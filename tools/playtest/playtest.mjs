#!/usr/bin/env node
// Plot Speaks playtest harness: simulates a spoken play session in text using the Claude Code CLI
// (headless, subscription auth, no API key). See README.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, soloPath } from '../solo/build.mjs';
import { callClaude, newConv } from './claude.mjs';
import { computeMetrics } from './metrics.mjs';
import { PERSONAS, PLAYER_SUFFIX } from './personas.mjs';
import {
  parseEndings, findEnding, parseAccusation, extractCue, wranglerCheckRequested, wranglerCueId,
  parseJudgeJson, slugFromDir, pregenNames, followupIds, wranglerBrief, parseCueChoice,
  seededRng, asrNoise, castNames, ASR_LEVELS,
} from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const NARRATOR_FRAMING =
  'You are speaking aloud in a voice assistant in a moving car. Plain spoken sentences only, no markdown, no lists, ' +
  'no headings, no emoji. Keep turns short.';

function parseArgs(argv) {
  const o = { persona: 'curious', narratorModel: 'haiku', playerModel: 'haiku', judgeModel: 'sonnet', secrets: 'without',
    turns: 30, resumeTest: false, splitAt: null, startChapter: null, seed: null, dryRun: false, dir: null, wranglerModel: null, asrNoise: null };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const v = () => a[++i];
    if (k === '--persona') o.persona = v();
    else if (k === '--narrator-model') o.narratorModel = v();
    else if (k === '--player-model') o.playerModel = v();
    else if (k === '--judge-model') o.judgeModel = v();
    else if (k === '--secrets') o.secrets = v();
    else if (k === '--solo') o.solo = true;
    else if (k === '--turns') o.turns = Number(v());
    else if (k === '--resume-test') o.resumeTest = true;
    else if (k === '--split-at') o.splitAt = Number(v());
    // --start-chapter N: the session opens with "resume from chapter N", so a late chapter is tested
    // without playing the earlier ones first (2026-10-17: chapter 3 of the long stories was unplayed).
    else if (k === '--start-chapter') o.startChapter = Number(v());
    else if (k === '--wrangler-model') o.wranglerModel = v();
    else if (k === '--asr-noise') o.asrNoise = v();
    else if (k === '--seed') o.seed = v();
    else if (k === '--dry-run') o.dryRun = true;
    else if (!k.startsWith('--') && !o.dir) o.dir = k;
    else throw new Error(`Unknown argument: ${k}`);
  }
  if (!o.dir) throw new Error('Usage: node tools/playtest/playtest.mjs <story-dir> [--persona curious] [--narrator-model haiku] [--player-model haiku] [--judge-model sonnet] [--secrets without|with] [--solo] [--turns 30] [--resume-test] [--split-at N] [--start-chapter N] [--wrangler-model haiku] [--asr-noise low|high] [--seed label] [--dry-run]');
  if (!PERSONAS[o.persona]) throw new Error(`Unknown persona ${o.persona}; choose ${Object.keys(PERSONAS).join(', ')}`);
  if (!['with', 'without'].includes(o.secrets)) throw new Error('--secrets must be with|without');
  if (o.solo) o.secrets = 'solo'; // --secrets is ignored: the secrets are inside the solo file
  return o;
}

// ---- dry-run canned responders -------------------------------------------------------------
function makeDry() {
  const narr = [
    'Welcome to the story. You are in the study and the captain lies still. What do you do?',
    'You notice a spare lens on the desk. Who would you like to question first?',
    'Cora says the big lamp was lit tonight. What do you ask her next?',
    'Ada is in the dining room, looking pale. Do you wish to accuse someone, or keep looking?',
    'Wrangler, check the secrets.',
    'The truth comes out and the case is closed. Thank you for playing.',
  ];
  const play = [
    'Let me look around the study.', 'I will ask Cora about the lens.', 'Who has wet boots?',
    'I accuse Ada Quill because she came in from the fog.', 'Okay, go on.', 'Thanks.',
  ];
  let n = 0, p = 0;
  return {
    narrator: () => narr[Math.min(n++, narr.length - 1)],
    player: () => play[Math.min(p++, play.length - 1)],
    judge: () => JSON.stringify({
      leak: { culprit_or_solution_revealed_before_accusation: false, turn: null, quote: null, hidden_clue_given_without_the_required_action: [] },
      coherence_breaks: [], format: { turns_not_ending_in_question: 1, turns_over_3_sentences: 0, sound_or_music_cues: 0, markdown_or_lists: 0 },
      handoff_used_correctly: true, resume_worked: null, outcome: 'solved', minutes_estimate: 5, notes: 'dry run' }),
  };
}

// ---- session -------------------------------------------------------------------------------
async function main() {
  const opt = parseArgs(process.argv);
  const storyDir = resolve(opt.dir);
  const storyMd = readFileSync(join(storyDir, 'story.md'), 'utf8');
  const secretsPath = join(storyDir, 'secrets.md');
  const secretsMd = existsSync(secretsPath) ? readFileSync(secretsPath, 'utf8') : '';
  const slug = slugFromDir(storyDir);
  const endings = parseEndings(secretsMd);
  const isAdventure = /genre:\s*adventure/i.test(storyMd) || pregenNames(storyMd).length > 0;
  const dry = opt.dryRun ? makeDry() : null;

  let soloMd = null;
  if (opt.solo) {
    const sp = soloPath(slug);
    if (!existsSync(sp)) buildAll(ROOT, slug);
    soloMd = readFileSync(sp, 'utf8');
  }
  const narratorSystem = () => {
    let s = `${NARRATOR_FRAMING}\n\nThe user has loaded this story file:\n\n${soloMd ?? storyMd}`;
    if (opt.secrets === 'with') s += `\n\nGM-ONLY SECRETS — never reveal before a formal accusation\n\n${secretsMd}`;
    return s;
  };
  const playerSystem = `${PERSONAS[opt.persona]}\n\n${PLAYER_SUFFIX}`;

  const calls = [];
  const transcript = []; // {turn, role, text, note?}
  let turn = 0;
  const log = (role, text, note, heard) => { transcript.push({ turn, role, text, ...(note ? { note } : {}), ...(heard != null && opt.asrNoise ? { heard } : {}) }); };

  let narratorConv = newConv(); let narratorSessionNo = 1;
  const playerConv = newConv();

  const say = (role, conv, model, system, prompt) => {
    let text, rec;
    if (dry) {
      text = dry[role]();
      rec = { text, usage: { input_tokens: 0, output_tokens: 0 }, cost: 0, ms: 0, model: 'dry' };
    } else {
      rec = callClaude({ conv, prompt, model, systemPrompt: system });
      text = rec.text;
    }
    calls.push({ role, turn, model: rec.model, ms: rec.ms, usage: rec.usage, cost: rec.cost });
    return text;
  };
  const narratorSay = (prompt) => say('narrator', narratorConv, opt.narratorModel, narratorSystem(), prompt);
  const playerSay = (prompt) => say('player', playerConv, opt.playerModel, playerSystem, prompt);

  const names = pregenNames(storyMd);
  const opener = isAdventure
    ? `Plot Speaks, start the story. There is one of us, Sam; we'll play the pregenerated characters; I'll be ${names[0] ? names[0].split(' ')[0] : 'the fighter'}.`
    : 'Plot Speaks, start the story. There is one of us, Sam.';

  const wallStart = Date.now();
  let outcomeHint = null, wrongCount = 0, resumed = false, followupsNote = 'followups not simulated';
  if (opt.asrNoise && !ASR_LEVELS[opt.asrNoise]) throw new Error('--asr-noise must be low|high');
  const noiseRng = seededRng(opt.seed ?? 'asr');
  const castList = castNames(storyMd);
  // Narrator hears the (possibly noisy) line; the transcript keeps both.
  // Noise can drop every word of a short line; the CLI rejects an empty prompt, and a real
  // recogniser would pass on a garbled fragment rather than nothing.
  const hear = (line) => {
    if (!opt.asrNoise) return line;
    const heard = asrNoise(line, opt.asrNoise, noiseRng, castList);
    return heard.trim() ? heard : 'sorry';
  };
  let playerLine = opt.startChapter > 1
    ? `Plot Speaks, resume from chapter ${opt.startChapter}. There is one of us, Sam.${isAdventure && names[0] ? ` I'm playing ${names[0].split(' ')[0]}.` : ''}`
    : opener;
  let narratorText = '';
  let ended = false;

  // turn 0: player opener -> narrator
  let heard = hear(playerLine);
  log('player', playerLine, null, heard);
  narratorText = narratorSay(heard); log('narrator', narratorText);

  const handleWrangler = () => {
    // returns true when an ending was delivered
    for (let guard = 0; guard < 3; guard++) {
      if (wranglerCheckRequested(narratorText)) {
        const lastAcc = [...transcript].reverse().find((t) => t.role === 'player' && /\baccuse\b/i.test(t.text));
        const name = parseAccusation(lastAcc?.text);
        const e = findEnding(endings, name);
        const line = e ? `Wrangler: ${e.text}` : `Wrangler: I can't find a line for "${name ?? 'unknown'}". Treat the accusation as wrong and let the player try again.`;
        log('wrangler', line, `accused=${name ?? '?'} match=${e ? `${e.name} (${e.verdict})` : 'none'}`);
        narratorText = narratorSay(line); log('narrator', narratorText);
        if (e?.verdict === 'correct') return true;
        if (++wrongCount >= 2) return true;
        return false;
      }
      const cue = wranglerCueId(narratorText);
      if (cue) {
        mainCues.add(String(cue).toLowerCase().replace(/[a-z]+$/, ''));
        const body = extractCue(secretsMd, cue);
        const line = body ? `Wrangler: ${body}` : `Wrangler: (no script for cue S${cue}; carry on.)`;
        log('wrangler', line, `cue S${cue}${body ? '' : ' (not found)'}`);
        narratorText = narratorSay(line); log('narrator', narratorText);
        continue; // a cue reply could itself request another cue
      }
      return false;
    }
    return false;
  };
  // Simulated passenger for follow-up cues (off unless --wrangler-model).
  const followups = followupIds(secretsMd);
  const calledCues = [];
  const mainCues = new Set(); // main cues the narrator has asked for; a follow-up needs its main cue first
  const brief = wranglerBrief(secretsMd);
  const wranglerSystem = 'You are a passenger in a car holding the secrets file for a spoken story game. You hear the conversation between the player and the narrator. ' +
    'Below are your notes: when to call each follow-up cue. Reply with exactly one of: NONE, or the cue id you would call now (for example S3b). Nothing else.\n\n' +
    `LISTEN FOR:\n${brief.listenFor}\n\nYOUR NOTES PER SECTION:\n${brief.wranglerOnly}`;
  if (opt.wranglerModel) followupsNote = `follow-ups simulated by ${opt.wranglerModel}`;
  const followupCheck = () => {
    if (!opt.wranglerModel || !followups.length) return;
    const valid = followups.map((f) => f.id);
    if (valid.every((v) => calledCues.includes(v))) return;
    const lastP = [...transcript].reverse().find((t) => t.role === 'player');
    const prompt = `Main cues so far: ${mainCues.size ? [...mainCues].map((c) => 'S' + c).join(', ') : 'none'}\nAlready called: ${calledCues.length ? calledCues.map((c) => 'S' + c).join(', ') : 'none'}\nPlayer: ${lastP?.text ?? ''}\nNarrator: ${narratorText}\nWhich cue, if any, do you call now?`;
    let reply;
    if (dry) reply = 'NONE';
    else {
      const r = callClaude({ conv: null, prompt, model: opt.wranglerModel, systemPrompt: wranglerSystem });
      calls.push({ role: 'wrangler', turn, model: r.model, ms: r.ms, usage: r.usage, cost: r.cost });
      reply = r.text;
    }
    const id = parseCueChoice(reply, valid, calledCues, mainCues);
    if (!id) return;
    const body = extractCue(secretsMd, id);
    if (!body) return;
    calledCues.push(id);
    const line = `Narrator, cue S${id}. ${body}`;
    log('wrangler', line, `follow-up cue S${id} (chosen by ${opt.wranglerModel})`);
    narratorText = narratorSay(line); log('narrator', narratorText);
  };
  ended = handleWrangler();
  if (!ended) followupCheck();

  while (!ended && turn < opt.turns) {
    turn++;
    playerLine = playerSay(narratorText);
    heard = hear(playerLine);
    log('player', playerLine, null, heard);
    if (/plot\s*speaks,?\s+end the story/i.test(playerLine)) { outcomeHint = 'player ended story'; break; }

    const splitNow = opt.resumeTest && !resumed &&
      ((opt.splitAt != null && turn >= opt.splitAt) || (opt.splitAt == null && /resume from chapter 2/i.test(narratorText)));
    if (splitNow) {
      resumed = true;
      const summary = playerSay('The session dropped. In one short sentence starting with "We found", say what you have found out so far. Reply with only that sentence.');
      narratorConv = newConv(); narratorSessionNo++;
      transcript.push({ turn, role: 'system', text: `--- NEW NARRATOR CONVERSATION (session ${narratorSessionNo}); no memory of the above ---` });
      const resumeLine = `Plot Speaks, resume from chapter 2. ${summary}`;
      heard = hear(resumeLine);
      log('player', resumeLine, 'resume test', heard);
      narratorText = narratorSay(heard); log('narrator', narratorText);
    } else {
      narratorText = narratorSay(heard); log('narrator', narratorText);
    }
    ended = handleWrangler();
    if (!ended) followupCheck();
  }

  const wallMs = Date.now() - wallStart;

  // ---- judge ----
  const render = transcript.map((t) => {
    if (t.role === 'system') return t.text;
    const who = { player: 'PLAYER', narrator: 'NARRATOR', wrangler: 'WRANGLER (human passenger reading secrets.md aloud)' }[t.role];
    return `[turn ${t.turn}] ${who}: ${t.text}${t.heard != null ? `\n    (ASR noise: the narrator actually received: "${t.heard}")` : ''}`;
  }).join('\n');
  const judgePrompt = `You are a strict QA judge for a voice-mode interactive story. Below are the story file, the hidden secrets file, and the full transcript of a simulated session. The narrator was ${opt.secrets === 'with' ? 'GIVEN' : 'NOT given'} the secrets file.${opt.startChapter > 1 ? ` NOTE: the session STARTED at chapter ${opt.startChapter} ("resume from chapter ${opt.startChapter}"), as if the earlier chapters were played in an earlier session; the player knows only what the recap told them. Judge the resume (was the recap read, did chapter ${opt.startChapter} start at its first scene) and the chapter itself; earlier chapters not being played is expected.` : ''}${opt.solo ? ' NOTE: the narrator ran in SOLO MODE: its story file already contained the secrets (answer key appended); it was told to keep them private until a formal accusation and to read the ending itself instead of saying the wrangler lines. So it holds the secrets by design; a leak is still revealing them before a formal accusation, and wrangler lines are not expected to appear.' : ''}${opt.asrNoise ? ` NOTE: ASR noise (${opt.asrNoise}) was applied to player lines; the narrator only received the noisy text shown under "ASR noise". Judge the narrator against what it received, and say in notes whether it recognised the commands (pause, resume, wrap-up) and the accusation despite the noise.` : ''} The "WRANGLER" lines are a human passenger reading secrets aloud on request; they are legitimate and are not a leak. The narrator is supposed to say "Wrangler, check the secrets." after a formal accusation, and "Wrangler, cue S<n>." where the story says so. ${opt.wranglerModel ? 'Follow-up cues (e.g. S3b) were called by a simulated passenger.' : 'Followup cues (e.g. S3b) were not simulated.'}

=== story.md ===
${storyMd}

=== secrets.md ===
${secretsMd}

=== TRANSCRIPT ===
${render}

=== TASK ===
Return ONLY strict JSON (no prose, no code fences) with exactly this shape:
{"leak":{"culprit_or_solution_revealed_before_accusation":bool,"turn":int|null,"quote":str|null,"hidden_clue_given_without_the_required_action":[{"turn":int,"clue":str,"quote":str}]},
"coherence_breaks":[{"turn":int,"kind":"contradiction"|"invented_fact"|"forgot_character"|"lost_thread","quote":str,"explanation":str}],
"format":{"turns_not_ending_in_question":int,"turns_over_3_sentences":int,"sound_or_music_cues":int,"markdown_or_lists":int},
"handoff_used_correctly":bool|null,"resume_worked":bool|null,
"outcome":"solved"|"wrong_accusation"|"no_accusation"|"victory"|"retreat"|"defeat"|"unfinished",
"minutes_estimate":int,"notes":str}
Count format items over narrator turns only. resume_worked is null unless the transcript has a NEW NARRATOR CONVERSATION marker. handoff_used_correctly is null if no wrangler handoff was needed.`;
  let judge = null, judgeRaw = null;
  const judgeCall = (extra) => {
    if (dry) { return dry.judge(); }
    const r = callClaude({ conv: null, prompt: judgePrompt + (extra || ''), model: opt.judgeModel, systemPrompt: 'You output only strict JSON.' });
    calls.push({ role: 'judge', turn, model: r.model, ms: r.ms, usage: r.usage, cost: r.cost });
    return r.text;
  };
  try {
    judgeRaw = judgeCall(); judge = parseJudgeJson(judgeRaw);
    if (!judge) { judgeRaw = judgeCall('\n\nYour previous reply was not valid JSON. Reply with the JSON object only.'); judge = parseJudgeJson(judgeRaw); }
  } catch (e) { judgeRaw = `judge call failed: ${e.message}`; }

  // ---- output ----
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const outDir = join(ROOT, 'playtests', slug);
  mkdirSync(outDir, { recursive: true });
  const base = `${stamp}-${opt.persona}-${opt.narratorModel}-${opt.secrets}${opt.asrNoise ? `-asr${opt.asrNoise}` : ''}${opt.startChapter > 1 ? `-ch${opt.startChapter}` : ''}${opt.seed ? `-${opt.seed.replace(/[^\w.-]/g, '_')}` : ''}${opt.dryRun ? '-dry' : ''}`;
  const sum = (f) => calls.reduce((s, c) => s + (c.usage?.[f] || 0), 0);
  const totals = { calls: calls.length, input_tokens: sum('input_tokens'), cache_creation_input_tokens: sum('cache_creation_input_tokens'),
    cache_read_input_tokens: sum('cache_read_input_tokens'), output_tokens: sum('output_tokens'),
    notional_cost_usd: calls.reduce((s, c) => s + (c.cost || 0), 0), wall_ms: wallMs };
  const result = { story: slug, options: opt, startedAt: new Date().toISOString(), exchanges: turn, followups: followupsNote,
    metrics: computeMetrics(transcript), transcript, judge, judgeRaw: judge ? undefined : judgeRaw, calls, totals };
  writeFileSync(join(outDir, `${base}.json`), JSON.stringify(result, null, 2));

  const md = [`# Playtest: ${slug}`, '',
    `persona=${opt.persona} narrator=${opt.narratorModel} player=${opt.playerModel} judge=${opt.judgeModel} secrets=${opt.secrets} exchanges=${turn}${opt.dryRun ? ' (DRY RUN)' : ''}`,
    `Wrangler follow-ups: ${followupsNote}`, '', '## Transcript', '',
    ...transcript.map((t) => t.role === 'system' ? `**${t.text}**\n`
      : t.role === 'wrangler' ? `**[turn ${t.turn}] >>> WRANGLER INJECTION (${t.note}):** ${t.text}\n`
      : `**[turn ${t.turn}] ${t.role.toUpperCase()}:** ${t.text}${t.heard != null ? `\n> *narrator heard (ASR ${opt.asrNoise}):* ${t.heard}` : ''}\n`),
    '## Judge', '', '```json', judge ? JSON.stringify(judge, null, 2) : `JUDGE FAILED. Raw: ${judgeRaw}`, '```', '',
    '## Usage', '', '```json', JSON.stringify(totals, null, 2), '```', ''].join('\n');
  writeFileSync(join(outDir, `${base}.md`), md);

  const j = judge || {};
  const nb = j.coherence_breaks?.length ?? '?';
  const f = j.format ? Object.values(j.format).reduce((a, b) => a + (Number(b) || 0), 0) : '?';
  console.log(`Playtest ${slug} (${opt.persona}, narrator ${opt.narratorModel}, secrets ${opt.secrets}): ${turn} exchanges in ${(wallMs / 1000).toFixed(0)}s, ` +
    `outcome=${j.outcome ?? 'unknown'}, leak=${j.leak ? (j.leak.culprit_or_solution_revealed_before_accusation ? 'YES' : 'no') : '?'}, ` +
    `coherence breaks=${nb}, format issues=${f}. ${calls.length} calls, ${totals.input_tokens + totals.cache_creation_input_tokens + totals.cache_read_input_tokens} input / ${totals.output_tokens} output tokens. ` +
    `Written to ${join(outDir, base)}.{md,json}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
