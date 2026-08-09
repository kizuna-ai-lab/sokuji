// sokuji-audio-host — per-application audio capture for Windows.
//
//   sokuji-audio-host.exe --list
//       Writes one JSON array to stdout and exits 0.
//       [{"id":"pid:1234","label":"Zoom Meetings","exe":"Zoom.exe","active":true,
//         "windows":["Zoom Meeting","Chat"]}]
//       `id` names the application's root process, which outlives the child
//       that happens to hold the audio session. `label` is the application
//       name; `windows` are its window titles, which the UI shows on hover
//       because one process can own several windows and Windows cannot capture
//       them separately.
//
//   sokuji-audio-host.exe --target pid:1234
//       Writes raw PCM to stdout until killed. Format is fixed at
//       24000 Hz, 1 channel, signed 16-bit little-endian.
//       Writes one JSON object per line to stderr:
//         {"event":"format","sampleRate":24000,"channels":1,"encoding":"s16le"}
//         {"event":"error","code":"..."}
//
// Exit codes: 0 clean, 1 runtime failure, 2 bad usage.
//
// stdout carries ONLY PCM. Everything else goes to stderr, or the audio stream
// is corrupted. Built with plain MSVC — deliberately no WIL and no Media
// Foundation, unlike the Microsoft ApplicationLoopback sample this is based on.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <winver.h>
#include <fcntl.h>
#include <io.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <map>

// The pipeline consumes 24 kHz mono s16 and nothing else, so the format is not
// configurable. WASAPI converts from whatever the app renders via
// AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM.
static const DWORD kSampleRate = 24000;
static const WORD  kChannels   = 1;
static const WORD  kBits       = 16;

// ---------------------------------------------------------------- utilities

// Window titles and executable names are UTF-16 and routinely non-ASCII.
// Converting through the console code page (printf("%S")) mangles them.
static std::string Utf8(const wchar_t* w) {
    if (!w || !*w) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) return std::string();
    std::string s(static_cast<size_t>(n - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
    return s;
}

static std::string JsonEscape(const std::string& in) {
    std::string o;
    o.reserve(in.size() + 8);
    for (unsigned char c : in) {
        switch (c) {
            case '"':  o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n";  break;
            case '\r': o += "\\r";  break;
            case '\t': o += "\\t";  break;
            default:
                if (c < 0x20) { char b[8]; sprintf_s(b, "\\u%04x", c); o += b; }
                else o += static_cast<char>(c);
        }
    }
    return o;
}

static void EmitEvent(const char* json) {
    fprintf(stderr, "%s\n", json);
    fflush(stderr);
}

static void EmitError(const char* code) {
    fprintf(stderr, "{\"event\":\"error\",\"code\":\"%s\"}\n", code);
    fflush(stderr);
}

static std::wstring ImagePathOf(DWORD pid) {
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!h) return std::wstring();
    wchar_t path[MAX_PATH] = {};
    DWORD n = MAX_PATH;
    std::wstring result;
    if (QueryFullProcessImageNameW(h, 0, path, &n)) result.assign(path, n);
    CloseHandle(h);
    return result;
}

static std::string ExeNameOf(DWORD pid) {
    const std::wstring path = ImagePathOf(pid);
    if (path.empty()) return std::string();
    const size_t slash = path.find_last_of(L'\\');
    return Utf8(slash == std::wstring::npos ? path.c_str() : path.c_str() + slash + 1);
}

/**
 * The executable's FileDescription resource - "Google Chrome" for chrome.exe.
 *
 * This is the name Task Manager shows, and the only application name Windows
 * offers for free; everything friendlier (AppUserModelID, package display name)
 * covers packaged apps only.
 */
static std::string FileDescription(const wchar_t* path) {
    DWORD ignored = 0;
    const DWORD size = GetFileVersionInfoSizeW(path, &ignored);
    if (size == 0) return std::string();
    std::vector<BYTE> buffer(size);
    if (!GetFileVersionInfoW(path, 0, size, buffer.data())) return std::string();

    struct LangCodePage { WORD language; WORD codePage; };
    LangCodePage* translations = nullptr;
    UINT bytes = 0;
    if (!VerQueryValueW(buffer.data(), L"\\VarFileInfo\\Translation",
                        reinterpret_cast<void**>(&translations), &bytes)
        || bytes < sizeof(LangCodePage)) {
        return std::string();
    }
    // The first translation is the binary's own language. Later ones are
    // localisations, which would name the app in a language nobody asked for.
    wchar_t key[64];
    swprintf_s(key, L"\\StringFileInfo\\%04x%04x\\FileDescription",
               translations[0].language, translations[0].codePage);
    wchar_t* value = nullptr;
    UINT length = 0;
    if (!VerQueryValueW(buffer.data(), key, reinterpret_cast<void**>(&value), &length)
        || length == 0) {
        return std::string();
    }
    return Utf8(value);
}

// ------------------------------------------------------------------- --list

struct TitleCollector {
    std::map<DWORD, std::vector<std::string>> byPid;
};

// Chromium and Electron render audio from a child process (the audio service),
// and that child owns no window, so nothing about the application can be read
// off the audio session's own pid. Walking up the parent chain reaches the
// process that does represent the app. Capped so a broken or cyclic chain
// cannot spin.
static const int kMaxParentHops = 6;

struct ProcessTable {
    std::map<DWORD, DWORD> parent;
    std::map<DWORD, std::string> image;
};

static ProcessTable BuildProcessTable() {
    ProcessTable table;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return table;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (Process32FirstW(snap, &entry)) {
        do {
            table.parent[entry.th32ProcessID] = entry.th32ParentProcessID;
            // The snapshot's image name needs no handle, so it also covers
            // processes this helper may not open.
            table.image[entry.th32ProcessID] = Utf8(entry.szExeFile);
        } while (Process32NextW(snap, &entry));
    }
    CloseHandle(snap);
    return table;
}

static std::string ImageOf(DWORD pid, const ProcessTable& table) {
    auto it = table.image.find(pid);
    if (it != table.image.end() && !it->second.empty()) return it->second;
    return ExeNameOf(pid);
}

static bool SameImage(const std::string& a, const std::string& b) {
    return !a.empty() && !b.empty() && _stricmp(a.c_str(), b.c_str()) == 0;
}

/**
 * The process that represents the *application* holding this audio session.
 *
 * The session belongs to whichever process opened the render stream, and for a
 * multi-process app that is a short-lived child: Chrome plays through a
 * `--type=utility` audio service it tears down and replaces around playback.
 * Targeting that child produced a tap that died with it - the helper exited
 * `target_gone`, and Sokuji answers a dead helper by falling back to
 * whole-system capture while the picker still names the application, so the
 * user's whole desktop starts being translated with nothing on screen saying
 * so. Reporting the root instead gives a pid that lives as long as the app,
 * and PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE still reaches every
 * child it spawns - including the replacement audio service.
 *
 * The walk stops as soon as the parent runs a different executable, and that
 * bound is what makes it safe. Multi-process apps spawn their children from
 * their own image, whereas an unrelated parent - explorer.exe having launched a
 * window-less player - does not. Without the bound such an app's root would be
 * the desktop shell, and capturing that tree would capture nearly everything
 * the user has open: the exact leak this is meant to close.
 */
static DWORD AppRootPid(DWORD pid, const ProcessTable& table) {
    const std::string image = ImageOf(pid, table);
    if (image.empty()) return pid;
    DWORD root = pid;
    for (int hop = 0; hop < kMaxParentHops; hop++) {
        auto parent = table.parent.find(root);
        if (parent == table.parent.end()) break;
        const DWORD up = parent->second;
        // 0-4 are System/Idle; a self-referencing entry would loop forever.
        if (up <= 4 || up == root) break;
        if (!SameImage(ImageOf(up, table), image)) break;
        root = up;
    }
    return root;
}

/**
 * What to call this application in the picker.
 *
 * Deliberately not a window title. A capturable source is a process tree, and
 * one tree routinely owns several windows - two Chrome windows are one process
 * and therefore one source, which Windows offers no way to split. Naming the
 * row after whichever window was enumerated first promised a granularity the OS
 * cannot deliver, and made two windows look like one arbitrary one. The window
 * titles still travel, in `windows`, for the UI to show on hover.
 */
static std::string FriendlyName(DWORD pid, const ProcessTable& table) {
    const std::wstring path = ImagePathOf(pid);
    if (!path.empty()) {
        const std::string described = FileDescription(path.c_str());
        if (!described.empty()) return described;
    }
    const std::string image = ImageOf(pid, table);
    if (!image.empty()) return image;
    char b[32];
    sprintf_s(b, "PID %lu", pid);
    return b;
}

static BOOL CALLBACK CollectTitle(HWND hwnd, LPARAM lp) {
    if (!IsWindowVisible(hwnd)) return TRUE;
    if (GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;  // tool/child window
    wchar_t title[256] = {};
    if (GetWindowTextW(hwnd, title, 255) == 0) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0) return TRUE;
    auto* c = reinterpret_cast<TitleCollector*>(lp);
    // Every window, not just the first: they are what the row's tooltip lists,
    // and dropping all but one is what made two Chrome windows indistinguishable.
    c->byPid[pid].push_back(Utf8(title));
    return TRUE;
}

struct Entry {
    DWORD pid;
    std::string exe;
    std::string label;
    bool active;
    std::vector<std::string> windows;
};

// Enumerate processes that hold an audio session on the default render endpoint.
// Chosen over window enumeration because it yields a short, relevant list and
// tells us which app is actually playing. Note this only sees the *current*
// Windows session, which is correct: Sokuji runs in the user's session.
static int ListSources() {
    IMMDeviceEnumerator* en = nullptr;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator), (void**)&en))) {
        // No enumerator at all: emit an empty list so the picker degrades to
        // whole-system capture instead of showing an error.
        printf("[]");
        return 0;
    }

    IMMDevice* dev = nullptr;
    if (FAILED(en->GetDefaultAudioEndpoint(eRender, eConsole, &dev))) {
        printf("[]");
        en->Release();
        return 0;
    }

    IAudioSessionManager2* mgr = nullptr;
    if (FAILED(dev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&mgr))) {
        printf("[]");
        dev->Release();
        en->Release();
        return 0;
    }

    TitleCollector titles;
    EnumWindows(CollectTitle, reinterpret_cast<LPARAM>(&titles));
    const ProcessTable procs = BuildProcessTable();

    // A window belongs to the application, not to the process that happens to
    // own it, so fold every collected title onto its application root. One row
    // can then list every window the app has open.
    std::map<DWORD, std::vector<std::string>> windowsByRoot;
    for (const auto& owner : titles.byPid) {
        auto& into = windowsByRoot[AppRootPid(owner.first, procs)];
        for (const auto& title : owner.second) {
            if (std::find(into.begin(), into.end(), title) == into.end()) into.push_back(title);
        }
    }

    std::vector<Entry> entries;
    IAudioSessionEnumerator* sessions = nullptr;
    int count = 0;
    if (SUCCEEDED(mgr->GetSessionEnumerator(&sessions))) {
        sessions->GetCount(&count);
    }

    DWORD self = GetCurrentProcessId();
    for (int i = 0; i < count; i++) {
        IAudioSessionControl* ctl = nullptr;
        if (FAILED(sessions->GetSession(i, &ctl))) continue;

        IAudioSessionControl2* ctl2 = nullptr;
        if (SUCCEEDED(ctl->QueryInterface(__uuidof(IAudioSessionControl2), (void**)&ctl2))) {
            DWORD pid = 0;
            ctl2->GetProcessId(&pid);
            // pid 0 is the system-wide session; capturing ourselves would loop.
            if (pid != 0 && pid != self && ctl2->IsSystemSoundsSession() != S_OK) {
                AudioSessionState st = AudioSessionStateInactive;
                ctl->GetState(&st);

                // Report the application, not the process that opened the
                // stream: see AppRootPid. This also collapses an app that holds
                // several sessions into the one row a user expects.
                const DWORD root = AppRootPid(pid, procs);

                Entry e{};
                e.pid = root;
                e.exe = ImageOf(root, procs);
                e.active = (st == AudioSessionStateActive);
                e.label = FriendlyName(root, procs);
                auto windows = windowsByRoot.find(root);
                if (windows != windowsByRoot.end()) e.windows = windows->second;

                bool dup = false;
                for (auto& x : entries) {
                    // Merged rows are active when any of their sessions is, or
                    // an app playing through its second session reads as idle.
                    if (x.pid == root) { x.active = x.active || e.active; dup = true; break; }
                }
                if (!dup) entries.push_back(e);
            }
            ctl2->Release();
        }
        ctl->Release();
    }

    // Two instances of one application - a second Chrome profile, or Chrome
    // beside Chrome Beta - carry the same name here, and nothing in this list
    // tells them apart. Disambiguating them is the caller's job: it appends the
    // pid from `id` to every row, on every platform, rather than only where a
    // collision happens to occur.
    printf("[");
    for (size_t i = 0; i < entries.size(); i++) {
        const Entry& e = entries[i];
        printf("%s{\"id\":\"pid:%lu\",\"label\":\"%s\",\"exe\":\"%s\",\"active\":%s,\"windows\":[",
               i ? "," : "",
               e.pid,
               JsonEscape(e.label).c_str(),
               JsonEscape(e.exe).c_str(),
               e.active ? "true" : "false");
        for (size_t w = 0; w < e.windows.size(); w++) {
            printf("%s\"%s\"", w ? "," : "", JsonEscape(e.windows[w]).c_str());
        }
        printf("]}");
    }
    printf("]");
    fflush(stdout);

    if (sessions) sessions->Release();
    mgr->Release();
    dev->Release();
    en->Release();
    return 0;
}

// ------------------------------------------------------------------ capture

class ActivateHandler : public IActivateAudioInterfaceCompletionHandler {
public:
    HANDLE done = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    HRESULT activateHr = E_FAIL;
    IAudioClient* client = nullptr;

    HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
        IUnknown* unk = nullptr;
        HRESULT hrResult = E_FAIL;
        HRESULT hr = op->GetActivateResult(&hrResult, &unk);
        activateHr = SUCCEEDED(hr) ? hrResult : hr;
        if (SUCCEEDED(activateHr) && unk) {
            unk->QueryInterface(__uuidof(IAudioClient), (void**)&client);
        }
        if (unk) unk->Release();
        SetEvent(done);
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
            *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
            return S_OK;
        }
        // Without IAgileObject the callback cannot marshal and activation hangs.
        if (riid == __uuidof(IAgileObject)) { *ppv = this; return S_OK; }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return 2; }
    ULONG STDMETHODCALLTYPE Release() override { return 1; }
};

static volatile BOOL g_stop = FALSE;

static BOOL WINAPI OnConsoleCtrl(DWORD) {
    g_stop = TRUE;
    return TRUE;
}

static int Capture(DWORD pid) {
    // Keep a handle so we can tell "the app quit" from "the app went quiet".
    HANDLE target = OpenProcess(SYNCHRONIZE, FALSE, pid);

    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = pid;
    // Browsers and Electron apps render audio from a child process, so the whole
    // tree must be included or a Chrome tab's audio is missed entirely.
    params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT pv{};
    pv.vt = VT_BLOB;
    pv.blob.cbSize = sizeof(params);
    pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

    ActivateHandler handler;
    IActivateAudioInterfaceAsyncOperation* op = nullptr;
    HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                             __uuidof(IAudioClient), &pv, &handler, &op);
    if (FAILED(hr)) { EmitError("activation_failed"); return 1; }

    if (WaitForSingleObject(handler.done, 5000) != WAIT_OBJECT_0) {
        EmitError("activation_failed");
        return 1;
    }
    if (FAILED(handler.activateHr) || !handler.client) {
        EmitError("activation_failed");
        return 1;
    }

    WAVEFORMATEX fmt{};
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = kChannels;
    fmt.nSamplesPerSec = kSampleRate;
    fmt.wBitsPerSample = kBits;
    fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

    hr = handler.client->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        0, 0, &fmt, nullptr);
    if (FAILED(hr)) { EmitError("initialize_failed"); return 1; }

    HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (FAILED(handler.client->SetEventHandle(ready))) { EmitError("initialize_failed"); return 1; }

    IAudioCaptureClient* cap = nullptr;
    if (FAILED(handler.client->GetService(__uuidof(IAudioCaptureClient), (void**)&cap))) {
        EmitError("initialize_failed");
        return 1;
    }

    if (FAILED(handler.client->Start())) { EmitError("initialize_failed"); return 1; }

    EmitEvent("{\"event\":\"format\",\"sampleRate\":24000,\"channels\":1,\"encoding\":\"s16le\"}");

    static const char kZeros[8192] = {};
    const UINT32 blockAlign = fmt.nBlockAlign;
    int rc = 0;

    while (!g_stop) {
        if (target && WaitForSingleObject(target, 0) == WAIT_OBJECT_0) {
            EmitError("target_gone");
            rc = 1;
            break;
        }
        if (WaitForSingleObject(ready, 500) != WAIT_OBJECT_0) continue;

        for (;;) {
            BYTE* data = nullptr;
            UINT32 frames = 0;
            DWORD flags = 0;
            hr = cap->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
            if (FAILED(hr) || hr == AUDCLNT_S_BUFFER_EMPTY || frames == 0) {
                if (SUCCEEDED(hr) && frames == 0) cap->ReleaseBuffer(0);
                break;
            }

            size_t bytes = static_cast<size_t>(frames) * blockAlign;
            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                // The buffer contents are undefined under this flag. Write real
                // zeros, and never skip the write: downstream timing assumes
                // every buffer is forwarded.
                size_t remaining = bytes;
                while (remaining > 0) {
                    size_t chunk = remaining < sizeof(kZeros) ? remaining : sizeof(kZeros);
                    fwrite(kZeros, 1, chunk, stdout);
                    remaining -= chunk;
                }
            } else {
                fwrite(data, 1, bytes, stdout);
            }
            cap->ReleaseBuffer(frames);

            // The parent reads this pipe live; without a flush the audio arrives
            // in stdio-buffer-sized bursts and adds latency.
            if (fflush(stdout) != 0) { g_stop = TRUE; break; }  // parent closed the pipe
        }
    }

    handler.client->Stop();
    cap->Release();
    handler.client->Release();
    if (target) CloseHandle(target);
    return rc;
}

// --------------------------------------------------------------------- main

static void Usage() {
    fprintf(stderr,
        "usage:\n"
        "  sokuji-audio-host.exe --list\n"
        "  sokuji-audio-host.exe --target pid:<processId>\n");
}

int wmain(int argc, wchar_t** argv) {
    // PCM must not be newline-translated; 0x0A bytes are ordinary sample data.
    _setmode(_fileno(stdout), _O_BINARY);

    if (argc < 2) { Usage(); return 2; }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) { EmitError("activation_failed"); return 1; }

    int rc = 2;
    if (wcscmp(argv[1], L"--list") == 0) {
        rc = ListSources();
    } else if (wcscmp(argv[1], L"--target") == 0 && argc >= 3) {
        if (wcsncmp(argv[2], L"pid:", 4) != 0) { EmitError("bad_target"); rc = 2; }
        else {
            DWORD pid = static_cast<DWORD>(_wtoi(argv[2] + 4));
            if (pid == 0) { EmitError("bad_target"); rc = 2; }
            else {
                SetConsoleCtrlHandler(OnConsoleCtrl, TRUE);
                rc = Capture(pid);
            }
        }
    } else {
        Usage();
        rc = 2;
    }

    CoUninitialize();
    return rc;
}
