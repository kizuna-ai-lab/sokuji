import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampPanelWidth, readPanelWidth, savePanelWidth,
  PANEL_MIN_WIDTH, PANEL_DEFAULT_WIDTH,
} from './panelWidth';

describe('clampPanelWidth', () => {
  it('floors at the minimum', () => {
    expect(clampPanelWidth(100, 1600)).toBe(PANEL_MIN_WIDTH);
  });
  it('caps at viewport minus the MainPanel minimum (360)', () => {
    expect(clampPanelWidth(5000, 1000)).toBe(1000 - 360);
  });
  it('leaves an in-range width unchanged', () => {
    expect(clampPanelWidth(500, 1600)).toBe(500);
  });
  it('floors at the minimum on a tiny viewport', () => {
    expect(clampPanelWidth(400, 500)).toBe(PANEL_MIN_WIDTH);
  });
});

describe('read/savePanelWidth', () => {
  beforeEach(() => localStorage.clear());
  it('returns the default when unset or garbage', () => {
    expect(readPanelWidth()).toBe(PANEL_DEFAULT_WIDTH);
    localStorage.setItem('panelState.settingsPanelWidth', 'abc');
    expect(readPanelWidth()).toBe(PANEL_DEFAULT_WIDTH);
  });
  it('round-trips a saved width', () => {
    savePanelWidth(523.6);
    expect(localStorage.getItem('panelState.settingsPanelWidth')).toBe('524');
    expect(readPanelWidth()).toBe(524);
  });
});
