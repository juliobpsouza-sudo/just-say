#pragma once
#include <string>
#include <windows.h>

// Nome estável de uma tecla física, independente do layout (ABNT2, US...).
// Os nomes são os mesmos usados nas configurações de atalho do app.
std::string KeyNameFromVk(DWORD vk, DWORD llFlags);

bool IsModifierKey(const std::string& name);
bool IsWinKey(const std::string& name);
bool IsAltKey(const std::string& name);

// F13–F22 e F24 nunca são engolidas (F23 fica de fora: é usada pela tecla Copilot).
bool IsPassthroughFunctionKey(DWORD vk);
