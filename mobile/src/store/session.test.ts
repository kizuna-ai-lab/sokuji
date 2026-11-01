import { describe, expect, it } from 'vitest';
import { createSessionStore } from './session';

describe('whether a session is running, for every screen', () => {
  it('starts with none running', () => {
    expect(createSessionStore().getState().active).toBe(false);
  });

  it('follows what the main screen reports', () => {
    const store = createSessionStore();
    store.getState().setActive(true);
    expect(store.getState().active).toBe(true);
    store.getState().setActive(false);
    expect(store.getState().active).toBe(false);
  });
});
