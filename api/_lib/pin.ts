import argon2 from '@node-rs/argon2';

const REQUIRED_HASH_PREFIX = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/;

export async function verifyPinHash(hash: string, pin: string): Promise<boolean> {
  if (!REQUIRED_HASH_PREFIX.test(hash)) return false;
  try { return await argon2.verify(hash, pin); }
  catch { return false; }
}
