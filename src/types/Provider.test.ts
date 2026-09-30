import { describe, it, expect } from "vitest";
import { Provider, isKizunaManagedProvider } from "./Provider";

describe("kizuna-managed provider helpers", () => {
  it("identifies the two relay-managed providers", () => {
    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE)).toBe(true);
    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(true);
    expect(isKizunaManagedProvider(Provider.OPENAI_TRANSLATE)).toBe(false);
  });
});
