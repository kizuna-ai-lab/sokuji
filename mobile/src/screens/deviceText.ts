import type { Route } from '../session/route';

/**
 * The output as the user knows it: the route in words, with the device's own
 * name where it tells one apart (a headset's). The built-in speaker's "name"
 * is the phone's model string, so it is left out.
 */
export function outputLines(t: (key: string) => string, route: Route, name: string): { label: string; value?: string } {
  const label = t(`mobile.devices.route.${route}`);
  return route !== 'speaker' && name.trim() ? { label, value: name.trim() } : { label };
}
