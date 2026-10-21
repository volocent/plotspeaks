// The choose matcher (worker/src/branching.ts) on spoken answers: numbers, ordinals, single words,
// accents and Spanish, puzzle answers with lead-ins, and the guesses that must NOT pick a choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchChoice } from "../src/branching.ts";
test('matchChoice', () => {
const c = (text: string, to = text) => ({ text, to, if: [], unless: [] });
const open = [c("¿Hay un hotel cerca?"), c("Voy al río"), c("Sí, gracias")];
const cases: [string, string | null][] = [["hotel", "¿Hay un hotel cerca?"], ["voy al rio", "Voy al río"], ["si gracias", "Sí, gracias"], ["2", "Voy al río"], ["the third one", "Sí, gracias"], ["banana", null]];
for (const [said, want] of cases) { const got = matchChoice(open, said)?.text ?? null; assert.equal(got, want, said); }
const eng = [c("Climb to the lamp room"), c("Answer the radio")];
for (const [said, want] of [["the radio", "Answer the radio"], ["lamp", "Climb to the lamp room"], ["room radio", null]] as [string, string | null][]) { const got = matchChoice(eng, said)?.text ?? null; assert.equal(got, want, said); }
const pz = [{ text: "towel", to: "win", if: [], unless: [], answer: ["towel"] }, { text: "glass", to: "win2", if: [], unless: [], answer: ["glass"] }, { text: "seven", to: "win3", if: [], unless: [], answer: ["7", "seven"] }, c("Get a hint"), c("Give up on this lock")];
// Review 2026-10-17: a number inside a choice's own words is part of those words.
const nums = [c("Run"), c("Take 1 coin")];
for (const [said, want] of [["take 1 coin", "Take 1 coin"], ["1", "Run"], ["2", "Take 1 coin"]] as [string, string | null][]) { const got = matchChoice(nums, said)?.text ?? null; assert.equal(got, want, said); }
const doors = [c("Open door 3"), c("Open door 1"), c("Go back")];
for (const [said, want] of [["open door 1", "Open door 1"], ["door 3", "Open door 3"], ["option 1", "Open door 3"], ["go back", "Go back"]] as [string, string | null][]) { const got = matchChoice(doors, said)?.text ?? null; assert.equal(got, want, said); }
for (const [said, want] of [["I think it's a towel", "towel"], ["is it glass?", "glass"], ["class", null], ["3", null], ["3 octopuses", null], ["7", "seven"], ["option 2", "Give up on this lock"], ["fork", null], ["forty", null], ["a hint please", "Get a hint"]] as [string, string | null][]) { const got = matchChoice(pz, said)?.text ?? null; assert.equal(got, want, said); }
});
// Going back one choice (2026-10-17): the node chosen from, with flags rebuilt from the path.
import { rewind, advance, initialState } from "../src/branching.ts";
test('rewind', () => {
  const n = (sets: string[], choices: { text: string; to: string }[], ending = false) => ({ read_aloud: "x", notes: null, sets, ending: ending ? { name: "End", tone: null } : null, choices: choices.map((c) => ({ ...c, if: [], unless: [] })) });
  const g = { start: "start", nodes: { start: n([], [{ text: "Left", to: "a" }, { text: "Right", to: "b" }]), a: n(["key"], [{ text: "Door", to: "end" }, { text: "Back", to: "start" }]), b: n([], [{ text: "Go", to: "end" }]), end: n(["doom"], [], true) } };
  let st = initialState(g);
  assert.equal(rewind(g, st), null);
  st = advance(g, st, g.nodes.start.choices[0]);
  st = advance(g, st, g.nodes.a.choices[0]);
  assert.deepEqual([st.node, st.ended, st.flags], ["end", true, ["doom", "key"]]);
  const back = rewind(g, st)!;
  assert.deepEqual([back.node, back.ended, back.flags, back.path.length], ["a", false, ["key"], 1]);
  const back2 = rewind(g, back)!;
  assert.deepEqual([back2.node, back2.flags, back2.path.length], ["start", [], 0]);
});
// QA 2026-10-17: refusals and filler.
test('refusals and filler', () => {
  const c = (text: string) => ({ text, to: text, if: [], unless: [] });
  const look = [c("Look inside"), c("Keep it closed, don't look")];
  for (const [said, want] of [["I don't look", "Keep it closed, don't look"], ["look inside", "Look inside"], ["um look inside", "Look inside"], ["don't open it", "Keep it closed, don't look"]] as [string, string | null][]) assert.equal(matchChoice(look, said)?.text ?? null, want, said);
  const brave = [c("Yes, I'm frightened"), c("No, I'm brave")];
  for (const [said, want] of [["no", "No, I'm brave"], ["yes", "Yes, I'm frightened"]] as [string, string | null][]) assert.equal(matchChoice(brave, said)?.text ?? null, want, said);
  const walk = [c("Look inside"), c("Walk away")];
  assert.equal(matchChoice(walk, "I don't look")?.text ?? null, "Walk away", "between two choices, refusing one picks the other");
  const pz = [{ text: "stars", to: "w", if: [], unless: [], answer: ["stars", "the stars"] }, c("Hear the riddle again")];
  for (const said of ["um is it the stars?", "uh, the stars", "I think it's the stars", "they're stars"]) assert.equal(matchChoice(pz, said)?.text ?? null, "stars", said);
});
// QA 2026-10-17, second pass: "don't want to", wouldn't, punctuation, puzzle answers inside a sentence,
// two-letter words.
test('refusals, punctuation, puzzle sentences, short words', () => {
  const c = (text: string) => ({ text, to: text, if: [], unless: [] });
  const walk = [c("Keep walking"), c("Stop and rest")];
  assert.equal(matchChoice(walk, "I don't want to keep walking")?.text ?? null, "Stop and rest");
  const trust = [c("Yes, trust again"), c("No, never again")];
  assert.equal(matchChoice(trust, "I wouldn't trust them again")?.text ?? null, "No, never again");
  assert.equal(matchChoice(trust, "no never again")?.text ?? null, "No, never again");
  const bed = [c("Go back to bed"), c("Check the door")];
  assert.equal(matchChoice(bed, "no, don't go back to bed")?.text ?? null, "Check the door");
  const pz = [{ text: "outside", to: "w", if: [], unless: [], answer: ["outside", "put them outside"] }, c("Unplug the freezer"), c("Ask for a hint")];
  assert.equal(matchChoice(pz, "put them outside the hab in the shade")?.text ?? null, "outside");
  assert.equal(matchChoice(pz, "unplug the freezer and put them outside")?.text ?? null, "outside");
  assert.equal(matchChoice(pz, "don't put them outside")?.text ?? null, null);
  const south = [{ text: "south", to: "w", if: [], unless: [], answer: ["south"] }, c("Trust the compass")];
  assert.equal(matchChoice(south, "um south I think")?.text ?? null, "south");
  const up = [c("Look it up in the manual"), c("Weigh the options")];
  assert.equal(matchChoice(up, "weigh it up")?.text ?? null, "Weigh the options");
  assert.equal(matchChoice([c("Go up"), c("Go down")], "up")?.text ?? null, "Go up");
});

// "Your path" (plan 2026-10-19, item 10): the summary, and following a shared path until a different turn.
import { pathSummary, followChoice } from "../src/branching.ts";
test('shared path: next follows the friend, a different turn leaves the path', () => {
  const ch = (text: string, to: string) => ({ text, to, if: [], unless: [] });
  const node = (choices: any[], ending: any = null) => ({ read_aloud: "x", notes: null, sets: [], ending, choices });
  const g = { start: "a", nodes: { a: node([ch("Left", "b"), ch("Right", "c")]), b: node([ch("Up", "d"), ch("Down", "e")]), c: node([], { name: "Lost", tone: null }), d: node([], { name: "Home", tone: null }), e: node([], { name: "Cave", tone: null }) } };
  let st = { ...initialState(g as any), follow: ["Left", "Up"] };
  assert.equal(followChoice(g as any, st)?.text, "Left");
  st = advance(g as any, st, followChoice(g as any, st)!);
  assert.deepEqual(st.follow, ["Left", "Up"], 'still on the path');
  const off = advance(g as any, st, ch("Down", "e") as any);
  assert.equal(off.follow, undefined, 'a different turn leaves the path');
  const on = advance(g as any, st, followChoice(g as any, st)!);
  assert.equal(pathSummary(on, "Home"), 'You chose: "Left", then "Up". Ending: Home.');
});
