import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve('.vercel/output/functions/api/pin');
const routes = readdirSync(root).filter((name) => name.endsWith('.func')).sort();
assert.deepEqual(routes, ['login.func', 'logout.func', 'session.func'], 'Only the three real PIN routes may be deployable; test fixtures must never be endpoints');
for (const route of routes) {
  const config = JSON.parse(readFileSync(join(root, route, '.vc-config.json'), 'utf8'));
  assert.match(config.runtime, /^nodejs/);
  const module = await import(pathToFileURL(join(root, route, config.handler)).href);
  assert.equal(typeof module.default, 'function', `Invalid API entrypoint: ${route}`);
}
console.log('PASS: exactly three PIN endpoints; every built ESM handler imports successfully.');
