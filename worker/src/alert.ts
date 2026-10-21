// Phone alerts for Ben through Pushover (2026-10-21): a story submitted for review, a server error, and
// the nightly jobs (retention, GitHub watch) or an approval's cover failing.
// Secrets: `wrangler secret put PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY` (dev and prod); with either
// missing, nothing is sent. Same Pushover account as the owner's other alerts.
// An alert never carries a player's words, a story's text, a contact address or an id: `scrub` is a
// second guard on every message. Dev alerts are tagged [DEV] and sent at normal priority.

export interface AlertEnv {
  DB?: D1Database;
  ENVIRONMENT?: string;
  PUSHOVER_APP_TOKEN?: string;
  PUSHOVER_USER_KEY?: string;
}

export type AlertLevel = "info" | "high" | "critical";
const PRIORITY: Record<AlertLevel, number> = { info: 0, high: 1, critical: 2 };

export interface Alert { title: string; message: string; level?: AlertLevel }

/** Removes anything shaped like an email, a long id or a long number before a message leaves the Worker. */
export function scrub(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "[id]")
    .replace(/\b(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{12,}\b/g, "[id]")
    .replace(/\d{5,}/g, "[number]")
    .slice(0, 900);
}

export const alertsConfigured = (env: AlertEnv): boolean => Boolean(env.PUSHOVER_APP_TOKEN && env.PUSHOVER_USER_KEY);

/** Sends one alert now. Returns whether Pushover accepted it; never throws. */
export async function sendAlert(env: AlertEnv, alert: Alert, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!alertsConfigured(env)) return false;
  const prod = env.ENVIRONMENT === "production";
  const level: AlertLevel = prod ? (alert.level ?? "high") : "info";
  const body = new URLSearchParams({
    token: env.PUSHOVER_APP_TOKEN as string,
    user: env.PUSHOVER_USER_KEY as string,
    title: scrub(`${prod ? "" : "[DEV] "}${alert.title}`).slice(0, 250),
    message: scrub(alert.message),
    priority: String(PRIORITY[level]),
  });
  if (level === "critical") { body.set("retry", "300"); body.set("expire", "10800"); }
  try {
    const res = await fetchImpl("https://api.pushover.net/1/messages.json", { method: "POST", body });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sends an alert at most once per `key` per UTC hour, so a burst of identical errors is one push. The claim
 * is a daily_counts row (kind "alert"), which the retention job already ages out.
 */
export async function alertOnce(env: AlertEnv, key: string, alert: Alert, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!alertsConfigured(env)) return false;
  const iso = new Date(now).toISOString();
  let first = true; // no database, or the database failing: worth a push
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        "INSERT INTO daily_counts (day, kind, key, n) VALUES (?, 'alert', ?, 1) ON CONFLICT (day, kind, key) DO UPDATE SET n = n + 1 RETURNING n",
      ).bind(iso.slice(0, 10), `${key}@${iso.slice(11, 13)}`.slice(0, 60)).first<{ n: number }>();
      first = row?.n === 1;
    } catch { /* first stays true */ }
  }
  return first ? sendAlert(env, alert, fetchImpl) : false;
}

/** The part of a path an alert may name: its first segment (/mcp, /admin, /stories), never ids or slugs. */
export function routeOf(pathname: string): string {
  const first = /^\/[a-z-]*/i.exec(pathname)?.[0] ?? "/";
  return first.length > 24 ? "/…" : first;
}
