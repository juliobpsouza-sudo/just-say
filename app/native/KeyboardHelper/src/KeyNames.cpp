#include "KeyNames.h"

#include <cstdio>

std::string KeyNameFromVk(DWORD vk, DWORD llFlags) {
  if (vk >= 'A' && vk <= 'Z') return std::string(1, static_cast<char>(vk));
  if (vk >= '0' && vk <= '9') return std::string("Digit") + static_cast<char>(vk);
  if (vk >= VK_F1 && vk <= VK_F24) return "F" + std::to_string(vk - VK_F1 + 1);
  if (vk >= VK_NUMPAD0 && vk <= VK_NUMPAD9) return "Numpad" + std::to_string(vk - VK_NUMPAD0);

  switch (vk) {
    case VK_LCONTROL: return "LeftCtrl";
    case VK_RCONTROL: return "RightCtrl";
    case VK_LSHIFT: return "LeftShift";
    case VK_RSHIFT: return "RightShift";
    case VK_LMENU: return "LeftAlt";
    case VK_RMENU: return "RightAlt";
    case VK_LWIN: return "LeftWin";
    case VK_RWIN: return "RightWin";
    case VK_SPACE: return "Space";
    case VK_RETURN: return (llFlags & LLKHF_EXTENDED) ? "NumpadEnter" : "Enter";
    case VK_ESCAPE: return "Escape";
    case VK_TAB: return "Tab";
    case VK_BACK: return "Backspace";
    case VK_CAPITAL: return "CapsLock";
    case VK_DELETE: return "Delete";
    case VK_INSERT: return "Insert";
    case VK_HOME: return "Home";
    case VK_END: return "End";
    case VK_PRIOR: return "PageUp";
    case VK_NEXT: return "PageDown";
    case VK_LEFT: return "ArrowLeft";
    case VK_RIGHT: return "ArrowRight";
    case VK_UP: return "ArrowUp";
    case VK_DOWN: return "ArrowDown";
    case VK_SNAPSHOT: return "PrintScreen";
    case VK_SCROLL: return "ScrollLock";
    case VK_PAUSE: return "Pause";
    case VK_NUMLOCK: return "NumLock";
    case VK_APPS: return "ContextMenu";
    case VK_MULTIPLY: return "NumpadMultiply";
    case VK_ADD: return "NumpadAdd";
    case VK_SUBTRACT: return "NumpadSubtract";
    case VK_DECIMAL: return "NumpadDecimal";
    case VK_DIVIDE: return "NumpadDivide";
    case VK_OEM_1: return "Semicolon";
    case VK_OEM_PLUS: return "Equal";
    case VK_OEM_COMMA: return "Comma";
    case VK_OEM_MINUS: return "Minus";
    case VK_OEM_PERIOD: return "Period";
    case VK_OEM_2: return "Slash";
    case VK_OEM_3: return "Backquote";
    case VK_OEM_4: return "BracketLeft";
    case VK_OEM_5: return "Backslash";
    case VK_OEM_6: return "BracketRight";
    case VK_OEM_7: return "Quote";
    case VK_OEM_102: return "IntlBackslash";
    case 0xC1: return "AbntC1";
    case 0xC2: return "AbntC2";
    case VK_VOLUME_MUTE: return "VolumeMute";
    case VK_VOLUME_DOWN: return "VolumeDown";
    case VK_VOLUME_UP: return "VolumeUp";
    case VK_MEDIA_NEXT_TRACK: return "MediaNext";
    case VK_MEDIA_PREV_TRACK: return "MediaPrev";
    case VK_MEDIA_STOP: return "MediaStop";
    case VK_MEDIA_PLAY_PAUSE: return "MediaPlayPause";
    default: {
      char buf[16];
      sprintf_s(buf, "VK_0x%02X", static_cast<unsigned>(vk));
      return buf;
    }
  }
}

bool IsModifierKey(const std::string& name) {
  return name == "LeftCtrl" || name == "RightCtrl" || name == "LeftShift" || name == "RightShift" ||
         name == "LeftAlt" || name == "RightAlt" || name == "LeftWin" || name == "RightWin";
}

bool IsWinKey(const std::string& name) { return name == "LeftWin" || name == "RightWin"; }

bool IsAltKey(const std::string& name) { return name == "LeftAlt" || name == "RightAlt"; }

bool IsPassthroughFunctionKey(DWORD vk) {
  return (vk >= VK_F13 && vk <= VK_F22) || vk == VK_F24;
}
