import { Platform } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import { addOutputListener, currentOutput } from '../../modules/route-picker/src/RoutePickerModule';
import { routeOf, type Route } from './route';

// Kept apart from route.ts, which the node tests import: this module is native.

/** The library's device list with the output in use, which it leaves empty on Android. */
export async function devicesInfo() {
  const info = await AudioManager.getDevicesInfo();
  if (Platform.OS !== 'android') return info;
  const output = currentOutput();
  return { ...info, currentOutputs: output ? [output] : [] };
}

export async function currentRoute(): Promise<Route> {
  return routeOf(await devicesInfo());
}

/** Calls back after every change of output the OS reports. */
export function onOutputChange(cb: () => void): () => void {
  const sub = Platform.OS === 'android' ? addOutputListener(cb) : AudioManager.addSystemEventListener('routeChange', cb);
  return () => sub?.remove();
}

/** Calls back with the route after every change the OS reports. */
export function onRouteChange(cb: (route: Route) => void): () => void {
  return onOutputChange(() => { void currentRoute().then(cb); });
}
