import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/server/auth/password.js';

describe('password hashing', () => {
  it('stores a salted scrypt hash, never the plain password', async () => {
    const hash = await hashPassword('s3cret-密码');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/);
    expect(hash).not.toContain('s3cret');
    expect(await hashPassword('s3cret-密码')).not.toBe(hash);
  });

  it('verifies the correct password and rejects others', async () => {
    const hash = await hashPassword('pw1');
    expect(await verifyPassword('pw1', hash)).toBe(true);
    expect(await verifyPassword('pw2', hash)).toBe(false);
    expect(await verifyPassword('PW1', hash)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('pw', 'plain')).toBe(false);
    expect(await verifyPassword('pw', 'bcrypt$1$2$3$4$5')).toBe(false);
  });
});
