// A new password with the emailed code, then a sign-in with it. A failed reset
// fails the call (wrong code, say: the page says so). A sign-in that fails after
// a reset went through does not: the code is spent and the password changed, so
// the user signs in from the sign-in page instead of being asked for the code again.
export async function resetThenSignIn(o: { reset(): Promise<void>; signIn(): Promise<void>; log(line: string): void }): Promise<'signedIn' | 'resetOnly'> {
  await o.reset();
  try {
    await o.signIn();
    return 'signedIn';
  } catch (err) {
    o.log(`sign-in after the password reset failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'resetOnly';
  }
}
