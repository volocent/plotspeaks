// The connector version of a story (review 2026-10-16, B1/S10/S14). Pure: no I/O.
//
// The public story.md is written for paste play, where a passenger (the "wrangler") holds the
// answer key and reads lines into the same microphone as the players. Through the Plot Speaks
// connector there is no passenger: the narrator calls check_accusation and get_cue instead. The
// paste-play hand-offs, and the rules that tell the narrator to trust the next message starting
// "Wrangler", must never reach a connector client, so this module rewrites them at build time
// (tools/worker-data/build.mjs) and at load time for approved submissions (worker/src/submissions.ts).
//
// What it does, in order:
//   1. Straightens curly quotes, so typographic “Wrangler, …” hand-offs are caught too (S10).
//   2. Replaces the YAML front matter with a one-line header (title, genre, players, length).
//   3. Rewrites, bullet by bullet, the accusation hand-off, the solo-mode line, the cue rules and
//      the follow-up rule; then the known short phrases ("as the wrangler reads it", "Wrangler,
//      cue S2" -> "call get_cue with cue S2"), and "Narrator, cue S2c" in cue notes.
//   4. Drops any sentence that still mentions the wrangler, and reports it (`dropped`), so a new
//      phrasing can't slip through: the build prints them and the smoke test fails on any left.
//   5. Two-chapter stories: chapter 1's part keeps everything but chapter 2, which becomes a note
//      to call start_story with chapter 2; chapter 2's part keeps everything but chapter 1's
//      scenes, with chapter 1's recap block at the top of chapter 2.

const straighten = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'");

const CUE = '(S\\d+[a-z]?)';

/** Sentence split that keeps quotes together well enough for GM bullets. */
function sentences(text) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    cur += c;
    if (c === '"') inQuote = !inQuote;
    const ends = /[.!?]/.test(c) || (c === '"' && !inQuote && /[.!?]/.test(text[i - 1] ?? ''));
    if (!inQuote && ends && (text[i + 1] === ' ' || i === text.length - 1)) {
      // Keep a closing quote or bracket with the sentence.
      out.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const WRANGLERISH = /wrangler|same microphone|without question|is the truth|overrides anything|never ask for it again|doubt where it came from/i;

function accusationBullet(line) {
  const m = /^(\s*[-*]\s+)(.*)$/.exec(line);
  const [lead, body] = m ? [m[1], m[2]] : ['', line];
  const kept = [];
  let handed = false;
  for (const s of sentences(body)) {
    if (!handed && /Wrangler,\s*check the secrets/i.test(s)) {
      handed = true;
      // "Then say "Wrangler, check the secrets." and wait." / ", then say ... and wait."
      const rewritten = s
        .replace(/,?\s*(then\s+)?say\s+"Wrangler,\s*check the secrets\.?"\s*(and wait)?\.?/i, (all, then) => `${/^,/.test(all) ? ',' : ''} ${then ?? ''}call check_accusation with the story slug, the accused person's name and the play id.`)
        .replace(/^\s*,\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
      kept.push(/[.!?]$/.test(rewritten) ? rewritten : `${rewritten}.`);
      kept.push("Its result is the verdict for that person: it starts with Correct. or Innocent. and decides the outcome, even over a suspect's own account (people in this story can lie). Run the matching ending.");
      continue;
    }
    if (handed && WRANGLERISH.test(s)) continue;
    if (!handed && WRANGLERISH.test(s)) continue;
    kept.push(s);
  }
  if (!handed) kept.push('Then call check_accusation with the story slug, the accused person\'s name and the play id, and run the ending that matches its verdict.');
  return lead + kept.join(' ');
}

// Bullet-level rules: [test, replacement(line) or null to drop].
const BULLETS = [
  [/^\s*[-*]\s+(\*\*)?Solo (play|mode)\b/i, () => null],
  [/^\s*[-*]\s+(\*\*)?Accusation\b/i, accusationBullet],
  [/^\s*[-*]\s+\*\*A cue belongs to its scene\.?\*\*/i, (l) => `${/^\s*/.exec(l)[0]}- **A cue belongs to its scene.** Call a cue only once the party has reached its place or moment, never ahead of time.`],
  [/^\s*[-*]\s+\*\*Wrangler cues\.?\*\*/i, (l) => `${/^\s*/.exec(l)[0]}- **Cues.** When a scene says **Cue (call get_cue):** S<n>, call get_cue with that cue id at that moment and narrate only its read-aloud part. Never invent what a cue would have said. Everyone hears what you narrate, so it only ever says what is happening now.`],
  [/^\s*[-*]\s+(\*\*)?Follow-up cues\b/i, (l) => `${/^\s*/.exec(l)[0]}- Follow-up cues: each cue comes with notes for you, and S1's notes include a table of follow-up cues (such as S3b) and when they apply. When that moment comes, call get_cue for the follow-up yourself.`],
];

// Phrase-level rewrites, applied to every line after the bullet rules.
const PHRASES = [
  [/The wrangler's line \(or, in solo (?:mode|play), the matching Endings detail line you read yourself\)/gi, 'The check_accusation result'],
  [/after "Wrangler,\s*check the secrets\.?",? the GM-wrangler reads the correct ending aloud from the secrets\./gi, 'after check_accusation confirms it, give the verdict and the rest of its line.'],
  [/after "Wrangler,\s*check the secrets\.?",? the GM-wrangler reads aloud the accused's clearing line\./gi, "after check_accusation, give the verdict and the accused's clearing line it returns."],
  [/after the wrangler reads the confirmation,/gi, 'after check_accusation confirms it,'],
  [/as the wrangler reads it/gi, 'as the check_accusation result gives it'],
  [/only the wrangler's line decides/gi, 'only the check_accusation result decides'],
  [/until the wrangler's line/gi, 'until the check_accusation result'],
  [/the wrangler's line/gi, 'the check_accusation result'],
  [/say\s+"Wrangler,\s*check the secrets\.?"\s*(and wait)?/gi, 'call check_accusation'],
  [/"Wrangler,\s*check the secrets\.?"/gi, 'check_accusation'],
  [/\*\*Wrangler cue:\*\*/g, '**Cue (call get_cue):**'],
  [/\*\*Wrangler cue\*\*/g, '**Cue (call get_cue)**'],
  [new RegExp(`say\\s+"(?:Wrangler|Narrator),\\s*cue\\s+${CUE}\\.?"\\s*and wait`, 'gi'), 'call get_cue with cue $1 and wait for its result'],
  [new RegExp(`say\\s+"(?:Wrangler|Narrator),\\s*cue\\s+${CUE}\\.?"`, 'gi'), 'call get_cue with cue $1'],
  [new RegExp(`"(?:Wrangler|Narrator),\\s*cue\\s+${CUE}\\.?"`, 'gi'), 'call get_cue $1'],
  [new RegExp(`(?:Wrangler|Narrator),\\s*cue\\s+${CUE}`, 'gi'), 'call get_cue $1'],
  [new RegExp(`The wrangler may (?:then )?follow it with ${CUE}((?:,? (?:or|and) S\\d+[a-z]?)*)`, 'gi'), 'Its notes may call for $1$2 later'],
  [/unless the wrangler reads it to you/gi, 'unless a cue gives it to you'],
  [/after the wrangler has said/gi, 'after a cue has said'],
  [/any other way the wrangler reveals here/gi, 'any other way a cue reveals here'],
  [/with its wrangler cue/gi, 'with its cue'],
  [/gift from the wrangler/gi, 'gift from a cue'],
  [/using only what the wrangler read/gi, 'using only what the cues said'],
  [/the way the wrangler revealed/gi, 'the way a cue revealed'],
  [/\bA passenger may roll real dice\b/g, 'A player may roll real dice'],
  [/the GM-wrangler/gi, 'check_accusation'],
  // The endings offer the full reveal and an epilogue: both come from reveal_solution (B3).
  [/(or the full reveal|or shall I tell you what really happened)\?"(?! If they)/gi, '$1?" If they want the full reveal, call reveal_solution with the play id.'],
  [/(what became of (?:each of them|everyone))\?"(?! If they)/gi, '$1?" If they say yes, call reveal_solution with the play id.'],
  [/(ask whether the player wants to hear what became of everyone\.)(?! If)/gi, '$1 If yes, call reveal_solution with the play id.'],
  [/(offer one more accusation or the full reveal, and ask which\.)(?! For)/gi, '$1 For the full reveal, call reveal_solution with the play id.'],
];

/** Rewrites text for the connector. Returns { text, dropped } (sentences removed by the fallback). */
export function connectorText(text) {
  const dropped = [];
  const lines = straighten(text).split('\n');
  const out = [];
  for (let line of lines) {
    const rule = BULLETS.find(([re]) => re.test(line));
    if (rule) {
      line = rule[1](line);
      if (line === null) continue;
    }
    for (const [re, rep] of PHRASES) line = line.replace(re, rep);
    if (/wrangler/i.test(line)) {
      // Fallback: drop the sentences that still mention the wrangler.
      const m = /^(\s*(?:[-*]\s+|\|)?)(.*)$/.exec(line);
      if (m[1].startsWith('|') || /^\s*\|/.test(line)) {
        // A table row: replace the word rather than lose the row.
        dropped.push(line.trim().slice(0, 160));
        line = line.replace(/the\s+GM-wrangler|the\s+wrangler|wrangler/gi, 'the narrator');
      } else {
        const keep = sentences(m[2]).filter((s) => {
          if (/wrangler/i.test(s)) { dropped.push(s.slice(0, 160)); return false; }
          return true;
        });
        if (!keep.length) continue;
        line = m[1] + keep.join(' ');
      }
    }
    out.push(line);
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), dropped };
}

/** One-line header from the front matter fields. */
function header(fm) {
  const f = (k) => ((new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm').exec(fm) || [, ''])[1]).replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
  const genre = f('genre') === 'murder-mystery' ? 'murder mystery' : f('genre') === 'kids' ? 'family mystery' : f('genre') === 'adventure' ? 'fantasy adventure' : f('genre');
  const parts = [
    f('title') || 'Untitled',
    `${f('tone') === 'dark' ? 'dark ' : ''}${genre}`.trim(),
    f('players') ? `${f('players')} players` : '',
    f('duration_minutes') ? `about ${f('duration_minutes')} minutes` : '',
    Number(f('chapters')) > 1 ? `${f('chapters')} chapters` : '',
    f('rules_system') === 'srd-5.2.1' ? 'rules: SRD 5.2.1 (CC BY 4.0)' : '',
  ].filter(Boolean);
  return `Story: ${parts.join(' · ')}`;
}

/** Splits text into the part before chapter `n`, chapter n's section (to the next non-chapter ## heading or the next chapter), and the rest. */
function chapterRanges(lines) {
  const heads = [];
  lines.forEach((l, i) => { if (/^##\s/.test(l)) heads.push({ i, chapter: (/^##\s+Chapter\s+(\d+)\b/i.exec(l) || [])[1] }); });
  return heads.map((h, k) => ({ ...h, end: k + 1 < heads.length ? heads[k + 1].i : lines.length }));
}

/**
 * The connector parts of a story.md. Returns { parts: string[], dropped: string[] }:
 * parts[0] is the whole story (one chapter) or chapter 1; parts[1] is chapter 2, when there is one.
 */
export function connectorStory(storyMd) {
  const s = straighten(storyMd);
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(s);
  const body = fm ? s.slice(fm[0].length) : s;
  const head = header(fm ? fm[1] : '');
  const { text, dropped } = connectorText(body);
  const lines = text.split('\n');
  const ranges = chapterRanges(lines);
  const chapters = ranges.filter((r) => r.chapter);
  if (chapters.length < 2) return { parts: [`${head}\n\n${text.trim()}\n`], dropped };

  const recapOf = (r) => {
    const sec = lines.slice(r.i, r.end);
    const at = sec.findIndex((l) => /^###\s+Recap block\b/i.test(l));
    if (at < 0) return [];
    let end = sec.findIndex((l, j) => j > at && /^###?\s/.test(l));
    if (end < 0) end = sec.length;
    return sec.slice(at + 1, end);
  };
  const build = (n) => {
    const out = [];
    let cursor = 0;
    for (const r of chapters) {
      out.push(...lines.slice(cursor, r.i));
      const num = Number(r.chapter);
      if (num === n) out.push(...lines.slice(r.i, r.end));
      else if (num === n - 1) {
        out.push(`## Chapter ${num} (already played)`, '', `Chapter ${num} was served by an earlier start_story call. Its recap block, to read aloud first when chapter ${n} begins or on a resume:`, ...recapOf(r));
      } else if (num > n) {
        if (num === n + 1) out.push(`## Chapter ${num} (not included here)`, '', `When chapter ${n}'s recap block has been read and the players are ready to go on, or they ask to resume from chapter ${num}, call start_story again with this story's slug, chapter: ${num} and the play id. It returns chapter ${num}, with chapter ${n}'s recap at its top.`, '');
      }
      cursor = r.end;
    }
    out.push(...lines.slice(cursor));
    const note = n > 1 ? `\n\nThis is chapter ${n} of the story. The rest of the script (how to run it, the cast and the endings) is repeated here so it works in a fresh chat too. Skip the cold open and the how-to-play offer: start by reading chapter ${n - 1}'s recap block, then play chapter ${n}'s first scene.` :`\n\nThis is chapter 1 of ${chapters.length}.`;
    return `${head}${note}\n\n${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  };
  return { parts: chapters.map((_, k) => build(k + 1)), dropped };
}

/** A cue's narrator notes or the Listen-for table, with "Narrator/Wrangler, cue S2c" made a get_cue call. */
export function connectorNotes(text) {
  if (!text) return { text, dropped: [] };
  return connectorText(text);
}
