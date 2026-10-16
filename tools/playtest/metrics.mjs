// Objective length metrics computed in code (not by the judge).
import { countSentences } from '../check-story/rules.mjs';

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil(0.9 * s.length) - 1)]; };
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

export function computeMetrics(transcript) {
  const turns = transcript.filter((t) => t.role === 'narrator').map((t) => ({
    turn: t.turn,
    words: (t.text.match(/\S+/g) || []).length,
    sentences: countSentences(t.text),
    endsQ: /\?["'”’)\]\s]*$/.test(t.text.trim()),
  }));
  const words = turns.map((t) => t.words);
  const n = turns.length;
  const acc = transcript.find((t) => t.role === 'player' && /\bI\s+(?:formally\s+)?accuse\b/i.test(t.text));
  return {
    narrator_turns: n,
    per_turn: turns,
    median_words: median(words),
    p90_words: p90(words),
    pct_over_60_words: pct(turns.filter((t) => t.words > 60).length, n),
    pct_over_3_sentences: pct(turns.filter((t) => t.sentences > 3).length, n),
    pct_ending_question: pct(turns.filter((t) => t.endsQ).length, n),
    exchanges_to_first_accusation: acc ? acc.turn : null,
  };
}
