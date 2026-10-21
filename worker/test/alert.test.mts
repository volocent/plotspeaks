// Phone alerts (src/alert.ts): what may leave the Worker, the [DEV] tag, and one push per key per hour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertOnce, routeOf, scrub, sendAlert } from "../src/alert.ts";

const KEYS = { PUSHOVER_APP_TOKEN: "app", PUSHOVER_USER_KEY: "user" };

/** Counts alert claims the way daily_counts does: n goes 1, 2, 3 per (day, key). */
function claimDb() {
  const seen = new Map<string, number>();
  return {
    prepare: () => {
      let args: unknown[] = [];
      const stmt = {
        bind: (...a: unknown[]) => ((args = a), stmt),
        first: async () => { const k = args.join("|"); seen.set(k, (seen.get(k) ?? 0) + 1); return { n: seen.get(k) }; },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function fakeFetch() {
  const sent: URLSearchParams[] = [];
  const fn = (async (_url: string, init: RequestInit) => { sent.push(init.body as URLSearchParams); return new Response("{}"); }) as unknown as typeof fetch;
  return { fn, sent };
}

test("scrub removes emails, ids and long numbers", () => {
  const out = scrub("writer@example.com play 3f9a2b7c81d4e5 code 4821937");
  assert.doesNotMatch(out, /example\.com|3f9a2b|4821937/);
  assert.match(out, /\[email\]/);
});

test("routeOf names only the first path segment", () => {
  assert.equal(routeOf("/stories/kittering-bay/passenger"), "/stories");
  assert.equal(routeOf("/mcp"), "/mcp");
  assert.equal(routeOf("/"), "/");
});

test("sendAlert sends nothing without both keys", async () => {
  const f = fakeFetch();
  assert.equal(await sendAlert({ PUSHOVER_APP_TOKEN: "app" }, { title: "t", message: "m" }, f.fn), false);
  assert.equal(f.sent.length, 0);
});

test("dev alerts are tagged and never page", async () => {
  const f = fakeFetch();
  await sendAlert({ ENVIRONMENT: "dev", ...KEYS }, { title: "Down", message: "m", level: "critical" }, f.fn);
  assert.equal(f.sent[0]!.get("title"), "[DEV] Down");
  assert.equal(f.sent[0]!.get("priority"), "0");
  assert.equal(f.sent[0]!.has("retry"), false);
});

test("prod alerts default to high priority", async () => {
  const f = fakeFetch();
  await sendAlert({ ENVIRONMENT: "production", ...KEYS }, { title: "Waiting", message: "m" }, f.fn);
  assert.equal(f.sent[0]!.get("title"), "Waiting");
  assert.equal(f.sent[0]!.get("priority"), "1");
});

test("alertOnce pushes once per key per hour", async () => {
  const f = fakeFetch();
  const env = { DB: claimDb(), ENVIRONMENT: "production", ...KEYS };
  const at = Date.UTC(2026, 9, 21, 14, 5);
  assert.equal(await alertOnce(env, "5xx:/mcp", { title: "t", message: "m" }, at, f.fn), true);
  assert.equal(await alertOnce(env, "5xx:/mcp", { title: "t", message: "m" }, at + 60_000, f.fn), false);
  assert.equal(await alertOnce(env, "5xx:/admin", { title: "t", message: "m" }, at + 60_000, f.fn), true);
  assert.equal(await alertOnce(env, "5xx:/mcp", { title: "t", message: "m" }, at + 3_600_000, f.fn), true);
  assert.equal(f.sent.length, 3);
});
