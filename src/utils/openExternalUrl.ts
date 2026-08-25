// src/utils/openExternalUrl.ts
//
// Open a link outside the app. Electron's renderer would navigate the whole
// window away from the app, so links there go to the main process's shell
// handler; every other surface uses a normal new tab.
import { isElectron } from './environment';

export function openExternalUrl(url: string): void {
  if (isElectron() && (window as any).electron?.invoke) {
    (window as any).electron.invoke('open-external', url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
