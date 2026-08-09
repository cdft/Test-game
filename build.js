/* Bundle the game into a single self-contained HTML file for sharing.
 *
 * The game itself needs no build step — index.html runs as-is. This only
 * exists to produce one portable file you can host, attach or paste
 * anywhere, with the CSS and all eight scripts inlined and no external
 * requests of any kind.
 *
 *   node build.js [outfile]      # default: dist/paws-and-politburo.html
 *
 * The output deliberately omits <!doctype>, <html>, <head> and <body>, so
 * it can be dropped straight into a host that supplies its own skeleton.
 * Pass --standalone for a complete document you can open directly.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const standalone = process.argv.includes('--standalone');
const dest = process.argv.slice(2).filter(a => !a.startsWith('--'))[0]
  || path.join(ROOT, 'dist', 'paws-and-politburo.html');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* The app markup: the container through to just before the script tags. */
const start = html.indexOf('<div id="app">');
const end = html.indexOf('<script src="js/util.js">');
if (start < 0 || end < 0) throw new Error('index.html layout changed; update build.js');
const markup = html.slice(start, end).trimEnd();

/* Scripts, in the order index.html loads them. */
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (!scripts.length) throw new Error('no scripts found in index.html');

const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');

/* A host page owns its own <body>, so pin the stage to the viewport rather
   than inheriting a height from ancestors we do not control. */
const overrides = `
/* ── Bundled-page overrides ────────────────────────────────────── */
#app {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: #0d0b10;
}
#stage { touch-action: none; overscroll-behavior: none; }
body { overscroll-behavior: none; }
`;

const parts = [
  '<title>Paws &amp; Politburo</title>',
  '<style>',
  css.trimEnd(),
  overrides.trimEnd(),
  '</style>',
  '',
  markup,
  ''
];

scripts.forEach(function (src) {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8').trimEnd();
  // A literal </script> inside a source string would close the tag early.
  if (code.indexOf('</scr' + 'ipt>') !== -1) throw new Error('unescaped closing tag in ' + src);
  parts.push('<script>\n' + code + '\n</script>');
});

let out = parts.join('\n') + '\n';

if (standalone) {
  out = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, '
    + 'maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
    + '</head>\n<body>\n' + out + '</body>\n</html>\n';
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('wrote ' + dest + '  ' + (out.length / 1024).toFixed(1) + ' KB  ('
  + scripts.length + ' scripts inlined' + (standalone ? ', standalone' : '') + ')');
