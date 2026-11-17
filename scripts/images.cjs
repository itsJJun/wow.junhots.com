// Make the og (link preview) images and the picture for an /updates/ entry from the running site.
//   npx wrangler dev            (in another terminal)
//   node scripts/images.cjs                       -> public/assets/og/<page>.jpg for every page in the sitemap
//   node scripts/images.cjs update 2026-11-16-launch /gear-upgrades/  -> public/assets/updates/2026-11-16-launch.webp
// Needs Playwright (npx playwright) and Python Pillow (to write .webp).
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { readFileSync, mkdirSync } = require('node:fs');

(async () => {
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: process.argv[2] === 'update' ? 2 : 1 });
const shot = async (path, out) => {
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', quality: out.endsWith('.jpg') ? 82 : undefined });
};
const [mode, name, path = '/'] = process.argv.slice(2);
if (mode === 'update') {
  mkdirSync('public/assets/updates', { recursive: true });
  const tmp = '.wrangler/shot.png';
  mkdirSync('.wrangler', { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  // a crop of the top-left of the page (readable when small), not the whole page shrunk
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: tmp, clip: { x: Number(process.env.X || 10), y: Number(process.env.Y || 64), width: 672, height: 378 } });
  execFileSync('python3', ['-c', `from PIL import Image; Image.open('${tmp}').convert('RGB').resize((672, 378), Image.LANCZOS).save('public/assets/updates/${name}.webp', 'WEBP', quality=82)`]);
  console.log('wrote public/assets/updates/' + name + '.webp');
} else {
  mkdirSync('public/assets/og', { recursive: true });
  const urls = [...readFileSync('public/sitemap.xml', 'utf8').matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map(m => m[1]);
  for (const p of urls) {
    const n = p.replace(/\//g, '') || 'default';
    await shot(p, `public/assets/og/${n}.jpg`);
    console.log('og', p, '->', n + '.jpg');
  }
}
await browser.close();
})();
