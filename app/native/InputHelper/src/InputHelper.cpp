// InputHelper.dll — inserção de texto por clipboard + Ctrl+V, e leitura da seleção.
// Algoritmo:
// 1. Backup do clipboard: primeiro os formatos de texto (até 5 MB cada), depois os demais,
//    até 20 formatos e 30 MB no total, 5 MB por formato (20 MB para DIB/DIBV5), pulando
//    formatos que são handles GDI e não podem ser copiados como memória.
// 2. Grava o texto como CF_UNICODETEXT e relê para confirmar.
// 3. Cola com UM SendInput de 4 eventos (Ctrl↓ V↓ V↑ Ctrl↑), com a marca do Just Say.
// 4. Restaura numa thread separada: espera 500 ms, tenta abrir o clipboard até 5 vezes
//    (100 ms entre tentativas), esvazia e regrava os formatos salvos.
// 6. Seleção por cópia simulada: só sem modificadores; 50 ms, Ctrl+C, 200 ms; devolve só
//    o texto antigo ao clipboard; corta em 5000 caracteres.

#include <windows.h>
#include <ole2.h>  // WIN32_LEAN_AND_MEAN tira o COM, que o UIAutomation.h usa
#include <UIAutomation.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "JsonUtil.h"
#include "JustSayMarker.h"
#include "NativeUtil.h"

#define IH_API extern "C" __declspec(dllexport)

namespace {

constexpr size_t kMB = 1024 * 1024;
constexpr size_t kMaxTextFormatBytes = 5 * kMB;
constexpr size_t kMaxFormatBytes = 5 * kMB;
constexpr size_t kMaxImageBytes = 20 * kMB;
constexpr size_t kMaxTotalBytes = 30 * kMB;
constexpr size_t kMaxFormats = 20;
constexpr DWORD kRestoreDelayMs = 500;
constexpr int kRestoreRetries = 5;
constexpr DWORD kRestoreRetryMs = 100;
constexpr int kOpenRetries = 5;
constexpr DWORD kOpenRetryMs = 50;
constexpr DWORD kCopyPreMs = 50;
constexpr DWORD kCopyPostMs = 200;
constexpr size_t kMaxSelectionChars = 5000;

// Códigos de retorno (negativos = erro).
constexpr int kOk = 1;
constexpr int kErrOpen = -1;
constexpr int kErrWrite = -2;
constexpr int kErrVerify = -3;
constexpr int kErrModifiers = -4;
constexpr int kErrNoPattern = -5;
constexpr int kErrCom = -6;

HMODULE g_module = nullptr;

struct SavedFormat {
  UINT format;
  std::vector<uint8_t> data;
};
using Backup = std::vector<SavedFormat>;

struct ClipItem {
  UINT format;
  std::vector<uint8_t> data;
};

// ---------- janela dona do clipboard ----------
// EmptyClipboard com OpenClipboard(NULL) deixa o clipboard sem dono e faz SetClipboardData
// falhar. Cada operação cria uma janela de mensagens na própria thread e a destrói no fim.
class ClipboardOwner {
 public:
  ClipboardOwner() {
    static const wchar_t* kClass = L"JustSayClipboardOwner";
    static std::once_flag once;
    std::call_once(once, [] {
      WNDCLASSEXW wc = {sizeof(wc)};
      wc.lpfnWndProc = DefWindowProcW;
      wc.hInstance = g_module;
      wc.lpszClassName = kClass;
      RegisterClassExW(&wc);
    });
    hwnd_ = CreateWindowExW(0, kClass, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, g_module, nullptr);
  }
  ~ClipboardOwner() {
    if (hwnd_) DestroyWindow(hwnd_);
  }
  HWND hwnd() const { return hwnd_; }

 private:
  HWND hwnd_ = nullptr;
};

class ClipboardLock {
 public:
  ClipboardLock(HWND owner, int retries, DWORD retryMs) {
    for (int i = 0; i < retries; ++i) {
      if (OpenClipboard(owner)) {
        open_ = true;
        return;
      }
      Sleep(retryMs);
    }
  }
  ~ClipboardLock() {
    if (open_) CloseClipboard();
  }
  bool open() const { return open_; }

 private:
  bool open_ = false;
};

// ---------- backup ----------

bool IsUncopyableFormat(UINT f) {
  switch (f) {
    case CF_BITMAP:
    case CF_METAFILEPICT:
    case CF_PALETTE:
    case CF_ENHMETAFILE:
    case CF_PENDATA:
    case CF_DSPBITMAP:
    case CF_DSPMETAFILEPICT:
    case CF_DSPENHMETAFILE:
    case CF_OWNERDISPLAY:
      return true;
    default:
      // Faixas de handles GDI e privados: o conteúdo não é memória global copiável.
      return (f >= CF_GDIOBJFIRST && f <= CF_GDIOBJLAST) || (f >= CF_PRIVATEFIRST && f <= CF_PRIVATELAST);
  }
}

bool IsTextFormat(UINT f) { return f == CF_UNICODETEXT || f == CF_TEXT || f == CF_OEMTEXT; }

size_t LimitFor(UINT f) {
  if (IsTextFormat(f)) return kMaxTextFormatBytes;
  if (f == CF_DIB || f == CF_DIBV5) return kMaxImageBytes;
  return kMaxFormatBytes;
}

bool SaveFormat(UINT f, Backup& backup, size_t& total) {
  if (backup.size() >= kMaxFormats) return false;
  for (const auto& s : backup)
    if (s.format == f) return false;
  HANDLE h = GetClipboardData(f);
  if (!h) return false;
  const SIZE_T size = GlobalSize(h);
  if (size == 0 || size > LimitFor(f) || total + size > kMaxTotalBytes) return false;
  const void* p = GlobalLock(h);
  if (!p) return false;
  SavedFormat saved{f, std::vector<uint8_t>(static_cast<const uint8_t*>(p), static_cast<const uint8_t*>(p) + size)};
  GlobalUnlock(h);
  total += size;
  backup.push_back(std::move(saved));
  return true;
}

// Clipboard já aberto.
Backup TakeBackupLocked() {
  Backup backup;
  size_t total = 0;
  for (UINT f : {static_cast<UINT>(CF_UNICODETEXT), static_cast<UINT>(CF_TEXT), static_cast<UINT>(CF_OEMTEXT)}) {
    if (IsClipboardFormatAvailable(f)) SaveFormat(f, backup, total);
  }
  for (UINT f = EnumClipboardFormats(0); f != 0; f = EnumClipboardFormats(f)) {
    if (IsTextFormat(f) || IsUncopyableFormat(f)) continue;
    SaveFormat(f, backup, total);
  }
  return backup;
}

bool PutData(UINT format, const void* data, size_t size) {
  HGLOBAL g = GlobalAlloc(GMEM_MOVEABLE, size ? size : 1);
  if (!g) return false;
  if (void* p = GlobalLock(g)) {
    if (size) std::memcpy(p, data, size);
    GlobalUnlock(g);
  }
  if (!SetClipboardData(format, g)) {
    GlobalFree(g);
    return false;
  }
  return true;
}

// Marca o conteúdo para não entrar no histórico do Win+V nem na nuvem (ver DECISOES).
void MarkExcludedFromHistoryLocked() {
  static const UINT exclude = RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing");
  static const UINT canHistory = RegisterClipboardFormatW(L"CanIncludeInClipboardHistory");
  static const UINT canCloud = RegisterClipboardFormatW(L"CanUploadToCloudClipboard");
  const DWORD zero = 0;
  PutData(exclude, &zero, sizeof(zero));
  PutData(canHistory, &zero, sizeof(zero));
  PutData(canCloud, &zero, sizeof(zero));
}

bool HasFormat(const Backup& backup, UINT f) {
  for (const auto& s : backup)
    if (s.format == f) return true;
  return false;
}

// Clipboard aberto e esvaziado.
void WriteBackupLocked(const Backup& backup) {
  for (const auto& s : backup) PutData(s.format, s.data.data(), s.data.size());
  static const UINT exclude = RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing");
  if (!HasFormat(backup, exclude)) MarkExcludedFromHistoryLocked();
}

std::optional<std::wstring> ReadUnicodeTextLocked() {
  HANDLE h = GetClipboardData(CF_UNICODETEXT);
  if (!h) return std::nullopt;
  const wchar_t* p = static_cast<const wchar_t*>(GlobalLock(h));
  if (!p) return std::nullopt;
  const size_t maxChars = GlobalSize(h) / sizeof(wchar_t);
  size_t len = 0;
  while (len < maxChars && p[len]) ++len;
  std::wstring text(p, len);
  GlobalUnlock(h);
  return text;
}

std::vector<uint8_t> Utf16Bytes(const std::wstring& s) {
  const auto* b = reinterpret_cast<const uint8_t*>(s.c_str());
  return std::vector<uint8_t>(b, b + (s.size() + 1) * sizeof(wchar_t));
}

std::vector<uint8_t> Utf8Bytes(const std::string& s) {
  std::vector<uint8_t> v(s.begin(), s.end());
  v.push_back(0);
  return v;
}

// ---------- teclado ----------

void SendChord(WORD vk) {
  INPUT in[4] = {};
  const WORD keys[4] = {VK_CONTROL, vk, vk, VK_CONTROL};
  for (int i = 0; i < 4; ++i) {
    in[i].type = INPUT_KEYBOARD;
    in[i].ki.wVk = keys[i];
    in[i].ki.wScan = static_cast<WORD>(MapVirtualKeyW(keys[i], MAPVK_VK_TO_VSC));
    in[i].ki.dwFlags = (i >= 2) ? KEYEVENTF_KEYUP : 0;
    in[i].ki.dwExtraInfo = kJustSayInjectMarker;
  }
  SendInput(4, in, sizeof(INPUT));
}

bool AnyModifierDown() {
  for (int vk : {VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN})
    if (GetAsyncKeyState(vk) & 0x8000) return true;
  return false;
}

// ---------- restauração pendente ----------
// Uma colagem nova antes da restauração reaproveita o backup original (o clipboard ainda
// tem o nosso texto) e invalida a restauração anterior.

std::mutex g_mutex;  // serializa todas as operações deste DLL no clipboard
struct Pending {
  std::shared_ptr<Backup> backup;
  DWORD sequenceAfterSet;
  uint64_t generation;
};
std::optional<Pending> g_pending;
uint64_t g_generation = 0;

void RestoreLocked(const Pending& pending) {
  // Alguém copiou outra coisa depois de nós: não sobrescreve.
  if (GetClipboardSequenceNumber() != pending.sequenceAfterSet) return;
  ClipboardOwner owner;
  ClipboardLock lock(owner.hwnd(), kRestoreRetries, kRestoreRetryMs);
  if (!lock.open()) return;
  EmptyClipboard();
  WriteBackupLocked(*pending.backup);
}

void RestoreThread(uint64_t generation) {
  Sleep(kRestoreDelayMs);
  std::lock_guard<std::mutex> lock(g_mutex);
  if (!g_pending || g_pending->generation != generation) return;
  RestoreLocked(*g_pending);
  g_pending.reset();
}

// Espera uma restauração pendente terminar (até ~1,5 s). g_mutex NÃO pode estar preso.
void WaitPendingRestore() {
  for (int i = 0; i < 30; ++i) {
    {
      std::lock_guard<std::mutex> lock(g_mutex);
      if (!g_pending) return;
    }
    Sleep(50);
  }
}

int InsertImpl(const std::vector<ClipItem>& items, const std::wstring& verifyText, bool paste) {
  std::unique_lock<std::mutex> lock(g_mutex);
  ClipboardOwner owner;

  std::shared_ptr<Backup> backup;
  if (g_pending) {
    backup = g_pending->backup;
  } else {
    ClipboardLock clip(owner.hwnd(), kOpenRetries, kOpenRetryMs);
    if (!clip.open()) return kErrOpen;
    backup = std::make_shared<Backup>(TakeBackupLocked());
  }
  const uint64_t generation = ++g_generation;
  g_pending.reset();

  auto writeItems = [&]() -> int {
    ClipboardLock clip(owner.hwnd(), kOpenRetries, kOpenRetryMs);
    if (!clip.open()) return kErrOpen;
    if (!EmptyClipboard()) return kErrWrite;
    for (const auto& item : items)
      if (!PutData(item.format, item.data.data(), item.data.size())) return kErrWrite;
    MarkExcludedFromHistoryLocked();
    return kOk;
  };
  auto verify = [&]() -> bool {
    ClipboardLock clip(owner.hwnd(), kOpenRetries, kOpenRetryMs);
    if (!clip.open()) return false;
    auto text = ReadUnicodeTextLocked();
    return text && *text == verifyText;
  };

  int rc = writeItems();
  if (rc == kOk && !verify()) rc = writeItems() == kOk && verify() ? kOk : kErrVerify;
  if (rc != kOk) {
    // Não deixa o clipboard pela metade: devolve o original na hora.
    RestoreLocked(Pending{backup, GetClipboardSequenceNumber(), generation});
    return rc;
  }

  const DWORD sequence = GetClipboardSequenceNumber();
  if (paste) SendChord('V');
  g_pending = Pending{backup, sequence, generation};
  lock.unlock();
  std::thread(RestoreThread, generation).detach();
  return kOk;
}

// ---------- CF_HTML ----------

std::string BuildCfHtml(const std::string& fragment) {
  const std::string pre = "<html><body>\r\n<!--StartFragment-->";
  const std::string post = "<!--EndFragment-->\r\n</body></html>";
  const char* headerFmt =
      "Version:0.9\r\nStartHTML:%010zu\r\nEndHTML:%010zu\r\nStartFragment:%010zu\r\nEndFragment:%010zu\r\n";
  char header[160];
  const size_t headerLen = static_cast<size_t>(sprintf_s(header, headerFmt, size_t{0}, size_t{0}, size_t{0}, size_t{0}));
  const size_t startHtml = headerLen;
  const size_t startFragment = startHtml + pre.size();
  const size_t endFragment = startFragment + fragment.size();
  const size_t endHtml = endFragment + post.size();
  sprintf_s(header, headerFmt, startHtml, endHtml, startFragment, endFragment);
  return std::string(header) + pre + fragment + post;
}

std::string Utf8FromWide(const std::wstring& w) { return WideToUtf8(w); }

}  // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = module;
    DisableThreadLibraryCalls(module);
  }
  return TRUE;
}

// Cola `text` no campo em foco. 1 = ok; negativo = erro (ver códigos acima).
IH_API int insertText(const char16_t* text) {
  const std::wstring t = Utf16FromChar16(text);
  return InsertImpl({{CF_UNICODETEXT, Utf16Bytes(t)}}, t, true);
}

// Cola texto rico: HTML Format + text/markdown + texto plano. `markdown` pode ser nulo.
IH_API int insertRichText(const char16_t* html, const char16_t* text, const char16_t* markdown) {
  const std::wstring plain = Utf16FromChar16(text);
  std::vector<ClipItem> items;
  static const UINT cfHtml = RegisterClipboardFormatW(L"HTML Format");
  static const UINT cfMarkdown = RegisterClipboardFormatW(L"text/markdown");
  items.push_back({cfHtml, Utf8Bytes(BuildCfHtml(Utf8FromWide(Utf16FromChar16(html))))});
  if (markdown) items.push_back({cfMarkdown, Utf8Bytes(Utf8FromWide(Utf16FromChar16(markdown)))});
  items.push_back({CF_UNICODETEXT, Utf16Bytes(plain)});
  return InsertImpl(items, plain, true);
}

// Só para teste automatizado: faz backup, grava e agenda a restauração, sem colar.
IH_API int debugInsertTextWithoutPaste(const char16_t* text) {
  const std::wstring t = Utf16FromChar16(text);
  return InsertImpl({{CF_UNICODETEXT, Utf16Bytes(t)}}, t, false);
}

// Seleção por cópia simulada. Escreve UTF-8 em `out`; devolve o tamanho, ou negativo.
// Chame fora da thread principal (koffi .async): dorme 250 ms.
IH_API int getSelectedTextBySimulateCopy(char* out, int capacity) {
  if (AnyModifierDown()) return kErrModifiers;
  WaitPendingRestore();
  std::lock_guard<std::mutex> lock(g_mutex);
  ClipboardOwner owner;

  std::optional<std::wstring> oldText;
  {
    ClipboardLock clip(owner.hwnd(), kOpenRetries, kOpenRetryMs);
    if (!clip.open()) return kErrOpen;
    oldText = ReadUnicodeTextLocked();
    EmptyClipboard();
  }
  const DWORD before = GetClipboardSequenceNumber();
  Sleep(kCopyPreMs);
  SendChord('C');
  Sleep(kCopyPostMs);

  std::wstring selection;
  {
    ClipboardLock clip(owner.hwnd(), kRestoreRetries, kRestoreRetryMs);
    if (!clip.open()) return kErrOpen;
    if (GetClipboardSequenceNumber() != before) {
      if (auto copied = ReadUnicodeTextLocked()) selection = *copied;
    }
    EmptyClipboard();
    if (oldText) {
      PutData(CF_UNICODETEXT, oldText->c_str(), (oldText->size() + 1) * sizeof(wchar_t));
      MarkExcludedFromHistoryLocked();
    }
  }
  if (selection.size() > kMaxSelectionChars) selection.resize(kMaxSelectionChars);
  return WriteOut(Utf8FromWide(selection), out, capacity);
}

// ---------- seleção por UI Automation ----------

/** Texto selecionado num elemento com TextPattern. false = o elemento não tem TextPattern. */
bool SelectionFromElement(IUIAutomationElement* el, std::wstring& selection) {
  IUIAutomationTextPattern* pattern = nullptr;
  IUIAutomationTextRangeArray* ranges = nullptr;
  bool hasPattern = false;
  if (el && SUCCEEDED(el->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&pattern))) && pattern) {
    hasPattern = true;
    if (SUCCEEDED(pattern->GetSelection(&ranges)) && ranges) {
      int count = 0;
      ranges->get_Length(&count);
      for (int i = 0; i < count && selection.size() < kMaxSelectionChars; ++i) {
        IUIAutomationTextRange* range = nullptr;
        if (SUCCEEDED(ranges->GetElement(i, &range)) && range) {
          BSTR text = nullptr;
          const int remaining = static_cast<int>(kMaxSelectionChars - selection.size());
          if (SUCCEEDED(range->GetText(remaining, &text)) && text) {
            selection.append(text, SysStringLen(text));
            SysFreeString(text);
          }
          range->Release();
        }
      }
    }
  }
  SafeRelease(ranges);
  SafeRelease(pattern);
  return hasPattern;
}

/**
 * Seleção da página da janela (o primeiro elemento Document). Em Chrome, Edge e apps
 * Electron (Claude, Slack…), quem seleciona um trecho da conversa ou da página costuma deixar
 * o foco na caixa de texto; a seleção fica no documento, não no elemento focado.
 */
bool SelectionFromWindowDocument(IUIAutomation* uia, HWND hwnd, std::wstring& selection) {
  IUIAutomationElement* root = nullptr;
  IUIAutomationCondition* cond = nullptr;
  IUIAutomationElement* doc = nullptr;
  bool found = false;
  VARIANT v;
  VariantInit(&v);
  v.vt = VT_I4;
  v.lVal = UIA_DocumentControlTypeId;
  if (hwnd && SUCCEEDED(uia->ElementFromHandle(hwnd, &root)) && root &&
      SUCCEEDED(uia->CreatePropertyCondition(UIA_ControlTypePropertyId, v, &cond)) && cond &&
      SUCCEEDED(root->FindFirst(TreeScope_Descendants, cond, &doc)) && doc) {
    found = SelectionFromElement(doc, selection);
  }
  SafeRelease(doc);
  SafeRelease(cond);
  SafeRelease(root);
  return found;
}

// Apps Chromium (Chrome, Edge, Electron) só montam a árvore de acessibilidade quando um
// leitor de tela pede (mesmo protocolo da ContextHelper, D51). Uma vez por janela.
std::mutex g_wokenMutex;
std::set<HWND> g_woken;

BOOL CALLBACK WakeChromiumChild(HWND child, LPARAM) {
  wchar_t cls[64] = {};
  GetClassNameW(child, cls, 64);
  if (wcscmp(cls, L"Chrome_RenderWidgetHostHWND") == 0) {
    DWORD_PTR result = 0;
    SendMessageTimeoutW(child, WM_GETOBJECT, 0, 1, SMTO_ABORTIFHUNG | SMTO_BLOCK, 100, &result);
    NotifyWinEvent(EVENT_SYSTEM_ALERT, child, OBJID_CLIENT, 1);
  }
  return TRUE;
}

/** true = a janela é Chromium e acabou de ser acordada agora (a árvore leva um instante). */
bool WakeChromiumNow(HWND hwnd) {
  wchar_t cls[64] = {};
  GetClassNameW(hwnd, cls, 64);
  if (wcsncmp(cls, L"Chrome_WidgetWin_", 17) != 0) return false;
  {
    std::lock_guard<std::mutex> lock(g_wokenMutex);
    if (!g_woken.insert(hwnd).second) return false;
  }
  DWORD_PTR result = 0;
  SendMessageTimeoutW(hwnd, WM_GETOBJECT, 0, 1, SMTO_ABORTIFHUNG | SMTO_BLOCK, 100, &result);
  NotifyWinEvent(EVENT_SYSTEM_ALERT, hwnd, OBJID_CLIENT, 1);
  EnumChildWindows(hwnd, WakeChromiumChild, 0);
  return true;
}

/** Limita quanto cada chamada de UI Automation pode esperar um app travado. */
void SetUiaTimeouts(IUIAutomation* uia, DWORD ms) {
  IUIAutomation2* u2 = nullptr;
  if (uia && SUCCEEDED(uia->QueryInterface(IID_PPV_ARGS(&u2)))) {
    u2->put_ConnectionTimeout(ms);
    u2->put_TransactionTimeout(ms);
    u2->Release();
  }
}

/**
 * Seleção por UI Automation: primeiro no elemento focado; se ali não houver seleção, no
 * documento da janela. `hwnd` nulo = janela em primeiro plano; `useFocus` = olhar o foco.
 * `source` diz de onde veio: 1 foco, 2 documento, 0 nenhum.
 */
int SelectedTextUia(HWND hwnd, bool useFocus, char* out, int capacity, int* source) {
  ComScope com;
  if (!com.ok()) return kErrCom;
  IUIAutomation* uia = nullptr;
  if (FAILED(CoCreateInstance(__uuidof(CUIAutomation8), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&uia))) &&
      FAILED(CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&uia))))
    return kErrCom;
  SetUiaTimeouts(uia, 400);
  std::wstring selection;
  bool anyPattern = false;
  *source = 0;
  if (useFocus) {
    IUIAutomationElement* focused = nullptr;
    if (SUCCEEDED(uia->GetFocusedElement(&focused)) && focused) anyPattern = SelectionFromElement(focused, selection);
    SafeRelease(focused);
    if (!selection.empty()) *source = 1;
  }
  if (selection.empty()) {
    const HWND target = hwnd ? hwnd : GetForegroundWindow();
    // Janela Chromium ainda dormindo: acorda e tenta de novo enquanto a árvore aparece
    // (no teste, ela ficou pronta entre 300 e 600 ms depois de acordar).
    const bool justWoken = WakeChromiumNow(target);
    for (int attempt = 0; attempt < (justWoken ? 4 : 1); ++attempt) {
      if (justWoken) Sleep(150);
      std::wstring docSelection;
      if (SelectionFromWindowDocument(uia, target, docSelection)) {
        anyPattern = true;
        if (!docSelection.empty()) {
          selection = std::move(docSelection);
          *source = 2;
        }
        break;
      }
    }
  }
  SafeRelease(uia);
  if (!anyPattern) return kErrNoPattern;
  return WriteOut(Utf8FromWide(selection), out, capacity);
}

// Seleção por UI Automation (TextPattern), no foco e no documento da janela em primeiro plano.
// Escreve UTF-8 em `out`; devolve o tamanho, ou negativo.
IH_API int getSelectedText(char* out, int capacity) {
  int source = 0;
  return SelectedTextUia(nullptr, true, out, capacity, &source);
}

// Igual, mas diz de onde veio a seleção em `source` (1 foco, 2 documento, 0 nenhum), para o log.
IH_API int getSelectedTextWithSource(char* out, int capacity, int* source) {
  return SelectedTextUia(nullptr, true, out, capacity, source);
}

// Só para teste: seleção no documento de uma janela específica, sem depender do foco.
IH_API int debugGetSelectedTextInWindow(long long hwnd, char* out, int capacity) {
  int source = 0;
  return SelectedTextUia(reinterpret_cast<HWND>(hwnd), false, out, capacity, &source);
}

// Estado simples do foco: app em primeiro plano e campo com cursor. JSON UTF-8 em `out`.
IH_API int getCurrentInputState(char* out, int capacity) {
  HWND fg = GetForegroundWindow();
  DWORD pid = 0;
  const DWORD tid = fg ? GetWindowThreadProcessId(fg, &pid) : 0;

  std::wstring exePath;
  if (HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)) {
    wchar_t buf[MAX_PATH * 2];
    DWORD size = static_cast<DWORD>(std::size(buf));
    if (QueryFullProcessImageNameW(proc, 0, buf, &size)) exePath.assign(buf, size);
    CloseHandle(proc);
  }
  const size_t slash = exePath.find_last_of(L"\\/");
  const std::wstring exeName = slash == std::wstring::npos ? exePath : exePath.substr(slash + 1);

  wchar_t title[512] = {};
  wchar_t fgClass[256] = {};
  wchar_t focusClass[256] = {};
  if (fg) {
    GetWindowTextW(fg, title, static_cast<int>(std::size(title)));
    GetClassNameW(fg, fgClass, static_cast<int>(std::size(fgClass)));
  }
  GUITHREADINFO gti = {sizeof(gti)};
  const bool hasInfo = tid && GetGUIThreadInfo(tid, &gti);
  if (hasInfo && gti.hwndFocus) GetClassNameW(gti.hwndFocus, focusClass, static_cast<int>(std::size(focusClass)));

  std::string json = "{\"pid\":" + std::to_string(pid);
  json += ",\"exePath\":";
  JsonAppendEscaped(json, Utf8FromWide(exePath));
  json += ",\"exeName\":";
  JsonAppendEscaped(json, Utf8FromWide(exeName));
  json += ",\"title\":";
  JsonAppendEscaped(json, Utf8FromWide(title));
  json += ",\"windowClass\":";
  JsonAppendEscaped(json, Utf8FromWide(fgClass));
  json += ",\"focusClass\":";
  JsonAppendEscaped(json, Utf8FromWide(focusClass));
  json += ",\"hasCaret\":";
  json += (hasInfo && gti.hwndCaret) ? "true" : "false";
  if (hasInfo && gti.hwndCaret) {
    POINT pt = {gti.rcCaret.left, gti.rcCaret.top};
    ClientToScreen(gti.hwndCaret, &pt);
    json += ",\"caret\":{\"x\":" + std::to_string(pt.x) + ",\"y\":" + std::to_string(pt.y) +
            ",\"h\":" + std::to_string(gti.rcCaret.bottom - gti.rcCaret.top) + "}";
  }
  json += "}";
  return WriteOut(json, out, capacity);
}
