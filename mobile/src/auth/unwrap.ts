// better-auth's client returns { data, error } and never throws; the screens
// want a thrown Error with the server's message.
export function unwrap<T>(result: { data: T; error: { message?: string; status?: number } | null }): T {
  if (result.error) {
    throw new Error(result.error.message || `request failed${result.error.status ? ` (${result.error.status})` : ''}`);
  }
  return result.data;
}

// The backend requires a name on sign-up; the app has no name field.
export function localPart(email: string): string {
  const at = email.indexOf('@');
  const name = at > 0 ? email.slice(0, at) : at === 0 ? '' : email;
  return name.trim() || 'user';
}
