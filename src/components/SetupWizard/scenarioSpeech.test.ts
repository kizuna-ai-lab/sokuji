import { describe, it, expect, vi, beforeEach } from 'vitest';

// The stores as a face-to-face run leaves them: auto resolves on there. The scenario must not inherit that.
vi.mock('../../lib/session/appShape', () => ({
  speechInputsFromStores: () => ({ textOnly: false, participantSpeech: true }),
  heardFromStores: () => true,
}));

import { scenarioSpeechInputs } from './scenarioSpeech';
import { getScenario } from '../../lib/setup/scenarios';
import { useRoutingStore } from '../../stores/routingStore';

beforeEach(() => {
  useRoutingStore.setState({ participantSpeech: null });
});

describe('scenarioSpeechInputs', () => {
  it("resolves an auto switch against the scenario's own side: a meeting leaves the other side silent", () => {
    expect(scenarioSpeechInputs(getScenario('understand-others')).participantSpeech).toBe(false);
  });

  it('keeps a switch the user set, since applying the scenario keeps it', () => {
    useRoutingStore.setState({ participantSpeech: true });
    expect(scenarioSpeechInputs(getScenario('understand-others')).participantSpeech).toBe(true);
  });

  it("takes the preset's answer over the stores' switch", () => {
    useRoutingStore.setState({ participantSpeech: true });
    expect(scenarioSpeechInputs(getScenario('two-way-text')).participantSpeech).toBe(false);
    useRoutingStore.setState({ participantSpeech: false });
    expect(scenarioSpeechInputs(getScenario('face-to-face-voice')).participantSpeech).toBe(true);
  });
});
