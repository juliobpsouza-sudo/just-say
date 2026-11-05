#pragma once
#include <windows.h>

// Marca colocada em dwExtraInfo de toda tecla que o Just Say injeta com SendInput.
// O hook de teclado usa essa marca para ignorar as próprias teclas.
// 0x4A534159 = "JSAY" em ASCII.
constexpr ULONG_PTR kJustSayInjectMarker = 0x4A534159;
