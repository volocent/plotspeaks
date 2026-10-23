// Pictures for trivia clues that are hard to hold in your head by ear (Ben, 2026-10-23): a flag, or a
// country's outline. Built from the boards' answer files (secrets.md, never public) into
// worker/src/generated/clue-images.json, keyed by story and clue id. The Worker sends only the open clue's
// picture, inline, so no file name or URL can give the answer away; nothing in a picture names the country.
//
// Art: flags from flag-icons (MIT, by Panayiotis Lipiridis; accurate, e.g. all 50 US stars); outlines from @svg-maps/world (CC BY 4.0, by VictorCazanave,
// https://github.com/VictorCazanave/svg-maps), cropped to each country with svg-path-bbox.
// Without the answer files (the public repo), it writes an empty map and everything else still works.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseTrivia } from '../check-story/trivia.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const require = createRequire(path.join(ROOT, 'worker', 'package.json'));
const OUT = path.join(ROOT, 'worker', 'src', 'generated', 'clue-images.json');

// Which categories get which picture, per board.
const BOARDS = { 'trivia-geography': { flags: 'flag', 'country shapes': 'shape' } };
const ISO = {
  japan: 'JP', canada: 'CA', 'united states': 'US', 'united kingdom': 'GB', italy: 'IT', china: 'CN', switzerland: 'CH',
  brazil: 'BR', india: 'IN', france: 'FR', mexico: 'MX', spain: 'ES', germany: 'DE', greece: 'GR', ukraine: 'UA',
  sweden: 'SE', 'south korea': 'KR', israel: 'IL', lebanon: 'LB', jamaica: 'JM', argentina: 'AR', nepal: 'NP',
  cyprus: 'CY', kenya: 'KE', bhutan: 'BT', mozambique: 'MZ', denmark: 'DK', dominica: 'DM', qatar: 'QA',
  cambodia: 'KH', 'new zealand': 'NZ', australia: 'AU', chile: 'CL', norway: 'NO', cuba: 'CU', philippines: 'PH',
  vietnam: 'VN', indonesia: 'ID', madagascar: 'MG', 'sri lanka': 'LK', panama: 'PA', egypt: 'EG', thailand: 'TH',
  ireland: 'IE', turkey: 'TR', croatia: 'HR', malaysia: 'MY', finland: 'FI', bangladesh: 'BD', oman: 'OM', malawi: 'MW',
};

/** A flag, with anything that could name the country removed. */
function flag(code) {
  const f = path.join(ROOT, 'worker', 'node_modules', 'flag-icons', 'flags', '4x3', `${code.toLowerCase()}.svg`);
  return clean(fs.readFileSync(f, 'utf8'));
}
let world = null;
/** A country's outline, cropped to its own bounds with a little margin, in one fill colour. */
function shape(code) {
  if (!world) { const m = require('@svg-maps/world'); world = m.default ?? m; }
  const loc = world.locations.find((l) => l.id === code.toLowerCase());
  if (!loc) throw new Error(`no outline for ${code}`);
  const { svgPathBbox } = require('svg-path-bbox');
  const [x0, y0, x1, y1] = svgPathBbox(loc.path);
  const w = x1 - x0, h = y1 - y0, pad = Math.max(w, h) * 0.06;
  const vb = [x0 - pad, y0 - pad, w + 2 * pad, h + 2 * pad].map((n) => Math.round(n * 1000) / 1000).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path fill="#45B3E7" stroke="#1E4A7E" stroke-width="${Math.max(w, h) / 200}" stroke-linejoin="round" d="${loc.path}"/></svg>`;
}
let seq = 0;
/**
 * A picture with nothing that could name the country: no title or comments, no classes, and every id
 * renamed to a meaningless one (flag-icons ids carry the country code, "us-a"), with its references kept.
 */
function clean(svg) {
  let s = svg.replace(/<\?xml[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(title|desc|metadata)[\s\S]*?<\/\1>/gi, '')
    .replace(/\s(class|data-[\w-]+|aria-[\w-]+)="[^"]*"/g, '');
  const ids = [...new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))];
  // One letter and digits only, so a renamed id can never spell a country code.
  const pre = `q${++seq}_`;
  ids.forEach((id, i) => {
    const to = `${pre}${i}`;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\sid="${esc}"`, 'g'), ` id="${to}"`)
      .replace(new RegExp(`#${esc}(?=[)"'\\s])`, 'g'), `#${to}`);
  });
  return s.trim();
}

const out = {};
let made = 0;
for (const [slug, cats] of Object.entries(BOARDS)) {
  const file = path.join(ROOT, 'stories', slug, 'secrets.md');
  if (!fs.existsSync(file)) continue;
  const board = parseTrivia(fs.readFileSync(file, 'utf8'));
  const pics = {};
  for (const c of board.categories ?? []) {
    const kind = cats[c.name.toLowerCase()];
    if (!kind) continue;
    for (const q of c.clues) {
      const code = ISO[q.answer.toLowerCase().trim()];
      if (!code) throw new Error(`${slug}: no country code for "${q.answer}" in ${c.name}`);
      pics[`${c.name.toLowerCase()}|${q.answer.toLowerCase().trim()}`] = kind === 'flag' ? flag(code) : shape(code);
      made++;
    }
  }
  out[slug] = pics;
}
// A picture must never carry a country's name (the check that keeps the answer off the screen).
// And never its country code or the flag set's own name (both appear in the source files' ids).
const names = Object.keys(ISO), codes = Object.values(ISO).map((c) => c.toLowerCase());
for (const pics of Object.values(out)) for (const svg of Object.values(pics)) {
  const low = svg.toLowerCase();
  const hit = names.find((n) => new RegExp(`[^a-z]${n}[^a-z]`).test(low));
  if (hit) throw new Error(`a picture contains the name "${hit}"`);
  if (low.includes('flag-icons')) throw new Error('a picture still names the flag set');
  const ids = [...low.matchAll(/\sid="([^"]+)"|url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  const code = codes.find((c) => ids.some((id) => new RegExp(`(^|[^a-z])${c}([^a-z]|$)`).test(id)));
  if (code) throw new Error(`a picture's ids contain the country code "${code}"`);
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${path.relative(ROOT, OUT)}: ${made} pictures`);
