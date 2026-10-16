// Makes the home page's audio sample, worker/public/audio/sample-last-toast.mp3, and prints the
// line timings that src/site.ts uses to highlight who is speaking (SAMPLE_LINES there).
// Each line is spoken by POST /admin/tts on a running Plot Speaks server (Workers AI Aura 1, two
// voices); the MP3s are joined frame by frame with short silences between them, in plain Node.
// Then the file is sent to POST /admin/stt?model=turbo (Whisper large-v3-turbo) so the words can be checked without ears.
//
// Usage (from worker/, with `npx wrangler dev --env=dev --port 8798` running):
//   node scripts/make-sample.mjs [base-url] [--force]
// Key: ADMIN_KEY from the environment, else DEV_ACCESS_KEY from worker/.dev.vars (dev only).
// The lines use only the public story.md (cold open + a fact the table volunteers in Scene 1.2).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'audio', 'sample-last-toast.mp3');
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8798').replace(/\/$/, '');
const force = args.includes('--force');
const devVars = join(here, '..', '.dev.vars');
const key = process.env.ADMIN_KEY
  || (existsSync(devVars) ? (/^DEV_ACCESS_KEY=(.+)$/m.exec(readFileSync(devVars, 'utf8')) || [])[1]?.trim() : '');
if (!key) { console.error('No key: set ADMIN_KEY, or run against dev with DEV_ACCESS_KEY in worker/.dev.vars.'); process.exit(1); }
if (existsSync(out) && !force) { console.error(`${out} exists; pass --force to replace it.`); process.exit(1); }

const VOICE = { you: 'asteria', narrator: 'helios' };
const LINES = [
  { who: 'you', text: 'Start The Last Toast with Plot Speaks.' },
  { who: 'narrator', text: 'Retired judge Marguerite Okafor is hosting her own retirement dinner at Harrow House, a stone place on a hill above the river. During the cheese course, the housekeeper finds Marguerite slumped in her study, a half-finished glass of port beside her. Snow has iced the roads, and nobody can leave. Everyone turns to you, the only investigator here. Where do you want to start?' },
  { who: 'you', text: 'Who poured the port tonight?' },
  { who: 'narrator', text: 'Father Reyes lifts his eyes from the table, and pauses. "I did, at ten past nine. Everyone drank from the same decanter, in front of the whole table, and nobody else is ill." Who do you want to talk to next?' },
];
const GAP = 0.7; // seconds of silence between lines
const LEAD = 0.15; // a breath of silence at the very start

// ---------------------------------------------------------------- MP3 frame parsing
const BITRATES = { // kbps, [version][layer3]
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Splits an MP3 into Layer III frames, skipping ID3 tags and the Xing/Info header frame. */
function frames(buf) {
  let i = 0;
  if (buf.slice(0, 3).toString('latin1') === 'ID3') i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  const list = [];
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3, br = buf[i + 2] >> 4, sr = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { i++; continue; }
    const rate = RATES[ver][sr], kbps = BITRATES[ver === 3 ? 1 : 2][br];
    const samples = ver === 3 ? 1152 : 576;
    const len = Math.floor((samples / 8) * kbps * 1000 / rate) + pad;
    if (i + len > buf.length) break;
    const f = buf.subarray(i, i + len);
    const tag = f.slice(4, 60).toString('latin1');
    if (!(list.length === 0 && /Xing|Info/.test(tag))) list.push({ f, rate, samples, ver, chans: (buf[i + 3] >> 6) === 3 ? 1 : 2 });
    i += len;
  }
  return list;
}

/** A silent frame in the same format as `tpl`: same header, side info and main data all zero. */
function silentFrame(tpl) {
  const s = Buffer.alloc(tpl.f.length);
  tpl.f.copy(s, 0, 0, 4);
  s[1] |= 1; // no CRC, so the zeroed side info follows the header directly
  return s;
}

async function post(path, body, type) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': type, 'x-admin-key': key }, body });
    if (res.ok) return res;
    const msg = (await res.text()).slice(0, 200);
    if (res.status !== 503 || attempt === 4) throw new Error(`${path} ${res.status}: ${msg}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

const clips = [];
for (const line of LINES) {
  const res = await post('/admin/tts', JSON.stringify({ text: line.text, speaker: VOICE[line.who] }), 'application/json');
  const fr = frames(Buffer.from(await res.arrayBuffer()));
  if (!fr.length) throw new Error(`no MP3 frames for: ${line.text.slice(0, 40)}`);
  clips.push(fr);
}
const fmt = clips[0][0];
for (const c of clips) for (const f of c) if (f.rate !== fmt.rate || f.ver !== fmt.ver || f.chans !== fmt.chans) throw new Error(`mixed formats: ${f.rate} Hz v${f.ver} vs ${fmt.rate} Hz v${fmt.ver}`);
const frameSec = fmt.samples / fmt.rate;
const silence = (sec) => Array.from({ length: Math.round(sec / frameSec) }, () => silentFrame(fmt));

const parts = [...silence(LEAD)];
let t = parts.length * frameSec;
const timings = [];
clips.forEach((c, n) => {
  if (n) { const gap = silence(GAP); parts.push(...gap); t += gap.length * frameSec; }
  const start = t;
  for (const f of c) parts.push(f.f);
  t += c.length * frameSec;
  timings.push({ who: LINES[n].who, start: +start.toFixed(2), end: +t.toFixed(2), text: LINES[n].text });
});
parts.push(...silence(0.3));
const mp3 = Buffer.concat(parts);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, mp3, { flag: force ? 'w' : 'wx' });
console.log(`wrote ${out}: ${Math.round(mp3.length / 1024)} KB, ${(t + 0.3).toFixed(1)} s, ${fmt.rate} Hz, ${fmt.chans} ch`);
console.log('timings (for SAMPLE_LINES in src/site.ts):');
for (const x of timings) console.log(`  ${x.start.toFixed(2)}-${x.end.toFixed(2)}  ${x.who.padEnd(8)} ${x.text}`);
console.log(JSON.stringify(timings.map(({ who, start }) => ({ who, start }))));

const stt = await (await post('/admin/stt?model=turbo', mp3, 'audio/mpeg')).json();
console.log(`\nWhisper (large-v3-turbo) heard:\n${stt.text}`);
