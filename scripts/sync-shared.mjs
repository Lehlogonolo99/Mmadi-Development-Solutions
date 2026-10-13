#!/usr/bin/env node
// Copies services/shared into each service folder (services/<name>/shared).
// Each service is deployed and containerised on its own, so it needs its own copy.
// Edit files in services/shared only, then run:  node scripts/sync-shared.mjs
// CI runs it with --check and fails if a copy is out of date.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'services');
const src = join(root, 'shared');
const check = process.argv.includes('--check');
const banner = '// GENERATED from services/shared by scripts/sync-shared.mjs. Do not edit here.\n';

const services = readdirSync(root).filter((d) => d !== 'shared' && statSync(join(root, d)).isDirectory() && existsSync(join(root, d, 'package.json')));
const files = readdirSync(src).filter((f) => f.endsWith('.js'));
let stale = [];

for (const svc of services) {
  const dest = join(root, svc, 'shared');
  if (!check) { rmSync(dest, { recursive: true, force: true }); mkdirSync(dest, { recursive: true }); }
  for (const f of files) {
    const want = banner + readFileSync(join(src, f), 'utf8');
    const target = join(dest, f);
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== want) stale.push(`${svc}/shared/${f}`);
    } else {
      writeFileSync(target, want);
    }
  }
}

if (check && stale.length) {
  console.error(`Shared code is out of date in:\n  ${stale.join('\n  ')}\nRun: node scripts/sync-shared.mjs`);
  process.exit(1);
}
console.log(check ? 'Shared code is in sync.' : `Synced ${files.length} shared files into: ${services.join(', ')}`);
