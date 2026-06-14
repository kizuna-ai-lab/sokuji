import { describe, it, expect, vi } from "vitest";
vi.mock("../../utils/environment", async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  getRelayWsUrl: () => "wss://r.example/v1",
}));
import { ClientFactory } from "./ClientFactory";
import { Provider } from "../../types/Provider";
import { OpenAITranslateGAClient } from "./OpenAITranslateGAClient";
import { VolcengineAST2Client } from "./VolcengineAST2Client";

describe("ClientFactory kizuna relay providers", () => {
  it("routes the translate twin to OpenAITranslateGAClient", () => {
    const c = ClientFactory.createClient("gpt-realtime-translate", Provider.KIZUNA_AI_OPENAI_TRANSLATE, "sess_TOKEN");
    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
  });
  it("routes the doubao twin to VolcengineAST2Client", () => {
    const c = ClientFactory.createClient("ast-v2-s2s", Provider.KIZUNA_AI_VOLCENGINE_AST2, "sess_TOKEN");
    expect(c).toBeInstanceOf(VolcengineAST2Client);
  });
});
