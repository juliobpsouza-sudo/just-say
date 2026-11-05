#pragma once
#include <string>
#include <vector>
#include <windows.h>

// Utilitários mínimos de JSON compartilhados pelas DLLs. Só o necessário:
// escapar strings e ler um array de arrays de strings.

inline void JsonAppendEscaped(std::string& out, const std::string& s) {
  out.push_back('"');
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          sprintf_s(buf, "\\u%04x", c);
          out += buf;
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
  }
  out.push_back('"');
}

inline std::string WideToUtf8(const std::wstring& w) {
  if (w.empty()) return {};
  int len = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  std::string out(static_cast<size_t>(len), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), out.data(), len, nullptr, nullptr);
  return out;
}

// Lê `[["A","B"],["C"]]`. Devolve false se o texto não tiver esse formato.
inline bool JsonParseStringMatrix(const char* text, std::vector<std::vector<std::string>>& out) {
  out.clear();
  const char* p = text;
  auto skip = [&]() { while (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t') ++p; };
  auto readString = [&](std::string& s) -> bool {
    if (*p != '"') return false;
    ++p;
    while (*p && *p != '"') {
      if (*p == '\\' && p[1]) { ++p; }
      s.push_back(*p++);
    }
    if (*p != '"') return false;
    ++p;
    return true;
  };
  skip();
  if (*p++ != '[') return false;
  skip();
  if (*p == ']') return true;
  while (true) {
    skip();
    if (*p++ != '[') return false;
    std::vector<std::string> row;
    skip();
    if (*p != ']') {
      while (true) {
        skip();
        std::string s;
        if (!readString(s)) return false;
        row.push_back(std::move(s));
        skip();
        if (*p == ',') { ++p; continue; }
        break;
      }
    }
    if (*p++ != ']') return false;
    out.push_back(std::move(row));
    skip();
    if (*p == ',') { ++p; continue; }
    break;
  }
  skip();
  return *p == ']';
}
