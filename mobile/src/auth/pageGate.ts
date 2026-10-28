/**
 * Requests that belong to the page they were sent from. When the user leaves
 * the page (another tab, Back, the screen goes away), a request still running
 * keeps running, but its result is dropped: it must not move the user to the
 * next page, or show its error, somewhere else.
 */
export function createPageGate() {
  let page = 0;
  return {
    /** The page changed: what earlier requests return is no longer wanted. */
    leave() {
      page += 1;
    },
    async run<T>(action: () => Promise<T>, on: { done?: (value: T) => void; failed?: (err: unknown) => void; settled?: () => void }): Promise<void> {
      const mine = page;
      try {
        const value = await action();
        if (mine === page) on.done?.(value);
      } catch (err) {
        if (mine === page) on.failed?.(err);
      } finally {
        if (mine === page) on.settled?.();
      }
    },
  };
}
