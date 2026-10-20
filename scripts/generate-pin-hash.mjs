import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname, relative } from 'node:path';
import argon2 from '@node-rs/argon2';
import { emitKeypressEvents } from 'node:readline';

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  process.stderr.write('Run this command in a private interactive terminal.\n');
  process.exit(1);
}

function normalizeDigit(character) {
  const code = character.codePointAt(0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return character;
}

const input = process.stdin;
emitKeypressEvents(input);
input.setRawMode(true);
input.resume();
process.stdout.write('Enter the PIN (4-12 digits; input hidden): ');
let pin = '';

input.on('keypress', async (character, key) => {
  if (key?.ctrl && key.name === 'c') {
    input.setRawMode(false); input.pause(); process.stdout.write('\n'); process.exit(130);
  }
  if (key?.name === 'return' || key?.name === 'enter') {
    input.setRawMode(false); input.pause(); process.stdout.write('\n');
    if (!/^\d{4,12}$/.test(pin)) {
      pin = '';
      process.stderr.write('PIN must contain 4 to 12 digits. No hash was created.\n');
      process.exitCode = 1;
      return;
    }
    const hash = await argon2.hash(pin, {
      algorithm: argon2.Algorithm.Argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32
    });
    pin = '';
    const output=resolve(process.argv[2]||homedir()+'/.codex/private/beity-production-provisioning/pin-hash.txt');
    const fromProject=relative(process.cwd(),output);
    if(!fromProject.startsWith('..'))throw Error('Secret output must be outside the project');
    await mkdir(dirname(output),{recursive:true,mode:0o700});
    await writeFile(output,hash+'\n',{flag:'wx',mode:0o600});
    process.stdout.write('PIN hash saved to a private file outside the project. No secret was printed.\n');
    return;
  }
  if (key?.name === 'backspace' || key?.name === 'delete') {
    if (pin) { pin = pin.slice(0, -1); process.stdout.write('\b \b'); }
    return;
  }
  const digit = normalizeDigit(character ?? '');
  if (/^\d$/.test(digit) && pin.length < 12) { pin += digit; process.stdout.write('•'); }
});
