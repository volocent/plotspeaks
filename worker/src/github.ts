// Watches the public GitHub presence (Ben, 2026-10-20): who follows the Volocent organisation and who has
// starred, watched or forked the plotspeaks repo. GitHub has no webhook for a follow, so the daily cron
// reads the public lists (no token, public data only) and records each login the first time it is seen
// (migration 0016). The first run is the baseline: everyone already there is marked baseline = 1 and is
// not "new". A failed fetch (GitHub's unauthenticated limit is per address, and a Worker's is shared)
// leaves that list for tomorrow and never throws.

const ORG = "volocent";
const REPO = "volocent/plotspeaks";
const LISTS = [
  { kind: "follower", url: `https://api.github.com/users/${ORG}/followers`, login: (r: any) => r.login },
  { kind: "star", url: `https://api.github.com/repos/${REPO}/stargazers`, login: (r: any) => r.login },
  { kind: "watcher", url: `https://api.github.com/repos/${REPO}/subscribers`, login: (r: any) => r.login },
  { kind: "fork", url: `https://api.github.com/repos/${REPO}/forks`, login: (r: any) => r.owner?.login },
] as const;
const PAGES = 3; // up to 300 logins per list; the daily job is for a small project

async function fetchLogins(url: string, pick: (r: any) => string | undefined): Promise<string[] | null> {
  const logins: string[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const res = await fetch(`${url}?per_page=100&page=${page}`, { headers: { accept: "application/vnd.github+json", "user-agent": "plotspeaks-github-watch", "x-github-api-version": "2022-11-28" } });
    if (!res.ok) return page === 1 ? null : logins;
    const rows = (await res.json()) as any[];
    for (const r of rows) { const l = pick(r); if (l && /^[A-Za-z0-9-]{1,39}$/.test(l)) logins.push(l); }
    if (rows.length < 100) break;
  }
  return logins;
}

/** Reads the four lists and records new logins. Returns what was seen and what was new, for the log. */
export async function runGithubWatch(db: D1Database | undefined): Promise<Record<string, { seen: number; added: number } | "skipped">> {
  const out: Record<string, { seen: number; added: number } | "skipped"> = {};
  if (!db) return out;
  const now = Date.now();
  for (const l of LISTS) {
    try {
      const logins = await fetchLogins(l.url, l.login);
      if (!logins) { out[l.kind] = "skipped"; continue; }
      const had = await db.prepare("SELECT count(*) AS n FROM github_seen WHERE kind = ?").bind(l.kind).first<{ n: number }>();
      const baseline = (had?.n ?? 0) === 0 ? 1 : 0;
      let added = 0;
      for (let i = 0; i < logins.length; i += 50) {
        const batch = logins.slice(i, i + 50).map((login) => db.prepare("INSERT OR IGNORE INTO github_seen (kind, login, first_at, baseline) VALUES (?, ?, ?, ?)").bind(l.kind, login, now, baseline));
        const results = await db.batch(batch);
        added += results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
      }
      out[l.kind] = { seen: logins.length, added: baseline ? 0 : added };
    } catch {
      out[l.kind] = "skipped";
    }
  }
  // The totals: the sure signal when a list can't be read. One row a day.
  try {
    const h = { headers: { accept: "application/vnd.github+json", "user-agent": "plotspeaks-github-watch" } };
    const [org, repo] = await Promise.all([fetch(`https://api.github.com/users/${ORG}`, h), fetch(`https://api.github.com/repos/${REPO}`, h)]);
    if (org.ok && repo.ok) {
      const o = (await org.json()) as any, r = (await repo.json()) as any;
      await db.prepare("INSERT OR REPLACE INTO github_counts (day, followers, stars, watchers, forks) VALUES (?, ?, ?, ?, ?)").bind(new Date(now).toISOString().slice(0, 10), Number(o.followers) || 0, Number(r.stargazers_count) || 0, Number(r.subscribers_count) || 0, Number(r.forks_count) || 0).run();
    }
  } catch { /* tomorrow */ }
  return out;
}
