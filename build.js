import { mkdir, copyFile, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const PUBLIC = 'public';

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const f of ['app.js', 'lib.js', 'chart.js', 'map.js', 'styles.css', 'favicon.svg', 'manifest.webmanifest']) {
  await copyFile(join(PUBLIC, f), join(DIST, f));
}

await mkdir(join(DIST, 'icons'), { recursive: true });
for (const f of await readdir(join(PUBLIC, 'icons'))) {
  await copyFile(join(PUBLIC, 'icons', f), join(DIST, 'icons', f));
}

const html = (await readFile(join(PUBLIC, 'index.html'), 'utf8')).replaceAll('"/', '"./');
await writeFile(join(DIST, 'index.html'), html);

console.log('built → ./dist');
