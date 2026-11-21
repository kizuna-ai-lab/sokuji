// A record names the provider of each stage; one written before it did reads as its one provider on every stage.
import { describe, it, expect } from 'vitest';
import { recordStages } from './services';
import type { HistoryServices } from './types';

describe("a record's stages", () => {
  it('are the ones it stored: a local run with Bing and Edge', () => {
    const stages = { transcription: 'local_inference', translation: 'bing', speech: 'edge' };
    const services: HistoryServices = { provider: 'local_inference', models: {}, stages };
    expect(recordStages(services)).toEqual(stages);
  });

  it('are its one provider on every stage when it stored none', () => {
    const services: HistoryServices = { provider: 'soniox', models: {} };
    expect(recordStages(services)).toEqual({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' });
  });
});
