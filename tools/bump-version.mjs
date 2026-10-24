// VITA version bump — pure Node.js stdlib.
// Usage: npm run bump -- 2.1.0   (or: node tools/bump-version.mjs 2.1.0)
// Syncs: version.json, sw.js CACHE, index.html ?v=, js APP_VERSION, package.json.
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2];
if (!/^(\d+)\.(\d+)\.(\d+)$/.test(next || '')) {
  console.error('Usage: node tools/bump-version.mjs X.Y.Z');
  process.exit(1);
}
const cacheTag = 'vita-v' + next.replace(/\./g, '-');

const bumpFile = (path, pairs) => {
  let s = readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) { console.error(`SKIP ${path}: pattern not found: ${from.slice(0, 60)}`); process.exit(1); }
    s = s.split(from).join(to);
  }
  writeFileSync(path, s);
  console.log('updated', path);
};

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const prev = pkg.version;
const prevTag = 'vita-v' + prev.replace(/\./g, '-');
const prevQ = '?v=' + prev;
const nextQ = '?v=' + next;

writeFileSync('version.json', JSON.stringify({ version: next }) + '\n');
console.log('updated version.json');
bumpFile('sw.js', [[prevTag, cacheTag]]);
bumpFile('index.html', [
  [prevQ, nextQ],
  [`WEB EDITION v${prev}`, `WEB EDITION v${next}`],
  [`v${prev} (Latest)`, `v${next} (Latest)`]
]);
bumpFile('js/home.js', [[`const APP_VERSION = '${prev}'`, `const APP_VERSION = '${next}'`]]);
bumpFile('package.json', [[`"version": "${prev}"`, `"version": "${next}"`]]);
bumpFile('src-tauri/tauri.conf.json', [[`"version": "${prev}"`, `"version": "${next}"`]]);
bumpFile('src-tauri/Cargo.toml', [[`version = "${prev}"`, `version = "${next}"`]]);
console.log(`\nBumped ${prev} → ${next}. Test: npm run check && npm test`);
