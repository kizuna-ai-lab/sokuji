import { describe, it, expect } from "vitest";
import { migrateDeprecatedOpenAIModel, migrateLegacyTranslateTranscriptModel } from "./settingsStore";
import { defaultOpenAISettings } from "../services/providers/OpenAIProviderConfig";
import {
  OpenAITranslateProviderConfig,
  defaultOpenAITranslateSettings,
} from "../services/providers/OpenAITranslateProviderConfig";

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

  it("leaves current and future (>= 2.1) versioned models unchanged", () => {
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-2.1")).toBe("gpt-realtime-2.1");
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-2.1-mini")).toBe("gpt-realtime-2.1-mini");
    // Forward-compat: newer versions must NOT be downgraded to 2.1.
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-2.2")).toBe("gpt-realtime-2.2");
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-2.2-mini")).toBe("gpt-realtime-2.2-mini");
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-3")).toBe("gpt-realtime-3");
    expect(migrateDeprecatedOpenAIModel("gpt-realtime-10.4")).toBe("gpt-realtime-10.4");
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

describe("legacy OpenAI Translate transcript model migration", () => {
  it("rewrites the retired gpt-realtime-whisper", () => {
    expect(migrateLegacyTranslateTranscriptModel({ transcriptModel: "gpt-realtime-whisper" }))
      .toEqual({ transcriptModel: "gpt-live-transcribe" });
  });

  it("leaves anything else alone, so a future choice survives", () => {
    expect(migrateLegacyTranslateTranscriptModel({ transcriptModel: "gpt-live-transcribe" })).toEqual({});
    expect(migrateLegacyTranslateTranscriptModel({ transcriptModel: "gpt-transcribe" })).toEqual({});
    expect(migrateLegacyTranslateTranscriptModel({ transcriptModel: "" })).toEqual({});
  });

  it("ships a default the translations endpoint still accepts", () => {
    // Verified against /v1/realtime/translations on 2026-08-01.
    expect(defaultOpenAITranslateSettings.transcriptModel).toBe("gpt-live-transcribe");
    expect(migrateLegacyTranslateTranscriptModel(defaultOpenAITranslateSettings)).toEqual({});
  });

  it("keeps the dropdown a single option, which the migration relies on", () => {
    // Rewriting a stored value is only safe while there is no user choice to
    // overwrite. If this list ever grows, the migration must become one-shot.
    expect(new OpenAITranslateProviderConfig().getConfig().transcriptModels)
      .toEqual(["gpt-live-transcribe"]);
  });
});
