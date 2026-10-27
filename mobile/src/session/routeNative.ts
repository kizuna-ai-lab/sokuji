import { AudioManager } from 'react-native-audio-api';
import { routeOf, type Route } from './route';

// Kept apart from route.ts, which the node tests import: this module is native.
export async function currentRoute(): Promise<Route> {
  return routeOf(await AudioManager.getDevicesInfo());
}

/** Calls back with the route after every change the OS reports. */
export function onRouteChange(cb: (route: Route) => void): () => void {
  const sub = AudioManager.addSystemEventListener('routeChange', () => {
    void currentRoute().then(cb);
  });
  return () => sub?.remove();
}
