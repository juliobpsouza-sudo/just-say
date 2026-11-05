// UtilHelper.dll — áudio do sistema (Core Audio), dispositivos, tampa, device id e WMI.
//
// Mudo: em vez de mutar o dispositivo inteiro (o que calaria também os sons do próprio
// Just Say), mutamos cada sessão de áudio dos outros processos e lembramos quais foram
// mutadas por nós, para desfazer só essas. Ver DECISOES.md.

#include <windows.h>
#include <ole2.h>      // WIN32_LEAN_AND_MEAN tira o COM
#include <initguid.h>  // define os PROPERTYKEY/GUID dos cabeçalhos abaixo nesta unidade
// A ordem importa: mmdeviceapi.h traz o DEFINE_PROPERTYKEY usado pelos outros.
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <functiondiscoverykeys_devpkey.h>
#include <powrprof.h>
#include <knownfolders.h>
#include <shlobj.h>
#include <wbemidl.h>
#include <wincred.h>

#include <algorithm>
#include <fstream>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "JsonUtil.h"
#include "NativeUtil.h"

#define UH_API extern "C" __declspec(dllexport)

namespace {

std::mutex g_muteMutex;
std::vector<ISimpleAudioVolume*> g_mutedByUs;

std::set<DWORD> ParsePidList(const char* json) {
  std::set<DWORD> pids;
  if (!json) return pids;
  DWORD current = 0;
  bool inNumber = false;
  for (const char* p = json;; ++p) {
    if (*p >= '0' && *p <= '9') {
      current = current * 10 + static_cast<DWORD>(*p - '0');
      inNumber = true;
    } else {
      if (inNumber) pids.insert(current);
      current = 0;
      inNumber = false;
      if (!*p) break;
    }
  }
  return pids;
}

std::string PropString(IPropertyStore* store, const PROPERTYKEY& key) {
  PROPVARIANT v;
  PropVariantInit(&v);
  std::string out;
  if (SUCCEEDED(store->GetValue(key, &v))) {
    if (v.vt == VT_LPWSTR && v.pwszVal) out = WideToUtf8(v.pwszVal);
    else if (v.vt == VT_CLSID && v.puuid) {
      wchar_t buf[64];
      StringFromGUID2(*v.puuid, buf, 64);
      out = WideToUtf8(buf);
    }
  }
  PropVariantClear(&v);
  return out;
}

int PropUInt(IPropertyStore* store, const PROPERTYKEY& key, int fallback) {
  PROPVARIANT v;
  PropVariantInit(&v);
  int out = fallback;
  if (SUCCEEDED(store->GetValue(key, &v)) && v.vt == VT_UI4) out = static_cast<int>(v.ulVal);
  PropVariantClear(&v);
  return out;
}

std::wstring DefaultDeviceId(IMMDeviceEnumerator* en, EDataFlow flow, ERole role) {
  IMMDevice* dev = nullptr;
  std::wstring id;
  if (SUCCEEDED(en->GetDefaultAudioEndpoint(flow, role, &dev)) && dev) {
    LPWSTR raw = nullptr;
    if (SUCCEEDED(dev->GetId(&raw)) && raw) {
      id = raw;
      CoTaskMemFree(raw);
    }
    dev->Release();
  }
  return id;
}

// ---------- device id ----------

std::wstring ReadCredential(const std::wstring& target) {
  PCREDENTIALW cred = nullptr;
  std::wstring value;
  if (CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &cred) && cred) {
    value.assign(reinterpret_cast<const wchar_t*>(cred->CredentialBlob), cred->CredentialBlobSize / sizeof(wchar_t));
    CredFree(cred);
  }
  return value;
}

void WriteCredential(const std::wstring& target, const std::wstring& value) {
  CREDENTIALW cred = {};
  cred.Type = CRED_TYPE_GENERIC;
  cred.TargetName = const_cast<wchar_t*>(target.c_str());
  cred.CredentialBlobSize = static_cast<DWORD>(value.size() * sizeof(wchar_t));
  cred.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<wchar_t*>(value.data()));
  cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
  CredWriteW(&cred, 0);
}

std::wstring CacheFilePath(const std::wstring& appName) {
  PWSTR roaming = nullptr;
  std::wstring path;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &roaming)) && roaming) {
    path = std::wstring(roaming) + L"\\" + appName;
    CoTaskMemFree(roaming);
    CreateDirectoryW(path.c_str(), nullptr);
    path += L"\\device.cache";
  }
  return path;
}

std::wstring Trim(std::wstring s) {
  while (!s.empty() && (s.back() == L'\0' || iswspace(s.back()))) s.pop_back();
  size_t i = 0;
  while (i < s.size() && iswspace(s[i])) ++i;
  return s.substr(i);
}

bool LooksLikeId(const std::wstring& s) { return s.size() >= 32 && s.size() <= 64; }

std::wstring NewGuid() {
  GUID g;
  CoCreateGuid(&g);
  wchar_t buf[64];
  StringFromGUID2(g, buf, 64);
  std::wstring s(buf);
  s.erase(std::remove(s.begin(), s.end(), L'{'), s.end());
  s.erase(std::remove(s.begin(), s.end(), L'}'), s.end());
  std::transform(s.begin(), s.end(), s.begin(), ::towlower);
  return s;
}

// ---------- tampa ----------

struct LidState {
  HANDLE event;
  int value;
};

ULONG CALLBACK LidCallback(PVOID context, ULONG type, PVOID setting) {
  if (type == PBT_POWERSETTINGCHANGE && setting) {
    auto* ps = static_cast<POWERBROADCAST_SETTING*>(setting);
    auto* state = static_cast<LidState*>(context);
    if (ps->PowerSetting == GUID_LIDSWITCH_STATE_CHANGE && ps->DataLength >= sizeof(DWORD)) {
      state->value = *reinterpret_cast<DWORD*>(ps->Data) ? 1 : 0;
      SetEvent(state->event);
    }
  }
  return 0;
}

// ---------- WMI ----------

std::string VariantToJson(VARIANT& v) {
  if (v.vt == VT_NULL || v.vt == VT_EMPTY) return "null";
  if (v.vt == VT_BOOL) return v.boolVal ? "true" : "false";
  VARIANT s;
  VariantInit(&s);
  std::string out = "null";
  if (SUCCEEDED(VariantChangeType(&s, &v, VARIANT_ALPHABOOL, VT_BSTR)) && s.bstrVal) {
    out.clear();
    JsonAppendEscaped(out, WideToUtf8(std::wstring(s.bstrVal, SysStringLen(s.bstrVal))));
  }
  VariantClear(&s);
  return out;
}

}  // namespace

// Muta as sessões de áudio dos outros processos. `excludePidsJson` = [pid, ...] do próprio app.
// Devolve quantas sessões foram mutadas agora.
UH_API int muteAudio(const char* excludePidsJson) {
  ComScope com;
  if (!com.ok()) return -1;
  const std::set<DWORD> exclude = ParsePidList(excludePidsJson);
  std::lock_guard<std::mutex> lock(g_muteMutex);

  IMMDeviceEnumerator* en = nullptr;
  IMMDeviceCollection* devices = nullptr;
  int muted = 0;
  if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&en))) &&
      SUCCEEDED(en->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices))) {
    UINT count = 0;
    devices->GetCount(&count);
    for (UINT d = 0; d < count; ++d) {
      IMMDevice* dev = nullptr;
      IAudioSessionManager2* mgr = nullptr;
      IAudioSessionEnumerator* sessions = nullptr;
      if (SUCCEEDED(devices->Item(d, &dev)) &&
          SUCCEEDED(dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&mgr))) &&
          SUCCEEDED(mgr->GetSessionEnumerator(&sessions))) {
        int n = 0;
        sessions->GetCount(&n);
        for (int i = 0; i < n; ++i) {
          IAudioSessionControl* ctl = nullptr;
          IAudioSessionControl2* ctl2 = nullptr;
          ISimpleAudioVolume* vol = nullptr;
          if (SUCCEEDED(sessions->GetSession(i, &ctl)) &&
              SUCCEEDED(ctl->QueryInterface(IID_PPV_ARGS(&ctl2)))) {
            DWORD pid = 0;
            ctl2->GetProcessId(&pid);
            const bool system = ctl2->IsSystemSoundsSession() == S_OK;
            if (!system && pid != 0 && !exclude.count(pid) &&
                SUCCEEDED(ctl->QueryInterface(IID_PPV_ARGS(&vol)))) {
              BOOL already = FALSE;
              vol->GetMute(&already);
              if (!already && SUCCEEDED(vol->SetMute(TRUE, nullptr))) {
                g_mutedByUs.push_back(vol);  // fica com a referência para desfazer depois
                vol = nullptr;
                ++muted;
              }
            }
          }
          SafeRelease(vol);
          SafeRelease(ctl2);
          SafeRelease(ctl);
        }
      }
      SafeRelease(sessions);
      SafeRelease(mgr);
      SafeRelease(dev);
    }
  }
  SafeRelease(devices);
  SafeRelease(en);
  return muted;
}

// Desfaz só o que muteAudio mutou. Devolve quantas sessões voltaram.
UH_API int unmuteAudio() {
  ComScope com;
  std::lock_guard<std::mutex> lock(g_muteMutex);
  int restored = 0;
  for (ISimpleAudioVolume* vol : g_mutedByUs) {
    if (SUCCEEDED(vol->SetMute(FALSE, nullptr))) ++restored;
    vol->Release();
  }
  g_mutedByUs.clear();
  return restored;
}

UH_API int isMutedByUs() {
  std::lock_guard<std::mutex> lock(g_muteMutex);
  return g_mutedByUs.empty() ? 0 : 1;
}

// Lista os dispositivos de áudio ativos (entrada e saída). JSON UTF-8 em `out`.
UH_API int getAudioDevices(char* out, int capacity) {
  ComScope com;
  std::string json = "[";
  IMMDeviceEnumerator* en = nullptr;
  if (com.ok() && SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&en)))) {
    bool first = true;
    for (EDataFlow flow : {eRender, eCapture}) {
      const std::wstring defConsole = DefaultDeviceId(en, flow, eConsole);
      const std::wstring defComms = DefaultDeviceId(en, flow, eCommunications);
      IMMDeviceCollection* devices = nullptr;
      if (FAILED(en->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &devices))) continue;
      UINT count = 0;
      devices->GetCount(&count);
      for (UINT i = 0; i < count; ++i) {
        IMMDevice* dev = nullptr;
        IPropertyStore* props = nullptr;
        LPWSTR rawId = nullptr;
        if (SUCCEEDED(devices->Item(i, &dev)) && SUCCEEDED(dev->GetId(&rawId)) &&
            SUCCEEDED(dev->OpenPropertyStore(STGM_READ, &props))) {
          const std::wstring id = rawId;
          const std::string enumerator = PropString(props, PKEY_Device_EnumeratorName);
          if (!first) json.push_back(',');
          first = false;
          json += "{\"id\":";
          JsonAppendEscaped(json, WideToUtf8(id));
          json += ",\"name\":";
          JsonAppendEscaped(json, PropString(props, PKEY_Device_FriendlyName));
          json += ",\"flow\":";
          json += flow == eRender ? "\"render\"" : "\"capture\"";
          json += ",\"isDefault\":";
          json += id == defConsole ? "true" : "false";
          json += ",\"isDefaultCommunication\":";
          json += id == defComms ? "true" : "false";
          json += ",\"formFactor\":" + std::to_string(PropUInt(props, PKEY_AudioEndpoint_FormFactor, -1));
          json += ",\"containerId\":";
          JsonAppendEscaped(json, PropString(props, PKEY_Device_ContainerId));
          json += ",\"enumerator\":";
          JsonAppendEscaped(json, enumerator);
          json += ",\"bluetooth\":";
          json += (enumerator.find("BTH") != std::string::npos) ? "true" : "false";
          json += "}";
        }
        if (rawId) CoTaskMemFree(rawId);
        SafeRelease(props);
        SafeRelease(dev);
      }
      SafeRelease(devices);
    }
  }
  SafeRelease(en);
  json += "]";
  return WriteOut(json, out, capacity);
}

// 1 = tampa aberta, 0 = fechada, -1 = sem tampa ou desconhecido.
UH_API int deviceIsLidOpen() {
  SYSTEM_POWER_CAPABILITIES caps = {};
  if (CallNtPowerInformation(SystemPowerCapabilities, nullptr, 0, &caps, sizeof(caps)) != 0 || !caps.LidPresent)
    return -1;
  LidState state{CreateEventW(nullptr, TRUE, FALSE, nullptr), -1};
  DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS params = {LidCallback, &state};
  HPOWERNOTIFY handle = nullptr;
  // O Windows chama o callback na hora com o valor atual.
  if (PowerSettingRegisterNotification(&GUID_LIDSWITCH_STATE_CHANGE, DEVICE_NOTIFY_CALLBACK, &params, &handle) ==
      ERROR_SUCCESS) {
    WaitForSingleObject(state.event, 300);
    PowerSettingUnregisterNotification(handle);
  }
  CloseHandle(state.event);
  return state.value;
}

// Id estável do dispositivo: Gerenciador de Credenciais + %APPDATA%\<app>\device.cache.
// Se nenhum existir, gera um GUID e grava nos dois. UTF-8 em `out`.
UH_API int getDeviceId(const char16_t* appName, char* out, int capacity) {
  ComScope com;
  const std::wstring app = Utf16FromChar16(appName);
  const std::wstring target = app + L".deviceIdentifier";
  const std::wstring cachePath = CacheFilePath(app);

  std::wstring fromCred = Trim(ReadCredential(target));
  std::wstring fromFile;
  if (!cachePath.empty()) {
    std::wifstream in(cachePath);
    std::getline(in, fromFile);
    fromFile = Trim(fromFile);
  }
  std::wstring id = LooksLikeId(fromCred) ? fromCred : LooksLikeId(fromFile) ? fromFile : NewGuid();
  if (id != fromCred) WriteCredential(target, id);
  if (id != fromFile && !cachePath.empty()) {
    std::wofstream outFile(cachePath, std::ios::trunc);
    outFile << id;
  }
  return WriteOut(WideToUtf8(id), out, capacity);
}

// Consulta WMI. Devolve JSON (array de objetos, valores como texto) em `out`; negativo = erro.
UH_API int wmiQuery(const char16_t* ns, const char16_t* wql, char* out, int capacity) {
  ComScope com;
  if (!com.ok()) return -1;
  CoInitializeSecurity(nullptr, -1, nullptr, nullptr, RPC_C_AUTHN_LEVEL_DEFAULT, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr,
                       EOAC_NONE, nullptr);  // RPC_E_TOO_LATE se já foi feito: tudo bem
  IWbemLocator* locator = nullptr;
  IWbemServices* services = nullptr;
  IEnumWbemClassObject* rows = nullptr;
  std::string json = "[";
  int rc = -2;
  BSTR bns = SysAllocString(reinterpret_cast<const wchar_t*>(ns ? ns : u"ROOT\\CIMV2"));
  BSTR blang = SysAllocString(L"WQL");
  BSTR bquery = SysAllocString(reinterpret_cast<const wchar_t*>(wql));
  if (SUCCEEDED(CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&locator))) &&
      SUCCEEDED(locator->ConnectServer(bns, nullptr, nullptr, nullptr, 0, nullptr, nullptr, &services)) &&
      SUCCEEDED(CoSetProxyBlanket(services, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr, RPC_C_AUTHN_LEVEL_CALL,
                                  RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE)) &&
      SUCCEEDED(services->ExecQuery(blang, bquery, WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, nullptr,
                                    &rows))) {
    bool firstRow = true;
    while (true) {
      IWbemClassObject* obj = nullptr;
      ULONG got = 0;
      if (FAILED(rows->Next(5000, 1, &obj, &got)) || got == 0) break;
      SAFEARRAY* names = nullptr;
      if (SUCCEEDED(obj->GetNames(nullptr, WBEM_FLAG_NONSYSTEM_ONLY, nullptr, &names)) && names) {
        LONG lo = 0, hi = -1;
        SafeArrayGetLBound(names, 1, &lo);
        SafeArrayGetUBound(names, 1, &hi);
        if (!firstRow) json.push_back(',');
        firstRow = false;
        json.push_back('{');
        for (LONG i = lo; i <= hi; ++i) {
          BSTR name = nullptr;
          SafeArrayGetElement(names, &i, &name);
          VARIANT v;
          VariantInit(&v);
          if (name && SUCCEEDED(obj->Get(name, 0, &v, nullptr, nullptr))) {
            if (i != lo) json.push_back(',');
            JsonAppendEscaped(json, WideToUtf8(std::wstring(name, SysStringLen(name))));
            json.push_back(':');
            json += VariantToJson(v);
          }
          VariantClear(&v);
          SysFreeString(name);
        }
        json.push_back('}');
        SafeArrayDestroy(names);
      }
      obj->Release();
    }
    rc = 0;
  }
  SysFreeString(bns);
  SysFreeString(blang);
  SysFreeString(bquery);
  SafeRelease(rows);
  SafeRelease(services);
  SafeRelease(locator);
  if (rc != 0) return rc;
  json += "]";
  return WriteOut(json, out, capacity);
}
