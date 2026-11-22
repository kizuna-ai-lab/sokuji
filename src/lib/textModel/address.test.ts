import { describe, it, expect } from 'vitest';
import { compatibleAddressProblem, normaliseBaseUrl } from './address';

describe("a compatible service's address", () => {
  it('is read without its trailing slashes, and without an endpoint the user pasted with it', () => {
    expect(normaliseBaseUrl(' https://openrouter.ai/api/v1/ ')).toBe('https://openrouter.ai/api/v1');
    expect(normaliseBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(normaliseBaseUrl('https://api.deepseek.com//')).toBe('https://api.deepseek.com');
    expect(normaliseBaseUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
    expect(normaliseBaseUrl('https://api.example.com/v1/models/')).toBe('https://api.example.com/v1');
  });

  it('may be https anywhere, and http on this computer only', () => {
    for (const url of ['https://openrouter.ai/api/v1', 'https://api.deepseek.com', 'http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080']) {
      expect(compatibleAddressProblem(url), url).toBeNull();
    }
    for (const url of ['http://example.com/v1', 'http://192.168.1.10:11434/v1', 'http://localhost.example.com/v1', 'http://127.0.0.2/v1']) {
      expect(compatibleAddressProblem(url), url).toBe('not_https');
    }
  });

  it('is refused when it is no address, names no web scheme, carries a name and password, a query or a fragment', () => {
    expect(compatibleAddressProblem('')).toBe('not_a_url');
    expect(compatibleAddressProblem('openrouter.ai/api/v1')).toBe('not_a_url');
    expect(compatibleAddressProblem('ftp://example.com/v1')).toBe('not_https');
    expect(compatibleAddressProblem('file:///etc/passwd')).toBe('not_https');
    expect(compatibleAddressProblem('https://user:secret@example.com/v1')).toBe('has_credentials');
    expect(compatibleAddressProblem('https://example.com/v1?key=abc')).toBe('has_query');
    expect(compatibleAddressProblem('https://example.com/v1#x')).toBe('has_query');
  });

  it('is judged as it is read: a pasted endpoint and a trailing slash are no problem', () => {
    expect(compatibleAddressProblem('https://api.example.com/v1/chat/completions/')).toBeNull();
  });
});
