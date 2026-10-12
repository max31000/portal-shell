import { describe, expect, it } from 'vitest';
import { formatInviteCode, normalizeInviteCode } from './code';
// Shared with mvv42-auth's tests: the server must produce exactly the same results.
import vectors from './code-vectors.json';

interface Vector {
  input: string;
  result: 'normalized' | 'legacy' | 'invalid';
  value?: string;
  note: string;
}

const LEGACY = 'kQ7vX2mP9aLr4TzW_8-bNc3Y';

describe('normalizeInviteCode (spec review decision 6, shared vectors)', () => {
  it.each((vectors as Vector[]).map((v) => [v.note, v] as const))('%s', (_note, v) => {
    const n = normalizeInviteCode(v.input);
    if (v.result === 'invalid') expect(n).toEqual({ ok: false });
    else expect(n).toEqual({ ok: true, value: v.value, legacy: v.result === 'legacy' });
  });

  it('covers every outcome', () => {
    const kinds = new Set((vectors as Vector[]).map((v) => v.result));
    expect([...kinds].sort()).toEqual(['invalid', 'legacy', 'normalized']);
  });

  it('always yields ASCII (safe for the X-Invite-Code header)', () => {
    for (const v of vectors as Vector[]) {
      const n = normalizeInviteCode(v.input);
      if (n.ok) expect(/^[\x21-\x7e]+$/.test(n.value)).toBe(true);
    }
  });
});

describe('formatInviteCode', () => {
  it('groups a new code as XXXX-XXXX-XXXX', () => {
    expect(formatInviteCode('k7pm2xq9hd4t')).toBe('K7PM-2XQ9-HD4T');
  });

  it('leaves legacy and invalid codes untouched', () => {
    expect(formatInviteCode(LEGACY)).toBe(LEGACY);
    expect(formatInviteCode('kQ7vX2mP9aLr4TzW')).toBe('kQ7vX2mP9aLr4TzW');
  });
});
