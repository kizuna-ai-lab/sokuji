import { describe, it, expect } from "vitest";
import { Provider, isKizunaManagedProvider } from "./Provider";

describe("kizuna-managed provider helpers", () => {
  it("identifies the Kizuna-managed provider", () => {
    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_SONIOX)).toBe(true);
    expect(isKizunaManagedProvider(Provider.OPENAI_TRANSLATE)).toBe(false);
  });
});
