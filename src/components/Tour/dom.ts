// src/components/Tour/dom.ts
//
// Finding a step's target. "Visible" means it has layout: panels kept alive
// inside <Activity mode="hidden"> are display:none and report no client rects,
// which is exactly the case the tour must treat as "not there yet".
export function isVisible(el: Element): boolean {
  return el.getClientRects().length > 0;
}

export function resolveAnchor(id: string, root: ParentNode = document): HTMLElement | null {
  const el = root.querySelector(`[data-tour="${id}"]`);
  return el instanceof HTMLElement && isVisible(el) ? el : null;
}

export interface WaitOptions {
  timeoutMs?: number;
  /** Injected for tests; defaults to requestAnimationFrame. */
  schedule?: (cb: () => void) => void;
  now?: () => number;
  root?: ParentNode;
}

/** Poll until the anchor is visible or the timeout passes (spec §2.1: 1.5 s). */
export function waitForAnchor(id: string, opts: WaitOptions = {}): Promise<HTMLElement | null> {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const schedule = opts.schedule ?? ((cb) => requestAnimationFrame(cb));
  const now = opts.now ?? (() => performance.now());
  const root = opts.root ?? document;

  const first = resolveAnchor(id, root);
  if (first) return Promise.resolve(first);

  const deadline = now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const el = resolveAnchor(id, root);
      if (el) return resolve(el);
      if (now() >= deadline) return resolve(null);
      schedule(tick);
    };
    schedule(tick);
  });
}
