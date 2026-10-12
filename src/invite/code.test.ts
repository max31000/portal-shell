import { describe, expect, it } from 'vitest';
import { formatInviteCode, normalizeInviteCode } from './code';

const LEGACY = 'kQ7vX2mP9aLr4TzW_8-bNc3Y'; // 24-char base64url (pre-closed-registration links)

describe('normalizeInviteCode (spec review decision 6, same as the server)', () => {
  it.each([
    ['canonical', 'K7PM-2XQ9-HD4T', 'K7PM2XQ9HD4T'],
    ['no dashes', 'K7PM2XQ9HD4T', 'K7PM2XQ9HD4T'],
    ['lower case', 'k7pm-2xq9-hd4t', 'K7PM2XQ9HD4T'],
    ['spaces and padding', '  K7PM 2XQ9  HD4T \n', 'K7PM2XQ9HD4T'],
    ['en / em dash, minus, non-breaking hyphen', 'K7PM–2XQ9—HD4T', 'K7PM2XQ9HD4T'],
    ['minus sign and NB hyphen', 'K7PM−2XQ9‑HD4T', 'K7PM2XQ9HD4T'],
    ['Crockford O → 0', 'KOPM-2XQ9-HD4T', 'K0PM2XQ9HD4T'],
    ['Crockford I and L → 1', 'KIPM-2XQ9-HDLT', 'K1PM2XQ9HD1T'],
    ['lower-case o, i, l', 'kopm-2xq9-hdit', 'K0PM2XQ9HD1T'],
    ['Cyrillic upper look-alikes', 'АВЕК-МНОР-СТХ2', 'ABEKMH0PCTX2'],
    ['Cyrillic lower look-alikes', 'авек-мнор-стх2', 'ABEKMH0PCTX2'],
    ['mixed Cyrillic and Latin', 'К7РМ-2ХQ9-НD4Т', 'K7PM2XQ9HD4T'],
  ])('%s: %j → %s', (_label, raw, expected) => {
    expect(normalizeInviteCode(raw)).toEqual({ ok: true, value: expected, legacy: false });
  });

  it.each([
    ['legacy base64url', LEGACY],
    ['legacy with padding', `  ${LEGACY} `],
  ])('%s is used as is (trimmed)', (_label, raw) => {
    expect(normalizeInviteCode(raw)).toEqual({ ok: true, value: LEGACY, legacy: true });
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too short', 'K7PM-2XQ9-HD4'],
    ['too long (13)', 'K7PM-2XQ9-HD4TT'],
    ['U is not Crockford', 'U7PM-2XQ9-HD4T'],
    ['punctuation', 'K7PM.2XQ9.HD4T'],
    ['non-look-alike Cyrillic', 'ЖЖЖЖ-ЖЖЖЖ-ЖЖЖЖ'],
    ['short legacy-looking token', 'abc_def-123'],
    ['legacy with a space inside', 'kQ7vX2mP9aLr 4TzW_8-bNc3Y'],
    ['emoji', 'K7PM-2XQ9-HD4🙂'],
  ])('%s → invalid', (_label, raw) => {
    expect(normalizeInviteCode(raw)).toEqual({ ok: false });
  });

  it('always yields ASCII (safe for the X-Invite-Code header)', () => {
    for (const raw of ['авек-мнор-стх2', 'К7РМ-2ХQ9-НD4Т', LEGACY]) {
      const n = normalizeInviteCode(raw);
      expect(n.ok && /^[\x21-\x7e]+$/.test(n.value)).toBe(true);
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
