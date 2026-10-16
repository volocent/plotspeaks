// Smoke test for the Plot Speaks MCP server: every tool, the story_template prompt, the access lock, play recording,
// the passenger-page JSON API and the http -> https redirect.
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
ok(['open_plot_speaks', 'list_stories', 'start_story', 'reveal', 'get_cue', 'rate_story', 'write_story', 'review_story', 'check_story', 'submit_story', 'withdraw_submission'].every((t) => tools.includes(t)), `tools: ${tools.join(', ')}`);
const toolList = (await rpc('tools/list', {})).json?.result?.tools ?? [];
ok(toolList.every((t) => typeof t.title === 'string' && t.title.length > 0), 'every tool has a title');

const list = await call('list_stories', {});
ok(/example-dinner-party/.test(list) && /keepers-bell/.test(list), 'list_stories lists the stories');

// ---------------------------------------------------------------- open_plot_speaks and categories
const opened = await call('open_plot_speaks', {});
ok(opened.includes('Would you like to hear what stories there are, start one, or write your own?'), 'open_plot_speaks returns the question');
ok(/car ride/i.test(opened) && /until you accuse/i.test(opened), 'open_plot_speaks has the spoken intro (car rides, answer hidden until you accuse)');
ok(['Murder mysteries:', 'Dark murder mysteries:', 'Family mysteries:', 'Fantasy adventures:'].every((c) => opened.includes(c)) && /The Last Toast/.test(opened),
  'open_plot_speaks menu has the four categories with example titles');
ok(!/\((correct|wrong)\)|^\s*(Correct|Innocent)\.\s/im.test(opened), 'open_plot_speaks contains no answer-key line');
const darkList = await call('list_stories', { genre: 'dark' });
const mysteryList = await call('list_stories', { genre: 'murder-mystery' });
const classicList = await call('list_stories', { genre: 'classic' });
ok(/, dark;/.test(darkList) && !/example-dinner-party/.test(darkList) && !/; kids;/.test(darkList), 'list_stories genre "dark" lists dark mysteries only');
ok(/example-dinner-party/.test(classicList) && !/, dark;/.test(classicList), 'list_stories genre "classic" leaves dark mysteries out');
ok(/example-dinner-party/.test(mysteryList) && (!/, dark;/.test(list) || /, dark;/.test(mysteryList)), 'list_stories genre "murder-mystery" still lists every murder mystery (backwards compatible)');
ok(/; kids;/.test(await call('list_stories', { genre: 'kids' })), 'list_stories accepts genre "kids"');
const grouped = await call('list_stories', { group_by_category: true });
ok(/^Murder mysteries:\n- /m.test(grouped) && /^Fantasy adventures:\n- /m.test(grouped), 'list_stories groups by category');

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

// ---------------------------------------------------------------- Story Studio (M4)
const prompts = (await rpc('prompts/list', {})).json?.result?.prompts?.map((p) => p.name) ?? [];
ok(prompts.includes('story_template'), `prompts: ${prompts.join(', ')}`);
const tmpl = (await rpc('prompts/get', { name: 'story_template', arguments: { genre: 'murder-mystery', length: '30' } })).json?.result?.messages?.[0]?.content?.text ?? '';
ok(/Wrangler, check the secrets/.test(tmpl) && /jump straight in/.test(tmpl) && /check_story/.test(tmpl), `story_template returns the interview and GM block (${tmpl.length} chars)`);
for (const [genre, length] of [['kids', '20'], ['adventure', '2-chapter']]) {
  const t = (await rpc('prompts/get', { name: 'story_template', arguments: { genre, length } })).json?.result?.messages?.[0]?.content?.text ?? '';
  ok(t.length > 2000 && t.length < 7000 && /jump straight in/.test(t), `story_template ${genre}/${length} (${t.length} chars)`);
}
ok(tools.includes('check_story'), 'tools/list includes check_story');
const broken = [
  '---', 'name: plotspeaks-broken', 'description: A broken draft.', 'license: CC-BY-NC-4.0', 'metadata:', '  title: Broken',
  '  genre: murder-mystery', '  duration_minutes: 30', '  chapters: 1', '  players: 1-4', '  rating: PG-13', '  version: 0.1.0',
  '  author: Smoke', '  voice_ready: true', '  rules_system: none', '  ai_disclosure: ai-assisted', '---', '', '# Broken', '',
  '## How to run this (GM instructions)', '', '- Be a good narrator.', '', '## Cast (public information only)', '',
  '## Chapter 1 — Start (≈30 min)', '', '**Read aloud:** One. Two. Three. Four. Five.', '', '[thunder] Colonel Mustard enters.', '',
  '## Endings', '', '- Correct accusation: well done.',
].join('\n');
const brokenReport = await call('check_story', { story_md: broken });
ok(/^\d+ error/.test(brokenReport) && /\[read-aloud\]/.test(brokenReport) && /\[stop-phrase\]/.test(brokenReport) && /\[no-audio-cues\]/.test(brokenReport) && /\[denylist\]/.test(brokenReport),
  `check_story flags a broken draft (${(/^\d+ error\(s\)/.exec(brokenReport) || ['no summary'])[0]})`);
const exampleMd = readFileSync(new URL('../../stories/example-dinner-party/story.md', import.meta.url), 'utf8');
const exampleReport = await call('check_story', { story_md: exampleMd, slug: 'example-dinner-party' });
ok(/^0 errors/.test(exampleReport), `check_story passes the example story (${exampleReport.split('\n')[0]})`);
const tooLong = await rpc('tools/call', { name: 'check_story', arguments: { story_md: 'x'.repeat(60001) } });
ok(Boolean(tooLong.json?.error) || tooLong.json?.result?.isError === true, 'check_story rejects a story over 60,000 characters');

// ---------------------------------------------------------------- write_story and review_story
const writing = await call('write_story', { genre: 'dark', length: '30' });
ok(/story\.md/.test(writing) && /secrets\.md/.test(writing) && /person at Plot Speaks/.test(writing), 'write_story has the intro for the writer (two files, human review)');
ok(/jump straight in/.test(writing) && /## Endings/.test(writing) && /tone: dark/.test(writing), `write_story returns the template (${writing.length} chars)`);
const checkpoints = ['Would you like me to point out gaps and suggestions as we go?', 'Are you ready to have the story reviewed?', 'Are you ready to submit it?', 'What name would you like credited? A pen name is fine.'];
ok(checkpoints.every((c) => writing.includes(c)), 'write_story returns the four checkpoints');
ok(/review_story/.test(writing) && /submit_story/.test(writing) && /author_name/.test(writing), 'write_story suggests review_story, then submit_story with author_name');
// A crafted draft: the example story with a GM line that names the (made-up) culprit. Not The Last Toast's answer.
const tellMd = exampleMd.replace(/^## How to run this \(GM instructions\)\s*$/m, (h) => `${h}\n\n- Pacing: once the player has confronted Ada Fenn, ask who they accuse.`);
const tellSecrets = ['# Crafted secrets', '', '- **Culprit:** Ada Fenn.', '', '## Endings detail', '',
  '- **Ada Fenn (correct):** Correct. Crafted line.',
  '- **Hale Winterbourne (wrong):** Innocent. Crafted line.', ''].join('\n');
const tellReview = await call('review_story', { story_md: tellMd, secrets_md: tellSecrets });
ok(/^STATUS: \d+ problems? to fix/.test(tellReview) && /\[culprit-tell\]/.test(tellReview), `review_story flags a culprit tell (${tellReview.split('\n')[0]})`);
ok(/FAIR-PLAY REVIEW/.test(tellReview) && /can't judge/.test(tellReview) && /Minimum clue set/.test(tellReview) && /Red herrings/.test(tellReview), 'review_story returns the fair-play checklist and says the server cannot judge fairness');
const cleanReview = await call('review_story', { story_md: exampleMd, secrets_md: tellSecrets });
ok(/^STATUS: passes format checks/.test(cleanReview), `review_story passes a clean draft (${cleanReview.split('\n')[0]})`);

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
// Routes allowed to carry secret text, one answer at a time (the passenger page's JSON API, checked
// separately below). They are never part of the scan.
const SECRET_ROUTES_ALLOWED = [/^\/api\/stories\//];
const pages = ['/', ...slugs.flatMap((s) => [`/stories/${encodeURIComponent(s)}`, `/stories/${encodeURIComponent(s)}/story.md`, `/stories/${encodeURIComponent(s)}/passenger`]), '/stories/no-such-story']
  .filter((p) => !SECRET_ROUTES_ALLOWED.some((re) => re.test(p)));
let leaks = 0;
for (const p of pages) {
  const text = unescape((await get(p)).body);
  const flat = text.replace(/\s+/g, ' ');
  const keyLine = /\((correct|wrong)\)|^\s*(Correct|Innocent)\.\s/im.test(text);
  const hit = needles.some((n) => flat.includes(n));
  if (keyLine || hit) { leaks++; console.log(`FAIL  secret text on ${p} (${keyLine ? 'answer-key line' : 'ending/cue text'})`); }
}
ok(leaks === 0, `no answer-key line, Endings text or cue text on any of ${pages.length} pages (${needles.length} secret snippets checked${existsSync(genPath) ? '' : '; generated data not found, key-line check only'})`);

// ---------------------------------------------------------------- passenger page API
// Endpoints answer one name or cue at a time; names must carry no Endings text at all.
const getJson = async (path) => { const r = await fetch(`${base}${path}`); let json = null; try { json = await r.json(); } catch {} return { status: r.status, type: r.headers.get('content-type') ?? '', json }; };
const names = await getJson('/api/stories/example-dinner-party/names');
ok(names.status === 200 && /application\/json/.test(names.type) && Array.isArray(names.json?.names) && names.json.names.some((n) => /Winterbourne/.test(n)), `GET /api/stories/<slug>/names lists the names (${names.status})`);
const namesRaw = JSON.stringify(names.json ?? {});
ok(Object.keys(names.json ?? {}).join() === 'names' && !/Correct\.|Innocent\./.test(namesRaw) && !needles.some((n) => namesRaw.includes(n.slice(0, 60))) && names.json.names.every((n) => n.length < 60),
  'names returns names only, no ending text');
ok(JSON.stringify([...names.json.names].sort((x, y) => x.localeCompare(y))) === JSON.stringify(names.json.names), 'names are sorted (secrets.md order gives nothing away)');
const checked = await getJson(`/api/stories/example-dinner-party/check?name=${encodeURIComponent('hale winterbourne')}`);
ok(checked.status === 200 && checked.json?.verdict === 'wrong' && /^Innocent\./.test(checked.json?.line ?? '') && Object.keys(checked.json).sort().join() === 'line,verdict', `GET .../check returns one verdict line (${checked.json?.verdict})`);
const misheardCheck = await getJson(`/api/stories/example-dinner-party/check?name=${encodeURIComponent('Mr Winterbourne')}`);
ok(misheardCheck.status === 200 && misheardCheck.json?.verdict === 'wrong', 'GET .../check uses the same fuzzy matching as reveal');
const noMatch = await getJson('/api/stories/example-dinner-party/check?name=Nobody%20Atall');
ok(noMatch.status === 404 && noMatch.json?.error === 'no_match', `GET .../check with an unknown name is 404 JSON (${noMatch.status})`);
const apiCue = await getJson('/api/stories/keepers-bell/cue/s3');
const genStories = existsSync(genPath) ? JSON.parse(readFileSync(genPath, 'utf8')) : [];
const bellS3 = genStories.find((x) => x.slug === 'keepers-bell')?.cues?.S3;
ok(apiCue.status === 200 && typeof apiCue.json?.read_aloud === 'string' && Object.keys(apiCue.json).join() === 'read_aloud', `GET .../cue/<id> returns read_aloud only (${apiCue.status})`);
ok(!bellS3?.narrator_only || !JSON.stringify(apiCue.json).includes(bellS3.narrator_only.slice(0, 60)), 'the cue endpoint never returns the narrator-only part');
for (const path of ['/api/stories/no-such-story/names', '/api/stories/no-such-story/check?name=x', '/api/stories/keepers-bell/cue/S99', '/api/stories/no-such-story/cue/S1']) {
  const r = await getJson(path);
  ok(r.status === 404 && /application\/json/.test(r.type) && typeof r.json?.error === 'string', `${path} -> 404 JSON (${r.status})`);
}

// ---------------------------------------------------------------- http -> https redirect
// Only meaningful when the server is reached over https (local dev is plain http, and exempt).
if (base.startsWith('https://')) {
  const plain = await fetch(base.replace(/^https:/, 'http:') + '/', { redirect: 'manual' });
  ok(plain.status === 301 && (plain.headers.get('location') ?? '').startsWith('https://'), `http:// redirects to https:// with 301 (${plain.status})`);
} else console.log('SKIP  http -> https redirect (base URL is not https)');

// ---------------------------------------------------------------- covers and submissions (M5)
const coverRes = await fetch(`${base}/covers/example-dinner-party.jpg`);
await coverRes.arrayBuffer();
ok(coverRes.status === 200 && /^image\//.test(coverRes.headers.get('content-type') ?? ''), `GET /covers/example-dinner-party.jpg is an image (${coverRes.status} ${coverRes.headers.get('content-type')})`);
const noCover = await fetch(`${base}/covers/no-such-story.jpg`);
await noCover.arrayBuffer();
ok(noCover.status === 404, `an unknown cover is 404 (${noCover.status})`);

for (const [method, path] of [['GET', '/admin/submissions'], ['POST', '/admin/cover'], ['POST', '/admin/submissions/abc123/approve']]) {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{"slug":"keepers-bell"}' : undefined });
  await r.arrayBuffer();
  ok(r.status === 403 || r.status === 404, `${method} ${path} without the admin key is refused (${r.status})`);
}

ok(tools.includes('submit_story'), 'tools/list includes submit_story');
const noAuthor = await rpc('tools/call', { name: 'submit_story', arguments: { story_md: broken } });
ok(Boolean(noAuthor.json?.error) || noAuthor.json?.result?.isError === true, 'submit_story requires author_name');
const shortAuthor = await rpc('tools/call', { name: 'submit_story', arguments: { story_md: broken, author_name: 'A' } });
ok(Boolean(shortAuthor.json?.error) || shortAuthor.json?.result?.isError === true, 'submit_story refuses a 1-character author_name');
const urlAuthor = await call('submit_story', { story_md: broken, author_name: 'www.example.com' });
ok(/^Not submitted: the credited name can't be a web address/.test(urlAuthor), 'submit_story refuses a web address as the credit');
const lintFail = await call('submit_story', { story_md: broken, author_name: 'Smoke Author' });
ok(/^Not submitted: the story has \d+ format error/.test(lintFail) && /\[stop-phrase\]/.test(lintFail), 'submit_story refuses a lint-failing story and returns the errors');
const tooBig = await rpc('tools/call', { name: 'submit_story', arguments: { story_md: exampleMd, secrets_md: 'x'.repeat(30001) } });
ok(Boolean(tooBig.json?.error) || tooBig.json?.result?.isError === true, 'submit_story rejects secrets over 30,000 characters');

// A real submission, on dev only (the admin key is DEV_ACCESS_KEY there). The slug starts
// "smoke-test" (the dev marker), and the row is deleted again through the admin endpoint.
if (!openServer && key) {
  const stamp = Date.now().toString(36);
  const smokeMd = exampleMd
    .replace(/^name:\s*.+$/m, `name: plotspeaks-smoke-test-${stamp}`)
    .replace(/^(\s*title:\s*).+$/m, `$1Smoke Test ${stamp}`)
    .replace(/^# The Last Toast\s*$/m, `# Smoke Test ${stamp}`);
  const smokeSecrets = [
    '# Smoke test secrets', '', '## Endings detail', '',
    '- **Hale Winterbourne (wrong):** Innocent. Smoke test line for the innocent suspect.',
    '- **Smoke Target (correct):** Correct. Smoke test line for the culprit.', '',
  ].join('\n');
  const admin = (path, method = 'POST') => fetch(`${base}${path}`, { method, headers: { 'x-admin-key': key, accept: 'application/json' } });
  const receipt = await call('submit_story', { story_md: smokeMd, secrets_md: smokeSecrets, contact: 'smoke@example.invalid', author_name: 'Smoke Author' });
  const subId = (/Submission id: ([a-z0-9]+)/.exec(receipt) || [])[1];
  const claim = (/Claim code: ([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/.exec(receipt) || [])[1];
  ok(Boolean(subId) && /a person reviews every submission/i.test(receipt) && /not public yet/i.test(receipt), `submit_story accepts a valid story and returns a receipt (${subId ?? receipt.split('\n')[0].slice(0, 160)})`);
  ok(Boolean(claim) && /shown only this once/.test(receipt) && /no accounts/i.test(receipt) && /credited to Smoke Author/.test(receipt), 'the receipt has a claim code, explained in plain words');
  if (subId) {
    const slug = `smoke-test-${stamp}`;
    const pendingList = await call('list_stories', {});
    ok(!pendingList.includes(slug), 'a pending submission is not listed');
    const queue = await (await fetch(`${base}/admin/submissions`, { headers: { 'x-admin-key': key, accept: 'application/json' } })).json().catch(() => []);
    const mine = Array.isArray(queue) ? queue.find((r) => r.id === subId) : null;
    ok(Boolean(mine) && mine.dev_marker === 1 && !('secrets_md' in mine), `the admin queue lists it with the dev marker${mine ? `, cover: ${mine.has_cover ? 'yes' : 'no'}` : ''}`);
    ok(mine?.author_name === 'Smoke Author' && !('claim_hash' in mine), 'the admin queue shows the credited name and never the claim hash');
    const page = await fetch(`${base}/admin/submissions`, { headers: { 'x-admin-key': key } });
    ok(page.status === 200 && (await page.text()).includes(`Smoke Test ${stamp}`), 'the admin page shows the submission');
    const approved = await admin(`/admin/submissions/${subId}/approve`);
    ok(approved.status === 200, `approve (${approved.status})`);
    ok((await call('list_stories', {})).includes(slug), 'an approved submission is listed by list_stories');
    const subStart = await call('start_story', { slug });
    ok(new RegExp(`narrator for "Smoke Test ${stamp}"`).test(subStart) && !/\((correct|wrong)\):\*\*/.test(subStart), 'start_story serves the approved submission without its answer key');
    ok(/^\s+author: "Smoke Author"$/m.test(subStart), 'the credited name is the approved story\'s metadata.author');
    const subPage = await get(`/stories/${slug}`);
    ok(subPage.status === 200 && subPage.body.includes('Smoke Author'), `the site credits the writer on the story page (${subPage.status})`);
    const subReveal = await call('reveal', { slug, accused: 'Hale Winterbourne' });
    ok(/^Innocent\./.test(subReveal) && !/Smoke Target/.test(subReveal), 'reveal on a submission returns only the one ending line');
    const subNames = await getJson(`/api/stories/${slug}/names`);
    ok(subNames.status === 200 && JSON.stringify(subNames.json?.names) === JSON.stringify(['Hale Winterbourne', 'Smoke Target']), 'GET /api/.../names works for an approved submission');
    const subCheck = await getJson(`/api/stories/${slug}/check?name=${encodeURIComponent('smoke culprit')}`);
    ok(subCheck.status === 200 && subCheck.json?.verdict === 'correct' && /^Correct\./.test(subCheck.json?.line ?? ''), 'GET /api/.../check works for an approved submission');
    if (mine?.has_cover) {
      const c = await fetch(`${base}/covers/${slug}.jpg`);
      await c.arrayBuffer();
      ok(c.status === 200 && /^image\//.test(c.headers.get('content-type') ?? ''), `the approved submission's cover is served from D1 (${c.status})`);
    }
    // Update with the claim code: a wrong code is refused before screening; the right one puts it back to pending.
    const badReplace = await call('submit_story', { story_md: smokeMd, secrets_md: smokeSecrets, author_name: 'Smoke Author', replaces_id: subId, claim_code: 'AAAA-BBBB-CCCC' });
    ok(/^Not submitted: no submission matches that id and claim code/.test(badReplace), 'submit_story refuses an update with the wrong claim code');
    const replaced = await call('submit_story', { story_md: smokeMd, secrets_md: smokeSecrets, author_name: 'Smoke Author Two', replaces_id: subId, claim_code: claim.toLowerCase() });
    ok(/replaced submission/.test(replaced) && /claim code stays the same/i.test(replaced), `submit_story updates a submission with its claim code (${replaced.split('\n')[0].slice(0, 120)})`);
    ok(!(await call('list_stories', {})).includes(slug), 'an updated submission is off the catalog until reviewed again');
    // Withdraw: the wrong code is refused, the right one deletes it.
    const badWithdraw = await call('withdraw_submission', { id: subId, claim_code: 'AAAA-BBBB-CCCC' });
    ok(/^Not withdrawn/.test(badWithdraw), 'withdraw_submission refuses a wrong claim code');
    const withdrawn = await call('withdraw_submission', { id: subId, claim_code: claim });
    ok(/^Withdrawn:/.test(withdrawn), 'withdraw_submission deletes the submission with the right claim code');
    const after = await (await fetch(`${base}/admin/submissions?status=all`, { headers: { 'x-admin-key': key, accept: 'application/json' } })).json().catch(() => []);
    const still = Array.isArray(after) && after.some((r) => r.id === subId);
    ok(!still, 'the withdrawn submission is gone from the queue');
    if (still) await admin(`/admin/submissions/${subId}/delete`); // cleanup if withdraw failed
    ok(!(await call('list_stories', {})).includes(slug), 'the withdrawn submission is not listed');
    const again = await call('withdraw_submission', { id: subId, claim_code: claim });
    ok(/^Not withdrawn/.test(again), 'a used claim code no longer works');
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
