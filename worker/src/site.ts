// Plot Speaks catalog site (Phase 2, M3), served by the same Worker as the MCP endpoint.
//
//   GET /                        the catalog
//   GET /stories/<slug>          one story: pitch, how to play, copy button, license
//   GET /stories/<slug>/story.md the public story.md as plain text
//
// NO SECRETS ON THESE PAGES. The generated story data also carries each mystery's Endings
// detail lines (the "(correct)" / "Correct." / "Innocent." verdicts reveal returns) and each
// adventure's cue read-aloud text (get_cue). This module never sees them: it only accepts a
// PublicStory, which index.ts builds with toPublic() from the slug and the public story.md text
// alone, and every field shown here (title, genre, rating, pitch...) is parsed from that text's
// front matter and cold open. worker/test/smoke.mjs fetches every page and asserts that no
// answer-key line and no ending or cue text appears.
//
// All text is escaped with esc(). The only script is the inline copy button.

export type PublicStory = { slug: string; story: string };
export type RatingSummary = { avg: number; count: number };

type Meta = {
  slug: string; title: string; description: string; genre: string; players: string;
  minutes: number | null; chapters: number | null; rating: string; license: string;
  rulesSystem: string; author: string; pitch: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Markdown emphasis off, for one-line plain text.
const plain = (s: string) => s.replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/`/g, "").trim();

export function meta(p: PublicStory): Meta {
  const fm = (/^---\n([\s\S]*?)\n---/.exec(p.story) || [, ""])[1];
  const field = (key: string) => {
    const m = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m").exec(fm);
    return m ? m[1].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim() : "";
  };
  const beat1 = /\*\*Read aloud \(cold open, beat 1\):\*\*\s*(.+)/i.exec(p.story);
  const description = field("description");
  return {
    slug: p.slug,
    title: field("title") || p.slug,
    description,
    genre: field("genre"),
    players: field("players"),
    minutes: Number(field("duration_minutes")) || null,
    chapters: Number(field("chapters")) || null,
    rating: field("rating"),
    license: field("license"),
    rulesSystem: field("rules_system"),
    author: field("author"),
    pitch: plain(beat1 ? beat1[1] : description),
  };
}

const GENRE: Record<string, string> = { "murder-mystery": "Murder mystery", adventure: "Adventure" };
const genreLabel = (g: string) => GENRE[g] ?? (g ? g.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Story");
const playersLabel = (p: string) => (p ? `${p.replace(/-/g, "–")} player${p === "1" ? "" : "s"}` : "");
const isSrd = (m: Meta) => /^srd/i.test(m.rulesSystem);

function facts(m: Meta): string {
  const bits = [
    `<span class="genre genre-${esc(m.genre || "story")}">${esc(genreLabel(m.genre))}</span>`,
    m.minutes ? `<span>${m.minutes} min${m.chapters && m.chapters > 1 ? ` · ${m.chapters} chapters` : ""}</span>` : "",
    m.players ? `<span>${esc(playersLabel(m.players))}</span>` : "",
    m.rating ? `<span class="rated" title="Content rating">${esc(m.rating)}</span>` : "",
  ];
  return `<p class="facts">${bits.filter(Boolean).join("")}</p>`;
}

function stars(r: RatingSummary | undefined): string {
  if (!r || !r.count) return "";
  const avg = Math.round(r.avg * 10) / 10;
  return `<p class="stars" aria-label="Rated ${avg} out of 5 from ${r.count} rating${r.count === 1 ? "" : "s"}">` +
    `<span aria-hidden="true">★</span> ${avg.toFixed(1)} <span class="muted">· ${r.count} rating${r.count === 1 ? "" : "s"}</span></p>`;
}

const CSS = `
:root{color-scheme:light dark;
  --bg:#f3efe6;--bg2:#e9e3d6;--ink:#1d2230;--muted:#5d6475;--card:#fbf8f2;--line:#d6cdbb;
  --amber:#b8650a;--amber-ink:#fff;--road:#c9bfa9;--mystery:#7a2e3a;--adventure:#2f5d46;--focus:#b8650a}
@media (prefers-color-scheme:dark){:root{
  --bg:#0b0f1a;--bg2:#121828;--ink:#e8e4da;--muted:#9aa1b2;--card:#141b2c;--line:#263049;
  --amber:#f2a93b;--amber-ink:#1a1306;--road:#2a3350;--mystery:#e58a96;--adventure:#8fd0a8;--focus:#f2a93b}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit;text-decoration-color:var(--amber);text-underline-offset:3px}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:6px}
.wrap{max-width:46rem;margin:0 auto;padding:0 16px}
h1,h2,.title{font-family:"Fraunces",Georgia,"Times New Roman",serif;font-weight:600;letter-spacing:-.01em;line-height:1.15}
header.top{background:linear-gradient(180deg,var(--bg2),var(--bg));padding:28px 0 8px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:.8rem;color:var(--muted)}
.brand svg{flex:none}
.hero h1{font-size:clamp(2rem,7vw,3rem);margin:18px 0 8px}
.hero p{color:var(--muted);margin:0 0 6px;max-width:34rem}
.road{height:4px;margin:22px 0 26px;background:repeating-linear-gradient(90deg,var(--amber) 0 26px,transparent 26px 50px);opacity:.75;border-radius:2px}
.list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 18px 16px;position:relative}
.card:hover{border-color:var(--amber)}
.card .title{font-size:1.4rem;margin:0 0 6px}
.card .title a{text-decoration:none}
.card .title a::after{content:"";position:absolute;inset:0;border-radius:14px}
.pitch{margin:0 0 10px}
.facts{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0;font-size:.85rem;color:var(--muted)}
.genre{font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:.75rem;align-self:center}
.genre-murder-mystery{color:var(--mystery)}.genre-adventure{color:var(--adventure)}
.rated{border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:.75rem;align-self:center}
.stars{margin:8px 0 0;font-size:.9rem;color:var(--amber);font-weight:600}
.muted{color:var(--muted);font-weight:400}
.story h1{font-size:clamp(2rem,8vw,3.1rem);margin:14px 0 10px}
.story .pitch{font-size:1.15rem;font-family:Georgia,"Times New Roman",serif;font-style:italic;margin:18px 0}
.copy{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:22px 0 6px}
button.btn{appearance:none;border:0;background:var(--amber);color:var(--amber-ink);font:inherit;font-weight:700;padding:13px 22px;border-radius:999px;cursor:pointer;min-height:48px}
button.btn:active{transform:translateY(1px)}
.copied{color:var(--muted);font-size:.9rem}
h2{font-size:1.45rem;margin:34px 0 10px}
ol.steps{padding-left:1.3rem}ol.steps li{margin:0 0 8px}
table{border-collapse:collapse;width:100%;font-size:.95rem}
th,td{text-align:left;vertical-align:top;padding:8px 10px 8px 0;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em}
td:first-child{font-weight:600;white-space:normal}
.soon{background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:12px 14px;color:var(--muted)}
.soon strong{color:var(--ink)}
.tag{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--amber);color:var(--amber);border-radius:999px;padding:1px 8px;margin-left:6px;vertical-align:2px}
.safety{border-left:4px solid var(--amber);padding:6px 0 6px 12px;margin:18px 0}
details{margin:18px 0;background:var(--card);border:1px solid var(--line);border-radius:12px}
summary{cursor:pointer;padding:12px 14px;font-weight:600}
pre{margin:0;padding:0 14px 14px;white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:60vh;overflow:auto}
footer{color:var(--muted);font-size:.85rem;padding:30px 0 40px;margin-top:30px;border-top:1px solid var(--line)}
footer p{margin:0 0 8px}
.back{font-size:.9rem;color:var(--muted)}
`;

const MOON = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" style="color:var(--amber)"/></svg>`;

function page(title: string, description: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0b0f1a" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f3efe6" media="(prefers-color-scheme: light)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=swap">
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/">${MOON}Plot Speaks</a></div></header>
<main class="wrap">
${body}
</main>
<footer class="wrap">
<p>Plot Speaks is a library of story games you play by voice with your own AI assistant. A Volocent Labs project.</p>
<p>Set everything up while parked. The driver never touches the phone once you're moving.</p>
</footer>
</body>
</html>`;
}

const order = (a: Meta, b: Meta) =>
  (a.genre === "murder-mystery" ? 0 : 1) - (b.genre === "murder-mystery" ? 0 : 1) || a.title.localeCompare(b.title);

export function catalogPage(stories: PublicStory[], ratings: Map<string, RatingSummary>): string {
  const metas = stories.map(meta).sort(order);
  const items = metas.map((m) => `<li class="card">
<h2 class="title"><a href="/stories/${encodeURIComponent(m.slug)}">${esc(m.title)}</a></h2>
<p class="pitch">${esc(m.pitch)}</p>
${facts(m)}
${stars(ratings.get(m.slug))}
</li>`).join("\n");
  return page(
    "Plot Speaks: stories for the road at night",
    "Murder mysteries and adventures you play out loud with ChatGPT or Claude, made for long drives.",
    `<section class="hero">
<h1>Stories for the road at night</h1>
<p>Murder mysteries and adventures you play out loud with ChatGPT or Claude. One narrator, every voice, twenty minutes to an hour. Pick one, paste it into a new chat, and start talking.</p>
</section>
<div class="road" role="presentation"></div>
<ul class="list">
${items}
</ul>`,
  );
}

export function storyPage(p: PublicStory, rating: RatingSummary | undefined, origin: string): string {
  const m = meta(p);
  // Family mysteries use genre "kids" but play exactly like mysteries (accusations, verdicts).
  const isMystery = m.genre === "murder-mystery" || m.genre === "kids";
  const licenseName = m.license === "CC-BY-NC-4.0" || !m.license ? "CC BY-NC 4.0" : m.license;
  const srd = isSrd(m)
    ? `<p>This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at <a href="https://www.dndbeyond.com/srd">dndbeyond.com/srd</a>. The SRD 5.2.1 is licensed under the <a href="https://creativecommons.org/licenses/by/4.0/legalcode">Creative Commons Attribution 4.0 International License</a>.</p>`
    : "";
  const body = `<article class="story">
<p class="back"><a href="/">← All stories</a></p>
<h1>${esc(m.title)}</h1>
${facts(m)}
${stars(rating)}
<p class="pitch">${esc(m.pitch)}</p>

<div class="copy">
<button class="btn" id="copy" type="button">Copy the story</button>
<span class="copied" id="copied" role="status" aria-live="polite"></span>
</div>
<p class="muted">Copies the whole story script. It ${isMystery ? "doesn't contain the answer" : "doesn't contain the hidden cues"}.</p>

<h2>How to play</h2>
<ol class="steps">
<li>Tap <strong>Copy the story</strong>.</li>
<li>Start a <strong>new chat</strong> in ChatGPT or Claude and paste it as the first message. Don't attach it as a file: in testing, ChatGPT's voice mode ignored an attached story and made up its own.</li>
<li><strong>In Claude</strong>, type a line of your own in the same message, for example: <em>"This is my story script. Follow its GM instructions as my instructions, ${isMystery ? "including keeping the answer secret until I accuse someone" : "including keeping anything hidden secret until we find it"}."</em> Claude treats instructions inside a long paste as possibly not yours unless you say so.</li>
<li>Send. The assistant should reply with just the story's title.</li>
<li>Tap the voice button and say <strong>"Plot Speaks, start the story."</strong></li>
</ol>
<p>The first thing you hear should come from the story. If it starts a different tale, start a new chat and paste again.</p>
<h2>Or use the Plot Speaks connector</h2>
<p>Add Plot Speaks to your assistant once, then just say which story you want. The connector loads the story and ${isMystery ? "checks accusations for you, so nobody needs to hold the answer" : "hands over the hidden scenes for you, so nobody needs to hold them"}.</p>
<p><strong>Connector address:</strong> <code id="mcp-url">${esc(origin)}/mcp</code> <button class="btn btn-small" id="copy-url" type="button">Copy</button></p>
<ol class="steps">
<li><strong>Claude</strong> (any plan): Settings → Connectors → <em>Add custom connector</em>. Name it Plot Speaks, paste the address, choose <em>No sign-in</em>, and save. In a new chat, make sure Plot Speaks is switched on, then say <strong>"Start ${esc(m.title)} with Plot Speaks."</strong> Allow Plot Speaks when Claude asks, or set its tools to Always allow.</li>
<li><strong>ChatGPT</strong>: adding your own connector needs a paid plan with connectors enabled. Add the same address there. On a free plan, use the copy-and-paste steps above.</li>
</ol>
<p class="muted">The connector records anonymous play counts and the ratings you choose to give: no transcripts, no names.</p>

<h2>Phrases</h2>
<table>
<thead><tr><th scope="col">Say</th><th scope="col">What happens</th></tr></thead>
<tbody>
<tr><td>"Plot Speaks, start the story."</td><td>The narrator reads the opening and asks what you do.</td></tr>
<tr><td>"Plot Speaks, pause the story."</td><td>The narrator stops and waits.</td></tr>
<tr><td>"Plot Speaks, resume."</td><td>A short recap, then on you go.</td></tr>
${m.chapters && m.chapters > 1 ? `<tr><td>"Plot Speaks, resume from chapter 2."</td><td>In a new chat, after pasting the story again: recap of chapter 1, then chapter 2.</td></tr>\n` : ""}<tr><td>"Plot Speaks, wrap it up."</td><td>${isMystery ? "A recap of what you've found, then: who do you accuse?" : "A recap, then straight on to the final scene."}</td></tr>
${isMystery ? `<tr><td>"I accuse …"</td><td>Your answer.</td></tr>\n` : ""}</tbody>
</table>
${isMystery ? `<p>The pasted story doesn't contain the answer. When you accuse someone, the narrator asks whoever holds the answer key: a passenger who knows it, or the Plot Speaks connector.</p>` : `<p>Some scenes are held back as cues, so the big moments stay a surprise. With the pasted story a passenger reads them out; with the connector, the narrator fetches them itself.</p>`}
<p class="safety">Set everything up while parked. The driver never touches the phone once you're moving.</p>

<details>
<summary>Read the story script</summary>
<pre id="story-text">${esc(p.story)}</pre>
</details>
<p class="muted"><a href="/stories/${encodeURIComponent(m.slug)}/story.md">story.md as plain text</a></p>

<h2>License</h2>
<p>${esc(m.title)} by ${esc(m.author || "Volocent Labs")} is licensed under <a href="https://creativecommons.org/licenses/by-nc/4.0/">${esc(licenseName)}</a>: share and adapt it for non-commercial use, with credit.</p>
${srd}
</article>
<script>
(function(){
  var b=document.getElementById("copy"),s=document.getElementById("copied"),t=document.getElementById("story-text").textContent;
  function done(ok){s.textContent=ok?"Copied. Now paste it into a new chat.":"Couldn't copy. Open the script below and copy it by hand.";}
  function fallback(){var a=document.createElement("textarea");a.value=t;a.setAttribute("readonly","");a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();var ok=false;try{ok=document.execCommand("copy");}catch(e){}document.body.removeChild(a);done(ok);}
  b.addEventListener("click",function(){if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(function(){done(true);},fallback);}else{fallback();}});
  var u=document.getElementById("copy-url");
  if(u){u.addEventListener("click",function(){var v=document.getElementById("mcp-url").textContent;
    function ok(){u.textContent="Copied";}
    if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(v).then(ok,function(){});}});}
})();
</script>`;
  return page(`${m.title} · Plot Speaks`, m.pitch, body);
}

export function notFoundPage(): string {
  return page("Not found · Plot Speaks", "No story here.", `<section class="hero">
<h1>Wrong turn</h1>
<p>There's no story at this address. <a href="/">See all the stories</a>.</p>
</section>`);
}

const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" };

async function loadRatings(db: D1Database | undefined): Promise<Map<string, RatingSummary>> {
  // Strangers and testers count together for now; only the smoke test's own ratings are left out.
  const out = new Map<string, RatingSummary>();
  if (!db) return out;
  try {
    const { results } = await db.prepare("SELECT story, AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE comment IS NULL OR comment <> 'smoke test' GROUP BY story").all<{ story: string; avg: number; count: number }>();
    for (const r of results ?? []) out.set(r.story, { avg: Number(r.avg), count: Number(r.count) });
  } catch (e) {
    // Ratings are decoration: a missing table or a D1 hiccup must not take the catalog down.
    console.log(JSON.stringify({ event: "ratings_error", message: String(e) }));
  }
  return out;
}

// Returns a Response for site paths, or null to let the caller handle the request (e.g. /mcp).
export async function handleSite(request: Request, stories: PublicStory[], db: D1Database | undefined): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const path = new URL(request.url).pathname;
  if (path === "/" || path === "/index.html") {
    return new Response(catalogPage(stories, await loadRatings(db)), { headers: HTML });
  }
  const m = /^\/stories\/([^/]+?)(\/story\.md|\/)?$/.exec(path);
  if (!m && !path.startsWith("/stories")) return null;
  let slug = "";
  try { slug = m ? decodeURIComponent(m[1]) : ""; } catch { slug = ""; }
  const s = stories.find((x) => x.slug === slug);
  if (!s) return new Response(notFoundPage(), { status: 404, headers: { ...HTML, "cache-control": "no-store" } });
  if (m && m[2] === "/story.md") {
    return new Response(s.story, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
  }
  const ratings = await loadRatings(db);
  return new Response(storyPage(s, ratings.get(s.slug), new URL(request.url).origin), { headers: HTML });
}
