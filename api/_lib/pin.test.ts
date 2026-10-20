import { describe, expect, it } from 'vitest';
import argon2 from '@node-rs/argon2';
import { verifyPinHash } from './pin';

describe('server PIN hash validation', () => {
  it('rejects missing, weak, and non-Argon2id hashes before verifying', async () => {
    await expect(verifyPinHash('', '1234')).resolves.toBe(false);
    await expect(verifyPinHash('$argon2i$v=19$m=19456,t=2,p=1$salt$hash', '1234')).resolves.toBe(false);
    await expect(verifyPinHash('$argon2id$v=19$m=32768,t=3,p=1$salt$hash', '1234')).resolves.toBe(false);
  });

  it('verifies a production-strength Argon2id hash without storing the PIN', async () => {
    const sampleOnly = 'sample-only-625841';
    const hash = await argon2.hash(sampleOnly, { algorithm: argon2.Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 });

    await expect(verifyPinHash(hash, sampleOnly)).resolves.toBe(true);
    await expect(verifyPinHash(hash, 'wrong-sample')).resolves.toBe(false);
  });
});
