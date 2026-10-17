import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBranches, checkBranches, exploreBranches, offered } from '../branches.mjs';

const good = [
  '# Secrets', '',
  '## Node start',
  '**Read aloud:** The lamp is out and the radio crackles.',
  '',
  'A second paragraph of the same node.',
  '**Narrator notes:** Let the silence sit.',
  '**Sets:** heard_radio',
  '**Choice:** Climb to the lamp room -> lamp',
  '**Choice:** Answer the radio -> radio [if heard_radio]',
  '',
  '## Node lamp',
  '**Read aloud:** The glass is cracked.',
  '**Choice:** Mend it -> saved',
  '**Choice:** Go back down -> start',
  '',
  '## Node radio',
  '**Read aloud:** A voice you know says your name.',
  '**Ending:** The voice on the radio (strange)',
  '',
  '## Node saved',
  '**Read aloud:** The light turns again.',
  '**Ending:** The light holds (good)',
].join('\n');

test('parseBranches reads nodes, multi-paragraph read-alouds, notes, flags, choices and endings', () => {
  const g = parseBranches(good);
  assert.deepEqual(g.order, ['start', 'lamp', 'radio', 'saved']);
  assert.match(g.nodes.start.read_aloud, /crackles\.\n\nA second paragraph/);
  assert.equal(g.nodes.start.notes, 'Let the silence sit.');
  assert.deepEqual(g.nodes.start.sets, ['heard_radio']);
  assert.deepEqual(g.nodes.start.choices[1], { text: 'Answer the radio', to: 'radio', if: ['heard_radio'], unless: [], line: 10 });
  assert.deepEqual(g.nodes.radio.ending, { name: 'The voice on the radio', tone: 'strange' });
});

test('offered applies [if] and [unless] flags', () => {
  const g = parseBranches(good);
  assert.equal(offered(g.nodes.start, []).length, 1);
  assert.equal(offered(g.nodes.start, ['heard_radio']).length, 2);
});

test('a complete graph passes; reachability and endings are explored with flags', () => {
  assert.deepEqual(checkBranches(good).filter((f) => f.severity === 'ERROR'), []);
  const ex = exploreBranches(parseBranches(good));
  assert.deepEqual([...ex.endings].sort(), ['radio', 'saved']);
});

test('broken graphs: missing target, unreachable node, dead end, one ending, unset flag', () => {
  const bad = [
    '## Node start', '**Read aloud:** Hi.', '**Choice:** On -> nowhere', '**Choice:** Off -> end [if never]',
    '## Node island', '**Read aloud:** Nobody comes here.', '**Ending:** Alone',
    '## Node end', '**Read aloud:** Bye.', '**Ending:** Done',
  ].join('\n');
  const msgs = checkBranches(bad).map((f) => f.message).join('\n');
  assert.match(msgs, /goes to node nowhere, which doesn't exist/);
  assert.match(msgs, /node island can't be reached/);
  assert.match(msgs, /leaves the player with no choice/);
  assert.match(msgs, /only 0 ending can be reached/);
  assert.match(msgs, /flag "never" is tested but no node sets it/);
  assert.match(checkBranches('no nodes here')[0].message, /needs "## Node <id>" sections/);
});
