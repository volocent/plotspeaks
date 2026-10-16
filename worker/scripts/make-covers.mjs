// Makes a cover for every story in stories/ that doesn't have worker/public/covers/<slug>.jpg yet,
// by calling POST /admin/cover on a running Plot Speaks server (local `wrangler dev` or dev).
// The scene comes from stories/<slug>/cover-prompt.txt when present; otherwise the server writes
// one from the story's title, description and first scene. The house style and the
// "no text, no faces, no bodies, no gore" rules are always added server-side (src/covers.ts).
//
// Usage (from worker/):
//   node scripts/make-covers.mjs [base-url] [--force] [--only=slug,slug] [--raw] [--size=768] [--quality=82]
//   base-url  default http://127.0.0.1:8790
//   --force   overwrite existing covers (only those named with --only, if given)
//   --raw     keep the model's 1024px JPEG as is (about 600 KB); by default it is resized and
//             re-encoded locally with Windows' built-in System.Drawing (no extra packages)
// Key: ADMIN_KEY from the environment, else DEV_ACCESS_KEY from worker/.dev.vars (dev only).
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(here, '..', 'public', 'covers');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || dflt;
const base = (args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8790').replace(/\/$/, '');
const force = flag('force');
const only = opt('only', '') ? new Set(opt('only', '').split(',')) : null;
const size = Number(opt('size', '768'));
const quality = Number(opt('quality', '82'));

const devVars = join(here, '..', '.dev.vars');
const key = process.env.ADMIN_KEY
  || (existsSync(devVars) ? (/^DEV_ACCESS_KEY=(.+)$/m.exec(readFileSync(devVars, 'utf8')) || [])[1]?.trim() : '');
if (!key) { console.error('No key: set ADMIN_KEY, or run against dev with DEV_ACCESS_KEY in worker/.dev.vars.'); process.exit(1); }

/** Resize to size x size and re-encode as JPEG at the given quality, using PowerShell + System.Drawing. */
function shrink(bytes) {
  if (process.platform !== 'win32') return bytes;
  const stamp = `${process.pid}-${Date.now()}`;
  const src = join(tmpdir(), `cover-src-${stamp}.jpg`), dst = join(tmpdir(), `cover-dst-${stamp}.jpg`);
  writeFileSync(src, bytes, { flag: 'wx' });
  const ps = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${src}')
$bmp = New-Object System.Drawing.Bitmap ${size}, ${size}
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, ${size}, ${size})
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$p = New-Object System.Drawing.Imaging.EncoderParameters 1
$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]${quality})
$bmp.Save('${dst}', $codec, $p)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  try {
    if (r.status === 0 && existsSync(dst)) return readFileSync(dst);
    console.warn(`  (resize failed, keeping the original: ${(r.stderr || '').trim().slice(0, 200)})`);
    return bytes;
  } finally {
    for (const f of [src, dst]) if (existsSync(f)) unlinkSync(f);
  }
}

mkdirSync(outDir, { recursive: true });
let made = 0, skipped = 0, failed = 0;
for (const slug of readdirSync(join(root, 'stories')).sort()) {
  const dir = join(root, 'stories', slug);
  if (!existsSync(join(dir, 'story.md'))) continue;
  if (only && !only.has(slug)) continue;
  const out = join(outDir, `${slug}.jpg`);
  if (existsSync(out) && !force) { skipped++; continue; }
  const promptFile = join(dir, 'cover-prompt.txt');
  const prompt = existsSync(promptFile) ? readFileSync(promptFile, 'utf8').trim() : undefined;
  // `wrangler dev` reloads when a file lands in public/, so the next request can get a 503
  // "worker restarted mid-request": wait and retry a few times.
  let res;
  for (let attempt = 1; attempt <= 4; attempt++) {
    res = await fetch(`${base}/admin/cover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify(prompt ? { slug, prompt } : { slug }),
    });
    if (res.status !== 503 || attempt === 4) break;
    await res.arrayBuffer();
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) {
    failed++;
    console.log(`FAIL ${slug}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const bytes = flag('raw') ? raw : shrink(raw);
  // 'wx' refuses to overwrite a file that appeared meanwhile; only --force replaces a cover.
  writeFileSync(out, bytes, { flag: force ? 'w' : 'wx' });
  made++;
  const used = decodeURIComponent(res.headers.get('x-cover-prompt') || '');
  console.log(`made ${slug}.jpg (${Math.round(bytes.length / 1024)} KB${bytes === raw ? '' : `, from ${Math.round(raw.length / 1024)} KB`})${prompt ? '' : `\n  generated prompt: ${used}`}`);
}
console.log(`\n${made} made, ${skipped} already there, ${failed} failed`);
process.exit(failed ? 1 : 0);
