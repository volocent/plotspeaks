// Optional accounts: Sign in with Google (Ben, 2026-10-17).
//
// Nothing needs an account. Signing in adds a memory: what you've played (so you can ask for "a
// mystery I haven't done"), trivia clues you've already heard (so a board deals new ones), and
// campaigns you can pick up without a code. The site signs in at /auth/google/start; the account
// connector (account.plotspeaks.com/mcp, OAuth via @cloudflare/workers-oauth-provider) sends you
// through the same Google sign-in on its own host. Both find the same person by Google's account id.
//
// Stored: a user row (Google's id, email, name), sessions (only a SHA-256 of the cookie), and the
// history tables. Google tokens are not kept. Deleting the account removes all of it.

export type User = { id: string; email: string | null; name: string | null };
export type AuthEnv = {
  DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
};

const SESSION_COOKIE = "ps_session";
const FLOW_COOKIE = "ps_signin";
const SESSION_DAYS = 90;
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
const hmac = async (secret: string, s: string) => {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(s))));
};
const cookie = (req: Request, name: string) => (req.headers.get("cookie") ?? "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.slice(1).join("=") ?? null;
const setCookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const signInConfigured = (env: AuthEnv) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET && env.DB);
// Only a path on this same site: parsed as a URL against a placeholder origin, so a query with "+",
// ":" or "," (an OAuth request's) survives, and "//evil" or "/\evil" can't leave the site.
const safeNext = (next: string | null) => {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/account";
  try {
    const u = new URL(next, "https://same.invalid");
    return u.origin === "https://same.invalid" ? u.pathname + u.search : "/account";
  } catch { return "/account"; }
};

/** Starts Google sign-in. The state, PKCE verifier and return path ride in a short, signed cookie. */
export async function startSignIn(req: Request, env: AuthEnv): Promise<Response> {
  if (!signInConfigured(env)) return new Response("Sign-in isn't set up yet.\n", { status: 503, headers: { "content-type": "text/plain" } });
  const url = new URL(req.url);
  const state = random(16), verifier = random(48), next = safeNext(url.searchParams.get("next"));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
  const payload = b64url(enc.encode(JSON.stringify({ state, verifier, next, at: Date.now() })));
  const signed = `${payload}.${await hmac(env.SESSION_SECRET!, payload)}`;
  const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  g.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: `${url.origin}/auth/google/callback`, response_type: "code",
    scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return new Response(null, { status: 302, headers: { location: g.toString(), "set-cookie": setCookie(FLOW_COOKIE, signed, 600), "cache-control": "no-store" } });
}

/** Google's redirect back: checks the state, swaps the code for an ID token, signs the person in. */
// sessionSeconds: how long the sign-in lasts. The site keeps it for SESSION_DAYS; the account
// connector's host only needs it for the consent page that follows, so a shared computer doesn't stay
// able to approve new connectors for the person (review 2026-10-17).
export async function finishSignIn(req: Request, env: AuthEnv, sessionSeconds = SESSION_DAYS * 86400): Promise<Response> {
  if (!signInConfigured(env)) return new Response("Sign-in isn't set up yet.\n", { status: 503 });
  const url = new URL(req.url);
  const flow = cookie(req, FLOW_COOKIE) ?? "";
  const [payload, sig] = flow.split(".");
  const bad = (why: string) => new Response(`Sign-in didn't complete (${why}). Please try again from the site.\n`, { status: 400, headers: { "content-type": "text/plain", "set-cookie": setCookie(FLOW_COOKIE, "", 0) } });
  if (!payload || !sig || !sameText(sig, await hmac(env.SESSION_SECRET!, payload))) return bad("the sign-in link expired");
  let f: { state: string; verifier: string; next: string; at: number };
  try { f = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { return bad("the sign-in link expired"); }
  if (f.state !== url.searchParams.get("state") || Date.now() - f.at > 600_000) return bad("the sign-in link expired");
  const code = url.searchParams.get("code");
  if (!code) return bad(url.searchParams.get("error") === "access_denied" ? "you cancelled" : "no code from Google");
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${url.origin}/auth/google/callback`, grant_type: "authorization_code", code_verifier: f.verifier }),
  });
  if (!tok.ok) return bad("Google refused the sign-in");
  // The ID token came straight from Google's token endpoint over TLS, so its claims can be read
  // without checking the signature (OpenID Connect Core 3.1.3.7); its audience and issuer still are.
  type Claims = { sub?: string; aud?: string; iss?: string; exp?: number; email?: string; email_verified?: boolean; name?: string };
  let claims: Claims;
  try {
    const idToken = String(((await tok.json()) as { id_token?: string }).id_token ?? "");
    claims = JSON.parse(new TextDecoder().decode(fromB64url(idToken.split(".")[1] ?? ""))) as Claims;
  } catch { return bad("the sign-in couldn't be verified"); }
  if (!claims.sub || claims.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss ?? "") || (claims.exp ?? 0) * 1000 < Date.now()) return bad("the sign-in couldn't be verified");
  let session: string;
  try {
    const user = await upsertUser(env.DB!, claims.sub, claims.email_verified ? claims.email ?? null : null, claims.name ?? null);
    session = random(32);
    await env.DB!.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(session), user.id, Date.now(), Date.now() + sessionSeconds * 1000).run();
  } catch { return bad("Plot Speaks couldn't save the sign-in just now"); }
  const headers = new Headers({ location: f.next, "cache-control": "no-store" });
  headers.append("set-cookie", setCookie(SESSION_COOKIE, session, sessionSeconds));
  headers.append("set-cookie", setCookie(FLOW_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

// One statement, so two first sign-ins at the same moment can't both insert (google_sub is UNIQUE).
async function upsertUser(db: D1Database, sub: string, email: string | null, name: string | null): Promise<User> {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO users (id, google_sub, email, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, last_seen_at = excluded.last_seen_at RETURNING id`)
    .bind(random(12), sub, email, name, now, now).first<{ id: string }>();
  if (!row) throw new Error("user upsert returned nothing");
  return { id: row.id, email, name };
}
// Compares two strings in time that doesn't depend on where they differ.
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The signed-in person for a site request, or null. Never throws. */
export async function currentUser(req: Request, env: AuthEnv): Promise<User | null> {
  const s = cookie(req, SESSION_COOKIE);
  if (!s || !env.DB) return null;
  try {
    return await env.DB.prepare("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?")
      .bind(await sha256(s), Date.now()).first<User>();
  } catch { return null; }
}

export async function userById(env: AuthEnv, id: string): Promise<User | null> {
  if (!env.DB) return null;
  try { return await env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(id).first<User>(); } catch { return null; }
}

export async function signOut(req: Request, env: AuthEnv): Promise<Response> {
  const s = cookie(req, SESSION_COOKIE);
  if (s && env.DB) { try { await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(s)).run(); } catch { /* gone already */ } }
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": setCookie(SESSION_COOKIE, "", 0), "cache-control": "no-store" } });
}

/**
 * Deletes the account and everything kept for it: history, heard clues, sessions, and the saved
 * state and resume codes of its plays (a campaign world can hold whatever the players narrated).
 * The plays themselves stay as anonymous counts. The caller also revokes the connector's grants.
 */
export async function deleteAccount(env: AuthEnv, userId: string): Promise<void> {
  const db = env.DB!;
  await db.batch([
    db.prepare("DELETE FROM user_history WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM user_seen WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM user_assistants WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM campaign_codes WHERE play_id IN (SELECT id FROM plays WHERE user_id = ?)").bind(userId),
    db.prepare("DELETE FROM play_state WHERE play_id IN (SELECT id FROM plays WHERE user_id = ?)").bind(userId),
    db.prepare("UPDATE plays SET user_id = NULL WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
}

// ------------------------------------------------------------------ memory

export type HistoryRow = { story: string; title: string; kind: string; play_id: string; started_at: number; outcome: string | null };

/** Records that a signed-in person started a story or game (one row per play). */
export async function noteStart(db: D1Database | undefined, userId: string | null, row: { play_id: string; story: string; title: string; kind: string }) {
  if (!db || !userId) return;
  try {
    await db.prepare("INSERT OR IGNORE INTO user_history (user_id, play_id, story, title, kind, started_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(userId, row.play_id, row.story, row.title.slice(0, 120), row.kind, Date.now()).run();
  } catch { /* memory must never break play */ }
}
/** Records how a signed-in person's play ended: "solved", "wrong", "gave up", an ending's name, "rated 4". */
export async function noteOutcome(db: D1Database | undefined, userId: string | null, playId: string | null | undefined, outcome: string) {
  if (!db || !userId || !playId) return;
  try { await db.prepare("UPDATE user_history SET outcome = ?, finished_at = ? WHERE user_id = ? AND play_id = ?").bind(outcome.slice(0, 80), Date.now(), userId, playId).run(); } catch { /* as above */ }
}
/**
 * Moves anonymous plays onto a signed-in person's account (Ben, 2026-10-17): the plays from the chat
 * they were in before signing in, or a campaign resumed with its code. A play already on someone's
 * account is left alone. Rebuilds each play's outcome from its events, and marks a trivia game's
 * played clues as heard. Returns what was claimed.
 */
export async function claimPlays(db: D1Database | undefined, userId: string, playIds: string[], titleOf: (slug: string) => { title: string; kind: string } | null): Promise<{ claimed: string[]; skipped: number }> {
  if (!db) return { claimed: [], skipped: playIds.length };
  const claimed: string[] = [];
  let skipped = 0;
  for (const id of [...new Set(playIds)].slice(0, 50)) {
    try {
      const play = await db.prepare("SELECT id, story, started_at, user_id FROM plays WHERE id = ?").bind(id).first<{ id: string; story: string; started_at: number; user_id: string | null }>();
      if (!play || (play.user_id && play.user_id !== userId)) { skipped++; continue; }
      const t = titleOf(play.story);
      if (!t) { skipped++; continue; }
      const ev = await db.prepare("SELECT kind, detail, verdict FROM play_events WHERE play_id = ? ORDER BY at DESC").bind(id).all<{ kind: string; detail: string | null; verdict: string | null }>();
      const events = ev.results ?? [];
      const solved = events.find((e) => e.kind === "accusation" && e.verdict === "correct");
      const ending = events.find((e) => e.kind === "ending");
      const reveal = events.find((e) => e.kind === "reveal");
      const accused = events.find((e) => e.kind === "accusation");
      const outcome = solved ? `solved (${solved.detail})` : ending ? `ending: ${ending.detail}` : reveal?.detail === "gave_up" ? "gave up" : accused ? `accused ${accused.detail}` : null;
      // The history row is added only if the play really is this person's after the update, so a
      // play someone else claimed a moment earlier never shows up here.
      const res = await db.batch([
        db.prepare("UPDATE plays SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = ?)").bind(userId, id, userId),
        db.prepare("INSERT OR IGNORE INTO user_history (user_id, play_id, story, title, kind, started_at, outcome) SELECT ?, id, story, ?, ?, started_at, ? FROM plays WHERE id = ? AND user_id = ?").bind(userId, t.title.slice(0, 120), t.kind, outcome, id, userId),
      ]);
      if (!res[0]?.meta.changes) { skipped++; continue; }
      claimed.push(play.story);
    } catch { skipped++; }
  }
  return { claimed, skipped };
}

export async function historyOf(db: D1Database | undefined, userId: string, limit = 50): Promise<HistoryRow[]> {
  if (!db) return [];
  try {
    const { results } = await db.prepare("SELECT story, title, kind, play_id, started_at, outcome FROM user_history WHERE user_id = ? ORDER BY started_at DESC LIMIT ?").bind(userId, limit).all<HistoryRow>();
    return results ?? [];
  } catch { return []; }
}
export async function playedSlugs(db: D1Database | undefined, userId: string | null): Promise<Set<string>> {
  if (!db || !userId) return new Set();
  try {
    const { results } = await db.prepare("SELECT DISTINCT story FROM user_history WHERE user_id = ?").bind(userId).all<{ story: string }>();
    return new Set((results ?? []).map((r) => r.story));
  } catch { return new Set(); }
}
