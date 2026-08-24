// showLogs is persisted in sessionStorage, and the logs button only exists
// in advanced mode. Without this, a user who opens logs in advanced and
// switches to basic is left with an open panel and nothing to close it with.
// The panel is CLOSED, not suspended: switching back to advanced does not
// reopen it, which is the predictable reading of a cleared flag.
//
// This hook decides only WHEN. The caller closes, because closing means three
// things it already owns — the state, the persisted flag, and ending the
// panel's tracked view. Handing this hook a bare setState skipped that last
// one, so analytics kept believing logs were on screen and billed the next
// panel's duration to them.
import { useEffect } from 'react';

export function useCloseLogsOutsideAdvanced(
  uiMode: string,
  showLogs: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (uiMode !== 'advanced' && showLogs) onClose();
  }, [uiMode, showLogs, onClose]);
}
