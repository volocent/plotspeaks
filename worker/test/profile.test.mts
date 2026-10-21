// Profile handles (src/profile.ts): what a public page name may be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHandle } from "../src/profile.ts";

test('checkHandle: lower-case letters, numbers, single hyphens; no reserved, offensive or protected names', () => {
  const deny = ["Hercule Poirot"];
  assert.deepEqual(checkHandle("Night-Owl-42", deny), { handle: "night-owl-42" });
  assert.deepEqual(checkHandle("abc", deny), { handle: "abc" });
  for (const bad of ["ab", "a".repeat(21), "-abc", "abc-", "a--b", "a b", "a_b", "abc!"]) assert.deepEqual(checkHandle(bad, deny), { error: "invalid" }, bad);
  for (const no of ["admin", "plotspeaks", "support", "big-shit-energy", "hercule-poirot"]) assert.deepEqual(checkHandle(no, deny), { error: "not-allowed" }, no);
});
