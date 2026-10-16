// Thin wrapper around the Claude Code CLI in headless mode (subscription auth, no API key).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export function findClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const root = join(process.env.USERPROFILE || process.env.HOME || '', '.vscode', 'extensions');
  if (existsSync(root)) {
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const d of dirs.reverse()) {
      const p = join(root, d, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
      if (existsSync(p)) return p;
    }
  }
  return 'claude';
}

// Empty cwd so no project CLAUDE.md loads. Removed when the process ends: the system-prompt files
// written here hold story text and, in --solo / --secrets runs, the answer key.
export const EMPTY_CWD = mkdtempSync(join(tmpdir(), 'plotspeaks-playtest-'));
process.on('exit', () => { try { rmSync(EMPTY_CWD, { recursive: true, force: true }); } catch { /* best effort */ } });

/**
 * One CLI call. `conv` is {id, started}; the first call uses --session-id, later ones --resume.
 * The prompt goes over stdin; the system prompt through a file (Windows command lines cap at ~32k chars).
 */
export function callClaude({ conv, prompt, model, systemPrompt, bin = findClaudeBin(), timeoutMs = 300000 }) {
  // An empty prompt on a resumed session makes the CLI error out; send a filler instead.
  if (!String(prompt ?? '').trim()) prompt = '(no answer)';
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '',
    '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands'];
  let promptFile = null;
  if (systemPrompt) {
    promptFile = join(EMPTY_CWD, `sp-${randomUUID()}.txt`);
    writeFileSync(promptFile, systemPrompt);
    args.push('--system-prompt-file', promptFile);
  }
  if (conv) {
    if (conv.started) args.push('--resume', conv.id);
    else args.push('--session-id', conv.id);
  }
  const t0 = Date.now();
  let r;
  try {
    r = spawnSync(bin, args, { input: prompt, cwd: EMPTY_CWD, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } finally {
    // The CLI has read it by now; the answer key must not sit in the temp folder.
    if (promptFile) { try { unlinkSync(promptFile); } catch { /* already gone */ } }
  }
  const ms = Date.now() - t0;
  if (r.error) throw new Error(`claude spawn failed: ${r.error.message}`);
  let j;
  try { j = JSON.parse(r.stdout); } catch {
    throw new Error(`claude returned non-JSON (exit ${r.status}): ${(r.stdout || '').slice(0, 300)} ${(r.stderr || '').slice(0, 300)}`);
  }
  if (j.is_error) throw new Error(`claude error: ${String(j.result).slice(0, 300)}`);
  if (conv) conv.started = true;
  return { text: String(j.result ?? '').trim(), sessionId: j.session_id, usage: j.usage, cost: j.total_cost_usd, ms, model };
}

export function newConv() { return { id: randomUUID(), started: false }; }
