// The Plot Speaks screen (MCP Apps) checks: node test/apps-check.mjs [mcp url]. Dev by default (uses the dev
// access key); pass https://plotspeaks.com/mcp for prod. Tool metadata, the ui:// view, and what each kind of
// result draws: covers, the menu, the trivia board, the story timeline, dice (never a hidden roll), wind-downs.
import fs from 'node:fs';
const URL_ = process.argv[2] || 'https://dev.plotspeaks.com/mcp';
const vars = fs.existsSync(new URL('../.dev.vars', import.meta.url)) ? fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8') : '';
const key = URL_.includes('dev.') ? /DEV_ACCESS_KEY\s*=\s*"?([^"\r\n]+)/.exec(vars)?.[1] : null;
const SCREEN = 'ui://plotspeaks/screen', KEY = 'plotspeaks/screen';
let sid = null, id = 0, bad = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) bad++; };
async function rpc(method, params, notify = false) {
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' };
  if (key) h['x-api-key'] = key;
  if (sid) h['mcp-session-id'] = sid;
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
  const r = await fetch(URL_, { method: 'POST', headers: h, body: JSON.stringify(body) });
  sid = r.headers.get('mcp-session-id') || sid;
  if (notify) return null;
  const t = await r.text(); const m = /data: (.*)/.exec(t);
  return JSON.parse(m ? m[1] : t);
}
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
const scr = (r) => r?._meta?.[KEY];
await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, clientInfo: { name: 'apps-check', version: '2' } });
await rpc('notifications/initialized', {}, true);

const tools = (await rpc('tools/list', {})).result.tools;
for (const t of ['open_plot_speaks', 'list_stories', 'start_story', 'game_board', 'game_question', 'game_answer', 'game_challenge', 'choose', 'check_accusation', 'reveal_solution', 'get_cue', 'roll'])
  ok(tools.find((x) => x.name === t)?._meta?.ui?.resourceUri === SCREEN, `${t} links the screen`);
ok(!tools.find((x) => x.name === 'rate_story')?._meta?.ui, 'rate_story links no screen');
const res = (await rpc('resources/list', {})).result?.resources ?? [];
ok(res.some((r) => r.uri === SCREEN) && res.some((r) => r.uri === 'ui://plotspeaks/trivia-board'), 'resources/list has the screen and the first URI');
const read = (await rpc('resources/read', { uri: SCREEN })).result?.contents?.[0];
ok(read?.mimeType === 'text/html;profile=mcp-app' && /ui\/initialize/.test(read?.text ?? ''), 'resources/read returns the app HTML');
ok(Array.isArray(read?._meta?.ui?.csp?.resourceDomains) && read._meta.ui.csp.resourceDomains.length === 1, 'the screen allows one image domain (the site)');
fs.writeFileSync(new URL('../board-app.out.html', import.meta.url), read?.text ?? '');

// The menu, as covers.
const menu = scr(await call('open_plot_speaks', { skip_intro: true }));
ok(menu?.kind === 'picker' && menu.stories.length >= 4, `open_plot_speaks shows the menu as ${menu?.stories?.length ?? 0} covers`);
const covers = new Set(menu?.stories?.map((x) => x.cover) ?? []);

// Trivia: the cover first, then the board.
const t0 = await call('start_story', { slug: 'trivia-geography' });
const s0 = scr(t0);
ok(s0?.kind === 'trivia' && s0.opening === true && s0.story?.cover?.endsWith('/covers/trivia-geography.jpg'), 'start_story (trivia) shows its cover and the board');
covers.add(s0?.story?.cover);
const pid = /Play id: ([0-9a-f-]{36})/.exec(t0.content[0].text)[1];
const q = scr(await call('game_question', { slug: 'trivia-geography', play_id: pid, category: 'Capitals', value: 100 }));
ok(q?.kind === 'trivia' && q.open?.category === 'Capitals' && q.last === null, 'game_question: the open clue, no answer');
const a = await call('game_answer', { slug: 'trivia-geography', play_id: pid, answer: 'Paris', player: 'Sam' });
const b2 = scr(a);
ok(b2?.last && b2.open?.value === 200, 'game_answer: the answer just ruled and the next clue');
ok(JSON.stringify(b2).split('"answer":').length === 2, 'only one answer on the board (the one just ruled)');
ok(/Ding|Bzzt/.test(a.content?.[0]?.text ?? ''), 'the text ruling is unchanged for hosts without a screen');

// The opening screen: the watch code with a QR code, and the play id and slug for the star rating.
ok(s0?.watch?.code && /^<svg[\s>]/.test(s0.watch.qr ?? '') && s0.watch.url.includes('/watch?code='), 'the opening shows the watch code with a QR code');
ok(s0?.slug === 'trivia-geography' && /^[0-9a-f-]{36}$/.test(s0?.playId ?? ''), 'the screen carries the slug and play id for the star rating');

// A flag clue carries its picture, and the picture never names the answer.
const fl = scr(await call('game_question', { slug: 'trivia-geography', play_id: pid, category: 'Flags', value: 100 }));
const pic = fl?.open?.image ?? '';
ok(/^<svg[\s>]/.test(pic), 'a flag clue carries its picture');
const fa = await call('game_answer', { slug: 'trivia-geography', play_id: pid, answer: 'I pass' });
const ans = /answer is ([^.]+)\./i.exec(fa.content[0].text)?.[1] ?? '';
ok(ans && !pic.toLowerCase().includes(ans.toLowerCase()), `the picture doesn't contain its answer (${ans || '?'})`);
ok(!/<(title|desc|text)\b/i.test(pic), 'the picture has no title, description or text');
const sh = scr(await call('game_question', { slug: 'trivia-geography', play_id: pid, category: 'Country Shapes', value: 100 }));
ok(/^<svg[\s>]/.test(sh?.open?.image ?? ''), 'a country-shape clue carries its outline');
const cap = scr(await call('game_question', { slug: 'trivia-geography', play_id: pid, category: 'Rivers and Lakes', value: 100 }));
ok(cap?.open && !cap.open.image, 'other clues carry no picture');

// Quick fire: the tally.
const qf = scr(await call('start_story', { slug: 'trivia-general', minutes: 5 }));
ok(qf?.kind === 'trivia' && qf.mode === 'quick' && qf.quickMax === 12 && qf.categories.length === 0, 'a sized quick fire shows the tally (of 12)');

// A mystery: the cover, then the timeline with the accusation.
const m0 = await call('start_story', { slug: 'example-dinner-party' });
const ms = scr(m0);
ok(ms?.kind === 'timeline' && ms.opening && ms.story?.cover?.endsWith('/covers/example-dinner-party.jpg'), 'start_story (mystery) shows its cover and the timeline');
covers.add(ms?.story?.cover);
const mpid = /Play id: ([0-9a-f-]{36})/.exec(m0.content[0].text)[1];
const acc = scr(await call('check_accusation', { slug: 'example-dinner-party', accused: 'Father Reyes', play_id: mpid }));
ok(acc?.kind === 'timeline' && acc.events.some((e) => /^Accused Father Reyes: (innocent|correct)$/.test(e.label)), 'check_accusation: the timeline shows the accusation and its verdict');
ok(!/solution|culprit|murderer/i.test(JSON.stringify(acc.events)), 'the timeline names no solution');

// Dice: shown when the players hear it, never when hidden.
const r1 = await call('roll', { dice: '1d20+3', why: 'Stealth check' });
ok(scr(r1)?.kind === 'roll' && typeof scr(r1).total === 'number', 'roll shows the dice and the total');
const r2 = await call('roll', { dice: '1d6', hidden: true });
ok(!scr(r2), 'a hidden roll shows nothing');

// A wind-down: the breathing guide.
const w = scr(await call('start_story', { slug: 'winddown-breathing-count' }));
ok(w?.kind === 'winddown' && w.story?.cover, 'a wind-down shows its cover and the breathing guide');
covers.add(w?.story?.cover);

// Every cover the screen named loads.
for (const c of [...covers].filter(Boolean)) {
  const r = await fetch(c, { method: 'GET' });
  ok(r.ok && /image\//.test(r.headers.get('content-type') ?? ''), `cover loads: ${c.split('/').pop()}`);
}
fs.writeFileSync(new URL('../board-sample.out.json', import.meta.url), JSON.stringify({ trivia: b2, timeline: acc, picker: menu, roll: scr(r1), quick: qf, opening: s0, flag: fl, shape: sh }, null, 1));
console.log(bad ? `${bad} FAILED` : 'all checks passed');
