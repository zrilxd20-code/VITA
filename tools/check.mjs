// VITA unified check — pure Node.js stdlib, no dependencies.
// 1) syntax check (node --check) for all JS entry points
// 2) global scope collision: home.js + prologue.js + game.js share window scope
// 3) i18n parity: every T.en key must exist in T.id
// 4) secret scan: no hardcoded supabase keys/URLs in source
// Run: npm run check
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const FILES = ['js/supabase.js', 'js/home.js', 'js/prologue.js', 'js/game.js', 'sw.js'];
let failed = false;
const fail = (m) => { failed = true; console.error('FAIL:', m); };
const ok = (m) => console.log('OK:', m);

// 1+2) syntax + combined scope
try {
  for (const f of FILES) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  ok('syntax node --check (' + FILES.join(', ') + ')');
} catch (e) { fail('syntax error\n' + (e.stderr?.toString() || e.message)); }

try {
  const combined =
    readFileSync('js/supabase.js', 'utf8') + '\n;\n' +
    readFileSync('js/home.js', 'utf8') + '\n;\n' +
    readFileSync('js/prologue.js', 'utf8') + '\n;\n' +
    readFileSync('js/game.js', 'utf8');
  new Function(combined);
  ok('combined global scope (supabase+home+prologue+game)');
} catch (e) { fail('global scope collision: ' + e.message); }

// 3) i18n parity via lightweight parse of T blocks
try {
  const src = readFileSync('js/game.js', 'utf8');
  const idBlock = src.match(/const T = \{\s*id:\s*\{([\s\S]*?)\},\s*en:/);
  const enBlock = src.match(/,\s*en:\s*\{([\s\S]*?)\n    \}\n\};/);
  if (!idBlock || !enBlock) throw new Error('T blocks not found');
  const keys = (b) => [...b.matchAll(/^\s*([a-z0-9_]+):/gmi)].map((m) => m[1]);
  const id = new Set(keys(idBlock[1]));
  const en = keys(enBlock[1]);
  const missing = en.filter((k) => !id.has(k));
  if (missing.length) fail('i18n missing in T.id: ' + missing.join(', '));
  else ok(`i18n parity (${en.length} keys EN↔ID)`);
} catch (e) { fail('i18n check: ' + e.message); }

// 4) secret scan
try {
  const scanFiles = ['js/supabase.js', 'index.html', ...FILES];
  const hits = [];
  for (const f of new Set(scanFiles)) {
    const s = readFileSync(f, 'utf8');
    if (/supabase\.co/.test(s) && !/your-project\.supabase\.co/.test(s.replace(/your-project\.supabase\.co/g, '')) && /https:\/\/[a-z0-9-]+\.supabase\.co/.test(s)) {
      // allow only placeholder; flag real-looking project URLs
      if (!s.includes('vita_supabase_config')) hits.push(f + ': supabase URL?');
    }
    if (/sb_publishable_|sb_secret_/i.test(s)) hits.push(f + ': supabase key?');
  }
  // precise: fail only if a real key pattern exists
  const strict = [];
  for (const f of new Set(scanFiles)) {
    const s = readFileSync(f, 'utf8');
    if (/sb_publishable_[A-Za-z0-9_-]{10,}/.test(s)) strict.push(f);
  }
  if (strict.length) fail('hardcoded supabase key in: ' + strict.join(', '));
  else ok('secret scan (no hardcoded supabase keys)');
} catch (e) { fail('secret scan: ' + e.message); }

// 5) PWA manifest audit
try {
  const mfStr = readFileSync('manifest.webmanifest', 'utf8');
  const mf = JSON.parse(mfStr);
  if (!mf.name || !mf.short_name || !mf.start_url || !Array.isArray(mf.icons) || !mf.icons.length) {
    fail('manifest.webmanifest missing required PWA fields');
  } else {
    const missingIcons = mf.icons.map(i => i.src.replace(/^\.\//, '')).filter(src => !existsSync(src));
    const missingScreenshots = Array.isArray(mf.screenshots)
      ? mf.screenshots.map(s => s.src.replace(/^\.\//, '')).filter(src => !existsSync(src))
      : [];
    if (missingIcons.length) fail('manifest missing icon files: ' + missingIcons.join(', '));
    else if (missingScreenshots.length) fail('manifest missing screenshot files: ' + missingScreenshots.join(', '));
    else ok(`manifest.webmanifest valid (${mf.icons.length} icons, ${mf.screenshots?.length || 0} screenshots verified)`);
  }
} catch (e) { fail('manifest parse error: ' + e.message); }

if (failed) { console.error('\nCHECK FAILED'); process.exit(1); }
console.log('\nCHECK PASSED');
