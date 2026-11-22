// Builds sea/sea.html: ONE self-contained page (engine, demo house and built-in catalog inlined) where the demo
// house stands by the water, on one of three synthetic sites (see sea/main.js). Usage: `npm run sea` in card/.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const INTEGRATION = new URL('custom_components/house_view/', ROOT);

/** Built-in catalog of the integration (descriptors only: the pictures are not needed to draw the scene). */
function builtinCatalog() {
  const read = (folder, descriptor) => {
    const base = new URL(`${folder}/items/`, INTEGRATION);
    const out = {};
    if (!existsSync(base)) return out;
    for (const id of readdirSync(base).sort()) out[id] = JSON.parse(readFileSync(new URL(`${id}/${descriptor}`, base), 'utf8'));
    return out;
  };
  return {
    trees: read('catalog_builtin', 'tree.json'),
    objects: read('catalog_builtin_objects', 'object.json'),
    pond_fish: read('catalog_builtin_pond_fish', 'pond_fish.json'),
  };
}

const catalogPlugin = {
  name: 'catalog',
  setup(b) {
    b.onResolve({ filter: /^virtual:catalog$/ }, () => ({ path: 'catalog', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
      contents: `export default ${JSON.stringify(builtinCatalog())};`,
      loader: 'js',
    }));
  },
};

const result = await build({
  entryPoints: [new URL('../sea/main.js', import.meta.url).pathname],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  loader: { '.sh3d': 'base64' },
  plugins: [catalogPlugin],
  logLevel: 'error',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>House View</title>
</head>
<body>
<script type="module">${js}</script>
</body>
</html>
`;
const out = new URL('../sea/sea.html', import.meta.url);
writeFileSync(out, html);
console.log(`${out.pathname}: ${(html.length / 1024).toFixed(0)} KB`);
