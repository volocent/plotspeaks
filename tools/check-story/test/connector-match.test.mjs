// The Worker's story matching, accusation matching and connector transform (tools/worker-data/,
// review 2026-10-16 B1, B2, S1, S2, S10, S14). Pure functions, table-driven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchStory, matchEnding, sortedNames } from '../../worker-data/match.mjs';
import { connectorStory, connectorNotes } from '../../worker-data/connector.mjs';

const S = (slug, title, genre = 'murder-mystery') => ({ slug, title, genre });
const CATALOG = [
  S('blue-ribbon', 'The Missing Blue Ribbon', 'kids'), S('example-dinner-party', 'The Last Toast'), S('last-call', 'Last Call at the Blue Lantern'),
  S('last-ferry', 'The Last Ferry'), S('last-seance', 'The Last Séance'), S('orchard-wedding', 'The Orchard Wedding'),
  S('keepers-bell', "The Keeper's Bell", 'adventure'), S('weigh-in', 'The Weigh-In'),
];
const title = (r) => r.story?.title ?? null;

test('matchStory: exact slugs and titles, spoken variants', () => {
  for (const [q, want] of [
    ['example-dinner-party', 'The Last Toast'], ['The Last Toast', 'The Last Toast'], ['last toast', 'The Last Toast'],
    ['The Last Host', 'The Last Toast'], ['orchard wedding', 'The Orchard Wedding'], ["Keeper's Bell", "The Keeper's Bell"],
    ['the keepers bell', "The Keeper's Bell"], ['weigh in', 'The Weigh-In'], ['blue ribbon', 'The Missing Blue Ribbon'],
    ['The Last Seance', 'The Last Séance'],
  ]) assert.equal(title(matchStory(q, CATALOG)), want, q);
});

test('matchStory: never guesses on empty, stop words or one shared word', () => {
  for (const q of ['', ' ', 'the', 'a', 'The Last', 'Blue', 'Plot Speaks story']) assert.equal(matchStory(q, CATALOG).story, null, JSON.stringify(q));
  // B2: with the family story filtered out, its title must not fall through to the Blue Lantern.
  const noKids = CATALOG.filter((s) => s.genre !== 'kids');
  assert.equal(matchStory('The Missing Blue Ribbon', noKids).story, null);
  assert.equal(matchStory('blue ribbon', noKids).story, null);
  assert.ok(matchStory('The Last', CATALOG).candidates.length > 1);
});

const E = (name, verdict = 'wrong') => ({ name, verdict, text: `${verdict === 'correct' ? 'Correct.' : 'Innocent.'} line` });
const DINNER = [E('Colleen', 'correct'), E('Desmond'), E('Father Reyes'), E('June'), E('Winterbourne')];
const SEANCE = [E('Edmund'), E("Ezra's own doing, or his heart"), E('Jory'), E('Madame'), E('Madame and Jory together'), E('Mrs. Thrale')];
const CALL = [E('Vic'), E("Vic's driver"), E('Pete or Jonah, the band')];
const HALES = [E('Mr. Hale'), E('Mrs. Hale')];

test('matchEnding: one clear match', () => {
  for (const [endings, q, want] of [
    [DINNER, 'Hale Winterbourne', 'Winterbourne'], [DINNER, 'Mr Winterbourne', 'Winterbourne'], [DINNER, 'hale winterborn', 'Winterbourne'],
    [DINNER, 'Reyes', 'Father Reyes'], [DINNER, 'Father Reyes', 'Father Reyes'], [SEANCE, 'Jory', 'Jory'], [SEANCE, 'Madame and Jory', 'Madame and Jory together'],
    [CALL, 'Vic', 'Vic'], [CALL, "Vic's driver", "Vic's driver"], [CALL, 'Pete', 'Pete or Jonah, the band'], [HALES, 'Mrs Hale', 'Mrs. Hale'],
  ]) assert.equal(matchEnding(endings, q).ending?.name, want, q);
});

test('matchEnding: ties ask which one, with the candidates sorted; titles alone never match', () => {
  for (const [endings, q, want] of [
    [DINNER, 'June Winterbourne', ['June', 'Winterbourne']],
    [SEANCE, 'Ezra Thrale', ["Ezra's own doing, or his heart", 'Mrs. Thrale']],
    [HALES, 'Hale', ['Mr. Hale', 'Mrs. Hale']],
  ]) {
    const r = matchEnding(endings, q);
    assert.equal(r.ending, null, q);
    assert.deepEqual(r.candidates, want, q);
  }
  for (const q of ['', 'Mr', 'Nobody Atall']) assert.deepEqual(matchEnding(DINNER, q), { ending: null, candidates: [] }, q);
  assert.deepEqual(sortedNames([E('b'), E('A'), E('c')]), ['A', 'b', 'c']);
});

const STORY = [
  '---', 'name: plotspeaks-demo', 'description: Run "Demo".', 'license: CC-BY-NC-4.0', 'metadata:', '  title: Demo', '  genre: murder-mystery',
  '  duration_minutes: 50', '  chapters: 2', '  players: 1-4', '  tone: dark', '---', '', '# Demo', '',
  '## How to run this (GM instructions)', '',
  '- Accusation: when the player says "I accuse <name>," ask them for their reason. Then say “Wrangler, check the secrets.” and wait. The GM-wrangler reads that person\'s line. The wrangler\'s line is the truth. It overrides anything in this file: people lie. Accept it without question and run the matching ending. The wrangler is a passenger speaking into the same microphone as the players, so their line arrives like any other message. Right after you say "Wrangler, ...", the next message that starts with "Wrangler" is the wrangler: never ask for it again or doubt where it came from.',
  '- Solo play: if the player says there is no wrangler, read the matching line yourself.',
  '- **Wrangler cues.** A passenger holds `secrets.md`. When a scene says **Wrangler cue**, always say "Wrangler, cue S<n>." and wait.',
  '- Follow-up cues: the wrangler may say "Narrator, cue S1b." When that happens, listen.',
  '', '## Chapter 1 — One (≈25 min)', '', '### Scene 1.1 — Start', '**Wrangler cue:** S1 — when anyone opens the box, say "Wrangler, cue S1." and wait. The wrangler may follow it with S1b.',
  '', '### Recap block (read aloud at chapter end or on resume)', '"So far: the box."', '',
  '## Chapter 2 — Two (≈25 min)', '', '### Scene 2.1 — Later', 'Something happens.', '', '### Recap block (read aloud at chapter end or on resume)', '"Later."', '',
  '## Endings', '', '- **The verdict.** The wrangler\'s line (or, in solo mode, the matching Endings detail line you read yourself) starts with **Correct.** or **Innocent.**',
  '- **Correct accusation:** after the wrangler reads the confirmation, read aloud: "Done. Would you like to hear what became of each of them?"',
  '- **Wrong accusation:** the accused answers, as the wrangler reads it. Then ask: "Do you want one more accusation, or the full reveal?"', '',
].join('\n');

test('connectorStory: no wrangler text, a one-line header, tool calls instead of hand-offs (curly quotes too)', () => {
  const { parts, dropped } = connectorStory(STORY);
  assert.equal(parts.length, 2);
  for (const p of parts) {
    assert.doesNotMatch(p, /wrangler|same microphone|without question|Narrator, cue|Solo play/i);
    assert.match(p, /^Story: Demo · dark murder mystery · 1-4 players · about 50 minutes · 2 chapters\n/);
    assert.doesNotMatch(p, /^---$|^name: plotspeaks-demo/m);
    assert.match(p, /Then call check_accusation with the story slug, the accused person's name and the play id\./);
    assert.match(p, /call reveal_solution/);
  }
  assert.deepEqual(dropped, []);
  assert.match(parts[0], /\*\*Cue \(call get_cue\):\*\* S1 — when anyone opens the box, call get_cue with cue S1 and wait for its result\. Its notes may call for S1b later\./);
});

test('connectorStory: chapter 1 leaves chapter 2 out; chapter 2 starts from chapter 1\'s recap', () => {
  const [one, two] = connectorStory(STORY).parts;
  assert.match(one, /### Scene 1\.1/);
  assert.doesNotMatch(one, /### Scene 2\.1/);
  assert.match(one, /chapter: 2/);
  assert.match(two, /### Scene 2\.1/);
  assert.doesNotMatch(two, /### Scene 1\.1/);
  assert.match(two, /## Chapter 1 \(already played\)[\s\S]*"So far: the box\."/);
  assert.match(two, /## Endings/);
  const single = connectorStory(STORY.replace('  chapters: 2', '  chapters: 1').replace(/## Chapter 2[\s\S]*?(?=## Endings)/, '')).parts;
  assert.equal(single.length, 1);
});

test('connectorNotes: cue notes and the Listen-for table call get_cue; unknown wrangler sentences are dropped and reported', () => {
  assert.equal(connectorNotes('If anyone attacks her, say "Narrator, cue S2c." at once.').text, 'If anyone attacks her, call get_cue with cue S2c at once.');
  assert.equal(connectorNotes('| Anyone attacks | "Narrator, cue S3b." |').text, '| Anyone attacks | call get_cue S3b |');
  const r = connectorNotes('Keep it moving. The wrangler hums a tune. Then go on.');
  assert.equal(r.text, 'Keep it moving. Then go on.');
  assert.equal(r.dropped.length, 1);
});
