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

await copyFile(join(PUBLIC, 'app.js'), join(DIST, 'app.js'));
await copyFile(join(PUBLIC, 'styles.css'), join(DIST, 'styles.css'));

let html = await readFile(join(PUBLIC, 'index.html'), 'utf8');
html = html
  .replaceAll('"/vendor/spektrum/', '"./vendor/spektrum/')
  .replaceAll('href="/styles.css"', 'href="./styles.css"')
  .replaceAll('src="/app.js"', 'src="./app.js"');
await writeFile(join(DIST, 'index.html'), html);

console.log('built → ./dist');
