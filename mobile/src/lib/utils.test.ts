import { describe, expect, it } from 'vitest';
import { cn } from './utils';

// cn() merges Tailwind 3.4 classes (NativeWind 4) with tailwind-merge 2.x, the
// line for Tailwind 3 (v3 targets Tailwind 4). The merges the screens rely on:
describe('cn', () => {
  it('lets a later class win within its group', () => {
    expect(cn('text-foreground text-base font-medium text-center', 'text-left')).toBe('text-foreground text-base font-medium text-left');
    expect(cn('min-h-12 px-5 py-3', 'self-stretch px-1')).toBe('min-h-12 py-3 self-stretch px-1');
    expect(cn('bg-primary active:bg-primary/90', 'bg-destructive active:bg-destructive/90')).toBe('bg-destructive active:bg-destructive/90');
    expect(cn('text-muted-foreground text-sm', 'text-destructive')).toBe('text-sm text-destructive');
  });

  it('keeps a size and a colour that share the text- prefix', () => {
    expect(cn('text-sm', 'text-primary')).toBe('text-sm text-primary');
  });
});
