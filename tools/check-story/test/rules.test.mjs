import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontMatter, checkFrontMatter, checkSections, checkChapters, countSentences, checkReadAloud, checkColdOpen,
  checkAudioCues, checkDenylist, parseDenylist, checkWranglerCues, checkCueParts, checkSpoilerHints, checkHiddenClues, checkStoryText,
} from '../rules.mjs';

const rules = (fs, sev) => fs.filter((f) => !sev || f.severity === sev).map((f) => f.rule);
const FM = (over = {}, meta = {}) => {
  const top = { name: 'plotspeaks-demo', description: 'Run "Demo".', license: 'CC-BY-NC-4.0', ...over };
  const m = { title: 'Demo', genre: 'murder-mystery', duration_minutes: '30', chapters: '1', players: '1-4', rating: 'PG-13', version: '0.1.0', author: 'Me', voice_ready: 'true', rules_system: 'none', ai_disclosure: 'human-written', ...meta };
  const lines = ['---'];
  for (const [k, v] of Object.entries(top)) if (v !== null) lines.push(`${k}: ${v}`);
  lines.push('metadata:');
  for (const [k, v] of Object.entries(m)) if (v !== null) lines.push(`  ${k}: ${v}  # c`);
  lines.push('---', '', '# Demo');
  return lines.join('\n');
};

test('front matter parser: scalars, nested map, comments, quotes, CRLF', () => {
  const fm = parseFrontMatter('---\r\nname: "a b" # c\r\nmetadata:\r\n  x: 1 # note\r\n  y: \'q\'\r\n---\r\nbody');
  assert.equal(fm.ok, true);
  assert.equal(fm.data.name, 'a b');
  assert.deepEqual(fm.metadata, { x: '1', y: 'q' });
});

test('front matter: missing block and unclosed block', () => {
  assert.equal(parseFrontMatter('# hi').ok, false);
  assert.deepEqual(rules(checkFrontMatter('# hi')), ['front-matter']);
  assert.equal(parseFrontMatter('---\nname: x\n').ok, false);
});

test('front matter: valid passes', () => {
  assert.deepEqual(checkFrontMatter(FM(), { slug: 'demo' }), []);
});

test('front matter: bad values', () => {
  const bad = (over, meta) => checkFrontMatter(FM(over, meta), { slug: 'demo' });
  assert.ok(rules(bad({ name: 'Bad_Name' }), 'ERROR').includes('front-matter'));
  assert.equal(rules(bad({ name: 'plotspeaks-other' })).length, 1); // WARN only
  assert.equal(bad({ name: 'plotspeaks-other' })[0].severity, 'WARN');
  assert.equal(bad({ description: 'x'.repeat(1025) })[0].severity, 'ERROR');
  assert.equal(bad({ license: 'MIT' })[0].severity, 'ERROR');
  assert.equal(bad({}, { genre: 'western' })[0].severity, 'ERROR');
  assert.equal(bad({}, { duration_minutes: '0' })[0].severity, 'ERROR');
  assert.equal(bad({}, { players: '4-2' })[0].severity, 'ERROR');
  assert.equal(bad({}, { players: '3' }).length, 0);
  assert.equal(bad({}, { version: '1.0' })[0].severity, 'ERROR');
  assert.equal(bad({}, { voice_ready: 'yes' })[0].severity, 'ERROR');
  assert.equal(bad({}, { ai_disclosure: null })[0].severity, 'ERROR');
});

test('front matter: rating R and adventure/none warn', () => {
  const r = checkFrontMatter(FM({}, { rating: 'R' }), { slug: 'demo' });
  assert.deepEqual(r.map((f) => f.severity), ['WARN']);
  const a = checkFrontMatter(FM({}, { genre: 'adventure' }), { slug: 'demo' });
  assert.deepEqual(a.map((f) => f.severity), ['WARN']);
});

test('front matter: SRD attribution required', () => {
  const fm = FM({}, { rules_system: 'srd-5.2.1' });
  assert.ok(rules(checkFrontMatter(fm, { slug: 'demo' }), 'ERROR').includes('srd-attribution'));
  const ok = fm + '\nThis work includes material from the System Reference Document 5.2.1, licensed under Creative Commons Attribution 4.0.';
  assert.deepEqual(checkFrontMatter(ok, { slug: 'demo' }), []);
});

const GOOD = `## How to run this (GM instructions)
- Stop phrase: "Plot Speaks, pause the story." Resume: "Plot Speaks, resume." Wrap-up: "Plot Speaks, wrap it up."
- Spoken intro: "Would you like a quick how-to-play first, or shall we jump straight in?"
## How to play (spoken intro)
**Read aloud (intro, beat 1):** You are the detective. Tell me what you do.
## Cast
## Chapter 1 — A (≈30 min)
### Recap block
## Endings
`;

test('read-aloud-length: beats over 45 words warn', () => {
  const long = '**Read aloud:** Word ' + 'word '.repeat(30) + 'end. More ' + 'more '.repeat(20) + 'done.';
  assert.deepEqual(checkReadAloud(long).map((f) => f.rule), ['read-aloud-length']);
  assert.deepEqual(checkReadAloud('**Read aloud:** A short beat. Then a second one.'), []);
});

test('spoken-intro: the offer and the section are both required', () => {
  const noOffer = GOOD.replace(/^- Spoken intro:.*\n/m, '');
  assert.ok(checkSections(noOffer).some((f) => f.rule === 'spoken-intro'));
  const noSection = GOOD.replace(/## How to play \(spoken intro\)\n.*\n/, '');
  assert.ok(checkSections(noSection).some((f) => f.rule === 'spoken-intro'));
});

test('sections: pass and fail', () => {
  assert.deepEqual(checkSections(GOOD), []);
  const missing = checkSections('## Chapter 1\n');
  assert.equal(missing.filter((f) => f.rule === 'required-sections').length, 3);
  assert.equal(missing.filter((f) => f.rule === 'stop-phrase').length, 3);
  const noCast = GOOD.replace('## Cast\n', '');
  assert.equal(checkSections(noCast, { genre: 'murder-mystery' })[0].severity, 'ERROR');
  assert.equal(checkSections(noCast, { genre: 'adventure' })[0].severity, 'WARN');
});

test('sections: stop phrase must be in GM instructions', () => {
  const t = GOOD.replace(/Stop phrase.*\n/, '') + '\nPlot Speaks, pause the story. Plot Speaks, resume. Plot Speaks, wrap it up.';
  assert.equal(checkSections(t).filter((f) => f.rule === 'stop-phrase').length, 3);
});

test('chapters: count, recap, duration', () => {
  const t = (h, recap = true) => `## Chapter 1 ${h}\n${recap ? '### Recap block\n' : ''}## Chapter 2 ${h}\n### Recap block\n## Endings\n`;
  assert.deepEqual(checkChapters(t('(≈30 min)'), { expectedChapters: 2, expectedMinutes: 60 }), []);
  assert.deepEqual(rules(checkChapters(t('(~30 min)'), { expectedChapters: 3 })), ['chapters']);
  assert.deepEqual(rules(checkChapters(t('(30 min)', false), {})), ['recap-block']);
  assert.deepEqual(rules(checkChapters(t('(≈45 min)'), {}), 'ERROR'), ['chapter-duration', 'chapter-duration']);
  assert.deepEqual(rules(checkChapters(t('(≈10 min)'), {}), 'ERROR'), ['chapter-duration', 'chapter-duration']);
  assert.deepEqual(checkChapters(t(''), {}).map((f) => f.severity), ['WARN', 'WARN']);
  assert.deepEqual(rules(checkChapters(t('(≈30 min)'), { expectedMinutes: 30 })), ['duration-sum']);
});

test('chapters: recap must precede the next ## heading', () => {
  const f = checkChapters('## Chapter 1 (≈30 min)\n## Endings\n### Recap block\n', {});
  assert.deepEqual(rules(f), ['recap-block']);
});

test('sentence splitter', () => {
  assert.equal(countSentences('One. Two. Three.'), 3);
  assert.equal(countSentences('Mr. Smith met Dr. Jones at St. Mary\'s.'), 1);
  assert.equal(countSentences('Mrs. Hale arrived at 9.30 p.m. Then it rained.'), 2);
  assert.equal(countSentences('It cost 3.5 dollars vs. nothing, e.g. a lot.'), 1);
  assert.equal(countSentences('Wait... then she spoke.'), 1);
  assert.equal(countSentences('Wait… Then she spoke.'), 2);
  assert.equal(countSentences('Wait... Then she spoke.'), 2);
  assert.equal(countSentences('"Who did it?" she asked. "Nobody."'), 2);
  assert.equal(countSentences('"Run!" he said. Silence.'), 2);
  assert.equal(countSentences('She said "stop." Then left.'), 2);
  assert.equal(countSentences('Is it? Yes! Fine.'), 3);
  assert.equal(countSentences('No. 5 Elm Street was dark.'), 1);
  assert.equal(countSentences('Cheese, wine, etc. Nobody ate.'), 2);
  assert.equal(countSentences(''), 0);
  assert.equal(countSentences('no punctuation here'), 1);
});

test('read-aloud: 1 warns, 2-3 pass, 4 errors, recap exempt', () => {
  const ra = (s) => `**Read aloud:** ${s}\n**Available:** x\n`;
  assert.deepEqual(checkReadAloud(ra('One.')).map((f) => f.severity), ['WARN']);
  assert.deepEqual(checkReadAloud(ra('One. Two.')), []);
  assert.deepEqual(checkReadAloud(ra('One. Two. Three.')), []);
  assert.deepEqual(checkReadAloud(ra('One. Two. Three. Four.')).map((f) => f.severity), ['ERROR']);
  assert.deepEqual(checkReadAloud(ra('Mr. Day sat. Dr. Night stood. It was 9.30 p.m. now.')), []);
  assert.deepEqual(checkReadAloud('### Recap block\n"One. Two. Three. Four. Five."\n'), []);
  assert.deepEqual(checkReadAloud(ra('**Bold** one. _Two._ Three. Four?')).map((f) => f.severity), ['ERROR']);
});

test('read-aloud: continuation lines count', () => {
  assert.deepEqual(checkReadAloud('**Read aloud:** One. Two.\nThree. Four.\n\nNext.').map((f) => f.severity), ['ERROR']);
  assert.deepEqual(checkReadAloud('**Read aloud (cold open, beat 1):** One. Two. Three. Four.').map((f) => f.rule), ['read-aloud']);
  assert.deepEqual(checkReadAloud('**Read aloud to the narrator:** One. Two. Three. Four.').map((f) => f.rule), ['read-aloud']);
  assert.deepEqual(checkReadAloud('**Read aloud (beat 2):** One. Two.'), []);
  assert.deepEqual(checkColdOpen('# T\n\nOne. Two. Three. Four.\n\n## How to run this\n').map((f) => f.rule), ['cold-open']);
  assert.deepEqual(checkColdOpen('# T\n\n**Read aloud (cold open, beat 1):** One. Two. Three.\n\nOne. Two.\n\n## X\n'), []);
});

test('audio cues: flagged', () => {
  for (const bad of [
    '[sound of thunder]', '[SFX: door]', '[music swells]', '(sfx: bell)', '[thunder]', '[whispers]', '[laughs]', '[pause]', '[sighs]',
    '[voice: gruff]', '[accent: French]', '[gasps]', 'Add SFX here', '♪ la la ♪', 'Then music swells.', 'The music fades out.', 'Play some music now.',
    'Play the sound of rain.', 'Sound effect: a creak.', 'Use a sound cue.', 'Cue the thunder.', 'Switch to a gravelly voice.',
    'Switch into the villain voice.', 'Change your voice here.', 'Use a different voice for him.', 'Say it in a deep voice.',
  ]) {
    assert.equal(rules(checkAudioCues(bad), 'ERROR').length >= 1, true, bad);
  }
});

test('audio cues: not flagged', () => {
  for (const ok of [
    'Never produce sound effects or music.', 'Do not play music or use sound effects.', 'Avoid [sfx] tags and never write [thunder].',
    'See [the rules](http://x.example) for voice.', '- [ ] todo', '- [x] done', 'The sound of rain on the roof.',
    'Voice note: a slow, gravelly voice.', 'He spoke in a gravelly voice.', 'The music in the house had stopped years ago.',
    'She whispers the answer.', 'Quote [...] elided.', 'She laughs too easily.', 'Without music, the room was quiet.',
  ]) {
    assert.deepEqual(checkAudioCues(ok), [], ok);
  }
});

test('audio cues: reports line numbers', () => {
  assert.equal(checkAudioCues('fine\n[pause]\n')[0].line, 2);
});

test('denylist: whole phrase, case-insensitive, no bare-word hits', () => {
  const dl = parseDenylist('# header\n\nColonel Mustard\nMrs. White\nbeholder\nBaldur\'s Gate\nFaerûn\n');
  assert.deepEqual(dl, ['Colonel Mustard', 'Mrs. White', 'beholder', "Baldur's Gate", 'Faerûn']);
  assert.equal(checkDenylist('colonel   MUSTARD did it', dl).length, 1);
  assert.equal(checkDenylist('A Beholder!', dl).length, 1);
  assert.equal(checkDenylist('beholders everywhere', dl).length, 0);
  assert.equal(checkDenylist('Mrs. White and White paint, Green door', dl).length, 1);
  assert.equal(checkDenylist('Baldur’s Gate and Faerûn', dl).length, 2);
  assert.equal(checkDenylist('plain text', dl).length, 0);
  assert.equal(checkDenylist('x', dl.concat([])).length, 0);
});

test('denylist: shipped list covers seeds and avoids bare words', async () => {
  const { readFileSync } = await import('node:fs');
  const dl = parseDenylist(readFileSync(new URL('../denylist.txt', import.meta.url), 'utf8'));
  for (const t of ['Colonel Mustard', 'Strahd', 'Sherlock Holmes', 'Forgotten Realms', 'mind flayer']) assert.ok(dl.includes(t), t);
  assert.equal(checkDenylist('Green and White and Black and Plum', dl).length, 0);
});

test('wrangler cues', () => {
  const story = 'a\n**Wrangler cue:** S1\nb\n**Wrangler cue:** S2, S3\n';
  const secrets = '## S1 — one\n## S2 - two\n## S3 — three\n## S9 — orphan\n';
  const f = checkWranglerCues(story, secrets);
  assert.deepEqual(f.map((x) => [x.severity, x.file, x.line]), [['WARN', 'secrets.md', 4]]);
  const missing = checkWranglerCues(story, '## S1 — one\n');
  assert.deepEqual(missing.map((x) => [x.severity, x.file, x.line]), [['ERROR', 'story.md', 4], ['ERROR', 'story.md', 4]]);
  assert.deepEqual(checkWranglerCues('nothing', '# secrets'), []);
  assert.equal(checkWranglerCues('', '## S1xy\n').length, 0);
});

test('spoiler hints and hidden clues', () => {
  assert.deepEqual(rules(checkSpoilerHints('The culprit is Bob.\nHe is secretly the heir.')), ['spoiler-hint', 'spoiler-hint']);
  assert.deepEqual(checkSpoilerHints('Nobody knows who did it.'), []);
  assert.deepEqual(rules(checkHiddenClues('no markers', { genre: 'murder-mystery' })), ['hidden-clue']);
  assert.deepEqual(checkHiddenClues('a *hidden* clue', { genre: 'murder-mystery' }), []);
  assert.deepEqual(checkHiddenClues('none', { genre: 'heist' }), []);
});

test('checkStoryText: a minimal clean story has no findings; breaking it is caught', () => {
  const body = `
## How to run this (GM instructions)
- Never produce sound effects or music. Stop phrase: "Plot Speaks, pause the story." Resume phrase: "Plot Speaks, resume." Wrap-up: "Plot Speaks, wrap it up." Wrangler, check the secrets. Spoken intro: "Would you like a quick how-to-play first, or shall we jump straight in?"
## How to play (spoken intro)
**Read aloud (intro, beat 1):** You are the detective. Tell me what you do.
## Cast (public information only)
## Chapter 1 — One (≈30 min)
### Scene 1.1
**Read aloud:** A door stands open. The hall is cold.
**Clues here:** *hidden* — a note.
### Recap block (read aloud at chapter end)
"So far."
## Endings
- Done.
`;
  const story = FM() + body;
  assert.deepEqual(checkStoryText(story, { slug: 'demo', denylist: ['Cluedo'] }), []);
  const broken = story.replace('A door stands open.', '[sound of wind] Cluedo. A door. Open. Wide.');
  const r = rules(checkStoryText(broken, { slug: 'demo', denylist: ['Cluedo'] }), 'ERROR');
  assert.deepEqual([...new Set(r)].sort(), ['denylist', 'no-audio-cues', 'read-aloud']);
});

test('accusation-handoff and resume-chapter', () => {
  const gm = (extra) => `## How to run this\nPlot Speaks, pause the story. Plot Speaks, resume. Plot Speaks, wrap it up. Or shall we jump straight in? ${extra}\n## How to play (spoken intro)\n## Cast\n## Chapter 1\n## Endings\n`;
  assert.deepEqual(rules(checkSections(gm(''), { genre: 'murder-mystery' })), ['accusation-handoff']);
  assert.deepEqual(checkSections(gm('Say "Wrangler, check the secrets."'), { genre: 'murder-mystery' }), []);
  assert.deepEqual(checkSections(gm(''), { genre: 'heist' }), []);
  assert.deepEqual(rules(checkSections(gm(''), { genre: 'heist', chapters: 2 })), ['resume-chapter']);
  assert.deepEqual(checkSections(gm('resume from chapter 2'), { genre: 'heist', chapters: 2 }), []);
  assert.deepEqual(checkSections(gm(''), { genre: 'heist', chapters: 1 }), []);
  // a phrase outside the GM section does not count
  const outside = '## How to run this\nPlot Speaks, pause the story. Plot Speaks, resume.\n## Setting\nWrangler, check the secrets.\n';
  assert.ok(rules(checkSections(outside, { genre: 'murder-mystery' })).includes('accusation-handoff'));
});

test('wrangler cues: S3b follow-ups are covered by a cued S3', () => {
  const story = '**Wrangler cue:** S3\n';
  assert.deepEqual(checkWranglerCues(story, '## S3 — a\n## S3b — follow-up\n'), []);
  const w = checkWranglerCues(story, '## S3 — a\n## S4b — orphan follow-up\n## S5 — orphan\n');
  assert.deepEqual(w.map((x) => x.line), [2, 3]);
  assert.deepEqual(checkWranglerCues('**Wrangler cue:** S3b\n', '## S3 — a\n').map((x) => x.severity), ['ERROR', 'WARN']);
});

test('cue-parts', () => {
  const full = '## S1 — x\n**Read aloud to the narrator:** hi\n**Wrangler only (don’t read):** no\n';
  assert.deepEqual(checkCueParts(full), []);
  const f = checkCueParts("## S1 — x\n**Wrangler only (don't read):** no\n## S2b\n");
  assert.deepEqual(f.map((x) => [x.line, x.severity]), [[1, 'WARN'], [3, 'WARN'], [3, 'WARN']]);
  assert.deepEqual(checkCueParts('## Other\nnothing\n'), []);
});

test('wrangler cues: "cue S3b" mentions need a section; extra labels allowed in cue-parts', () => {
  const secrets = '## S3 — a\nWhen stuck, cue S3b. Or cue S3c.\n## S3b — more\n';
  const f = checkWranglerCues('**Wrangler cue:** S3\nAlso cue S4b here.\n', secrets);
  assert.deepEqual(f.map((x) => [x.file, x.line, x.severity]), [['story.md', 2, 'ERROR'], ['secrets.md', 2, 'ERROR']]);
  const parts = "## S3b — x\n**When:** now\n**Read aloud to the narrator:** hi\n**Numbers (read these aloud too):** 3\n**Wrangler only (don't read):** n\n";
  assert.deepEqual(checkCueParts(parts), []);
});

test('culprit-tell: confronting the culprit in a GM trigger is an error; other mentions warn', async () => {
  const { checkCulpritTells } = await import('../rules.mjs');
  const secrets = '- **Culprit:** Mrs. Ada Fenn (the cook).\n';
  const story = [
    '## How to run this (GM instructions)',
    '- Pacing: once the player has confronted Ada, ask who they accuse.',
    '  5. Lead: "Look at Fenn\'s apron."',
    '## Cast (public information only)',
    '| Name | Role | Notes |',
    '|---|---|---|',
    '| Ada Fenn | Cook | Until confronted, Ada is calm. |',
    '| Bo Hart | Groom | Nervous. |',
  ].join('\n');
  const f = checkCulpritTells(story, secrets);
  assert.deepEqual(f.map((x) => [x.line, x.severity]), [[2, 'ERROR'], [3, 'WARN'], [7, 'ERROR']]);
  assert.deepEqual(checkCulpritTells('## How to run this\n- once the player has found the apron', secrets), []);
  assert.deepEqual(checkCulpritTells(story, ''), []);
  // The catalogue pitch is public: naming the culprit there is an error; naming anyone else is fine.
  const pitched = checkCulpritTells('---\nmetadata:\n  pitch: "A cook named Ada Fenn serves a last supper."\n---\n', secrets);
  assert.deepEqual(pitched.map((x) => [x.line, x.severity, x.rule]), [[3, 'ERROR', 'culprit-tell']]);
  assert.deepEqual(checkCulpritTells('---\nmetadata:\n  pitch: "Six guests, one toast, and the host is dead before dessert."\n---\n', secrets), []);
});
