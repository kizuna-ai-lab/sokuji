import { describe, it, expect } from "vitest";
import { migrateLegacyKizunaProvider } from "./settingsStore";
import { Provider } from "../types/Provider";

describe("legacy kizunaai provider migration", () => {
  it("migrates a legacy 'kizunaai' provider to managed Soniox", () => {
    expect(migrateLegacyKizunaProvider("kizunaai" as any)).toBe(Provider.KIZUNA_AI_SONIOX);
  });
  it("leaves other providers unchanged", () => {
    expect(migrateLegacyKizunaProvider(Provider.OPENAI)).toBe(Provider.OPENAI);
    expect(migrateLegacyKizunaProvider(Provider.KIZUNA_AI_SONIOX)).toBe(Provider.KIZUNA_AI_SONIOX);
  });
});
