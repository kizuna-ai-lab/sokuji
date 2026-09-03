import { describe, it, expect, vi, afterEach } from "vitest";
import { getRelayWsUrl, isLocalNativeEnabled, LOCAL_NATIVE_DEBUG_KEY } from "./environment";

afterEach(() => { vi.unstubAllEnvs(); });

describe("isLocalNativeEnabled", () => {
  const asElectron = () => { (window as unknown as { electronAPI?: object }).electronAPI = {}; };
  const production = () => { vi.stubEnv("DEV", false); vi.stubEnv("VITE_ENABLE_LOCAL_NATIVE", ""); };
  afterEach(() => {
    localStorage.removeItem(LOCAL_NATIVE_DEBUG_KEY);
    delete (window as unknown as { electronAPI?: object }).electronAPI;
  });

  it("is on in development mode regardless of flags", () => {
    vi.stubEnv("DEV", true);
    expect(isLocalNativeEnabled()).toBe(true);
  });

  it("is off in a packaged build without the build-time flag", () => {
    production(); asElectron();
    expect(isLocalNativeEnabled()).toBe(false);
  });

  it("is on when the build-time flag was baked in", () => {
    vi.stubEnv("DEV", false); vi.stubEnv("VITE_ENABLE_LOCAL_NATIVE", "true"); asElectron();
    expect(isLocalNativeEnabled()).toBe(true);
  });

  it("is on in a packaged Electron build when the tester switch is set in localStorage", () => {
    production(); asElectron();
    localStorage.setItem(LOCAL_NATIVE_DEBUG_KEY, "1");
    expect(isLocalNativeEnabled()).toBe(true);
  });

  it("ignores the tester switch outside Electron (extension / web)", () => {
    production();
    localStorage.setItem(LOCAL_NATIVE_DEBUG_KEY, "1");
    expect(isLocalNativeEnabled()).toBe(false);
  });

  it("requires the exact value '1' — anything else leaves the provider hidden", () => {
    production(); asElectron();
    localStorage.setItem(LOCAL_NATIVE_DEBUG_KEY, "true");
    expect(isLocalNativeEnabled()).toBe(false);
  });
});

describe("getRelayWsUrl", () => {
  it("derives a wss /v1 URL from the default backend", () => {
    vi.stubEnv("VITE_BACKEND_URL", "");
    expect(getRelayWsUrl()).toBe("wss://sokuji.kizuna.ai/v1");
  });
  it("converts http to ws for local dev", () => {
    vi.stubEnv("VITE_BACKEND_URL", "http://localhost:8787");
    expect(getRelayWsUrl()).toBe("ws://localhost:8787/v1");
  });
  it("converts https to wss", () => {
    vi.stubEnv("VITE_BACKEND_URL", "https://example.com");
    expect(getRelayWsUrl()).toBe("wss://example.com/v1");
  });
});
