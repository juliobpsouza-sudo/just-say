#pragma once
#include <windows.h>

#include <cstring>
#include <string>

// Inicializa COM na thread atual (MTA) e desfaz no fim, se fomos nós que inicializamos.
// Se a thread já está num apartamento STA (ex.: thread principal do Electron), segue nele.
class ComScope {
 public:
  ComScope() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    owns_ = SUCCEEDED(hr);
    ok_ = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
  }
  ~ComScope() {
    if (owns_) CoUninitialize();
  }
  bool ok() const { return ok_; }
  ComScope(const ComScope&) = delete;
  ComScope& operator=(const ComScope&) = delete;

 private:
  bool owns_ = false;
  bool ok_ = false;
};

// Copia `value` (UTF-8) para o buffer do chamador. Devolve o tamanho total do valor,
// que pode ser maior que `capacity` (o chamador então sabe que truncou).
inline int WriteOut(const std::string& value, char* out, int capacity) {
  if (out && capacity > 0) {
    const size_t n = value.size() < static_cast<size_t>(capacity - 1) ? value.size() : static_cast<size_t>(capacity - 1);
    std::memcpy(out, value.data(), n);
    out[n] = '\0';
  }
  return static_cast<int>(value.size());
}

inline std::wstring Utf16FromChar16(const char16_t* s) {
  return s ? std::wstring(reinterpret_cast<const wchar_t*>(s)) : std::wstring();
}

template <typename T>
inline void SafeRelease(T*& p) {
  if (p) {
    p->Release();
    p = nullptr;
  }
}
