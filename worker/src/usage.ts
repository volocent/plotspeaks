// Usage tallies (2026-10-16): page views and MCP request outcomes per UTC day, for the key-gated
// /admin/stats.json (src/stats.ts) that the admin dashboard and daily monitoring read. Our own D1
// counts: no analytics script, no cookie.
//
// Counts only. One row per (day, kind, key) in D1 table daily_counts (migration 0004) holds a
// number; no IP address, user agent, play id or anything else about a person is written here.
// Tallying must never break a page or a tool call: every failure is swallowed, and while the
// table is missing (code deployed before its migration) the first failure switches tallying off
// for that isolate instead of logging an error on every request.

export const TOOL_NAMES = new Set([
  "open_plot_speaks", "list_stories", "claim_plays", "my_history", "start_story", "choose", "game_board", "game_question", "game_answer", "game_challenge", "roll", "world_recall", "world_update", "check_accusation", "reveal_solution", "get_cue", "rate_story",
  "write_story", "review_story", "submit_story", "withdraw_submission", "team_roster", "request_team", "pick_for_me",
]);

// MCP methods named in the error tallies; anything else a client sends is "other", so the keys stay few.
const RPC_METHODS = new Set([
  "initialize", "ping", "tools/list", "tools/call", "prompts/list", "prompts/get", "resources/list",
  "resources/read", "resources/templates/list", "completion/complete", "logging/setLevel",
]);

const KNOWN_PAGES = new Set(["games", "connect", "how-it-works", "write", "privacy", "support", "terms", "preview"]);

// Search engines, link previews, uptime checks and scripts (the smoke test, monitoring) are
// counted apart from people, so the page-view numbers mean visits.
const NOT_A_PERSON = /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|node|undici|axios|go-http|headless|lighthouse|monitor|uptime|^$/i;

let tableMissing = false;

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function bump(db: D1Database | undefined, items: [kind: string, key: string][], now = Date.now()): Promise<void> {
  if (!db || tableMissing || !items.length) return;
  const day = today(now);
  try {
    await db.batch(items.map(([kind, key]) =>
      db.prepare("INSERT INTO daily_counts (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT (day, kind, key) DO UPDATE SET n = n + 1")
        .bind(day, kind, key.slice(0, 60))));
  } catch (e) {
    if (/no such table/i.test(String(e))) tableMissing = true;
    else console.log(JSON.stringify({ event: "usage_error", message: String(e).slice(0, 200) }));
  }
}

/** The page group a site path belongs to, or null for paths that aren't pages. */
export function pageOf(pathname: string): { page: string; slug?: string } | null {
  const path = pathname.replace(/(.)\/$/, "$1");
  if (path === "/" || path === "/index.html") return { page: "home" };
  const m = /^\/stories\/([a-z0-9-]+)(\/story\.md|\/passenger)?$/.exec(path);
  if (m) return { page: m[2] === "/story.md" ? "story.md" : m[2] ? "passenger" : "story", slug: m[1] };
  const first = path.slice(1);
  return KNOWN_PAGES.has(first) ? { page: first } : null;
}

/** Tally one successful page response (GET, 2xx). */
export function countPage(db: D1Database | undefined, request: Request, res: Response): Promise<void> {
  if (request.method !== "GET" || res.status < 200 || res.status >= 300) return Promise.resolve();
  const p = pageOf(new URL(request.url).pathname);
  if (!p) return Promise.resolve();
  // The QA browsers (Hank on dev, Becky on prod; .mcp.json) aren't visitors or crawlers: not counted.
  if (/PlotSpeaks-QA\//.test(request.headers.get("user-agent") ?? "")) return Promise.resolve();
  if (NOT_A_PERSON.test(request.headers.get("user-agent") ?? "")) return bump(db, [["crawler", p.page]]);
  const items: [string, string][] = [["page", p.page]];
  if (p.page === "story" && p.slug) items.push(["story_page", p.slug]);
  return bump(db, items);
}

type RpcMsg = { id?: unknown; method?: unknown; params?: { name?: unknown } };

/**
 * Tally one MCP POST: the request, each tools/call by tool, and every error in the response (a
 * JSON-RPC error, or a tool result with isError). Reads a clone of the response, so it runs in
 * waitUntil without holding up the reply. Testers (requests with the access key) go under their
 * own kind, so smoke tests' deliberate errors don't count against strangers.
 */
export async function countMcp(db: D1Database | undefined, msgs: RpcMsg[], res: Response | null, tester: boolean, failure?: "exception" | "rejected"): Promise<void> {
  const kind = tester ? "mcp_tester" : "mcp";
  const items: [string, string][] = [[kind, "requests"]];
  if (failure) {
    items.push([kind, failure]);
    return bump(db, items);
  }
  const toolOf = (m: RpcMsg) => {
    const name = typeof m.params?.name === "string" ? m.params.name : "";
    return TOOL_NAMES.has(name) ? name : "other";
  };
  const byId = new Map<string, RpcMsg>();
  for (const m of msgs) {
    if (m && m.method === "tools/call") items.push([kind, `call:${toolOf(m)}`]);
    if (m && m.id !== undefined && m.id !== null) byId.set(String(m.id), m);
  }
  if (res) {
    if (res.status >= 500) items.push([kind, "http_5xx"]);
    else if (res.status >= 400) items.push([kind, "http_4xx"]);
    try {
      const raw = await res.text();
      const bodies = /^\s*[[{]/.test(raw) ? [raw] : raw.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5));
      for (const b of bodies) {
        let parsed: unknown;
        try { parsed = JSON.parse(b); } catch { continue; }
        for (const r of (Array.isArray(parsed) ? parsed : [parsed]) as { id?: unknown; error?: unknown; result?: { isError?: unknown } }[]) {
          if (!r || (!r.error && r.result?.isError !== true)) continue;
          const req = r.id !== undefined && r.id !== null ? byId.get(String(r.id)) : undefined;
          if (req?.method === "tools/call") items.push([kind, `error:${toolOf(req)}`]);
          else items.push([kind, `rpc_error:${!req ? "unknown" : RPC_METHODS.has(String(req.method)) ? String(req.method) : "other"}`]);
        }
      }
    } catch { /* an unreadable body is not worth an error of its own */ }
  }
  return bump(db, items);
}
