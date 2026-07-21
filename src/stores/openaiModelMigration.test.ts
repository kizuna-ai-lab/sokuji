import { describe, it, expect } from "vitest";
import { migrateDeprecatedOpenAIModel } from "./settingsStore";
import { defaultOpenAISettings } from "../services/providers/OpenAIProviderConfig";

describe("deprecated OpenAI realtime model migration", () => {
  it("maps deprecated mini realtime families to gpt-realtime-2.1-mini", () => {
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-mini")).toBe("gpt-realtime-2.1-mini");
    expect(migrateDeprecatedOpenAIModel("gpt-4o-mini-realtime")).toBe("gpt-realtime-2.1-mini");
    expect(migrateDeprecatedOpenAIModel("gpt-4o-mini-realtime-preview-2024-12-17")).toBe("gpt-realtime-2.1-mini");
  });

  it("maps deprecated full realtime families to gpt-realtime-2.1", () => {
    expect(migrateDeprecatedOpenAIModel("gpt-realtime")).toBe("gpt-realtime-2.1");
    expect(migrateDeprecatedOpenAIModel("gpt-4o-realtime-preview")).toBe("gpt-realtime-2.1");
    // Stale static-list ids that were never confirmed as current OpenAI models.
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-1.5")).toBe("gpt-realtime-2.1");
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-2")).toBe("gpt-realtime-2.1");
  });

  it("leaves current 2.1 models unchanged", () => {
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-2.1")).toBe("gpt-realtime-2.1");
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-2.1-mini")).toBe("gpt-realtime-2.1-mini");
  });

  it("leaves non-voice-agent realtime variants (translate/whisper) unchanged", () => {
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-translate")).toBe("gpt-realtime-translate");
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-whisper")).toBe("gpt-realtime-whisper");
  });

  it("leaves empty/unknown ids untouched", () => {
    expect(migrateDeprecatedOpenAIModel("")).toBe("");
    expect(migrateDeprecatedOpenAIModel("whisper-1")).toBe("whisper-1");
  });

  it("ships a non-deprecated default model", () => {
    expect(migrateDeprecatedOpenAIModel(defaultOpenAISettings.model)).toBe(defaultOpenAISettings.model);
    expect(defaultOpenAISettings.model).toBe("gpt-realtime-2.1-mini");
  });
});
