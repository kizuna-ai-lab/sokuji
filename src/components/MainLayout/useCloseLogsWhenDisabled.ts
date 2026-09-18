// showLogs is persisted in sessionStorage, and the logs button only exists
// while diagnostic logs are on (Help). Without this, a user who switches them
// off with the panel open is left with an open panel — over a store that has
// just been emptied — and nothing to close it with.
// The panel is CLOSED, not suspended: switching logs back on does not reopen
// it, which is the predictable reading of a cleared flag.
//
// This hook decides only WHEN. The caller closes, because closing means three
// things it already owns — the state, the persisted flag, and ending the
// panel's tracked view. Handing this hook a bare setState skipped that last
// one, so analytics kept believing logs were on screen and billed the next
// panel's duration to them.
import { useEffect } from 'react';

export function useCloseLogsWhenDisabled(
  enabled: boolean,
  showLogs: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!enabled && showLogs) onClose();
  }, [enabled, showLogs, onClose]);
}
