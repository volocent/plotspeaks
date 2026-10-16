// Smoke test for the Plot Speaks MCP server: every tool, the access lock, and play recording.
// Usage: node test/smoke.mjs [base-url]   (default http://127.0.0.1:8799; reads the key from .dev.vars)
// It prints verdict prefixes and counts only, never answer text.
import { readFileSync, existsSync } from 'node:fs';

const base = (process.argv[2] || 'http://127.0.0.1:8799').replace(/\/$/, '');
const key = existsSync(new URL('../.dev.vars', import.meta.url))
  ? (/^DEV_ACCESS_KEY=(.+)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')) || [])[1]?.trim()
  : process.env.DEV_ACCESS_KEY;

let id = 0, failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

async function rpc(method, params, { withKey = true } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (withKey && key) headers['x-plotspeaks-key'] = key;
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const raw = await res.text();
  const line = raw.split('\n').find((l) => l.startsWith('data: ')) ?? raw;
  let json = null;
  try { json = JSON.parse(line.replace(/^data: /, '')); } catch {}
  return { status: res.status, json };
}
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).json?.result?.content?.[0]?.text ?? '';

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
ok(init.status === 200 && /Plot Speaks runs interactive story games/.test(init.json?.result?.instructions ?? ''), 'initialize returns the server instructions');

if (key) {
  const locked = await rpc('tools/list', {}, { withKey: false });
  ok(locked.status === 401, `request without the key is refused (${locked.status})`);
}

const tools = (await rpc('tools/list', {})).json?.result?.tools?.map((t) => t.name) ?? [];
ok(['list_stories', 'start_story', 'reveal', 'get_cue', 'rate_story'].every((t) => tools.includes(t)), `tools: ${tools.join(', ')}`);

const list = await call('list_stories', {});
ok(/example-dinner-party/.test(list) && /keepers-bell/.test(list), 'list_stories lists the stories');

const start = await call('start_story', { slug: 'The Last Toast' });
const playId = (/Play id: ([0-9a-f-]{36})/.exec(start) || [])[1];
ok(Boolean(playId), 'start_story returns a play id');
ok(/Playing through the Plot Speaks connector/.test(start) && !/say\s+"Wrangler, check the secrets/i.test(start), 'start_story rewrites the wrangler hand-off');
// The script may mention "Endings detail" (its GM instructions name the section); an answer-key
// line itself looks like "- **Name (correct):** Correct. ..." and must never be served.
ok(!/\((correct|wrong)\):\*\*|^\s*(Correct|Innocent)\.\s/im.test(start), 'start_story contains no answer-key line');

const wrong = await call('reveal', { slug: 'example-dinner-party', accused: 'Hale Winterbourne', play_id: playId });
ok(/^Innocent\./.test(wrong), `reveal of an innocent starts "Innocent." (${wrong.slice(0, 10)})`);
const unmatched = await call('reveal', { slug: 'example-dinner-party', accused: 'Nobody Atall', play_id: playId });
ok(/couldn't match/i.test(unmatched), 'reveal asks for clarification on an unknown name');

const cue = await call('get_cue', { slug: 'keepers-bell', cue: 's3', play_id: playId });
ok(/^READ ALOUD/.test(cue) && /NARRATOR ONLY/.test(cue), 'get_cue returns read-aloud text and narrator-only notes');
const cue1 = await call('get_cue', { slug: 'keepers-bell', cue: 'S1' });
ok(/Follow-up cues to listen for/.test(cue1), 'get_cue S1 carries the follow-up table');

const rated = await call('rate_story', { slug: 'example-dinner-party', stars: 5, spoiled: false, comment: 'smoke test', play_id: playId });
ok(/rating saved/i.test(rated), 'rate_story saves a rating');
const badRate = await rpc('tools/call', { name: 'rate_story', arguments: { slug: 'example-dinner-party', stars: 9 } });
ok(Boolean(badRate.json?.error) || /error|invalid/i.test(JSON.stringify(badRate.json?.result ?? '')), 'rate_story rejects 9 stars');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
