// Builds a single-file copy of the tax dashboard.
//
// The site loads the page as separate files; a standalone copy (an artifact,
// an email attachment, a USB stick) has to carry its stylesheets, scripts and
// the parameter file inside one HTML file. Same sources, inlined — there is no
// second implementation to keep in sync.
//
//   node tools/bundle-irpf.mjs                 -> dist/irpf-standalone.html
//   node tools/bundle-irpf.mjs --fragment out.html
//
// --fragment drops <!doctype>, <html>, <head> and <body>, for hosts that wrap
// the page in their own document shell.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
// The site's tab title carries the app name; a standalone copy is its own
// thing and may want its own.
const titleIndex = args.indexOf('--title');
const titleArg = titleIndex === -1 ? null : args[titleIndex + 1];
const outArg = args.find((a, i) => !a.startsWith('--') && i !== titleIndex + 1);
const out = path.resolve(root, outArg || (fragment ? 'dist/irpf-fragment.html' : 'dist/irpf-standalone.html'));

const page = read('irpf.html');
const styles = ['css/app.css', 'css/irpf.css'].map(read).join('\n');
const scripts = ['js/irpf/i18n.js', 'js/irpf/engine.js', 'js/irpf/analysis.js', 'js/irpf/charts.js', 'js/irpf/app.js']
  .map(read).join('\n');
const params = read('data/tax/es-2026.json');

// Everything between <body> and </body> of the real page, so the markup can
// never drift from what the site serves.
const body = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'))
  .replace(/<script src="[^"]*"><\/script>\s*/g, '')
  // A standalone copy has no sibling basket app to link back to.
  .replace('href="./"', 'href="https://vladcherry.github.io/cesta/"')
  .trim();

const title = titleArg || (page.match(/<title>([^<]*)<\/title>/) || [, 'IRPF'])[1];
const description = (page.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1];

const inner = [
  `<title>${title}</title>`,
  `<style>\n${styles}\n</style>`,
  body,
  `<script type="application/json" id="tax-params">\n${params}\n</script>`,
  `<script>\n${scripts}\n</script>`,
].join('\n\n');

const html = fragment ? inner + '\n' : `<!doctype html>
<html lang="en" data-theme="">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta name="color-scheme" content="light dark">
${inner}
</head>
</html>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${path.relative(root, out)} — ${(html.length / 1024).toFixed(0)} kB`);
