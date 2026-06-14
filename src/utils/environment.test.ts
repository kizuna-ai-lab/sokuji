import { describe, it, expect, vi, afterEach } from "vitest";
import { getRelayWsUrl } from "./environment";

afterEach(() => { vi.unstubAllEnvs(); });

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
