// A sign-out the server refuses (an expired session, no network) still drops
// the local session: the sign-in screen is the only way back.
export async function signOutAndForget(o: { signOut(): Promise<void>; forget(): Promise<void>; log(line: string): void }): Promise<void> {
  try {
    await o.signOut();
  } catch (err) {
    o.log(`sign-out refused: ${err instanceof Error ? err.message : String(err)}`);
  }
  await o.forget();
}
