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
for (const [said, want] of [["I think it's a towel", "towel"], ["is it glass?", "glass"], ["class", null], ["3", null], ["3 octopuses", null], ["7", "seven"], ["option 2", "Give up on this lock"], ["fork", null], ["forty", null], ["a hint please", "Get a hint"]] as [string, string | null][]) { const got = matchChoice(pz, said)?.text ?? null; assert.equal(got, want, said); }
});
