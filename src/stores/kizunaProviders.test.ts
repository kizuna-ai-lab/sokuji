import { describe, it, expect } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { Provider } from "../types/Provider";

describe("KizunaAI relay providers — session config", () => {
  it("translate twin builds an openai_translate config from its own slice", () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE } as any);
    const cfg: any = useSettingsStore.getState().createSessionConfig("instr");
    expect(cfg.provider).toBe("openai_translate");
    expect(cfg.model).toBe("gpt-realtime-translate");
  });
  it("doubao twin builds a volcengine_ast2 config from its own slice", () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_VOLCENGINE_AST2 } as any);
    const cfg: any = useSettingsStore.getState().createSessionConfig("instr");
    expect(cfg.provider).toBe("volcengine_ast2");
  });
});
