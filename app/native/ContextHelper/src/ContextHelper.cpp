// ContextHelper.dll — lê o contexto da tela por UI Automation.
//
// Duas chamadas assíncronas, cada uma responde UMA vez pelo callback (requestId, json):
//   ctxCaptureApp   → app em foco (exe, título, posição, PID, elevado) e URL do navegador (≤ 400 ms).
//                      Antes, "acorda" a acessibilidade de apps Chromium/Electron.
//   ctxCaptureFocus → campo focado (tipo, editável, texto antes/depois do cursor), texto
//                      visível da janela e texto antes/depois do campo na página.
// Cada uma roda numa thread própria, com COM em MTA e prazo: as chamadas de UIA usam o
// TransactionTimeout do IUIAutomation2, então uma janela travada não trava o Just Say.

#include <windows.h>
#include <ole2.h>  // WIN32_LEAN_AND_MEAN tira o COM
#include <UIAutomation.h>
#include <dwmapi.h>

#include <chrono>
#include <condition_variable>
#include <deque>
#include <future>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "JsonUtil.h"
#include "NativeUtil.h"

#define CH_API extern "C" __declspec(dllexport)

using ContextCallback = void (*)(int requestId, const char* json);

namespace {

// ---------- despacho dos callbacks (uma thread só, como no KeyboardHelper) ----------

std::mutex g_mutex;
std::condition_variable g_cv;
std::deque<std::pair<int, std::string>> g_queue;
ContextCallback g_callback = nullptr;
bool g_started = false;

void DispatcherMain() {
  while (true) {
    std::pair<int, std::string> item;
    {
      std::unique_lock<std::mutex> lock(g_mutex);
      g_cv.wait(lock, [] { return !g_queue.empty(); });
      item = std::move(g_queue.front());
      g_queue.pop_front();
    }
    if (g_callback) g_callback(item.first, item.second.c_str());
  }
}

void Reply(int requestId, std::string json) {
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_queue.emplace_back(requestId, std::move(json));
  }
  g_cv.notify_one();
}

// ---------- utilitários ----------

class Deadline {
 public:
  explicit Deadline(DWORD ms) : end_(GetTickCount64() + ms) {}
  DWORD remaining() const {
    const ULONGLONG now = GetTickCount64();
    return now >= end_ ? 0 : static_cast<DWORD>(end_ - now);
  }
  bool passed() const { return remaining() == 0; }

 private:
  ULONGLONG end_;
};

std::string Bstr(BSTR b) { return b ? WideToUtf8(std::wstring(b, SysStringLen(b))) : std::string(); }

/** Lê uma propriedade BSTR do elemento e libera. */
template <typename Getter>
std::string ReadBstr(Getter getter) {
  BSTR b = nullptr;
  std::string out;
  if (SUCCEEDED(getter(&b))) out = Bstr(b);
  SysFreeString(b);
  return out;
}

/** JSON simples, com vírgulas automáticas. */
class Json {
 public:
  Json& begin() { return raw("{"); }
  Json& end() {
    s_.push_back('}');
    first_ = false;
    return *this;
  }
  Json& key(const char* k) {
    if (!first_) s_.push_back(',');
    first_ = true;  // o próximo valor não leva vírgula
    JsonAppendEscaped(s_, k);
    s_.push_back(':');
    return *this;
  }
  Json& str(const char* k, const std::string& v) {
    key(k);
    JsonAppendEscaped(s_, v);
    first_ = false;
    return *this;
  }
  Json& num(const char* k, long long v) {
    key(k);
    s_ += std::to_string(v);
    first_ = false;
    return *this;
  }
  Json& boolean(const char* k, bool v) {
    key(k);
    s_ += v ? "true" : "false";
    first_ = false;
    return *this;
  }
  Json& null(const char* k) {
    key(k);
    s_ += "null";
    first_ = false;
    return *this;
  }
  Json& rawValue(const char* k, const std::string& v) {
    key(k);
    s_ += v;
    first_ = false;
    return *this;
  }
  Json& openObject(const char* k) {
    key(k);
    s_.push_back('{');
    first_ = true;
    return *this;
  }
  const std::string& text() const { return s_; }

 private:
  Json& raw(const char* r) {
    s_ += r;
    first_ = true;
    return *this;
  }
  std::string s_;
  bool first_ = true;
};

std::string RectJson(const RECT& r) {
  return "{\"x\":" + std::to_string(r.left) + ",\"y\":" + std::to_string(r.top) + ",\"w\":" +
         std::to_string(r.right - r.left) + ",\"h\":" + std::to_string(r.bottom - r.top) + "}";
}

/** Registro de sondas: nome, duração e se estourou o prazo (context_metadata). */
class Probes {
 public:
  void add(const char* name, ULONGLONG startedAt, bool ok, bool timedOut = false) {
    if (!list_.empty()) list_.push_back(',');
    list_ += "{\"name\":\"";
    list_ += name;
    list_ += "\",\"ms\":" + std::to_string(GetTickCount64() - startedAt) + ",\"ok\":" + (ok ? "true" : "false") +
             ",\"timedOut\":" + (timedOut ? "true" : "false") + "}";
  }
  std::string json() const { return "[" + list_ + "]"; }

 private:
  std::string list_;
};

int JsonInt(const char* json, const char* key, int fallback) {
  if (!json) return fallback;
  const std::string k = std::string("\"") + key + "\"";
  const char* p = strstr(json, k.c_str());
  if (!p) return fallback;
  p = strchr(p + k.size(), ':');
  if (!p) return fallback;
  ++p;
  while (*p == ' ') ++p;
  if (!strncmp(p, "true", 4)) return 1;
  if (!strncmp(p, "false", 5)) return 0;
  return atoi(p);
}

// ---------- UI Automation ----------

class Uia {
 public:
  explicit Uia(DWORD transactionMs) {
    if (FAILED(CoCreateInstance(__uuidof(CUIAutomation8), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&uia_))))
      CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&uia_));
    setTimeout(transactionMs);
  }
  ~Uia() { SafeRelease(uia_); }
  IUIAutomation* get() const { return uia_; }
  explicit operator bool() const { return uia_ != nullptr; }

  /** Limita quanto uma única chamada de UIA pode esperar o app alvo. */
  void setTimeout(DWORD ms) {
    IUIAutomation2* u2 = nullptr;
    if (uia_ && SUCCEEDED(uia_->QueryInterface(IID_PPV_ARGS(&u2)))) {
      const DWORD t = ms < 50 ? 50 : ms;
      u2->put_ConnectionTimeout(t);
      u2->put_TransactionTimeout(t);
      u2->Release();
    }
  }

 private:
  IUIAutomation* uia_ = nullptr;
};

IUIAutomationElement* FindFirstByControlType(IUIAutomation* uia, IUIAutomationElement* root, CONTROLTYPEID type) {
  VARIANT v;
  VariantInit(&v);
  v.vt = VT_I4;
  v.lVal = type;
  IUIAutomationCondition* cond = nullptr;
  IUIAutomationElement* found = nullptr;
  if (SUCCEEDED(uia->CreatePropertyCondition(UIA_ControlTypePropertyId, v, &cond)))
    root->FindFirst(TreeScope_Descendants, cond, &found);
  SafeRelease(cond);
  return found;
}

std::string RangeText(IUIAutomationTextRange* range, int maxChars) {
  BSTR b = nullptr;
  std::string out;
  if (range && SUCCEEDED(range->GetText(maxChars, &b))) out = Bstr(b);
  SysFreeString(b);
  return out;
}

/** Texto de até `chars` caracteres antes (dir < 0) ou depois (dir > 0) de um ponto do range. */
std::string TextAround(IUIAutomationTextRange* anchor, int dir, int chars) {
  if (!anchor || chars <= 0) return {};
  IUIAutomationTextRange* r = nullptr;
  if (FAILED(anchor->Clone(&r)) || !r) return {};
  int moved = 0;
  if (dir < 0) {
    r->MoveEndpointByRange(TextPatternRangeEndpoint_End, r, TextPatternRangeEndpoint_Start);
    r->MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -chars, &moved);
  } else {
    r->MoveEndpointByRange(TextPatternRangeEndpoint_Start, r, TextPatternRangeEndpoint_End);
    r->MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, chars, &moved);
  }
  std::string text = RangeText(r, chars);
  r->Release();
  return text;
}

// ---------- Chromium/Electron: ligar a árvore de acessibilidade ----------

BOOL CALLBACK WakeChild(HWND child, LPARAM) {
  wchar_t cls[64] = {};
  GetClassNameW(child, cls, 64);
  if (wcscmp(cls, L"Chrome_RenderWidgetHostHWND") == 0) {
    DWORD_PTR result = 0;
    SendMessageTimeoutW(child, WM_GETOBJECT, 0, 1, SMTO_ABORTIFHUNG | SMTO_BLOCK, 100, &result);
    NotifyWinEvent(EVENT_SYSTEM_ALERT, child, OBJID_CLIENT, 1);
  }
  return TRUE;
}

std::mutex g_wokenMutex;
std::set<HWND> g_woken;

/**
 * Apps Chromium só montam a árvore de acessibilidade quando "percebem" um leitor de tela.
 * Depois de ligada ela continua ligada, então cada janela só é acordada uma vez.
 */
bool WakeChromium(HWND hwnd) {
  wchar_t cls[64] = {};
  GetClassNameW(hwnd, cls, 64);
  if (wcsncmp(cls, L"Chrome_WidgetWin_", 17) != 0) return false;
  {
    std::lock_guard<std::mutex> lock(g_wokenMutex);
    if (!g_woken.insert(hwnd).second) return true;
  }
  DWORD_PTR result = 0;
  SendMessageTimeoutW(hwnd, WM_GETOBJECT, 0, 1, SMTO_ABORTIFHUNG | SMTO_BLOCK, 100, &result);
  NotifyWinEvent(EVENT_SYSTEM_ALERT, hwnd, OBJID_CLIENT, 1);
  EnumChildWindows(hwnd, WakeChild, 0);
  return true;
}

// ---------- app em foco ----------

const wchar_t* const kBrowsers[] = {L"chrome.exe",  L"msedge.exe",   L"firefox.exe",  L"brave.exe",
                                    L"opera.exe",   L"opera_gx.exe", L"vivaldi.exe",  L"chromium.exe",
                                    L"arc.exe",     L"iexplore.exe", L"waterfox.exe", L"tor.exe",
                                    L"librewolf.exe", L"thorium.exe"};

bool IsBrowserExe(const std::wstring& exe) {
  for (const wchar_t* b : kBrowsers)
    if (_wcsicmp(exe.c_str(), b) == 0) return true;
  return false;
}

/** -1 = não deu para saber (processo protegido, o que costuma indicar que é elevado). */
int ProcessElevated(DWORD pid) {
  HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!proc) return -1;
  int result = -1;
  HANDLE token = nullptr;
  if (OpenProcessToken(proc, TOKEN_QUERY, &token)) {
    TOKEN_ELEVATION elevation = {};
    DWORD size = 0;
    if (GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size))
      result = elevation.TokenIsElevated ? 1 : 0;
    CloseHandle(token);
  }
  CloseHandle(proc);
  return result;
}

void CaptureApp(int requestId, int timeoutMs, bool wantUrl) {
  ComScope com;
  Deadline deadline(static_cast<DWORD>(timeoutMs));
  Probes probes;
  Json j;
  j.begin();

  ULONGLONG t0 = GetTickCount64();
  HWND hwnd = GetForegroundWindow();
  DWORD pid = 0;
  const DWORD tid = hwnd ? GetWindowThreadProcessId(hwnd, &pid) : 0;
  std::wstring exePath;
  if (HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)) {
    wchar_t buf[MAX_PATH * 2];
    DWORD size = static_cast<DWORD>(std::size(buf));
    if (QueryFullProcessImageNameW(proc, 0, buf, &size)) exePath.assign(buf, size);
    CloseHandle(proc);
  }
  const size_t slash = exePath.find_last_of(L"\\/");
  const std::wstring exeName = slash == std::wstring::npos ? exePath : exePath.substr(slash + 1);
  wchar_t title[1024] = {};
  wchar_t cls[256] = {};
  RECT bounds = {};
  if (hwnd) {
    GetWindowTextW(hwnd, title, static_cast<int>(std::size(title)));
    GetClassNameW(hwnd, cls, static_cast<int>(std::size(cls)));
    if (FAILED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds))))
      GetWindowRect(hwnd, &bounds);
  }
  GUITHREADINFO gti = {sizeof(gti)};
  const bool hasInfo = tid && GetGUIThreadInfo(tid, &gti);
  const bool isBrowser = IsBrowserExe(exeName);
  const int elevated = ProcessElevated(pid);

  j.openObject("app")
      .num("pid", pid)
      .str("exePath", WideToUtf8(exePath))
      .str("exeName", WideToUtf8(exeName))
      .str("title", WideToUtf8(title))
      .str("windowClass", WideToUtf8(cls))
      .rawValue("bounds", RectJson(bounds))
      .boolean("isBrowser", isBrowser)
      .boolean("hasCaret", hasInfo && gti.hwndCaret != nullptr);
  if (elevated < 0) j.null("isElevated");
  else j.boolean("isElevated", elevated == 1);
  j.end();
  probes.add("app", t0, hwnd != nullptr);

  t0 = GetTickCount64();
  const bool woke = hwnd && WakeChromium(hwnd);
  probes.add("wake_chromium", t0, woke);

  // URL: o elemento "Document" da página expõe a URL no ValuePattern e o título no Name.
  if (wantUrl && isBrowser && hwnd && !deadline.passed()) {
    t0 = GetTickCount64();
    Uia uia(deadline.remaining());
    IUIAutomationElement* root = nullptr;
    IUIAutomationElement* doc = nullptr;
    IUIAutomationValuePattern* value = nullptr;
    std::string url, pageTitle;
    if (uia && SUCCEEDED(uia.get()->ElementFromHandle(hwnd, &root)) && root) {
      doc = FindFirstByControlType(uia.get(), root, UIA_DocumentControlTypeId);
      if (doc) {
        pageTitle = ReadBstr([&](BSTR* b) { return doc->get_CurrentName(b); });
        if (SUCCEEDED(doc->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value)
          url = ReadBstr([&](BSTR* b) { return value->get_CurrentValue(b); });
      }
    }
    SafeRelease(value);
    SafeRelease(doc);
    SafeRelease(root);
    const bool timedOut = deadline.passed();
    probes.add("browser_url", t0, !url.empty(), timedOut);
    j.openObject("browser").str("url", url).str("pageTitle", pageTitle).end();
  } else {
    j.null("browser");
  }

  j.rawValue("probes", probes.json()).end();
  Reply(requestId, j.text());
}

// ---------- campo focado, texto visível e entorno ----------

struct FocusOptions {
  int timeoutMs;
  int visibleTimeoutMs;
  int cursorChars;
  int visibleChars;
  int surroundingChars;
  bool readText;
  long long hwnd;  // só para teste
};

/** Junta o texto das partes visíveis da janela em ordem de leitura (apps nativos). */
std::string VisibleTextFromTree(IUIAutomation* uia, IUIAutomationElement* root, IUIAutomationElement* focused,
                                size_t maxChars, std::string& beforeFocus, std::string& afterFocus, int surroundChars) {
  IUIAutomationCacheRequest* cache = nullptr;
  IUIAutomationCondition* notOff = nullptr;
  IUIAutomationElementArray* items = nullptr;
  std::string text;
  if (FAILED(uia->CreateCacheRequest(&cache))) return text;
  cache->AddProperty(UIA_NamePropertyId);
  cache->AddProperty(UIA_ControlTypePropertyId);
  cache->AddProperty(UIA_ValueValuePropertyId);
  cache->AddProperty(UIA_IsPasswordPropertyId);

  VARIANT v;
  VariantInit(&v);
  v.vt = VT_BOOL;
  v.boolVal = VARIANT_FALSE;
  uia->CreatePropertyCondition(UIA_IsOffscreenPropertyId, v, &notOff);
  if (notOff && SUCCEEDED(root->FindAllBuildCache(TreeScope_Descendants, notOff, cache, &items)) && items) {
    int count = 0;
    items->get_Length(&count);
    int focusIndex = -1;
    std::vector<std::string> pieces;
    for (int i = 0; i < count && i < 4000; ++i) {
      IUIAutomationElement* el = nullptr;
      if (FAILED(items->GetElement(i, &el)) || !el) continue;
      CONTROLTYPEID type = 0;
      el->get_CachedControlType(&type);
      BOOL isPassword = FALSE;
      el->get_CachedIsPassword(&isPassword);
      std::string piece;
      if (!isPassword) {
        if (type == UIA_TextControlTypeId || type == UIA_HyperlinkControlTypeId || type == UIA_ListItemControlTypeId ||
            type == UIA_DataItemControlTypeId || type == UIA_TreeItemControlTypeId || type == UIA_HeaderItemControlTypeId ||
            type == UIA_TitleBarControlTypeId || type == UIA_TabItemControlTypeId) {
          piece = ReadBstr([&](BSTR* b) { return el->get_CachedName(b); });
        } else if (type == UIA_EditControlTypeId || type == UIA_DocumentControlTypeId) {
          VARIANT val;
          VariantInit(&val);
          if (SUCCEEDED(el->GetCachedPropertyValue(UIA_ValueValuePropertyId, &val)) && val.vt == VT_BSTR)
            piece = Bstr(val.bstrVal);
          VariantClear(&val);
        }
      }
      if (focused && focusIndex < 0) {
        BOOL same = FALSE;
        if (SUCCEEDED(uia->CompareElements(el, focused, &same)) && same) focusIndex = static_cast<int>(pieces.size());
      }
      el->Release();
      if (!piece.empty()) pieces.push_back(std::move(piece));
    }
    for (const auto& p : pieces) {
      if (text.size() >= maxChars) break;
      if (!text.empty()) text.push_back('\n');
      text += p;
    }
    if (text.size() > maxChars) text.resize(maxChars);
    if (focusIndex >= 0) {
      for (int i = focusIndex - 1; i >= 0 && static_cast<int>(beforeFocus.size()) < surroundChars; --i)
        beforeFocus = pieces[i] + (beforeFocus.empty() ? "" : "\n") + beforeFocus;
      for (size_t i = focusIndex + 1; i < pieces.size() && static_cast<int>(afterFocus.size()) < surroundChars; ++i)
        afterFocus += (afterFocus.empty() ? "" : "\n") + pieces[i];
    }
  }
  SafeRelease(items);
  SafeRelease(notOff);
  SafeRelease(cache);
  return text;
}

constexpr size_t kMinDocumentText = 200;

struct VisibleResult {
  std::string text;
  std::string source = "none";
  std::string before;
  std::string after;
  ULONGLONG ms = 0;
};

/** Tira o caractere de "objeto embutido" (U+FFFC) que o Chromium põe no lugar de imagens e players. */
std::string CleanVisible(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  int newlines = 0;
  for (size_t i = 0; i < in.size(); ++i) {
    if (i + 2 < in.size() && static_cast<unsigned char>(in[i]) == 0xEF && static_cast<unsigned char>(in[i + 1]) == 0xBF &&
        static_cast<unsigned char>(in[i + 2]) == 0xBC) {
      i += 2;
      continue;
    }
    if (in[i] == '\n') {
      if (++newlines > 2) continue;
    } else if (in[i] != '\r' && in[i] != ' ') {
      newlines = 0;
    }
    out.push_back(in[i]);
  }
  size_t a = out.find_first_not_of(" \n\r\t");
  size_t b = out.find_last_not_of(" \n\r\t");
  return a == std::string::npos ? std::string() : out.substr(a, b - a + 1);
}

/** Thread do texto visível: prazo próprio, roda em paralelo com a leitura do campo. */
void CaptureVisible(std::shared_ptr<std::promise<VisibleResult>> out, FocusOptions opt) {
  ComScope com;
  const ULONGLONG t0 = GetTickCount64();
  Deadline deadline(static_cast<DWORD>(opt.visibleTimeoutMs));
  VisibleResult r;
  Uia uia(deadline.remaining());
  // `hwnd` nas opções só serve para teste: lê uma janela específica em vez da que está em foco.
  HWND hwnd = opt.hwnd ? reinterpret_cast<HWND>(static_cast<intptr_t>(opt.hwnd)) : GetForegroundWindow();
  if (hwnd) WakeChromium(hwnd);  // só age na primeira vez de cada janela
  IUIAutomationElement* root = nullptr;
  IUIAutomationElement* focused = nullptr;
  IUIAutomationElement* doc = nullptr;
  IUIAutomationTextPattern* docText = nullptr;
  if (uia && hwnd && SUCCEEDED(uia.get()->ElementFromHandle(hwnd, &root)) && root) {
    uia.get()->GetFocusedElement(&focused);
    // Páginas web e apps Electron: o documento tem TextPattern com as partes visíveis.
    doc = FindFirstByControlType(uia.get(), root, UIA_DocumentControlTypeId);
    if (doc && SUCCEEDED(doc->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&docText))) && docText) {
      IUIAutomationTextRangeArray* ranges = nullptr;
      uia.setTimeout(deadline.remaining());
      if (SUCCEEDED(docText->GetVisibleRanges(&ranges)) && ranges) {
        int n = 0;
        ranges->get_Length(&n);
        for (int i = 0; i < n && static_cast<int>(r.text.size()) < opt.visibleChars && !deadline.passed(); ++i) {
          IUIAutomationTextRange* range = nullptr;
          if (SUCCEEDED(ranges->GetElement(i, &range)) && range) {
            if (!r.text.empty()) r.text.push_back('\n');
            r.text += RangeText(range, opt.visibleChars - static_cast<int>(r.text.size()));
            range->Release();
          }
        }
        ranges->Release();
        r.source = "document";
      }
    }
    // Apps nativos, ou documento que devolveu quase nada (comum em páginas com vídeo ou
    // muito JavaScript): junta os textos dos elementos visíveis em ordem de leitura.
    if (CleanVisible(r.text).size() < kMinDocumentText && !deadline.passed()) {
      uia.setTimeout(deadline.remaining());
      std::string before, after;
      std::string fromTree = VisibleTextFromTree(uia.get(), doc ? doc : root, focused,
                                                 static_cast<size_t>(opt.visibleChars), before, after,
                                                 opt.surroundingChars);
      if (CleanVisible(fromTree).size() > CleanVisible(r.text).size()) {
        r.text = std::move(fromTree);
        r.source = "tree";
        r.before = std::move(before);
        r.after = std::move(after);
      }
    }
  }
  SafeRelease(docText);
  SafeRelease(doc);
  SafeRelease(focused);
  SafeRelease(root);
  r.text = CleanVisible(r.text);
  r.ms = GetTickCount64() - t0;
  out->set_value(std::move(r));
}

void CaptureFocus(int requestId, FocusOptions opt) {
  ComScope com;
  const ULONGLONG started = GetTickCount64();
  Deadline deadline(static_cast<DWORD>(opt.timeoutMs));
  Probes probes;
  Json j;
  j.begin();

  // O texto visível começa já, em paralelo.
  std::future<VisibleResult> visibleFuture;
  if (opt.readText) {
    auto promise = std::make_shared<std::promise<VisibleResult>>();
    visibleFuture = promise->get_future();
    std::thread(CaptureVisible, promise, opt).detach();
  }

  ULONGLONG t0 = GetTickCount64();
  Uia uia(deadline.remaining());
  IUIAutomationElement* focused = nullptr;
  if (!uia || FAILED(uia.get()->GetFocusedElement(&focused)) || !focused) {
    probes.add("focused_element", t0, false, deadline.passed());
    j.null("focused").rawValue("probes", probes.json()).end();
    Reply(requestId, j.text());
    return;
  }

  // --- metadados do campo ---
  CONTROLTYPEID type = 0;
  focused->get_CurrentControlType(&type);
  BOOL isPassword = FALSE, focusable = FALSE;
  focused->get_CurrentIsPassword(&isPassword);
  focused->get_CurrentIsKeyboardFocusable(&focusable);
  RECT rect = {};
  focused->get_CurrentBoundingRectangle(&rect);
  const std::string localizedType = ReadBstr([&](BSTR* b) { return focused->get_CurrentLocalizedControlType(b); });
  const std::string name = ReadBstr([&](BSTR* b) { return focused->get_CurrentName(b); });
  const std::string className = ReadBstr([&](BSTR* b) { return focused->get_CurrentClassName(b); });
  const std::string frameworkId = ReadBstr([&](BSTR* b) { return focused->get_CurrentFrameworkId(b); });
  const std::string automationId = ReadBstr([&](BSTR* b) { return focused->get_CurrentAutomationId(b); });
  const std::string helpText = ReadBstr([&](BSTR* b) { return focused->get_CurrentHelpText(b); });
  const std::string ariaRole = ReadBstr([&](BSTR* b) { return focused->get_CurrentAriaRole(b); });
  const std::string ariaProps = ReadBstr([&](BSTR* b) { return focused->get_CurrentAriaProperties(b); });

  IUIAutomationValuePattern* valuePattern = nullptr;
  IUIAutomationTextPattern* textPattern = nullptr;
  focused->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&valuePattern));
  focused->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&textPattern));
  BOOL readOnly = TRUE;
  if (valuePattern) valuePattern->get_CurrentIsReadOnly(&readOnly);
  const bool ariaReadOnly = ariaProps.find("readonly=true") != std::string::npos;
  // A raiz de uma página web (Chrome, Edge, Electron, Firefox) é um Document com TextPattern
  // e foco de teclado, mas com ValuePattern somente-leitura (a URL). Foco nela = sem campo.
  const bool readOnlyDocument = type == UIA_DocumentControlTypeId && valuePattern && readOnly;
  const bool editable =
      !ariaReadOnly && !readOnlyDocument && ((valuePattern && !readOnly) ||
                        (textPattern && focusable && (type == UIA_EditControlTypeId || type == UIA_DocumentControlTypeId)));
  const bool multiline = ariaProps.find("multiline=true") != std::string::npos || type == UIA_DocumentControlTypeId;
  probes.add("focused_element", t0, true, deadline.passed());

  // --- texto do campo em volta do cursor ---
  std::string before, after, selection, fullText;
  int beforeActual = 0, afterActual = 0;
  bool cursorKnown = false;
  if (opt.readText && !isPassword && !deadline.passed()) {
    t0 = GetTickCount64();
    uia.setTimeout(deadline.remaining());
    if (textPattern) {
      IUIAutomationTextRangeArray* sel = nullptr;
      IUIAutomationTextRange* caret = nullptr;
      if (SUCCEEDED(textPattern->GetSelection(&sel)) && sel) {
        int n = 0;
        sel->get_Length(&n);
        if (n > 0) sel->GetElement(0, &caret);
      }
      if (caret) {
        cursorKnown = true;
        selection = RangeText(caret, opt.cursorChars);
        before = TextAround(caret, -1, opt.cursorChars);
        after = TextAround(caret, 1, opt.cursorChars);
        caret->Release();
      }
      SafeRelease(sel);
    }
    if (!cursorKnown && valuePattern) {
      fullText = ReadBstr([&](BSTR* b) { return valuePattern->get_CurrentValue(b); });
      if (static_cast<int>(fullText.size()) > opt.cursorChars * 2) fullText.resize(opt.cursorChars * 2);
    }
    beforeActual = static_cast<int>(before.size());
    afterActual = static_cast<int>(after.size());
    probes.add("cursor_text", t0, cursorKnown || !fullText.empty(), deadline.passed());
  }

  // --- entorno do campo numa página (o texto da página antes e depois dele) ---
  // Só faz sentido quando o foco é um campo de texto; em outros elementos é só custo.
  std::string surroundBefore, surroundAfter;
  if (opt.readText && editable && !isPassword && !deadline.passed()) {
    t0 = GetTickCount64();
    uia.setTimeout(deadline.remaining());
    HWND hwnd = GetForegroundWindow();
    IUIAutomationElement* root = nullptr;
    IUIAutomationElement* doc = nullptr;
    IUIAutomationTextPattern* docText = nullptr;
    IUIAutomationTextRange* fieldRange = nullptr;
    if (hwnd && SUCCEEDED(uia.get()->ElementFromHandle(hwnd, &root)) && root) {
      doc = FindFirstByControlType(uia.get(), root, UIA_DocumentControlTypeId);
      if (doc && SUCCEEDED(doc->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&docText))) && docText &&
          SUCCEEDED(docText->RangeFromChild(focused, &fieldRange)) && fieldRange) {
        surroundBefore = TextAround(fieldRange, -1, opt.surroundingChars);
        surroundAfter = TextAround(fieldRange, 1, opt.surroundingChars);
      }
    }
    SafeRelease(fieldRange);
    SafeRelease(docText);
    SafeRelease(doc);
    SafeRelease(root);
    probes.add("surrounding_text", t0, !surroundBefore.empty() || !surroundAfter.empty(), deadline.passed());
  }

  j.openObject("focused")
      .num("controlType", type)
      .str("localizedType", localizedType)
      .str("name", isPassword ? std::string() : name)
      .str("className", className)
      .str("frameworkId", frameworkId)
      .str("automationId", automationId)
      .str("placeholder", helpText)
      .str("ariaRole", ariaRole)
      .boolean("isEditable", editable)
      .boolean("isPassword", isPassword != FALSE)
      .boolean("isMultiline", multiline)
      .boolean("hasTextPattern", textPattern != nullptr)
      .boolean("hasValuePattern", valuePattern != nullptr)
      .rawValue("bounds", RectJson(rect))
      .boolean("cursorKnown", cursorKnown)
      .str("textBefore", before)
      .str("textAfter", after)
      .str("selection", selection)
      .str("fullText", fullText)
      .num("beforeCharsRequested", opt.readText ? opt.cursorChars : 0)
      .num("beforeCharsActual", beforeActual)
      .num("afterCharsRequested", opt.readText ? opt.cursorChars : 0)
      .num("afterCharsActual", afterActual)
      .end();
  SafeRelease(textPattern);
  SafeRelease(valuePattern);
  focused->Release();

  // --- espera o texto visível até o prazo dele ---
  VisibleResult visible;
  bool visibleDone = false;
  if (opt.readText && !isPassword && visibleFuture.valid()) {
    const ULONGLONG visibleEnd = started + static_cast<ULONGLONG>(opt.visibleTimeoutMs);
    const ULONGLONG now = GetTickCount64();
    const auto wait = std::chrono::milliseconds(visibleEnd > now ? visibleEnd - now : 0);
    if (visibleFuture.wait_for(wait) == std::future_status::ready) {
      visible = visibleFuture.get();
      visibleDone = true;
    }
    probes.add("visible_text", started, visibleDone && !visible.text.empty(), !visibleDone);
  }
  // Em apps nativos o entorno vem da leitura da árvore.
  if (surroundBefore.empty() && surroundAfter.empty() && visibleDone) {
    surroundBefore = visible.before;
    surroundAfter = visible.after;
  }

  j.str("visibleText", visible.text)
      .str("visibleSource", visible.source)
      .openObject("surrounding")
      .str("before", surroundBefore)
      .str("after", surroundAfter)
      .end()
      .rawValue("probes", probes.json())
      .end();
  Reply(requestId, j.text());
}

// ---------- leitura leve do campo focado (aprendizado por edição e dica de uso, Fase 7) ----------
// Só o campo: identidade (RuntimeId), se é editável e o texto inteiro dele. Sem texto da tela.

std::string RuntimeIdString(IUIAutomationElement* el) {
  SAFEARRAY* sa = nullptr;
  std::string out;
  if (SUCCEEDED(el->GetRuntimeId(&sa)) && sa) {
    LONG lo = 0, hi = -1;
    SafeArrayGetLBound(sa, 1, &lo);
    SafeArrayGetUBound(sa, 1, &hi);
    for (LONG i = lo; i <= hi; ++i) {
      int v = 0;
      SafeArrayGetElement(sa, &i, &v);
      if (!out.empty()) out += '.';
      out += std::to_string(v);
    }
    SafeArrayDestroy(sa);
  }
  return out;
}

void ReadField(int requestId, int timeoutMs, int maxChars) {
  ComScope com;
  Json j;
  j.begin();
  Uia uia(static_cast<DWORD>(timeoutMs));
  IUIAutomationElement* focused = nullptr;
  if (!uia || FAILED(uia.get()->GetFocusedElement(&focused)) || !focused) {
    j.null("field").end();
    Reply(requestId, j.text());
    return;
  }
  CONTROLTYPEID type = 0;
  focused->get_CurrentControlType(&type);
  BOOL isPassword = FALSE, focusable = FALSE;
  focused->get_CurrentIsPassword(&isPassword);
  focused->get_CurrentIsKeyboardFocusable(&focusable);
  int pid = 0;
  focused->get_CurrentProcessId(&pid);
  const std::string frameworkId = ReadBstr([&](BSTR* b) { return focused->get_CurrentFrameworkId(b); });
  const std::string ariaProps = ReadBstr([&](BSTR* b) { return focused->get_CurrentAriaProperties(b); });
  IUIAutomationValuePattern* valuePattern = nullptr;
  IUIAutomationTextPattern* textPattern = nullptr;
  focused->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&valuePattern));
  focused->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&textPattern));
  BOOL readOnly = TRUE;
  if (valuePattern) valuePattern->get_CurrentIsReadOnly(&readOnly);
  // Mesma regra da CaptureFocus (D61).
  const bool ariaReadOnly = ariaProps.find("readonly=true") != std::string::npos;
  const bool readOnlyDocument = type == UIA_DocumentControlTypeId && valuePattern && readOnly;
  const bool editable =
      !ariaReadOnly && !readOnlyDocument &&
      ((valuePattern && !readOnly) ||
       (textPattern && focusable && (type == UIA_EditControlTypeId || type == UIA_DocumentControlTypeId)));

  std::string text;
  bool textKnown = false;
  if (editable && !isPassword && maxChars > 0) {
    IUIAutomationTextRange* all = nullptr;
    if (textPattern && SUCCEEDED(textPattern->get_DocumentRange(&all)) && all) {
      BSTR b = nullptr;
      if (SUCCEEDED(all->GetText(maxChars, &b))) {
        text = Bstr(b);
        textKnown = true;
      }
      SysFreeString(b);
      all->Release();
    }
    if (!textKnown && valuePattern) {
      text = ReadBstr([&](BSTR* b) { return valuePattern->get_CurrentValue(b); });
      if (static_cast<int>(text.size()) > maxChars) text.resize(maxChars);
      textKnown = true;
    }
  }

  j.openObject("field")
      .str("id", RuntimeIdString(focused))
      .num("pid", pid)
      .num("controlType", type)
      .str("frameworkId", frameworkId)
      .boolean("isEditable", editable)
      .boolean("isPassword", isPassword != FALSE)
      .boolean("textKnown", textKnown)
      .str("text", text)
      .end()
      .end();
  SafeRelease(textPattern);
  SafeRelease(valuePattern);
  focused->Release();
  Reply(requestId, j.text());
}

}  // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) DisableThreadLibraryCalls(module);
  return TRUE;
}

// Registra o callback. Chamar uma vez antes das capturas.
CH_API int ctxInit(ContextCallback callback) {
  std::lock_guard<std::mutex> lock(g_mutex);
  g_callback = callback;
  if (!g_started) {
    g_started = true;
    std::thread(DispatcherMain).detach();
  }
  return 1;
}

// App em foco + URL do navegador. Responde pelo callback com o mesmo requestId.
CH_API int ctxCaptureApp(int requestId, int timeoutMs, int wantUrl) {
  if (!g_callback) return 0;
  std::thread(CaptureApp, requestId, timeoutMs, wantUrl != 0).detach();
  return 1;
}

// Campo focado, texto visível e entorno. `optionsJson`:
// {"timeoutMs":..,"visibleTimeoutMs":..,"cursorChars":..,"visibleChars":..,"surroundingChars":..,"readText":true|false}
CH_API int ctxCaptureFocus(int requestId, const char* optionsJson) {
  if (!g_callback) return 0;
  FocusOptions opt{
      JsonInt(optionsJson, "timeoutMs", 500),
      JsonInt(optionsJson, "visibleTimeoutMs", 1500),
      JsonInt(optionsJson, "cursorChars", 4000),
      JsonInt(optionsJson, "visibleChars", 40000),
      JsonInt(optionsJson, "surroundingChars", 4000),
      JsonInt(optionsJson, "readText", 1) != 0,
      static_cast<long long>(JsonInt(optionsJson, "hwnd", 0)),
  };
  std::thread(CaptureFocus, requestId, opt).detach();
  return 1;
}

// Leitura leve do campo focado: {"field":{"id","pid","controlType","frameworkId","isEditable",
// "isPassword","textKnown","text"}} ou {"field":null}. Nunca lê campo de senha.
CH_API int ctxReadField(int requestId, int timeoutMs, int maxChars) {
  if (!g_callback) return 0;
  std::thread(ReadField, requestId, timeoutMs, maxChars).detach();
  return 1;
}
