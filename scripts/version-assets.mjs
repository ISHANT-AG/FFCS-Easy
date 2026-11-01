import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const files = (await readdir(new URL('src/', root))).filter((x) => x.endsWith('.js')).sort();
const clean = (s) => s.replace(/(\.(?:js|css))(?:\?v=[a-zA-Z0-9-]+)?/g, '$1');
const contents = await Promise.all(files.map((f) => readFile(new URL('src/' + f, root), 'utf8')));
const css = await readFile(new URL('style.css', root), 'utf8');
const version = createHash('sha256')
  .update(contents.map(clean).join('\n') + css)
  .digest('hex')
  .slice(0, 12);
for (let i = 0; i < files.length; i++) {
  const text = clean(contents[i]).replace(
    /(['"])(\.\.?\/[^'"\n]+\.js)\1/g,
    (_, q, path) => q + path + '?v=' + version + q
  );
  if (text !== contents[i]) await writeFile(new URL('src/' + files[i], root), text);
}
const index = await readFile(new URL('index.html', root), 'utf8');
const updated = index.replace(
  /(style\.css|src\/(?:app|bootstrap)\.js)(?:\?v=[a-zA-Z0-9-]+)?/g,
  '$1?v=' + version
);
if (updated !== index) await writeFile(new URL('index.html', root), updated);
console.log('Asset version:', version);
