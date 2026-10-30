/**
 * One action at a time behind a button: a tap while the last one is still
 * running starts nothing (design scope: no double requests). `onChange` tells
 * the screen when to show the busy state.
 */
export function createBusyGuard(onChange: (busy: boolean) => void) {
  let running = false;
  const set = (busy: boolean) => {
    running = busy;
    onChange(busy);
  };
  return {
    busy: () => running,
    /** The action's promise (it rejects as the action does: catch it), or null when one is already running. */
    run<T>(action: () => Promise<T> | T): Promise<T> | null {
      if (running) return null;
      let result: Promise<T>;
      try {
        set(true);
        result = Promise.resolve(action());
      } catch (e) {
        result = Promise.reject(e);
      }
      return result.finally(() => set(false));
    },
  };
}
