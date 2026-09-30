/* Bundle the game into single self-contained HTML files for sharing.
 *
 * The game itself needs no build step — index.html runs as-is. This only
 * exists to produce portable files you can host, attach or paste anywhere,
 * with the CSS and every script inlined and no external requests of any kind.
 *
 *   node build.js            # writes both bundles below
 *   node build.js --check    # exits 1 if either committed bundle is stale
 *
 *   dist/play.html                 a complete page: open it, host it, send it
 *   dist/paws-and-politburo.html   a fragment with no <!doctype>, <html>,
 *                                  <head> or <body>, for hosts that supply
 *                                  their own document skeleton
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = {
  standalone: path.join(ROOT, 'dist', 'play.html'),
  fragment: path.join(ROOT, 'dist', 'paws-and-politburo.html')
};

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Every script tag, in load order. Anything the bundler cannot reproduce
   faithfully is an error rather than a silently missing script. */
const tagRe = /<script\b([^>]*)>\s*<\/script>/gi;
const scripts = [];
let m;
while ((m = tagRe.exec(html))) {
  const attrs = m[1];
  const src = /\bsrc=(["'])([^"']+)\1/i.exec(attrs);
  if (!src) throw new Error('inline <script> in index.html; move it to js/');
  const extra = attrs.replace(src[0], '').trim();
  if (extra) throw new Error('cannot bundle <script ' + attrs.trim() + '>: unsupported attributes');
  scripts.push(src[2]);
}
const opened = (html.match(/<script\b/gi) || []).length;
if (!scripts.length || opened !== scripts.length) {
  throw new Error('found ' + opened + ' <script> tags but understood ' + scripts.length);
}

/* The app markup: the container through to the first script tag. */
const start = html.indexOf('<div id="app">');
const end = html.search(/<script\b/i);
if (start < 0 || end < start) throw new Error('index.html layout changed; update build.js');
const markup = html.slice(start, end).trimEnd();

/* Head tags worth keeping: description, theme colour, share previews, icon. */
const head = html.slice(0, html.indexOf('</head>'));
const title = (/<title>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || 'Paws &amp; Politburo';
const metas = (head.match(/<meta\b[^>]*>/gi) || [])
  .filter(t => !/charset|name="viewport"/i.test(t));
const icon = (head.match(/<link\b[^>]*rel="icon"[^>]*>/i) || [])[0] || '';

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

const style = '<style>\n' + css.trimEnd() + '\n' + overrides.trimEnd() + '\n</style>';

const code = scripts.map(function (src) {
  const js = fs.readFileSync(path.join(ROOT, src), 'utf8').trimEnd();
  // A literal </script> inside a source string would close the tag early.
  if (/<\/script/i.test(js)) throw new Error('unescaped closing tag in ' + src);
  return '<script>\n' + js + '\n</script>';
}).join('\n');

const body = markup + '\n\n' + code + '\n';

const outputs = {
  fragment: '<title>' + title + '</title>\n' + style + '\n\n' + body,
  standalone: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, '
    + 'maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
    + '<title>' + title + '</title>\n'
    + metas.map(t => t + '\n').join('')
    + (icon ? icon + '\n' : '')
    + style + '\n</head>\n<body>\n' + body + '</body>\n</html>\n'
};

if (process.argv.includes('--check')) {
  const stale = Object.keys(OUT).filter(function (k) {
    try { return fs.readFileSync(OUT[k], 'utf8') !== outputs[k]; } catch (e) { return true; }
  });
  if (stale.length) {
    console.error('stale bundle(s): ' + stale.map(k => path.relative(ROOT, OUT[k])).join(', ')
      + '\nrun `node build.js` and commit the result');
    process.exit(1);
  }
  console.log('bundles are up to date (' + scripts.length + ' scripts)');
} else {
  Object.keys(OUT).forEach(function (k) {
    fs.mkdirSync(path.dirname(OUT[k]), { recursive: true });
    fs.writeFileSync(OUT[k], outputs[k]);
    console.log('wrote ' + path.relative(ROOT, OUT[k]) + '  '
      + (outputs[k].length / 1024).toFixed(1) + ' KB  (' + scripts.length + ' scripts inlined)');
  });
}
