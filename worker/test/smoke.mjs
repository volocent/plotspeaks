// Smoke test for the Plot Speaks MCP server: every tool, the access lock, and play recording.
// Usage: node test/smoke.mjs [base-url] [--open]   (default http://127.0.0.1:8799; reads the key from .dev.vars)
//   --open: the server has no access key (production). Story calls must work without one; the key
//   is still sent with the other calls so smoke plays are flagged as tester plays, not strangers.
// It prints verdict prefixes and counts only, never answer text.
import { readFileSync, existsSync } from 'node:fs';

const openServer = process.argv.includes('--open');
const base = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8799').replace(/\/$/, '');
const key = existsSync(new URL('../.dev.vars', import.meta.url))
  ? (/^DEV_ACCESS_KEY=(.+)$/m.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')) || [])[1]?.trim()
  : process.env.DEV_ACCESS_KEY;

let id = 0, failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

async function rpc(method, params, { withKey = true } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (withKey && key) headers['x-api-key'] = key;
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

if (openServer) {
  const anon = await rpc('tools/call', { name: 'list_stories', arguments: {} }, { withKey: false });
  ok(anon.status === 200 && /\(slug: /.test(anon.json?.result?.content?.[0]?.text ?? ''), `an open server answers story calls without a key (${anon.status})`);
} else if (key) {
  const open = await rpc('tools/list', {}, { withKey: false });
  ok(open.status === 200, `the handshake (tools/list) works without the key, so connector pre-checks pass (${open.status})`);
  const locked = await rpc('tools/call', { name: 'start_story', arguments: { slug: 'The Last Toast' } }, { withKey: false });
  ok(locked.status === 403, `a tool call without the key is refused (${locked.status})`);
  const bearer = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'list_stories', arguments: {} } }) });
  ok(bearer.status === 200, `the key also works as Authorization: Bearer (${bearer.status})`);
}

const tools = (await rpc('tools/list', {})).json?.result?.tools?.map((t) => t.name) ?? [];
ok(['list_stories', 'start_story', 'reveal', 'get_cue', 'rate_story'].every((t) => tools.includes(t)), `tools: ${tools.join(', ')}`);

const list = await call('list_stories', {});
ok(/example-dinner-party/.test(list) && /keepers-bell/.test(list), 'list_stories lists the stories');

const start = await call('start_story', { slug: 'The Last Toast' });
const playId = (/Play id: ([0-9a-f-]{36})/.exec(start) || [])[1];
const misheard = await call('start_story', { slug: 'The Last Host' });
ok(/narrator for "The Last Toast"/.test(misheard), 'start_story finds a misheard title ("The Last Host")');
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

// ---------------------------------------------------------------- catalog site (M3)
// The pages are public, so they must carry no secret: fetch every page and assert that no
// answer-key line ("(correct):", a line starting "Correct." / "Innocent."), no Endings detail
// text and no cue read-aloud text appears. Endings and cue text come from the locally built
// worker/src/generated/stories.json (it never leaves this machine); only pass/fail is printed.
const unescape = (h) => h.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const get = async (path) => { const r = await fetch(`${base}${path}`); return { status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text() }; };

const home = await get('/');
ok(home.status === 200 && /text\/html/.test(home.type), `GET / is an HTML page (${home.status})`);
const slugs = [...home.body.matchAll(/href="\/stories\/([^"/]+)"/g)].map((m) => decodeURIComponent(m[1]));
ok(slugs.includes('example-dinner-party') && slugs.includes('keepers-bell'), `GET / lists the stories (${slugs.join(', ')})`);
ok(/The Last Toast/.test(home.body) && /The Keeper(&#39;|')s Bell/.test(home.body), 'GET / shows story titles');
const firstAdventure = home.body.search(/genre-adventure"/), lastMystery = home.body.lastIndexOf('genre-murder-mystery"');
ok(firstAdventure === -1 || lastMystery === -1 || lastMystery < firstAdventure, 'GET / lists mysteries first');

const dinner = await get('/stories/example-dinner-party');
ok(dinner.status === 200 && /<h1>The Last Toast<\/h1>/.test(dinner.body), 'GET /stories/example-dinner-party has the title');
ok(/id="copy"[^>]*>Copy the story</.test(dinner.body) && /id="story-text"/.test(dinner.body), 'the story page has the copy button and the story text');
ok(/CC BY-NC 4\.0/.test(dinner.body) && !/SRD 5\.2\.1/.test(dinner.body), 'the story page has the license line (no SRD line for a non-SRD story)');
const bell = await get('/stories/keepers-bell');
ok(bell.status === 200 && /System Reference Document 5\.2\.1/.test(bell.body) && /Creative Commons Attribution 4\.0/.test(bell.body), 'the SRD story page carries the SRD 5.2.1 CC BY 4.0 attribution');
const raw = await get('/stories/example-dinner-party/story.md');
ok(raw.status === 200 && /^---\nname: /.test(raw.body), 'GET /stories/<slug>/story.md serves the public story.md');
const missing = await get('/stories/no-such-story');
ok(missing.status === 404, `unknown slug -> 404 (${missing.status})`);
const mcpNoKey = key && !openServer ? await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 98, method: 'tools/call', params: { name: 'list_stories', arguments: {} } }) }) : null;
ok(!mcpNoKey || mcpNoKey.status === 403, 'the site routes leave the MCP key lock in place');

const genPath = new URL('../src/generated/stories.json', import.meta.url);
const secretTexts = [];
if (existsSync(genPath)) {
  for (const s of JSON.parse(readFileSync(genPath, 'utf8'))) {
    for (const e of s.endings ?? []) secretTexts.push(e.text);
    for (const c of Object.values(s.cues ?? {})) secretTexts.push(c.read_aloud, c.narrator_only);
    if (s.listen_for) secretTexts.push(s.listen_for);
  }
}
const needles = secretTexts.filter((t) => t && t.trim().length >= 25).map((t) => t.trim().replace(/\s+/g, ' ').slice(0, 120));
const pages = ['/', ...slugs.flatMap((s) => [`/stories/${encodeURIComponent(s)}`, `/stories/${encodeURIComponent(s)}/story.md`]), '/stories/no-such-story'];
let leaks = 0;
for (const p of pages) {
  const text = unescape((await get(p)).body);
  const flat = text.replace(/\s+/g, ' ');
  const keyLine = /\((correct|wrong)\)|^\s*(Correct|Innocent)\.\s/im.test(text);
  const hit = needles.some((n) => flat.includes(n));
  if (keyLine || hit) { leaks++; console.log(`FAIL  secret text on ${p} (${keyLine ? 'answer-key line' : 'ending/cue text'})`); }
}
ok(leaks === 0, `no answer-key line, Endings text or cue text on any of ${pages.length} pages (${needles.length} secret snippets checked${existsSync(genPath) ? '' : '; generated data not found, key-line check only'})`);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
