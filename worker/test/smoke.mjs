// Smoke test for the Plot Speaks MCP server: every tool, the access lock, play recording, the
// ChatGPT fail-closed rules, the connector scripts (no paste-play "wrangler" text), the leak scan
// over pages and tool outputs, the passenger-page JSON API and the http -> https redirect.
// Usage: node test/smoke.mjs [base-url] [--open]   (default http://127.0.0.1:8799; reads the key from .dev.vars)
//   --open: the server has no access key (production). Story calls must work without one; the key
//   is still sent with the other calls so smoke plays are flagged as tester plays, not strangers.
//   On an open server the test leaves no rating at all: it only checks rate_story's validation.
// It prints verdict prefixes and counts only, never answer text.
import { readFileSync, existsSync } from 'node:fs';

const openServer = process.argv.includes('--open');
const base = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8799').replace(/\/$/, '');
// Dev: the access key from .dev.vars (every dev play is a tester play). Prod (--open): the tester
// key (secret TESTER_KEY, local copy in .prod-secrets/), so smoke plays never count as strangers.
const readKey = (file, name) => existsSync(file) ? (new RegExp(`^${name}=(.+)$`, 'm').exec(readFileSync(file, 'utf8')) || [, readFileSync(file, 'utf8')])[1]?.trim() : process.env[name];
const key = openServer
  ? readKey(new URL('../../.prod-secrets/TESTER_KEY.txt', import.meta.url), 'TESTER_KEY')
  : readKey(new URL('../.dev.vars', import.meta.url), 'DEV_ACCESS_KEY');
if (openServer && !key) { console.log('FAIL  no tester key: put it in .prod-secrets/TESTER_KEY.txt (or env TESTER_KEY) so smoke plays are not counted as strangers'); process.exit(1); }

// Prod's Cloudflare rule blocks an IP that sends more than 60 requests in 10 s to /mcp or /api/*
// (docs/DECISIONS.md). The leak scan alone makes more than that, so on an open server those
// requests are spaced 220 ms apart (at most 45 in any 10 s); the pages are not rate-limited.
const rawFetch = globalThis.fetch;
let lastLimited = 0;
globalThis.fetch = async (url, init) => {
  if (openServer && /\/(mcp|api\/)/.test(String(url))) {
    const wait = lastLimited + 220 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastLimited = Date.now();
  }
  return rawFetch(url, init);
};

let id = 0, failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

async function rpc(method, params, { withKey = true, ua } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (withKey && key) headers['x-api-key'] = key;
  if (ua) headers['user-agent'] = ua;
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const raw = await res.text();
  const line = raw.split('\n').find((l) => l.startsWith('data: ')) ?? raw;
  let json = null;
  try { json = JSON.parse(line.replace(/^data: /, '')); } catch {}
  return { status: res.status, json };
}
const result = async (name, args, opts) => (await rpc('tools/call', { name, arguments: args }, opts)).json?.result ?? null;
const call = async (name, args, opts) => (await result(name, args, opts))?.content?.[0]?.text ?? '';
const isErr = (r) => r?.isError === true;
const GPT_UA = 'openai-mcp/1.0.0';

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
const instructions = init.json?.result?.instructions ?? '';
ok(init.status === 200 && /Plot Speaks runs interactive stories and games/.test(instructions), 'initialize returns the server instructions');
ok(!/wrangler/i.test(instructions) && !/\bkids?\b|family/i.test(instructions) && /reveal_solution/.test(instructions) && /check_accusation/.test(instructions),
  'the instructions mention no wrangler and no kids/family, and name check_accusation and reveal_solution');

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

// ---------------------------------------------------------------- the tool surface (review S7, S8, B2)
const EXPECTED_TOOLS = ['open_plot_speaks', 'list_stories', 'start_story', 'choose', 'game_board', 'game_question', 'game_answer', 'game_challenge', 'roll', 'world_recall', 'world_update', 'check_accusation', 'reveal_solution', 'get_cue', 'rate_story', 'write_story', 'review_story', 'submit_story', 'withdraw_submission'];
const toolList = (await rpc('tools/list', {})).json?.result?.tools ?? [];
const tools = toolList.map((t) => t.name);
ok(EXPECTED_TOOLS.every((t) => tools.includes(t)) && tools.length === EXPECTED_TOOLS.length, `tools: ${tools.join(', ')}`);
ok(!tools.includes('reveal') && !tools.includes('check_story'), 'reveal is renamed check_accusation, and check_story is gone');
ok(toolList.every((t) => typeof t.title === 'string' && t.title.length > 0), 'every tool has a title');
// Claude's directory form reads the title from annotations.title (2026-10-16 submission).
ok(toolList.every((t) => typeof t.annotations?.title === 'string' && t.annotations.title.length > 0), 'every tool has annotations.title');
const ann = (n) => toolList.find((t) => t.name === n)?.annotations ?? {};
ok(['start_story', 'choose', 'check_accusation', 'reveal_solution', 'rate_story'].every((n) => ann(n).readOnlyHint === false), 'tools that record a play event are not marked read-only');
ok(['open_plot_speaks', 'list_stories', 'get_cue', 'write_story', 'review_story'].every((n) => ann(n).readOnlyHint === true && ann(n).idempotentHint === true && ann(n).destructiveHint === false),
  'open_plot_speaks, list_stories, get_cue, write_story and review_story are read-only and idempotent');
ok(ann('reveal_solution').title === 'Full reveal', 'reveal_solution is titled "Full reveal"');
const prompts = (await rpc('prompts/list', {})).json?.result?.prompts?.map((p) => p.name) ?? [];
ok(!prompts.includes('story_template'), `the story_template prompt is gone (prompts: ${prompts.join(', ') || 'none'})`);
// Descriptions never mention children's stories, for any client; the kids enum value only outside ChatGPT.
const described = (list) => JSON.stringify(list.map((t) => [t.description, ...Object.values(t.inputSchema?.properties ?? {}).map((p) => p.description)]));
const gptList = (await rpc('tools/list', {}, { ua: GPT_UA })).json?.result?.tools ?? [];
ok(!/\bkids?\b|family/i.test(described(toolList)) && !/\bkids?\b|family/i.test(described(gptList)), 'no tool or parameter description mentions kids or family (neutral and ChatGPT clients)');
ok(!JSON.stringify(gptList).includes('"kids"') && JSON.stringify(toolList).includes('"kids"'), 'the "kids" enum value exists only when the client is not ChatGPT');
const maxOf = (tool, prop) => toolList.find((t) => t.name === tool)?.inputSchema?.properties?.[prop]?.maxLength;
ok(maxOf('start_story', 'slug') === 80 && maxOf('check_accusation', 'accused') === 120 && maxOf('rate_story', 'comment') === 500 && maxOf('submit_story', 'author_name') === 60,
  'input limits: slug 80, accused 120, comment 500, author_name 60');

const list = await call('list_stories', {});
ok(/example-dinner-party/.test(list) && /keepers-bell/.test(list), 'list_stories lists the stories');

// ---------------------------------------------------------------- open_plot_speaks and categories
const opened = await call('open_plot_speaks', {});
ok(opened.includes('Would you like to hear what stories there are, start one, or write your own?'), 'open_plot_speaks returns the question');
ok(/car ride/i.test(opened) && /until you accuse/i.test(opened), 'open_plot_speaks has the spoken intro (car rides, answer hidden until you accuse)');
ok(/^- Mysteries \(some dark, some for families\): /m.test(opened) && /^- Adventures: /m.test(opened) && !/^- Mysteries[^:]*: The (Missing Blue Ribbon|Fizzless Volcano|Empty Glass Case)/m.test(opened),
  'open_plot_speaks menu lists the kinds with example titles (mysteries note dark and family)');
ok(!/\((correct|wrong)\)|^\s*(Correct|Innocent)\.\s/im.test(opened), 'open_plot_speaks contains no answer-key line');
const skipped = await call('open_plot_speaks', { skip_intro: true });
ok(!/^INTRO/m.test(skipped) && skipped.includes('Would you like to hear what stories there are') && /MENU/.test(skipped), 'open_plot_speaks with skip_intro leaves the intro out but keeps the question and menu');
const howTo = await call('open_plot_speaks', { instructions: true });
ok(/HOW IT WORKS/.test(howTo) && /Plot Speaks, pause/.test(howTo) && /No signal/.test(howTo) && /feedback/i.test(howTo), 'open_plot_speaks with instructions adds the how-to-play (phrases, no signal, feedback)');
ok(/haven't come across that yet/.test(instructions) && /can't reach Plot Speaks/.test(instructions) && /leave feedback/i.test(instructions),
  'the server instructions carry the discovery guardrail, the no-signal rule and the feedback ask');
const gptOpened = await call('open_plot_speaks', {}, { ua: GPT_UA });
ok(!/famil/i.test(gptOpened) && !/Blue Ribbon|Fizzless|Glass Case/.test(gptOpened) && /^- Adventures: /m.test(gptOpened), 'open_plot_speaks for ChatGPT leaves the family stories out');
const darkList = await call('list_stories', { genre: 'dark' });
const mysteryList = await call('list_stories', { genre: 'murder-mystery' });
const classicList = await call('list_stories', { genre: 'classic' });
ok(/, dark;/.test(darkList) && !/example-dinner-party/.test(darkList) && !/for families/.test(darkList), 'list_stories genre "dark" lists dark mysteries only');
ok(/example-dinner-party/.test(classicList) && !/, dark;/.test(classicList), 'list_stories genre "classic" leaves dark mysteries out');
ok(/example-dinner-party/.test(mysteryList) && (!/, dark;/.test(list) || /, dark;/.test(mysteryList)), 'list_stories genre "murder-mystery" still lists every murder mystery (backwards compatible)');
ok(/for families/.test(await call('list_stories', { genre: 'kids' })), 'list_stories accepts genre "kids" outside ChatGPT');
ok(/Keeper's Bell/.test(await call('list_stories', { kind: 'adventure' })) && !/Last Toast/.test(await call('list_stories', { kind: 'adventure' })), 'list_stories filters by kind');
ok(!/for families|Blue Ribbon/.test(await call('list_stories', {}, { ua: GPT_UA })), 'list_stories for ChatGPT lists no family story');
const grouped = await call('list_stories', { group_by_category: true });
ok(/^Mysteries:\n- /m.test(grouped) && /^Adventures:\n- /m.test(grouped), 'list_stories groups by kind');

// ---------------------------------------------------------------- start_story, matching, ChatGPT fail-closed
const start = await call('start_story', { slug: 'The Last Toast' });
const playId = (/Play id: ([0-9a-f-]{36})/.exec(start) || [])[1];
ok(Boolean(playId), 'start_story returns a play id');
const misheard = await call('start_story', { slug: 'The Last Host' });
ok(/narrator for "The Last Toast"/.test(misheard), 'start_story finds a misheard title ("The Last Host")');
ok(/Playing through the Plot Speaks connector/.test(start) && /check_accusation/.test(start) && !/^---\s*$/m.test(start.split('\n').slice(0, 6).join('\n')) && /^Story: The Last Toast · /m.test(start),
  'start_story serves the connector script: preface, one-line header, no front matter');
// The script may mention "Endings detail" (its GM instructions name the section); an answer-key
// line itself looks like "- **Name (correct):** Correct. ..." and must never be served.
ok(!/\((correct|wrong)\):\*\*|^\s*(Correct|Innocent)\.\s/im.test(start), 'start_story contains no answer-key line');
for (const [label, args, opts] of [
  ['ChatGPT UA', { slug: 'The Missing Blue Ribbon' }, { ua: GPT_UA }],
  ['ChatGPT UA, short title', { slug: 'blue ribbon' }, { ua: GPT_UA }],
]) {
  const r = await result('start_story', args, opts);
  ok(isErr(r) && /isn't available in ChatGPT/.test(r?.content?.[0]?.text ?? '') && !/narrator for/.test(r?.content?.[0]?.text ?? ''), `B2: a family title from ${label} answers "isn't available in ChatGPT" (isError), never another story`);
}
const metaGpt = await rpc('tools/call', { name: 'start_story', arguments: { slug: 'The Missing Blue Ribbon' }, _meta: { 'openai/userLocation': { country: 'US' } } }, { ua: 'some-new-client/2.0' });
ok(isErr(metaGpt.json?.result) && /isn't available in ChatGPT/.test(metaGpt.json?.result?.content?.[0]?.text ?? ''), 'B2: an unknown UA with openai/* _meta is treated as ChatGPT (fail closed)');
const kidsElsewhere = await call('start_story', { slug: 'The Missing Blue Ribbon' });
ok(/narrator for "The Missing Blue Ribbon"/.test(kidsElsewhere), 'outside ChatGPT the family title still starts');
const the = await result('start_story', { slug: 'the' });
ok(isErr(the) && /No story called/.test(the?.content?.[0]?.text ?? ''), 'S2: "the" never starts a story (isError)');
const empty = await rpc('tools/call', { name: 'start_story', arguments: { slug: '' } });
ok(Boolean(empty.json?.error) || isErr(empty.json?.result), 'S2: an empty slug is refused');
const oneWord = await result('start_story', { slug: 'Blue' }, { ua: GPT_UA });
ok(isErr(oneWord) && !/narrator for/.test(oneWord?.content?.[0]?.text ?? ''), 'S2: one shared word ("Blue") does not start a story from ChatGPT');

// ---------------------------------------------------------------- check_accusation (review S1)
const wrong = await call('check_accusation', { slug: 'example-dinner-party', accused: 'Hale Winterbourne', play_id: playId });
ok(/^Innocent\./.test(wrong) && /matched: Winterbourne/.test(wrong), `check_accusation of an innocent starts "Innocent." and names the match (${wrong.slice(0, 10)})`);
const unmatched = await result('check_accusation', { slug: 'example-dinner-party', accused: 'Nobody Atall', play_id: playId });
const unmatchedText = unmatched?.content?.[0]?.text ?? '';
const listed = (/they mean: (.+)\.$/.exec(unmatchedText) || [])[1]?.split(', ') ?? [];
ok(isErr(unmatched) && /couldn't match/i.test(unmatchedText) && listed.length > 1 && JSON.stringify([...listed].sort((a, b) => a.localeCompare(b))) === JSON.stringify(listed),
  'check_accusation on an unknown name is an error and lists the names sorted');
const twoPeople = await result('check_accusation', { slug: 'example-dinner-party', accused: 'June Winterbourne' });
ok(isErr(twoPeople) && /more than one person/.test(twoPeople?.content?.[0]?.text ?? '') && !/^(Correct|Innocent)\./m.test(twoPeople?.content?.[0]?.text ?? ''), 'check_accusation asks which one when two people match equally');
const advAccuse = await result('check_accusation', { slug: 'keepers-bell', accused: 'Snagra' });
ok(isErr(advAccuse) && /no accusations/.test(advAccuse?.content?.[0]?.text ?? ''), 'check_accusation on an adventure says it has no accusations');

// ---------------------------------------------------------------- reveal_solution (review B3)
const fresh = await call('start_story', { slug: 'example-dinner-party' });
const freshId = (/Play id: ([0-9a-f-]{36})/.exec(fresh) || [])[1];
const gated = await result('reveal_solution', { slug: 'example-dinner-party', play_id: freshId });
ok(isErr(gated) && /accuse someone first, or confirm they want to give up/.test(gated?.content?.[0]?.text ?? ''), 'reveal_solution is refused before any accusation (isError)');
const afterAcc = await result('reveal_solution', { slug: 'example-dinner-party', play_id: playId });
ok(!isErr(afterAcc) && /^READ ALOUD/.test(afterAcc?.content?.[0]?.text ?? ''), 'reveal_solution works once the play has an accusation');
const genPath = new URL('../src/generated/stories.json', import.meta.url);
const genStories = existsSync(genPath) ? JSON.parse(readFileSync(genPath, 'utf8')) : [];
if (genStories.find((s) => s.slug === 'example-dinner-party')?.full_reveal?.afterward) {
  ok(/WHAT BECAME OF THEM/.test(afterAcc?.content?.[0]?.text ?? ''), 'reveal_solution returns both parts, READ ALOUD and WHAT BECAME OF THEM');
}
const gaveUp = await result('reveal_solution', { slug: 'example-dinner-party', play_id: freshId, gave_up: true });
ok(!isErr(gaveUp) && /^READ ALOUD/.test(gaveUp?.content?.[0]?.text ?? ''), 'reveal_solution works with gave_up: true');
const advReveal = await result('reveal_solution', { slug: 'keepers-bell', play_id: freshId, gave_up: true });
ok(isErr(advReveal) && /no reveal/.test(advReveal?.content?.[0]?.text ?? ''), 'reveal_solution on an adventure says to play on to the end');
const noPlay = await rpc('tools/call', { name: 'reveal_solution', arguments: { slug: 'example-dinner-party' } });
ok(Boolean(noPlay.json?.error) || isErr(noPlay.json?.result), 'reveal_solution requires a play id');

// ---------------------------------------------------------------- get_cue and chapters
const cue = await call('get_cue', { slug: 'keepers-bell', cue: 's3' });
ok(/^READ ALOUD/.test(cue) && /NARRATOR NOTES/.test(cue), 'get_cue returns read-aloud text and narrator notes');
const cue1 = await call('get_cue', { slug: 'keepers-bell', cue: 'S1' });
ok(/Follow-up cues to listen for/.test(cue1) && /call get_cue S\d/.test(cue1), 'get_cue S1 carries the follow-up table, as get_cue calls');
const badCue = await result('get_cue', { slug: 'keepers-bell', cue: 'S99' });
ok(isErr(badCue), 'an unknown cue is an error result');
const bell1 = await call('start_story', { slug: 'keepers-bell' });
const bellId = (/Play id: ([0-9a-f-]{36})/.exec(bell1) || [])[1];
ok(/### Scene 1\.1/.test(bell1) && !/### Scene 2\.1/.test(bell1) && /chapter: 2/.test(bell1), 'S14: a two-chapter story serves chapter 1 only, with how to get chapter 2');
const bell2 = await call('start_story', { slug: 'keepers-bell', chapter: 2, play_id: bellId });
ok(/### Scene 2\.1/.test(bell2) && !/### Scene 1\.1/.test(bell2) && /Chapter 1 \(already played\)/.test(bell2) && bell2.includes(`Play id: ${bellId}`), 'S14: chapter 2 has chapter 1\'s recap at its top and keeps the play id');
const ch3 = await result('start_story', { slug: 'example-dinner-party', chapter: 2 });
ok(isErr(ch3), 'asking for chapter 2 of a one-chapter story is an error');

// B1: no paste-play text in any start_story or get_cue output, for every story and cue.
let b1Hits = 0, b1Checked = 0;
const toolOutputs = [['open_plot_speaks', opened], ['list_stories', list], ['list_stories grouped', grouped]];
for (const s of genStories) {
  const parts = Math.max(1, s.story_connector?.length ?? 1);
  for (let n = 1; n <= parts; n++) {
    const out = await call('start_story', n === 1 ? { slug: s.slug } : { slug: s.slug, chapter: n });
    b1Checked++;
    toolOutputs.push([`start_story ${s.slug} ch${n}`, out]);
    if (/wrangler/i.test(out) || /Narrator,\s*cue/i.test(out) || !/narrator for/.test(out)) { b1Hits++; console.log(`FAIL  start_story ${s.slug} chapter ${n} still has paste-play text (or didn't start)`); }
  }
  for (const c of Object.keys(s.cues ?? {})) {
    const out = await call('get_cue', { slug: s.slug, cue: c });
    b1Checked++;
    toolOutputs.push([`get_cue ${s.slug} ${c}`, out]);
    if (/wrangler/i.test(out) || /Narrator,\s*cue/i.test(out) || !/^READ ALOUD/.test(out)) { b1Hits++; console.log(`FAIL  get_cue ${s.slug} ${c} still has paste-play text`); }
  }
}
ok(b1Checked > 15 && b1Hits === 0, `B1: no "wrangler" and no "Narrator, cue" in ${b1Checked} start_story and get_cue outputs`);

// ---------------------------------------------------------------- rate_story (review S3)
const badRate = await rpc('tools/call', { name: 'rate_story', arguments: { slug: 'example-dinner-party', stars: 9, play_id: playId } });
ok(Boolean(badRate.json?.error) || isErr(badRate.json?.result), 'rate_story rejects 9 stars');
const noPlayRate = await rpc('tools/call', { name: 'rate_story', arguments: { slug: 'example-dinner-party', stars: 5 } });
ok(Boolean(noPlayRate.json?.error) || isErr(noPlayRate.json?.result), 'rate_story requires a play id');
const ghostRate = await result('rate_story', { slug: 'example-dinner-party', stars: 5, play_id: 'no-such-play' });
ok(isErr(ghostRate) && /nothing was saved/i.test(ghostRate?.content?.[0]?.text ?? ''), 'rate_story refuses a play id that does not exist (nothing saved)');
if (!openServer) {
  // Dev only: production smoke runs leave no rating at all.
  const rated = await call('rate_story', { slug: 'example-dinner-party', stars: 5, spoiled: false, comment: 'smoke test', feedback: 'smoke test feedback', play_id: playId });
  ok(/rating and feedback saved/i.test(rated), 'rate_story saves a rating for a real play (dev; stored as a tester rating)');
} else console.log('SKIP  saving a rating (open server: the smoke test leaves no rating)');

// ---------------------------------------------------------------- preview stories
// In stories/catalog.json "preview": never listed by the assistant tools; on the site's Stories and
// Games tabs only marked "In testing"; started by exact name.
const previews = genStories.filter((s) => s.preview);
if (previews.length) {
  const everything = await call('list_stories', {});
  const menu = await call('open_plot_speaks', {});
  ok(previews.every((p) => !everything.includes(`slug: ${p.slug}`) && !menu.includes(p.title)), `preview stories are not in list_stories or the welcome menu (${previews.length})`);
  const tabs = (await (await fetch(`${base}/`)).text()) + (await (await fetch(`${base}/games`)).text());
  const testingCards = (tabs.match(/class="card card-testing"/g) || []).length;
  ok(testingCards === previews.length && /In testing/.test(tabs), `the Stories and Games tabs show every preview piece marked "In testing" (${testingCards})`);
  const byTitle = await call('start_story', { slug: previews[0].title });
  ok(new RegExp(`narrator for "${previews[0].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(byTitle), 'a preview story starts by its exact title');
} else console.log('SKIP  preview checks (no preview story)');

// ---------------------------------------------------------------- choose-your-path (kind: branching)
// Runs on the first branching story the server lists; skipped while none is published. The leak
// check uses the locally built graph: no node but the one served may appear in an output.
const branchList = await call('list_stories', { kind: 'branching' });
const branchSlug = (/slug: ([a-z0-9-]+)/.exec(branchList) || [])[1] ?? genStories.find((s) => s.preview && s.kind === 'branching')?.slug;
const branchGraph = genStories.find((s) => s.slug === branchSlug)?.branches;
if (branchSlug && branchGraph) {
  const nodeNeedles = (except) => Object.entries(branchGraph.nodes).filter(([id]) => !except.includes(id)).map(([, n]) => n.read_aloud.slice(0, 70)).filter((t) => t.length >= 40);
  const bStart = await call('start_story', { slug: branchSlug });
  const bPlay = (/Play id: ([0-9a-f-]{36})/.exec(bStart) || [])[1];
  ok(Boolean(bPlay) && /## The opening/.test(bStart) && /CHOICES/.test(bStart), `start_story on a branching story returns the opening node and its choices (${branchSlug})`);
  ok(!nodeNeedles(['start']).some((t) => bStart.includes(t)), 'start_story serves no node but the opening');
  const firstTo = branchGraph.nodes.start.choices.find((c) => !c.if.length)?.to;
  const moved = await call('choose', { slug: branchSlug, play_id: bPlay, choice: '1' });
  ok(/^READ ALOUD/.test(moved) && (!firstTo || !nodeNeedles([firstTo]).some((t) => moved.includes(t))), 'choose "1" returns the next node, and only that node');
  const resumed = await call('choose', { slug: branchSlug, play_id: bPlay });
  ok(/WHERE THEY ARE/.test(resumed) && /they chose "/.test(resumed), 'choose with no answer returns where the play is and the path so far');
  const unclear = await result('choose', { slug: branchSlug, play_id: bPlay, choice: 'zebra quantum pancake' });
  ok(isErr(unclear) && /didn't clearly match/.test(unclear?.content?.[0]?.text ?? ''), 'an unclear answer is refused with the choices listed, not guessed');
  const foreign = await result('choose', { slug: branchSlug, play_id: playId, choice: '1' });
  ok(isErr(foreign) && /couldn't find that play/.test(foreign?.content?.[0]?.text ?? ''), "another story's play id doesn't move this story");
  const noBranch = await result('choose', { slug: 'example-dinner-party', play_id: playId, choice: '1' });
  ok(isErr(noBranch) && /isn't a choose-your-path story/.test(noBranch?.content?.[0]?.text ?? ''), 'choose on a mystery says it is not a choose-your-path story');
} else console.log('SKIP  choose-your-path checks (no branching story is listed yet)');

// ---------------------------------------------------------------- trivia (kind: trivia)
// Runs on the first trivia board listed. The answers come from the locally built board; no output
// before a ruling may contain the answer to the open clue. The challenge is not exercised here (it
// calls three AI models); its refusals are.
const triviaList = await call('list_stories', { kind: 'trivia' });
// Prefer a board whose first clue has one step, so scoring and the challenge refusal are exercised too.
const listedTrivia = [...triviaList.matchAll(/slug: ([a-z0-9-]+)/g)].map((m) => m[1]);
const triviaCandidates = genStories.filter((s) => s.trivia && (listedTrivia.includes(s.slug) || s.preview));
const triviaSlug = (triviaCandidates.find((s) => s.trivia.categories.find((c) => !c.final)?.clues[0]?.steps.length === 1) ?? triviaCandidates[0])?.slug;
const triviaBoard = genStories.find((s) => s.slug === triviaSlug)?.trivia;
if (triviaSlug && triviaBoard) {
  const cat = triviaBoard.categories.find((c) => !c.final);
  const q = cat.clues[0];
  const tStart = await call('start_story', { slug: triviaSlug });
  const tPlay = (/Play id: ([0-9a-f-]{36})/.exec(tStart) || [])[1];
  ok(Boolean(tPlay) && /## The board/.test(tStart) && tStart.includes(cat.name), `start_story on a trivia board returns the board (${triviaSlug})`);
  const allAnswers = triviaBoard.categories.flatMap((c) => c.clues.map((x) => x.answer)).filter((a) => a.length >= 4);
  ok(!allAnswers.some((a) => tStart.includes(`Answer: ${a}`) || new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(tStart.split('## The board')[1] ?? '')), 'the board shows no answers');
  const clue = await call('game_question', { slug: triviaSlug, play_id: tPlay, category: cat.name, value: q.value });
  ok(/^CLUE/.test(clue) && clue.includes(q.steps[0]) && !(q.answer.length >= 4 && clue.toLowerCase().includes(q.answer.toLowerCase())), 'game_question gives the clue and not its answer');
  const again = await result('game_question', { slug: triviaSlug, play_id: tPlay, category: 'no such category' });
  ok(isErr(again) && /no category called/.test(again?.content?.[0]?.text ?? ''), 'an unknown category is refused with the list');
  const wrong = await call('game_answer', { slug: triviaSlug, play_id: tPlay, answer: 'zebra quantum pancake', player: 'Smoke' });
  ok(q.steps.length > 1 ? /^NOT YET/.test(wrong) : /^NOT RIGHT/.test(wrong) && wrong.includes(q.answer), 'a wrong answer is ruled wrong (or gets the next step) and the answer is given after the ruling');
  if (q.steps.length === 1) {
    const q2 = cat.clues[1];
    await call('game_question', { slug: triviaSlug, play_id: tPlay, category: cat.name, value: q2.value });
    const right = await call('game_answer', { slug: triviaSlug, play_id: tPlay, answer: `what is ${q2.answer}`, player: 'Smoke' });
    ok(/^CORRECT/.test(right) && new RegExp(`Smoke ${q2.value}`).test(right), 'a right answer scores its value for the named player');
    const noChallenge = await result('game_challenge', { slug: triviaSlug, play_id: tPlay });
    ok(isErr(noChallenge) && /already ruled correct/.test(noChallenge?.content?.[0]?.text ?? ''), 'a correct ruling cannot be challenged');
  }
  const board2 = await call('game_board', { slug: triviaSlug, play_id: tPlay });
  // A stepped clue stays open after a wrong answer (the next step comes), so only a one-step clue leaves the board.
  ok(/^SCORES:/.test(board2) && (q.steps.length > 1 || !new RegExp(`- ${cat.name}: ${q.value}\\b`).test(board2)), 'game_board shows the scores and drops a played clue');
} else console.log('SKIP  trivia checks (no trivia board is listed yet)');

// ---------------------------------------------------------------- dice and campaigns
const d20 = await call('roll', { dice: '1d20+3', why: 'smoke' });
const d20n = Number((/= (-?\d+)\./.exec(d20) || [])[1]);
ok(/^smoke: Rolled \d+ \+ 3 = \d+\./.test(d20) && d20n >= 4 && d20n <= 23, `roll 1d20+3 rolls on the server (${d20n})`);
ok(isErr(await result('roll', { dice: 'a lot' })) && isErr(await result('roll', { dice: '1d7' })), 'roll refuses a non-roll and a non-standard die');
const campList = await call('list_stories', { kind: 'campaign' });
const campSlug = (/slug: ([a-z0-9-]+)/.exec(campList) || [])[1] ?? genStories.find((s) => s.preview && s.kind === 'campaign')?.slug;
if (campSlug) {
  const cStart = await call('start_story', { slug: campSlug });
  const cPlay = (/Play id: ([0-9a-f-]{36})/.exec(cStart) || [])[1];
  const code = (/RESUME CODE: "([a-z ]+)"/.exec(cStart) || [])[1];
  ok(Boolean(cPlay) && /^[a-z]+ [a-z]+ [a-z]+$/.test(code ?? ''), `start_story on a campaign gives a play id and a three-word resume code (${campSlug})`);
  const up = await call('world_update', { slug: campSlug, play_id: cPlay, party: [{ name: 'Smoke', class: 'wizard', level: 1, max_hp: 8, max_slots: { 1: 2 } }], npcs: [{ name: 'Old Bram', status: 'dead' }], location: 'the crossroads', note: 'smoke test' });
  ok(/Smoke joined \(wizard, level 1, 8 HP\)/.test(up) && /the crossroads/.test(up), 'world_update adds a character and a place');
  const hit = await call('world_update', { slug: campSlug, play_id: cPlay, party: [{ name: 'Smoke', damage: 3, spend_slot: '1' }, { name: 'Smoke', hp: 50 }], npcs: [{ name: 'Old Bram', status: 'friendly' }] });
  ok(/5\/8/.test(hit) && /REFUSED/.test(hit) && /dead stay dead/.test(hit) && /above their maximum/.test(hit), 'world_update applies damage and a spell slot, and refuses raising the dead and HP over the maximum');
  const back = await call('world_recall', { slug: campSlug, resume_code: code });
  ok(back.includes(cPlay) && /Smoke, wizard 1: 5\/8 HP/.test(back), 'world_recall by resume code returns the same campaign');
  const carry = await call('start_story', { slug: campSlug, resume_code: code });
  ok(carry.includes(`Play id: ${cPlay}`) && /Where the campaign stands/.test(carry) && !/RESUME CODE:/.test(carry), 'start_story with the resume code carries on the same campaign, with no new play or code');
  const rest = await call('world_update', { slug: campSlug, play_id: cPlay, rest: 'long', day: 2 });
  ok(/8\/8 HP/.test(rest) && /^DAY 2\b/m.test(rest), 'a long rest sent with the day moves one day, not two, and restores HP');
  ok(isErr(await result('world_recall', { slug: campSlug, resume_code: 'not a code' })), 'a wrong resume code is refused');
} else console.log('SKIP  campaign checks (no campaign is listed yet)');

// ---------------------------------------------------------------- write_story and review_story
const broken = [
  '---', 'name: plotspeaks-broken', 'description: A broken draft.', 'license: CC-BY-NC-4.0', 'metadata:', '  title: Broken',
  '  genre: murder-mystery', '  duration_minutes: 30', '  chapters: 1', '  players: 1-4', '  rating: PG-13', '  version: 0.1.0',
  '  author: Smoke', '  voice_ready: true', '  rules_system: none', '  ai_disclosure: ai-assisted', '---', '', '# Broken', '',
  '## How to run this (GM instructions)', '', '- Be a good narrator.', '', '## Cast (public information only)', '',
  '## Chapter 1 — Start (≈30 min)', '', '**Read aloud:** One. Two. Three. Four. Five.', '', '[thunder] Colonel Mustard enters.', '',
  '## Endings', '', '- Correct accusation: well done.',
].join('\n');
const brokenReport = await call('review_story', { story_md: broken });
ok(/^STATUS: \d+ problems? to fix/.test(brokenReport) && /\[read-aloud\]/.test(brokenReport) && /\[stop-phrase\]/.test(brokenReport) && /\[no-audio-cues\]/.test(brokenReport) && /\[denylist\]/.test(brokenReport),
  `review_story without secrets flags a broken draft (${brokenReport.split('\n')[0]})`);
const exampleMd = readFileSync(new URL('../../stories/example-dinner-party/story.md', import.meta.url), 'utf8');
const exampleReport = await call('review_story', { story_md: exampleMd });
ok(/^STATUS: passes format checks/.test(exampleReport), `review_story passes the example story (${exampleReport.split('\n')[0]})`);
const slugReport = await call('review_story', { story_md: exampleMd, slug: 'the-wrong-slug' });
ok(/name should equal "plotspeaks-the-wrong-slug"/.test(slugReport), 'review_story checks the slug when given one');
const tooLong = await rpc('tools/call', { name: 'review_story', arguments: { story_md: 'x'.repeat(60001) } });
ok(Boolean(tooLong.json?.error) || tooLong.json?.result?.isError === true, 'review_story rejects a story over 60,000 characters');
const writing = await call('write_story', { genre: 'dark', length: '30' });
ok(/story\.md/.test(writing) && /secrets\.md/.test(writing) && /person at Plot Speaks/.test(writing), 'write_story has the intro for the writer (two files, human review)');
ok(/jump straight in/.test(writing) && /## Endings/.test(writing) && /tone: dark/.test(writing) && /## Full reveal/.test(writing), `write_story returns the template, with the Full reveal section (${writing.length} chars)`);
ok(!/same microphone|never doubt|without question/i.test(writing) && !/check_story|story_template/.test(writing), 'write_story has no wrangler trust rules and names no removed tool');
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
ok(/\[full-reveal\]/.test(tellReview), 'review_story warns when a mystery\'s secrets.md has no ## Full reveal');
const cleanReview = await call('review_story', { story_md: exampleMd, secrets_md: tellSecrets });
ok(/^STATUS: passes format checks/.test(cleanReview), `review_story passes a clean draft (${cleanReview.split('\n')[0]})`);

// ---------------------------------------------------------------- catalog site (M3)
// The pages are public, so they must carry no secret: fetch every page and assert that no
// answer-key line ("(correct):", a line starting "Correct." / "Innocent."), no Endings detail
// text, no full reveal and no cue read-aloud text appears. Endings and cue text come from the
// locally built worker/src/generated/stories.json (it never leaves this machine); only pass/fail is printed.
const unescape = (h) => h.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const get = async (path) => { const r = await fetch(`${base}${path}`); return { status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text() }; };

const home = await get('/');
ok(home.status === 200 && /text\/html/.test(home.type), `GET / is an HTML page (${home.status})`);
const slugs = [...home.body.matchAll(/href="\/stories\/([^"/]+)"/g)].map((m) => decodeURIComponent(m[1]));
ok(slugs.includes('example-dinner-party') && slugs.includes('keepers-bell'), `GET / lists the stories (${slugs.join(', ')})`);
ok(/The Last Toast/.test(home.body) && /The Keeper(&#39;|')s Bell/.test(home.body), 'GET / shows story titles');
ok(/<audio controls preload="none" src="\/audio\/sample-last-toast\.mp3"/.test(home.body) && /class="btn btn-ghost btn-sm sample-btn" hidden aria-label="Play a/.test(home.body), 'GET / has the audio sample (a plain player without JS, a play button with it)');
const firstAdventure = home.body.search(/genre-adventure"/), lastMystery = home.body.lastIndexOf('genre-murder-mystery"');
ok(firstAdventure === -1 || lastMystery === -1 || lastMystery < firstAdventure, 'GET / lists mysteries first');

const dinner = await get('/stories/example-dinner-party');
ok(dinner.status === 200 && /<h1>The Last Toast<\/h1>/.test(dinner.body), 'GET /stories/example-dinner-party has the title');
ok(/id="copy"[^>]*>Copy the story</.test(dinner.body) && /id="story-text"/.test(dinner.body), 'the story page has the copy button and the story text');
ok(/CC BY-NC 4\.0/.test(dinner.body) && !/SRD 5\.2\.1/.test(dinner.body), 'the story page has the license line (no SRD line for a non-SRD story)');
const bell = await get('/stories/keepers-bell');
ok(bell.status === 200 && /System Reference Document 5\.2\.1/.test(bell.body) && /Creative Commons Attribution 4\.0/.test(bell.body), 'the SRD story page carries the SRD 5.2.1 CC BY 4.0 attribution');
const raw = await get('/stories/example-dinner-party/story.md');
ok(raw.status === 200 && /^---\nname: /.test(raw.body) && /Wrangler, check the secrets/.test(raw.body), 'GET /stories/<slug>/story.md serves the public story.md (paste-play text kept)');
const missing = await get('/stories/no-such-story');
ok(missing.status === 404, `unknown slug -> 404 (${missing.status})`);
const passengerPage = await get('/stories/example-dinner-party/passenger');
ok(passengerPage.status === 200 && /id="reveal-load"/.test(passengerPage.body) && /id="reveal-confirm"[^>]*hidden/.test(passengerPage.body) && /Spoiler: this shows the whole solution/.test(passengerPage.body),
  'the passenger page has a Full reveal button behind a spoiler confirm');
const privacy = await get('/privacy');
ok(privacy.status === 200 && /through an assistant/i.test(privacy.body) && /site-wide daily limit/.test(privacy.body) && !/sees the conversation/.test(privacy.body), 'the privacy page explains the IP cap for connector traffic');
const mcpNoKey = key && !openServer ? await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 98, method: 'tools/call', params: { name: 'list_stories', arguments: {} } }) }) : null;
ok(!mcpNoKey || mcpNoKey.status === 403, 'the site routes leave the MCP key lock in place');

const endingTexts = [], cueTexts = [];
for (const s of genStories) {
  for (const e of s.endings ?? []) endingTexts.push(e.text);
  if (s.full_reveal) endingTexts.push(...s.full_reveal.read_aloud.split(/\n\n+/), ...(s.full_reveal.afterward ?? '').split('\n'));
  for (const c of Object.values(s.cues ?? {})) cueTexts.push(c.read_aloud, c.narrator_only);
  if (s.listen_for_raw) cueTexts.push(s.listen_for_raw);
}
const needle = (t) => t.trim().replace(/^[-*]\s+/, '').replace(/\s+/g, ' ').slice(0, 120);
const endingNeedles = endingTexts.filter((t) => t && t.trim().length >= 25).map(needle);
const needles = [...endingNeedles, ...cueTexts.filter((t) => t && t.trim().length >= 25).map(needle)];
// Routes allowed to carry secret text, one answer at a time (the passenger page's JSON API, checked
// separately below). They are never part of the scan.
const SECRET_ROUTES_ALLOWED = [/^\/api\/stories\//];
const pages = ['/', '/games', '/preview', '/games/werewolf', '/connect', '/how-it-works', '/write', '/privacy', '/support', '/terms', '/robots.txt', '/sitemap.xml',
  ...slugs.flatMap((s) => [`/stories/${encodeURIComponent(s)}`, `/stories/${encodeURIComponent(s)}/story.md`, `/stories/${encodeURIComponent(s)}/passenger`]), '/stories/no-such-story']
  .filter((p) => !SECRET_ROUTES_ALLOWED.some((re) => re.test(p)));
const keyLineRe = /\((correct|wrong)\)|^\s*(Correct|Innocent)\.\s/im;
let leaks = 0;
for (const p of pages) {
  const text = unescape((await get(p)).body);
  const flat = text.replace(/\s+/g, ' ');
  const keyLine = keyLineRe.test(text);
  const hit = needles.some((n) => flat.includes(n));
  if (keyLine || hit) { leaks++; console.log(`FAIL  secret text on ${p} (${keyLine ? 'answer-key line' : 'ending/cue text'})`); }
}
ok(leaks === 0, `no answer-key line, Endings text, full reveal or cue text on any of ${pages.length} pages (${needles.length} secret snippets checked${genStories.length ? '' : '; generated data not found, key-line check only'})`);
// S13: the same scan over tool outputs. get_cue serves its own cue text by design, so its outputs
// are scanned for Endings and full-reveal text only.
let toolLeaks = 0;
for (const [label, out] of toolOutputs) {
  const flat = out.replace(/\s+/g, ' ');
  const scan = label.startsWith('get_cue') ? endingNeedles : needles;
  if (keyLineRe.test(out) || scan.some((n) => flat.includes(n))) { toolLeaks++; console.log(`FAIL  secret text in ${label}`); }
}
ok(toolLeaks === 0, `no answer-key line, Endings text or full reveal in ${toolOutputs.length} tool outputs (open_plot_speaks, list_stories, every start_story chapter, every get_cue)`);

// ---------------------------------------------------------------- passenger page API
// Endpoints answer one name or cue at a time; names must carry no Endings text at all.
const getJson = async (path) => { const r = await fetch(`${base}${path}`); let json = null; try { json = await r.json(); } catch {} return { status: r.status, type: r.headers.get('content-type') ?? '', json }; };
const names = await getJson('/api/stories/example-dinner-party/names');
ok(names.status === 200 && /application\/json/.test(names.type) && Array.isArray(names.json?.names) && names.json.names.some((n) => /Winterbourne/.test(n)), `GET /api/stories/<slug>/names lists the names (${names.status})`);
const nameList = Array.isArray(names.json?.names) ? names.json.names : [];
const namesRaw = JSON.stringify(names.json ?? {});
ok(Object.keys(names.json ?? {}).join() === 'names' && !/Correct\.|Innocent\./.test(namesRaw) && !needles.some((n) => namesRaw.includes(n.slice(0, 60))) && nameList.every((n) => n.length < 60),
  'names returns names only, no ending text');
ok(nameList.length > 0 && JSON.stringify([...nameList].sort((x, y) => x.localeCompare(y))) === JSON.stringify(nameList), 'names are sorted (secrets.md order gives nothing away)');
const checked = await getJson(`/api/stories/example-dinner-party/check?name=${encodeURIComponent('hale winterbourne')}`);
ok(checked.status === 200 && checked.json?.verdict === 'wrong' && /^Innocent\./.test(checked.json?.line ?? '') && Object.keys(checked.json).sort().join() === 'line,verdict', `GET .../check returns one verdict line (${checked.json?.verdict})`);
const misheardCheck = await getJson(`/api/stories/example-dinner-party/check?name=${encodeURIComponent('Mr Winterbourne')}`);
ok(misheardCheck.status === 200 && misheardCheck.json?.verdict === 'wrong', 'GET .../check uses the same matching as check_accusation');
const noMatch = await getJson('/api/stories/example-dinner-party/check?name=Nobody%20Atall');
ok(noMatch.status === 404 && noMatch.json?.error === 'no_match', `GET .../check with an unknown name is 404 JSON (${noMatch.status})`);
const reveal = await getJson('/api/stories/example-dinner-party/full-reveal');
const dinnerReveal = genStories.find((s) => s.slug === 'example-dinner-party')?.full_reveal;
ok(dinnerReveal ? reveal.status === 200 && typeof reveal.json?.read_aloud === 'string' && Object.keys(reveal.json).sort().join() === 'afterward,read_aloud' : reveal.status === 404,
  `GET .../full-reveal returns the full reveal (${reveal.status})`);
const advRevealApi = await getJson('/api/stories/keepers-bell/full-reveal');
ok(advRevealApi.status === 404 && advRevealApi.json?.error === 'no_reveal', 'GET .../full-reveal on an adventure is 404 JSON');
const apiCue = await getJson('/api/stories/keepers-bell/cue/s3');
const bellS3 = genStories.find((x) => x.slug === 'keepers-bell')?.cues?.S3;
ok(apiCue.status === 200 && typeof apiCue.json?.read_aloud === 'string' && Object.keys(apiCue.json).join() === 'read_aloud', `GET .../cue/<id> returns read_aloud only (${apiCue.status})`);
ok(!bellS3?.narrator_only || !JSON.stringify(apiCue.json).includes(bellS3.narrator_only.slice(0, 60)), 'the cue endpoint never returns the narrator notes');
const listen = await getJson('/api/stories/keepers-bell/listen');
ok(listen.status === 200 && Array.isArray(listen.json?.follow_ups) && listen.json.follow_ups.length > 0 && listen.json.follow_ups.every((r) => /^S\d+[a-z]?$/.test(r.cue)), 'GET .../listen returns the follow-up cue ids');
for (const path of ['/api/stories/no-such-story/names', '/api/stories/no-such-story/check?name=x', '/api/stories/keepers-bell/cue/S99', '/api/stories/no-such-story/cue/S1', '/api/stories/no-such-story/full-reveal']) {
  const r = await getJson(path);
  ok(r.status === 404 && /application\/json/.test(r.type) && typeof r.json?.error === 'string', `${path} -> 404 JSON (${r.status})`);
}

// ---------------------------------------------------------------- http -> https redirect
// Only meaningful when the server is reached over https (local dev is plain http, and exempt).
if (base.startsWith('https://')) {
  const plain = await fetch(base.replace(/^https:/, 'http:') + '/', { redirect: 'manual' });
  ok(plain.status === 301 && (plain.headers.get('location') ?? '').startsWith('https://'), `http:// redirects to https:// with 301 (${plain.status})`);
  const plainPost = await fetch(base.replace(/^https:/, 'http:') + '/mcp', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok(plainPost.status === 308, `a POST to http:// redirects with 308, keeping the method (${plainPost.status})`);
} else console.log('SKIP  http -> https redirect (base URL is not https)');

// ---------------------------------------------------------------- covers and submissions (M5)
const coverRes = await fetch(`${base}/covers/example-dinner-party.jpg`);
await coverRes.arrayBuffer();
ok(coverRes.status === 200 && /^image\//.test(coverRes.headers.get('content-type') ?? ''), `GET /covers/example-dinner-party.jpg is an image (${coverRes.status} ${coverRes.headers.get('content-type')})`);
const sampleRes = await fetch(`${base}/audio/sample-last-toast.mp3`);
const sampleBytes = (await sampleRes.arrayBuffer()).byteLength;
ok(sampleRes.status === 200 && /^audio\//.test(sampleRes.headers.get('content-type') ?? '') && sampleBytes > 50_000 && sampleBytes < 600_000,
  `GET /audio/sample-last-toast.mp3 is audio (${sampleRes.status} ${sampleRes.headers.get('content-type')}, ${Math.round(sampleBytes / 1024)} KB)`);
const sampleRange = await fetch(`${base}/audio/sample-last-toast.mp3`, { headers: { range: 'bytes=0-1' } });
ok(sampleRange.status === 206 && sampleRange.headers.get('content-range') === `bytes 0-1/${sampleBytes}` && (await sampleRange.arrayBuffer()).byteLength === 2,
  `the sample answers a byte-range request, as iOS Safari needs (${sampleRange.status} ${sampleRange.headers.get('content-range')})`);
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
const lintFail = await result('submit_story', { story_md: broken, author_name: 'Smoke Author' });
ok(isErr(lintFail) && /^Not submitted: the story has \d+ format error/.test(lintFail?.content?.[0]?.text ?? '') && /\[stop-phrase\]/.test(lintFail?.content?.[0]?.text ?? ''), 'submit_story refuses a lint-failing story (isError) and returns the errors');
const tooBig = await rpc('tools/call', { name: 'submit_story', arguments: { story_md: exampleMd, secrets_md: 'x'.repeat(30001) } });
ok(Boolean(tooBig.json?.error) || tooBig.json?.result?.isError === true, 'submit_story rejects secrets over 30,000 characters');

// A real submission, on dev only (the admin key is DEV_ACCESS_KEY there). The slug starts
// "smoke-test" (the dev marker), and the row is deleted again through the admin endpoint.
// Its hand-off uses typographic quotes, as assistant-drafted stories often do (review S10).
if (!openServer && key) {
  const stamp = Date.now().toString(36);
  const smokeMd = exampleMd
    .replace(/^name:\s*.+$/m, `name: plotspeaks-smoke-test-${stamp}`)
    .replace(/^(\s*title:\s*).+$/m, `$1Smoke Test ${stamp}`)
    .replace(/^# The Last Toast\s*$/m, `# Smoke Test ${stamp}`)
    .replace(/"Wrangler, check the secrets\."/g, '“Wrangler, check the secrets.”');
  const smokeSecrets = [
    '# Smoke test secrets', '', '## Endings detail', '',
    '- **Hale Winterbourne (wrong):** Innocent. Smoke test line for the innocent suspect.',
    '- **Smoke Target (correct):** Correct. Smoke test line for the culprit.', '',
    '## Full reveal', '', '**Read aloud:** Smoke test reveal, first paragraph.', '', 'Smoke test reveal, second paragraph.', '',
    '**What became of them:**', '- Smoke Target: Smoke test epilogue line.', '',
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
    const subPlay = (/Play id: ([0-9a-f-]{36})/.exec(subStart) || [])[1];
    ok(new RegExp(`narrator for "Smoke Test ${stamp}"`).test(subStart) && !/\((correct|wrong)\):\*\*/.test(subStart), 'start_story serves the approved submission without its answer key');
    ok(!/wrangler/i.test(subStart) && /check_accusation/.test(subStart), 'S10: the submission\'s curly-quoted wrangler hand-off is rewritten for the connector');
    ok(/^Story: Smoke Test /m.test(subStart) && !/^\s+author:/m.test(subStart), 'the submission is served with a one-line header instead of its front matter');
    const subPage = await get(`/stories/${slug}`);
    ok(subPage.status === 200 && subPage.body.includes('Smoke Author'), `the site credits the writer on the story page (${subPage.status})`);
    const subMd = await get(`/stories/${slug}/story.md`);
    ok(/^\s+author: "Smoke Author"$/m.test(subMd.body), 'the credited name is the approved story\'s metadata.author');
    const subReveal = await call('check_accusation', { slug, accused: 'Hale Winterbourne', play_id: subPlay });
    ok(/^Innocent\./.test(subReveal) && !/Smoke Target/.test(subReveal), 'check_accusation on a submission returns only the one ending line');
    const subSolution = await call('reveal_solution', { slug, play_id: subPlay });
    ok(/first paragraph/.test(subSolution) && /second paragraph/.test(subSolution) && /WHAT BECAME OF THEM/.test(subSolution), 'reveal_solution reads a submission\'s two-paragraph Full reveal and its epilogue');
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

// Usage monitoring (2026-10-16): the public health check, and the key-gated stats the Volocent
// admin dashboard and monitoring read. Prints counts' presence only.
await new Promise((r) => setTimeout(r, 1500)); // tallies are written after each reply goes out
const health = await fetch(`${base}/api/health`);
const healthJson = await health.json().catch(() => null);
ok(health.status === 200 && healthJson?.ok === true && healthJson?.db === 'ok' && Object.keys(healthJson).length === 3, `GET /api/health answers ok with the database up (${health.status})`);
const statsNoKey = await fetch(`${base}/admin/stats.json`);
await statsNoKey.arrayBuffer();
ok(statsNoKey.status === 403 || statsNoKey.status === 404, `GET /admin/stats.json without the admin key is refused (${statsNoKey.status})`);
if (!openServer && key) {
  const st = await fetch(`${base}/admin/stats.json?days=7`, { headers: { 'x-admin-key': key } });
  const rawStats = await st.text();
  let sj = null;
  try { sj = JSON.parse(rawStats); } catch {}
  ok(st.status === 200 && sj?.gate2?.target === 500 && typeof sj?.plays?.testers?.retained === 'number' && sj?.days === 7, `GET /admin/stats.json with the key returns the stats (${st.status})`);
  ok(sj?.plays?.testers?.retained > 0 && Array.isArray(sj?.assistants) && typeof sj?.submissions?.pending === 'number' && 'inWindow' in (sj?.ratings ?? {}), 'the stats count tester plays (this run included), assistants, submissions and ratings');
  ok(!/Endings detail|read_aloud|story_md|secrets_md|claim_hash|ip_hash/.test(rawStats), 'the stats carry no story text, answer keys or hashes');
  if (sj?.pageViews === null) console.log(`NOTE  page and MCP tallies are off: ${sj.countsNote}`);
  else {
    ok(sj?.pageViews?.crawlers > 0 && sj?.mcp?.testers?.requests > 0 && sj?.mcp?.testers?.calls?.some((c) => c.key === 'start_story'),
      `the tallies count this run (script page views as crawlers: ${sj?.pageViews?.crawlers}; tester MCP requests: ${sj?.mcp?.testers?.requests})`);
    ok(sj?.mcp?.testers?.errors > 0, `deliberate bad calls show as tester MCP errors (${sj?.mcp?.testers?.errors})`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
