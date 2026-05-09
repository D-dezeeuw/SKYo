import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const PUBLIC = 'public';
const SPEKTRUM = 'node_modules/spektrum';

await rm(DIST, { recursive: true, force: true });
await mkdir(join(DIST, 'vendor', 'spektrum'), { recursive: true });

for (const f of [
  'spektrum.js',
  'spektrum-persist.js',
  'spektrum-devtools.js',
  'spektrum.d.ts',
  'LICENSE',
]) {
  await copyFile(join(SPEKTRUM, f), join(DIST, 'vendor', 'spektrum', f));
}

for (const f of ['app.js', 'lib.js', 'styles.css', 'favicon.svg']) {
  await copyFile(join(PUBLIC, f), join(DIST, f));
}

const html = (await readFile(join(PUBLIC, 'index.html'), 'utf8')).replaceAll('"/', '"./');
await writeFile(join(DIST, 'index.html'), html);

console.log('built → ./dist');
