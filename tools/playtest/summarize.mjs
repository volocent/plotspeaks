#!/usr/bin/env node
// Table of all playtests/**/*.json results.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { computeMetrics } from './metrics.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'playtests');

function walk(d) {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

const rows = [['story', 'persona', 'narrator', 'secrets', 'turns', 'outcome', 'leak', 'coherence', 'format', 'med.w', 'p90.w', '>60w%', '>3s%', '?end%', 'acc@', 'file']];
if (existsSync(root)) {
  for (const f of walk(root).sort()) {
    let r;
    try { r = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    const j = r.judge;
    const fmt = j?.format ? Object.values(j.format).reduce((a, b) => a + (Number(b) || 0), 0) : '?';
    const mt = r.metrics || computeMetrics(r.transcript || []);
    const x = (v) => (v == null ? '-' : String(v));
    rows.push([r.story, r.options.persona, r.options.narratorModel, r.options.secrets, String(r.exchanges), j?.outcome ?? '?',
      j?.leak ? (j.leak.culprit_or_solution_revealed_before_accusation || j.leak.hidden_clue_given_without_the_required_action?.length ? 'Y' : 'n') : '?',
      String(j?.coherence_breaks?.length ?? '?'), String(fmt), x(mt.median_words), x(mt.p90_words), x(mt.pct_over_60_words), x(mt.pct_over_3_sentences), x(mt.pct_ending_question), x(mt.exchanges_to_first_accusation), f.slice(root.length + 1).replace(/\.json$/, '')]);
  }
}
const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd());
if (rows.length === 1) console.log('(no playtests yet)');
