/**
 * The page's live sign-in for code outside React that must not import the session's module graph
 * (`providers/soniox/regionChange`: a render-time `AuthContext` snapshot cannot show an account that changed
 * during a lookup). `getAppSession()` registers the reader; until then there is none.
 */
import type { AuthContext } from '../lib/provider/types';

let read: () => AuthContext | undefined = () => undefined;

export function registerAuth(reader: () => AuthContext | undefined): void {
  read = reader;
}

export function currentAuth(): AuthContext | undefined {
  return read();
}
