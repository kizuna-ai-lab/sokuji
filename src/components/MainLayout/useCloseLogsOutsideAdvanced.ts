// src/components/MainLayout/useCloseLogsOutsideAdvanced.ts
//
// showLogs is persisted in sessionStorage, and the logs button only exists
// in advanced mode. Without this, a user who opens logs in advanced and
// switches to basic is left with an open panel and nothing to close it with.
// The panel is CLOSED, not suspended: switching back to advanced does not
// reopen it, which is the predictable reading of a cleared flag.
import { useEffect } from 'react';

export function useCloseLogsOutsideAdvanced(
  uiMode: string,
  showLogs: boolean,
  setShowLogs: (next: boolean) => void,
): void {
  useEffect(() => {
    if (uiMode !== 'advanced' && showLogs) {
      setShowLogs(false);
      sessionStorage.setItem('panelState.showLogs', 'false');
    }
  }, [uiMode, showLogs, setShowLogs]);
}
