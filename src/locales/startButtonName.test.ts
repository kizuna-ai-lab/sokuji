// The button that starts a session must not carry the sign-in button's name: in Spanish and European Portuguese both
// read "Iniciar sesión" / "Iniciar sessão", so the docs (and the user) could not tell which button was meant.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = join(__dirname);
const codes = readdirSync(LOCALES).filter((name) => statSync(join(LOCALES, name)).isDirectory()).sort();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (code: string): any => JSON.parse(readFileSync(join(LOCALES, code, 'translation.json'), 'utf8'));
const norm = (s: string | undefined) => (s ?? '').trim().toLocaleLowerCase();

describe('the start button is not named like sign-in', () => {
  it.each(codes)('%s', (code) => {
    const t = read(code);
    const signIn = new Set([t.auth?.signIn, t.common?.signIn, t.setup?.credentials?.signIn].filter(Boolean).map(norm));
    expect(signIn.has(norm(t.mainPanel?.startSession))).toBe(false);
    expect(signIn.has(norm(t.subtitle?.bar?.start))).toBe(false);
  });
});
