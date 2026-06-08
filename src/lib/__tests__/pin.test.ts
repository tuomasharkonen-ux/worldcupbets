import { normalizePin, hashPin, verifyPin, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '../pin';

describe('normalizePin', () => {
  it('accepts 4–6 digit PINs and trims whitespace', () => {
    expect(normalizePin('1234')).toBe('1234');
    expect(normalizePin('123456')).toBe('123456');
    expect(normalizePin('  4321 ')).toBe('4321');
  });

  it('rejects too short, too long, non-numeric, and empty input', () => {
    expect(normalizePin('123')).toBeNull();
    expect(normalizePin('1234567')).toBeNull();
    expect(normalizePin('12ab')).toBeNull();
    expect(normalizePin('')).toBeNull();
    expect(normalizePin(undefined)).toBeNull();
    expect(normalizePin(null)).toBeNull();
  });

  it('keeps the advertised length bounds in sync', () => {
    expect(PIN_MIN_LENGTH).toBe(4);
    expect(PIN_MAX_LENGTH).toBe(6);
  });
});

describe('hashPin / verifyPin', () => {
  it('verifies the correct PIN', async () => {
    const hash = await hashPin('1357');
    expect(await verifyPin('1357', hash)).toBe(true);
  });

  it('rejects the wrong PIN', async () => {
    const hash = await hashPin('1357');
    expect(await verifyPin('1358', hash)).toBe(false);
  });

  it('salts: the same PIN hashes differently each time', async () => {
    const a = await hashPin('2468');
    const b = await hashPin('2468');
    expect(a).not.toEqual(b);
    expect(await verifyPin('2468', a)).toBe(true);
    expect(await verifyPin('2468', b)).toBe(true);
  });

  it('returns false for null or malformed stored hashes', async () => {
    expect(await verifyPin('1234', null)).toBe(false);
    expect(await verifyPin('1234', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPin('1234', 'deadbeef:')).toBe(false);
  });
});
