// KeyboardHelper.dll — hook global de teclado e mouse do Just Say.
//
// Desenho (ver DECISOES.md):
// - Uma thread de prioridade alta instala WH_KEYBOARD_LL e WH_MOUSE_LL e mantém uma
//   janela de mensagens. O hook só atualiza o estado, enfileira um retrato e faz
//   PostMessage(WM_USER+4) para a própria janela. Ele retorna na hora: nunca espera JS.
// - A janela serializa o JSON e entrega a uma thread despachante, que chama o callback
//   JS. O koffi bloqueia a thread que chama o callback até o JS rodar, então essa espera
//   fica isolada na despachante e não atrasa o hook (o Windows remove hooks lentos).
// - Teclas não modificadoras de um atalho reconhecido são engolidas, assim como o
//   "soltar" delas. Modificadores sempre passam (AltGr continua funcionando).

#include <windows.h>

#include <atomic>
#include <condition_variable>
#include <deque>
#include <future>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "JsonUtil.h"
#include "JustSayMarker.h"
#include "KeyNames.h"

#define KH_API extern "C" __declspec(dllexport)

using KeyCallback = void (*)(const char* json);

namespace {

constexpr UINT WM_KH_KEYS = WM_USER + 4;     // há retratos novos para serializar
constexpr UINT WM_KH_PHANTOM = WM_USER + 5;  // injetar tecla fantasma (wParam = vk)
constexpr UINT WM_KH_WATCHER = WM_USER + 6;  // reprogramar o vigia
constexpr UINT WM_KH_QUIT = WM_USER + 7;     // encerrar a thread do hook
constexpr UINT_PTR kWatcherTimerId = 1;
constexpr WORD kMenuMaskVk = 0xE8;           // VK sem uso: impede o Alt sozinho de abrir menus
constexpr DWORD kAltGrFakeCtrlScanFlag = 0x200;
constexpr DWORD kVkPacket = 0xE7;

struct PressedKey {
  std::string name;
  DWORD vk;
};

struct Snapshot {
  std::string type;  // down | up | reset | watcher
  std::string key;
  bool swallowed = false;
  std::vector<std::string> pressing;
  ULONGLONG time = 0;
};

struct DispatcherState {
  std::mutex mutex;
  std::condition_variable cv;
  std::deque<std::string> queue;
  bool stop = false;
  KeyCallback callback = nullptr;
};

HMODULE g_module = nullptr;

std::mutex g_stateMutex;
std::vector<PressedKey> g_pressing;
std::set<std::string> g_swallowed;
std::vector<std::vector<std::string>> g_targets;
std::deque<Snapshot> g_pending;
uint64_t g_seq = 0;

std::mutex g_lifecycleMutex;
std::atomic<bool> g_running{false};
std::atomic<UINT> g_watcherMs{5000};
std::thread g_hookThread;
HWND g_hwnd = nullptr;
HHOOK g_keyboardHook = nullptr;
HHOOK g_mouseHook = nullptr;
std::shared_ptr<DispatcherState> g_dispatch;

// ---------- estado (sempre com g_stateMutex) ----------

bool IsPressedLocked(const std::string& name) {
  for (const auto& k : g_pressing)
    if (k.name == name) return true;
  return false;
}

std::vector<std::string> PressingNamesLocked() {
  std::vector<std::string> names;
  names.reserve(g_pressing.size());
  for (const auto& k : g_pressing) names.push_back(k.name);
  return names;
}

const std::vector<std::string>* MatchTargetLocked() {
  for (const auto& target : g_targets) {
    if (target.empty() || target.size() != g_pressing.size()) continue;
    bool all = true;
    for (const auto& key : target) {
      if (!IsPressedLocked(key)) {
        all = false;
        break;
      }
    }
    if (all) return &target;
  }
  return nullptr;
}

void PushSnapshotLocked(const char* type, const std::string& key, bool swallowed) {
  Snapshot s;
  s.type = type;
  s.key = key;
  s.swallowed = swallowed;
  s.pressing = PressingNamesLocked();
  s.time = GetTickCount64();
  g_pending.push_back(std::move(s));
}

void NotifyWindow(UINT msg, WPARAM wParam = 0) {
  HWND hwnd = g_hwnd;
  if (hwnd) PostMessageW(hwnd, msg, wParam, 0);
}

// Processa uma tecla física. Devolve true se o evento deve ser engolido.
bool HandleKey(const std::string& name, DWORD vk, bool down) {
  bool swallow = false;
  WORD phantom = 0;
  {
    std::lock_guard<std::mutex> lock(g_stateMutex);
    if (down) {
      if (IsPressedLocked(name)) {
        // Auto-repetição: não muda o estado. Engole se o "apertar" original foi engolido.
        return g_swallowed.count(name) > 0;
      }
      g_pressing.push_back({name, vk});
      if (const auto* match = MatchTargetLocked()) {
        if (!IsModifierKey(name) && !IsPassthroughFunctionKey(vk)) {
          swallow = true;
          g_swallowed.insert(name);
        }
        for (const auto& k : *match) {
          if (IsWinKey(k)) phantom = VK_LSHIFT;
          else if (IsAltKey(k) && phantom == 0) phantom = kMenuMaskVk;
        }
      }
      PushSnapshotLocked("down", name, swallow);
    } else {
      for (auto it = g_pressing.begin(); it != g_pressing.end(); ++it) {
        if (it->name == name) {
          g_pressing.erase(it);
          break;
        }
      }
      swallow = g_swallowed.erase(name) > 0;
      PushSnapshotLocked("up", name, swallow);
    }
  }
  NotifyWindow(WM_KH_KEYS);
  if (phantom) NotifyWindow(WM_KH_PHANTOM, phantom);
  return swallow;
}

LRESULT CALLBACK KeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode != HC_ACTION) return CallNextHookEx(nullptr, nCode, wParam, lParam);
  const auto* k = reinterpret_cast<const KBDLLHOOKSTRUCT*>(lParam);

  // Teclas que nós mesmos injetamos passam direto.
  if (k->dwExtraInfo == kJustSayInjectMarker) return CallNextHookEx(nullptr, nCode, wParam, lParam);
  // Ctrl falso que o Windows gera junto com AltGr em layouts como o ABNT2.
  if (k->vkCode == VK_LCONTROL && (k->scanCode & kAltGrFakeCtrlScanFlag))
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
  if (k->vkCode == kVkPacket) return CallNextHookEx(nullptr, nCode, wParam, lParam);

  const bool down = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
  const std::string name = KeyNameFromVk(k->vkCode, k->flags);
  if (HandleKey(name, k->vkCode, down)) return 1;
  return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

LRESULT CALLBACK MouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode != HC_ACTION || wParam == WM_MOUSEMOVE) return CallNextHookEx(nullptr, nCode, wParam, lParam);
  const auto* m = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
  if (m->dwExtraInfo == kJustSayInjectMarker) return CallNextHookEx(nullptr, nCode, wParam, lParam);

  const char* name = nullptr;
  DWORD vk = 0;
  bool down = false;
  switch (wParam) {
    case WM_MBUTTONDOWN: name = "MouseMiddle"; vk = VK_MBUTTON; down = true; break;
    case WM_MBUTTONUP: name = "MouseMiddle"; vk = VK_MBUTTON; break;
    case WM_XBUTTONDOWN:
    case WM_XBUTTONUP: {
      const bool x1 = HIWORD(m->mouseData) == XBUTTON1;
      name = x1 ? "MouseX1" : "MouseX2";
      vk = x1 ? VK_XBUTTON1 : VK_XBUTTON2;
      down = wParam == WM_XBUTTONDOWN;
      break;
    }
    default: return CallNextHookEx(nullptr, nCode, wParam, lParam);
  }
  if (HandleKey(name, vk, down)) return 1;
  return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

// ---------- thread da janela ----------

std::string SnapshotToJson(const Snapshot& s, uint64_t seq) {
  std::string out = "{\"seq\":" + std::to_string(seq) + ",\"time\":" + std::to_string(s.time) + ",\"type\":";
  JsonAppendEscaped(out, s.type);
  out += ",\"key\":";
  JsonAppendEscaped(out, s.key);
  out += ",\"swallowed\":";
  out += s.swallowed ? "true" : "false";
  out += ",\"pressingKeys\":[";
  for (size_t i = 0; i < s.pressing.size(); ++i) {
    if (i) out.push_back(',');
    JsonAppendEscaped(out, s.pressing[i]);
  }
  out += "]}";
  return out;
}

void FlushPending() {
  std::deque<Snapshot> batch;
  uint64_t firstSeq = 0;
  {
    std::lock_guard<std::mutex> lock(g_stateMutex);
    batch.swap(g_pending);
    firstSeq = g_seq;
    g_seq += batch.size();
  }
  auto dispatch = g_dispatch;
  if (batch.empty() || !dispatch) return;
  {
    std::lock_guard<std::mutex> lock(dispatch->mutex);
    for (size_t i = 0; i < batch.size(); ++i) dispatch->queue.push_back(SnapshotToJson(batch[i], firstSeq + i + 1));
  }
  dispatch->cv.notify_one();
}

void InjectPhantom(WORD vk) {
  INPUT inputs[2] = {};
  for (auto& in : inputs) {
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = vk;
    in.ki.dwExtraInfo = kJustSayInjectMarker;
  }
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
  SendInput(2, inputs, sizeof(INPUT));
}

// Limpa teclas "presas": as que o estado diz pressionadas mas o sistema diz soltas.
// Teclas engolidas ficam de fora, porque o sistema nunca soube que elas desceram.
void RunWatcher() {
  bool changed = false;
  {
    std::lock_guard<std::mutex> lock(g_stateMutex);
    std::string removed;
    for (auto it = g_pressing.begin(); it != g_pressing.end();) {
      if (!g_swallowed.count(it->name) && (GetAsyncKeyState(static_cast<int>(it->vk)) & 0x8000) == 0) {
        if (!removed.empty()) removed.push_back('+');
        removed += it->name;
        it = g_pressing.erase(it);
        changed = true;
      } else {
        ++it;
      }
    }
    if (changed) PushSnapshotLocked("watcher", removed, false);
  }
  if (changed) FlushPending();
}

void ApplyWatcherTimer(HWND hwnd) {
  KillTimer(hwnd, kWatcherTimerId);
  const UINT ms = g_watcherMs.load();
  if (ms > 0) SetTimer(hwnd, kWatcherTimerId, ms, nullptr);
}

LRESULT CALLBACK WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_KH_KEYS: FlushPending(); return 0;
    case WM_KH_PHANTOM: InjectPhantom(static_cast<WORD>(wParam)); return 0;
    case WM_KH_WATCHER: ApplyWatcherTimer(hwnd); return 0;
    case WM_TIMER:
      if (wParam == kWatcherTimerId) RunWatcher();
      return 0;
    case WM_KH_QUIT:
      KillTimer(hwnd, kWatcherTimerId);
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY: PostQuitMessage(0); return 0;
    default: return DefWindowProcW(hwnd, msg, wParam, lParam);
  }
}

void HookThreadMain(std::promise<bool> ready) {
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);

  static const wchar_t* kClassName = L"JustSayKeyboardHelperWindow";
  WNDCLASSEXW wc = {sizeof(wc)};
  wc.lpfnWndProc = WindowProc;
  wc.hInstance = g_module;
  wc.lpszClassName = kClassName;
  RegisterClassExW(&wc);  // falha com ERROR_CLASS_ALREADY_EXISTS num reinício: tudo bem

  HWND hwnd = CreateWindowExW(0, kClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, g_module, nullptr);
  g_keyboardHook = hwnd ? SetWindowsHookExW(WH_KEYBOARD_LL, KeyboardProc, g_module, 0) : nullptr;
  if (!hwnd || !g_keyboardHook) {
    if (hwnd) DestroyWindow(hwnd);
    ready.set_value(false);
    return;
  }
  g_mouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseProc, g_module, 0);  // opcional
  g_hwnd = hwnd;
  ApplyWatcherTimer(hwnd);
  ready.set_value(true);

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) DispatchMessageW(&msg);

  g_hwnd = nullptr;
  if (g_mouseHook) UnhookWindowsHookEx(g_mouseHook);
  UnhookWindowsHookEx(g_keyboardHook);
  g_mouseHook = nullptr;
  g_keyboardHook = nullptr;
}

void DispatcherMain(std::shared_ptr<DispatcherState> state) {
  while (true) {
    std::string json;
    {
      std::unique_lock<std::mutex> lock(state->mutex);
      state->cv.wait(lock, [&] { return state->stop || !state->queue.empty(); });
      if (state->stop) return;
      json = std::move(state->queue.front());
      state->queue.pop_front();
    }
    if (state->callback) state->callback(json.c_str());
  }
}

}  // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = module;
    DisableThreadLibraryCalls(module);
  }
  return TRUE;
}

// Inicia o hook. Devolve 1 se instalou, 0 se já estava rodando ou se falhou.
KH_API int startMonitor(KeyCallback callback) {
  std::lock_guard<std::mutex> lifecycle(g_lifecycleMutex);
  if (g_running.load() || !callback) return 0;

  auto dispatch = std::make_shared<DispatcherState>();
  dispatch->callback = callback;
  g_dispatch = dispatch;
  std::thread(DispatcherMain, dispatch).detach();

  std::promise<bool> ready;
  auto readyFuture = ready.get_future();
  g_hookThread = std::thread(HookThreadMain, std::move(ready));
  if (!readyFuture.get()) {
    g_hookThread.join();
    {
      std::lock_guard<std::mutex> lock(dispatch->mutex);
      dispatch->stop = true;
    }
    dispatch->cv.notify_all();
    g_dispatch.reset();
    return 0;
  }
  g_running = true;
  return 1;
}

// Para o hook. Não espera a despachante: ela pode estar presa num callback que só
// roda quando o JS (que chamou esta função) ficar livre.
KH_API void stopMonitor() {
  std::lock_guard<std::mutex> lifecycle(g_lifecycleMutex);
  if (!g_running.load()) return;
  g_running = false;
  NotifyWindow(WM_KH_QUIT);
  if (g_hookThread.joinable()) g_hookThread.join();
  if (auto dispatch = g_dispatch) {
    {
      std::lock_guard<std::mutex> lock(dispatch->mutex);
      dispatch->stop = true;
      dispatch->queue.clear();
    }
    dispatch->cv.notify_all();
  }
  g_dispatch.reset();
  std::lock_guard<std::mutex> lock(g_stateMutex);
  g_pressing.clear();
  g_swallowed.clear();
  g_pending.clear();
}

// Recebe `[["RightAlt"],["RightAlt","Space"],...]`. Devolve quantos atalhos aceitou, ou -1.
KH_API int updateTargetShortcuts(const char* json) {
  if (!json) return -1;
  std::vector<std::vector<std::string>> parsed;
  if (!JsonParseStringMatrix(json, parsed)) return -1;
  std::lock_guard<std::mutex> lock(g_stateMutex);
  g_targets = std::move(parsed);
  return static_cast<int>(g_targets.size());
}

KH_API void resetPressingKeycodes() {
  {
    std::lock_guard<std::mutex> lock(g_stateMutex);
    g_pressing.clear();
    g_swallowed.clear();
    PushSnapshotLocked("reset", "", false);
  }
  NotifyWindow(WM_KH_KEYS);
}

// 0 desliga o vigia de teclas presas.
KH_API void setWatcherInterval(int ms) {
  g_watcherMs = ms > 0 ? static_cast<UINT>(ms) : 0;
  NotifyWindow(WM_KH_WATCHER);
}

// JSON com os teclados físicos (Raw Input). O ponteiro vale até a próxima chamada.
KH_API const char* getKeyboardDeviceList() {
  static thread_local std::string result;
  result = "[";
  UINT count = 0;
  if (GetRawInputDeviceList(nullptr, &count, sizeof(RAWINPUTDEVICELIST)) == 0 && count > 0) {
    std::vector<RAWINPUTDEVICELIST> devices(count);
    UINT got = GetRawInputDeviceList(devices.data(), &count, sizeof(RAWINPUTDEVICELIST));
    bool first = true;
    for (UINT i = 0; i < got && got != static_cast<UINT>(-1); ++i) {
      if (devices[i].dwType != RIM_TYPEKEYBOARD) continue;
      UINT chars = 0;
      GetRawInputDeviceInfoW(devices[i].hDevice, RIDI_DEVICENAME, nullptr, &chars);
      std::wstring name(chars, L'\0');
      if (chars) GetRawInputDeviceInfoW(devices[i].hDevice, RIDI_DEVICENAME, name.data(), &chars);
      while (!name.empty() && name.back() == L'\0') name.pop_back();

      RID_DEVICE_INFO info = {};
      info.cbSize = sizeof(info);
      UINT size = sizeof(info);
      GetRawInputDeviceInfoW(devices[i].hDevice, RIDI_DEVICEINFO, &info, &size);

      if (!first) result.push_back(',');
      first = false;
      result += "{\"name\":";
      JsonAppendEscaped(result, WideToUtf8(name));
      result += ",\"type\":" + std::to_string(info.keyboard.dwType);
      result += ",\"subType\":" + std::to_string(info.keyboard.dwSubType);
      result += ",\"keys\":" + std::to_string(info.keyboard.dwNumberOfKeysTotal) + "}";
    }
  }
  result += "]";
  return result.c_str();
}
