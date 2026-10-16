// Plot Speaks website, served by the same Worker as the MCP endpoint.
//
//   GET /                        home: what it is, bring your own assistant, car rides, the stories
//   GET /stories/<slug>          one story: cover, pitch, connect (primary), copy-and-paste (fallback)
//   GET /stories/<slug>/story.md the public story.md as plain text
//   GET /connect                 how to add the connector, per assistant
//   GET /how-it-works            how a session goes, the phrases, what to do if it goes wrong
//   GET /write                   for writers: the Studio tools and submit_story
// Static files (logo, icons, og image, covers) live in worker/public and are served by the
// assets binding before this code runs; index.ts answers other /covers/ paths (submissions, 404).
//
// NO SECRETS ON THESE PAGES. The generated story data also carries each mystery's Endings
// detail lines (the verdicts reveal returns) and each adventure's cue read-aloud text (get_cue).
// This module never sees them: it only accepts a PublicStory, which index.ts builds with
// toPublic() from the slug and the public story.md text alone, and every field shown here
// (title, genre, rating, pitch...) is parsed from that text's front matter and cold open.
// worker/test/smoke.mjs fetches every page and asserts that no answer-key line and no ending or
// cue text appears.
//
// All story-derived text is escaped with esc(). The only scripts are small inline ones: the copy
// buttons, the category filter and the /connect tabs. Every page works without them.

export type PublicStory = { slug: string; story: string };
export type RatingSummary = { avg: number; count: number };

type Meta = {
  slug: string; title: string; description: string; genre: string; tone: string; players: string;
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
    tone: field("tone").toLowerCase(),
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

// ============================================================================ CONNECT STEPS
// The one place to update connector instructions. Shown on /connect (full) and summarised on
// the home and story pages. Strings may hold simple trusted HTML (<strong>, <em>, <a>, <code>):
// they are written here, never taken from a story or a request. "{url}" is replaced with the
// connector address, "{claude}" with the Claude install link and "{story}" with a story title.
// Source: docs/research-notes/connector-setup-2026.md (read 2026-10-16), "Connect in 30
// seconds". Voice through the connector is confirmed for Claude only (our test, 2026-10-15).
type Assistant = {
  id: string; name: string; tab: string; status: string; ok?: boolean; plan: string;
  button?: { href: string; label: string };
  steps: string[]; say?: string; notes: string[];
};
// Claude's documented prefilled "Add custom connector" link (directory-vs-custom docs).
const claudeLink = (mcpUrl: string) =>
  `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("Plot Speaks")}&connectorUrl=${encodeURIComponent(mcpUrl)}`;
const CONNECT: { headline: string; short: string; assistants: Assistant[] } = {
  headline: "Connect once, then just say which story you want.",
  short: "Add Plot Speaks to Claude as a connector. One tap, no sign-in, and it works on Claude's free plan.",
  assistants: [
    {
      id: "claude", name: "Claude", tab: "Claude", status: "Recommended · works by voice", ok: true,
      plan: "Works on every Claude plan, including Free. Free accounts can add one custom connector, and Plot Speaks will use it. On a Team or Enterprise account, your admin adds it first.",
      button: { href: "{claude}", label: "Connect to Claude" },
      steps: [
        "Tap <strong>Connect to Claude</strong>. It opens claude.ai in your browser. Sign in if asked.",
        "Check the name says <strong>Plot Speaks</strong>, choose <strong>No sign-in</strong> if asked, and tap <strong>Add</strong>.",
        "Open the Claude app, start a new chat, tap <strong>+ → Connectors</strong> and make sure Plot Speaks is on.",
        "Tap the voice button and name the story: <strong>“Start {story} with Plot Speaks.”</strong> Allow Plot Speaks when Claude asks, or choose <em>Always allow</em> so it doesn't ask mid-drive.",
      ],
      say: "Start {story} with Plot Speaks.",
      notes: [
        "Adding it works best in a browser, so on a phone open the link there. Once added, the connector shows up in the Claude phone app on its own.",
        "Voice works: in our test, Claude's voice mode loaded the story and checked an accusation through the connector.",
        "Say the story's name. A vague “play something” can send Claude on a detour.",
        "Doing it by hand: <strong>Customize → Connectors → + Add → Add custom connector</strong>, name it Plot Speaks and paste <code>{url}</code>.",
      ],
    },
    {
      id: "lechat", name: "Le Chat (Mistral)", tab: "Le Chat", status: "Free plan works",
      plan: "Le Chat accepts custom connectors with no sign-in, on the free plan too.",
      steps: [
        "In Le Chat on the web, open <strong>Connectors → + Add Connector → Custom MCP Connector</strong>.",
        "Name it <strong>PlotSpeaks</strong> (no spaces) and paste <code>{url}</code>. Tap <strong>Connect</strong>.",
        "In a chat, ask: <strong>“Start {story} with Plot Speaks.”</strong>",
      ],
      say: "Start {story} with Plot Speaks.",
      notes: ["We haven't tested voice play in Le Chat yet."],
    },
    {
      id: "gemini", name: "Gemini", tab: "Gemini", status: "US, 18+, personal accounts",
      plan: "Gemini can add custom apps for people in the US who are 18 or older, on a personal Google account with Keep Activity turned on. Not on work or school accounts.",
      steps: [
        "In your phone's browser, go to <strong>gemini.google.com → Menu → Settings → Connected Apps</strong> (it may sit under Personal Intelligence).",
        "Choose <strong>Add a custom app</strong>, paste <code>{url}</code>, tap <strong>Next</strong> and follow the prompts.",
        "It then works in the Gemini app too. Type <strong>@Plot Speaks</strong> and name the story.",
      ],
      say: "@Plot Speaks start {story}.",
      notes: ["We haven't tested voice (Gemini Live) with Plot Speaks yet."],
    },
    {
      id: "more", name: "Perplexity and Grok", tab: "Perplexity, Grok", status: "Untested",
      plan: "Both can add a custom connector by address. We haven't played a story through either yet.",
      steps: [
        "<strong>Perplexity</strong> (paid plans): <strong>Plugins → Add custom → Connector → Add MCP connector → Remote</strong>. Name it Plot Speaks, paste <code>{url}</code>, leave authentication as <strong>None</strong>, tick the box and tap <strong>Add</strong>.",
        "<strong>Grok</strong>: go to <strong>grok.com/connectors → New Connector → Custom</strong> and paste <code>{url}</code>. Which plans and devices support it isn't documented.",
      ],
      notes: ["If either gives you trouble, paste the story instead: open any story page and tap <strong>Copy the story</strong>."],
    },
    {
      id: "chatgpt", name: "ChatGPT", tab: "ChatGPT", status: "Paste the story for now",
      plan: "ChatGPT only lets Business, Enterprise and Edu accounts add outside connectors like this one. On Free and Plus, paste the story instead. It plays start to finish by voice: we've tested it on ChatGPT Free.",
      button: { href: "/#stories", label: "Pick a story to paste" },
      steps: [
        "Open a story page and tap <strong>Copy the story</strong>.",
        "Start a <strong>new chat</strong> and paste it as the first message. Don't attach it as a file.",
        "Send, then tap the voice button and say <strong>“Plot Speaks, start the story.”</strong>",
      ],
      say: "Plot Speaks, start the story.",
      notes: [
        "Without the connector, the answer key isn't in the chat. A passenger who knows it can hold it, or you check your accusation after the drive.",
        "We'll add a one-tap ChatGPT option if Plot Speaks is approved for ChatGPT's directory.",
      ],
    },
    {
      id: "copilot", name: "Microsoft Copilot", tab: "Copilot", status: "Not supported",
      plan: "Copilot's consumer app has no way to add a custom connector. Pasting a story may work, but we haven't tested it.",
      steps: [],
      notes: ["Claude's free plan is the easiest way to play with the connector."],
    },
  ],
};
const fill = (s: string, url: string, story: string) =>
  s.replace(/\{url\}/g, esc(url)).replace(/\{claude\}/g, esc(claudeLink(url))).replace(/\{story\}/g, esc(story));

// ============================================================================ CATEGORIES
type Category = { id: string; name: string; short: string; blurb: string; icon: string; match: (m: Meta) => boolean };
const ICON = {
  // 24x24 stroke icons, currentColor.
  moon: `<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>`,
  glass: `<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>`,
  star: `<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>`,
  compass: `<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  pause: `<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>`,
  users: `<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.5 14.2A4.6 4.6 0 0 1 21 18.5"/>`,
  eyeoff: `<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.2 2-2.4 3.2M6.5 7.6C4.5 9 3.1 10.9 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>`,
  key: `<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>`,
  chat: `<path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5Z"/>`,
  app: `<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>`,
  user: `<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>`,
  card: `<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>`,
  plug: `<path d="M9 2.5v4.5M15 2.5v4.5"/><path d="M6.5 7h11v3.5a5.5 5.5 0 0 1-11 0Z"/><path d="M12 16v5.5"/>`,
  copy: `<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  arrow: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
  pen: `<path d="M4 20l1-4.5L15.5 5a2 2 0 0 1 3 3L8 18.5Z"/><path d="M13.5 7l3 3"/>`,
  book: `<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z"/><path d="M12 6.5v13"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  shield: `<path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6Z"/><path d="m9 12 2 2 4-4"/>`,
};
type IconName = keyof typeof ICON;
const icon = (name: IconName, size = 24, cls = "ic") =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;

const isMysteryGenre = (g: string) => g === "murder-mystery";
const CATEGORIES: Category[] = [
  { id: "dark", name: "Dark murder mysteries", short: "Dark mysteries", icon: "moon",
    blurb: "Grim cases for grown-ups, best told after the kids are asleep.",
    match: (m) => isMysteryGenre(m.genre) && m.tone === "dark" },
  { id: "mystery", name: "Murder mysteries", short: "Murder mysteries", icon: "glass",
    blurb: "A body, a handful of suspects, and one of them did it. Ask questions, then accuse.",
    match: (m) => isMysteryGenre(m.genre) && m.tone !== "dark" },
  { id: "family", name: "Family mysteries", short: "Family", icon: "star",
    blurb: "Nobody gets hurt. Something goes missing and the kids crack the case. For ages about 7 to 10.",
    match: (m) => m.genre === "kids" },
  { id: "adventure", name: "Fantasy adventures", short: "Fantasy", icon: "compass",
    blurb: "Swords, spells and dice rolls. Make choices as a party and see where the road goes.",
    match: (m) => m.genre === "adventure" },
];
const categoryOf = (m: Meta): Category => CATEGORIES.find((c) => c.match(m)) ?? CATEGORIES[1];

const GENRE: Record<string, string> = { "murder-mystery": "Murder mystery", adventure: "Fantasy adventure", kids: "Family mystery" };
const genreLabel = (m: Meta) =>
  m.genre === "murder-mystery" && m.tone === "dark" ? "Dark murder mystery"
    : GENRE[m.genre] ?? (m.genre ? m.genre.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Story");
const playersLabel = (p: string) => (p ? `${p.replace(/-/g, "–")} player${p === "1" ? "" : "s"}` : "");
const isSrd = (m: Meta) => /^srd/i.test(m.rulesSystem);
const sortKey = (t: string) => t.replace(/^(the|a|an)\s+/i, "");

// ============================================================================ SMALL PIECES
function facts(m: Meta): string {
  const bits = [
    `<span class="genre genre-${esc(m.genre || "story")}">${esc(genreLabel(m))}</span>`,
    m.minutes ? `<span>${icon("clock", 16)}${m.minutes} min${m.chapters && m.chapters > 1 ? ` · ${m.chapters} chapters` : ""}</span>` : "",
    m.players ? `<span>${icon("users", 16)}${esc(playersLabel(m.players))}</span>` : "",
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

// A cover: a palette gradient with the category's icon, and the real cover image on top when it
// exists. If /covers/<slug>.jpg 404s, onerror removes the img and the fallback shows.
function cover(m: Meta, opts: { alt?: string; eager?: boolean; cls?: string } = {}): string {
  const c = categoryOf(m);
  const alt = opts.alt ?? "";
  let h = 0; for (const ch of m.slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const gx = 15 + (h % 70), gy = 5 + ((h >> 8) % 35);
  return `<div class="cover cover-${c.id}${opts.cls ? " " + opts.cls : ""}" style="--gx:${gx}%;--gy:${gy}%">` +
    `<span class="cover-fallback" aria-hidden="true">${icon(c.icon as IconName, 40, "ic cover-ic")}<span class="cover-waves"></span></span>` +
    `<img src="/covers/${encodeURIComponent(m.slug)}.jpg" alt="${esc(alt)}" width="1024" height="1024" decoding="async"${opts.eager ? ` fetchpriority="high"` : ` loading="lazy"`} onerror="this.remove()">` +
    `</div>`;
}

function copyField(url: string, id: string, big = false): string {
  return `<div class="urlbox${big ? " urlbox-big" : ""}">
<code class="url" id="${id}">${esc(url)}</code>
<button class="btn ${big ? "btn-primary" : "btn-ghost"}" type="button" data-copy="${id}">${icon("copy", 20)}<span>Copy address</span></button>
</div>
<p class="copy-status" role="status" aria-live="polite" data-status-for="${id}"></p>`;
}

function connectCard(origin: string, story: string, opts: { id: string; heading?: "h2" | "h3"; lead?: string } = { id: "mcp-url" }): string {
  const h = opts.heading ?? "h2";
  const url = origin + "/mcp";
  return `<section class="connect-card" aria-labelledby="${opts.id}-h">
<p class="eyebrow">${icon("plug", 18)} Start here</p>
<${h} id="${opts.id}-h">${esc(CONNECT.headline)}</${h}>
<p>${opts.lead ?? esc(CONNECT.short)}</p>
<div class="connect-actions">
<a class="btn btn-primary btn-big" href="${esc(claudeLink(url))}" rel="noopener">${icon("plug", 20)}Connect to Claude</a>
<span class="or">or copy the address</span>
</div>
${copyField(url, opts.id, false)}
<p class="fine">On a phone, open the link in your browser and tap <strong>Add</strong>. Once added, Plot Speaks shows up in the Claude app, and it works in voice mode.</p>
<p class="then">Then, in a chat, tap <strong>+ → Connectors</strong>, turn Plot Speaks on, and name the story: <strong>“${esc(`Start ${story} with Plot Speaks.`)}”</strong></p>
<p class="connect-links"><a class="link-arrow" href="/connect">Le Chat, Gemini, ChatGPT and more ${icon("arrow", 18)}</a></p>
</section>`;
}

function phrasesTable(m: Meta | null): string {
  const isMystery = !m || m.genre === "murder-mystery" || m.genre === "kids";
  const chapters = !m || (m.chapters !== null && m.chapters > 1);
  return `<div class="table-wrap"><table class="phrases">
<thead><tr><th scope="col">Say</th><th scope="col">What happens</th></tr></thead>
<tbody>
<tr><td>"Plot Speaks, start the story."</td><td>The narrator reads the opening and asks what you do.</td></tr>
<tr><td>"Plot Speaks, pause the story."</td><td>The narrator stops and waits.</td></tr>
<tr><td>"Plot Speaks, resume."</td><td>A short recap, then on you go.</td></tr>
${chapters ? `<tr><td>"Plot Speaks, resume from chapter 2."</td><td>In a new chat: recap of chapter 1, then chapter 2.</td></tr>\n` : ""}<tr><td>"Plot Speaks, wrap it up."</td><td>${!m ? "A recap of what you've found, then the ending: in a mystery, who do you accuse?" : isMystery ? "A recap of what you've found, then: who do you accuse?" : "A recap, then straight on to the final scene."}</td></tr>
<tr><td>"Plot Speaks, shorter."</td><td>Two sentences, then a question for you.</td></tr>
${isMystery ? `<tr><td>"I accuse …"</td><td>${!m ? "Mysteries: your answer, checked against the answer key." : "Your answer, checked against the answer key."}</td></tr>\n` : ""}</tbody>
</table></div>`;
}

// ============================================================================ CSS
const CSS = `
:root{color-scheme:light;
  --navy:#12355B;--navy-2:#0F3E65;--orange:#EF7726;--sky:#3FB8E8;--peach:#F3C095;
  --bg:#FBF7EF;--bg-2:#F4ECDD;--surface:#FFFDF9;--surface-2:#FBF3E6;
  --ink:#13294A;--ink-2:#4B5B73;--line:#E7DCC9;--line-2:#D9CAB0;
  --accent:#B4520C;--accent-soft:rgba(239,119,38,.12);--sky-ink:#14709E;
  --btn:#EF7726;--btn-ink:#14233D;--btn-hover:#F58A3E;
  --shadow:0 1px 2px rgba(19,41,74,.06),0 8px 24px -12px rgba(19,41,74,.18);
  --shadow-lg:0 2px 6px rgba(19,41,74,.06),0 24px 48px -24px rgba(19,41,74,.32);
  --glow:rgba(243,192,149,.55);--focus:#0F6FA8;
  --night:#0B1D33;--night-2:#12355B;--night-ink:#F6F0E6;--night-ink-2:#B8C6D8;
  --radius:18px;--radius-lg:28px;--wrap:72rem;
  --serif:"Fraunces",Georgia,"Times New Roman",serif;
  --sans:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
  --bg:#0A1A2E;--bg-2:#0D2139;--surface:#112846;--surface-2:#0F2440;
  --ink:#F5EFE5;--ink-2:#AEBDD0;--line:#1F3B60;--line-2:#2A4C78;
  --accent:#F7A060;--accent-soft:rgba(239,119,38,.16);--sky-ink:#6FCBF2;
  --btn:#F28A3C;--btn-ink:#111E33;--btn-hover:#F69B55;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -14px rgba(0,0,0,.6);
  --shadow-lg:0 2px 6px rgba(0,0,0,.3),0 30px 60px -28px rgba(0,0,0,.8);
  --glow:rgba(63,184,232,.16);--focus:#7FD3F7;
  --night:#050E1A;--night-2:#163E6B}}
@media (prefers-color-scheme:dark){.say-you{background:#1E4E80}.night{border-block:1px solid #18324F}.waves circle:nth-child(1),.waves circle:nth-child(2){stroke:var(--peach);opacity:.16}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:84px}
body{margin:0;background:var(--bg);color:var(--ink);font:400 17px/1.6 var(--sans);overflow-x:hidden;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
a{color:inherit;text-decoration-color:var(--accent);text-decoration-thickness:1.5px;text-underline-offset:3px}
a:hover{color:var(--accent)}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:8px}
code{font:500 .9em/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--accent-soft);padding:.1em .4em;border-radius:6px;word-break:break-all}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 16px}
@media (min-width:720px){.wrap{padding:0 32px}}
.narrow{max-width:46rem}
h1,h2,h3{font-family:var(--serif);font-weight:620;letter-spacing:-.015em;line-height:1.12;font-variation-settings:"SOFT" 50,"opsz" 96;margin:0}
h1{font-size:clamp(2.35rem,8.5vw,4.4rem)}
h2{font-size:clamp(1.75rem,5.4vw,2.6rem)}
h3{font-size:1.3rem;font-variation-settings:"SOFT" 50,"opsz" 36}
p{margin:0 0 1em}
.muted{color:var(--ink-2);font-weight:400}
.lead{font-size:clamp(1.08rem,2.6vw,1.25rem);color:var(--ink-2);max-width:40rem}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 14px;font:700 .78rem/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.ic{flex:none;vertical-align:middle}
.skip{position:absolute;left:12px;top:-60px;background:var(--btn);color:var(--btn-ink);padding:10px 16px;border-radius:10px;font-weight:700;z-index:50;text-decoration:none}
.skip:focus{top:12px}

/* header */
.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
.top .wrap{display:flex;align-items:center;gap:16px;min-height:64px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);margin-right:auto}
.brand img{width:38px;height:38px;border-radius:11px;box-shadow:0 0 0 1px var(--line)}
.wordmark{font:800 1.02rem/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--ink)}
.wordmark span{font-weight:500}
.nav{display:none;gap:4px}
.nav a{text-decoration:none;font-weight:600;font-size:.95rem;padding:8px 12px;border-radius:999px;color:var(--ink-2)}
.nav a:hover{color:var(--ink);background:var(--accent-soft)}
.nav a[aria-current=page]{color:var(--ink);background:var(--accent-soft)}
.top .btn-connect{display:none}
.menu{position:relative}
.menu summary{list-style:none;cursor:pointer;display:grid;place-items:center;width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--surface)}
.menu summary::-webkit-details-marker{display:none}
.menu[open] summary{border-color:var(--accent)}
.menu-panel{position:absolute;right:0;top:52px;min-width:220px;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-lg);padding:8px;display:grid}
.menu-panel a{padding:12px 14px;border-radius:10px;text-decoration:none;font-weight:600}
.menu-panel a:hover,.menu-panel a[aria-current=page]{background:var(--accent-soft);color:var(--ink)}
@media (min-width:860px){.nav{display:flex}.menu{display:none}.top .btn-connect{display:inline-flex}}

/* buttons */
.btn{appearance:none;border:0;display:inline-flex;align-items:center;justify-content:center;gap:9px;font:700 1rem/1 var(--sans);padding:14px 22px;min-height:50px;border-radius:999px;cursor:pointer;text-decoration:none;transition:transform .15s ease,background-color .15s ease,box-shadow .15s ease}
.btn-primary{background:var(--btn);color:var(--btn-ink);box-shadow:0 6px 18px -8px rgba(239,119,38,.7)}
.btn-primary:hover{background:var(--btn-hover);color:var(--btn-ink)}
.btn:active{transform:translateY(1px) scale(.99)}
.btn-ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--line-2)}
.btn-ghost:hover{box-shadow:inset 0 0 0 1.5px var(--accent);color:var(--ink)}
.btn-sm{min-height:42px;padding:10px 16px;font-size:.92rem}
.btn.is-done{background:var(--sky);color:#08223A;box-shadow:none}
.link-arrow{display:inline;font-weight:700;text-decoration:none;color:var(--accent)}
.link-arrow .ic{margin-left:4px;vertical-align:-3px}
.link-arrow .ic{transition:transform .2s ease}
.link-arrow:hover .ic{transform:translateX(3px)}

/* hero */
.hero{position:relative;overflow:hidden;padding:48px 0 56px;isolation:isolate}
.hero::before{content:"";position:absolute;z-index:-2;inset:-20% -30% auto auto;width:90vmax;height:90vmax;border-radius:50%;background:radial-gradient(closest-side,var(--glow),transparent 70%)}
.waves{position:absolute;z-index:-1;right:-250px;top:-250px;width:560px;height:560px;opacity:.6;pointer-events:none}
.waves circle{fill:none;stroke-width:14;stroke-linecap:round;transform-origin:50% 50%;animation:pulse 4.8s ease-in-out infinite}
.waves circle:nth-child(1){stroke:var(--orange);opacity:.32}
.waves circle:nth-child(2){stroke:var(--orange);opacity:.22;animation-delay:.4s}
.waves circle:nth-child(3){stroke:var(--sky);opacity:.26;animation-delay:.8s}
.waves circle:nth-child(4){stroke:var(--sky);opacity:.14;animation-delay:1.2s}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
.hero-grid{display:grid;gap:36px;align-items:center}
@media (min-width:960px){.hero{padding:72px 0 88px}.hero-grid{grid-template-columns:1.1fr .9fr;gap:56px}.waves{right:-60px;top:-160px;width:760px;height:760px;opacity:.9}}
.hero h1{margin:0 0 18px;max-width:12ch}
.hero h1 em{font-style:italic;font-weight:560;color:var(--accent)}
.hero .lead{margin-bottom:28px}
.hero-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}

/* voice demo card */
.voice{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:22px;position:relative;max-width:30rem;justify-self:center;width:100%}
.voice-top{display:flex;align-items:center;gap:10px;margin:0 0 16px;font:700 .8rem/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
.live{width:9px;height:9px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 0 rgba(239,119,38,.6);animation:live 2s infinite}
@keyframes live{0%{box-shadow:0 0 0 0 rgba(239,119,38,.55)}70%{box-shadow:0 0 0 10px rgba(239,119,38,0)}100%{box-shadow:0 0 0 0 rgba(239,119,38,0)}}
.say{margin:0 0 14px;padding:14px 16px;border-radius:18px;max-width:92%}
.say b{display:block;font:700 .72rem/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px;opacity:.75}
.say-you{background:var(--navy);color:#F6F0E6;margin-left:auto;border-bottom-right-radius:6px}
.say-narrator{background:var(--surface-2);border:1px solid var(--line);border-bottom-left-radius:6px;font-family:var(--serif);font-size:1.04rem;line-height:1.5}
.say-narrator b{font-family:var(--sans)}
.bars{display:flex;align-items:center;gap:4px;height:34px;margin-top:4px}
.bars i{display:block;width:5px;border-radius:3px;background:linear-gradient(var(--sky),var(--orange));height:30%;animation:bar 1.4s ease-in-out infinite}
.bars i:nth-child(3n){animation-delay:.2s}.bars i:nth-child(3n+1){animation-delay:.45s}.bars i:nth-child(4n){animation-delay:.7s}.bars i:nth-child(5n){animation-delay:.9s}
@keyframes bar{0%,100%{height:22%}50%{height:100%}}

/* connect card */
.connect-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow);padding:24px 20px;position:relative;overflow:hidden}
.connect-card::after{content:"";position:absolute;right:-60px;top:-60px;width:180px;height:180px;border-radius:50%;border:14px solid var(--sky);opacity:.12;pointer-events:none}
.connect-card h2,.connect-card h3{font-size:clamp(1.45rem,4.6vw,1.95rem);margin:0 0 10px;max-width:22ch}
.connect-card>p{color:var(--ink-2)}
@media (min-width:720px){.connect-card{padding:32px}}
.urlbox{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch;margin:18px 0 4px}
.urlbox .url{flex:1 1 220px;display:flex;align-items:center;min-height:50px;padding:12px 16px;border-radius:14px;background:var(--bg);border:1.5px dashed var(--line-2);font-size:1rem;color:var(--ink);word-break:break-all}
.urlbox .btn{flex:1 1 auto}
@media (min-width:520px){.urlbox .btn{flex:0 0 auto}}
.connect-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin:20px 0 0}
.btn-big{min-height:58px;padding:16px 28px;font-size:1.08rem;flex:1 1 auto;max-width:100%}
@media (min-width:520px){.btn-big{flex:0 0 auto}}
.or{font-size:.9rem;color:var(--ink-2);font-weight:600}
.urlbox .btn-ghost{background:var(--surface)}
.copy-status{min-height:1.4em;margin:6px 0 0;font-size:.9rem;color:var(--ink-2)}
.then{margin:10px 0 6px;font-size:1.02rem}
.connect-links{margin:0}

/* sections */
.section{padding:64px 0}
@media (min-width:960px){.section{padding:96px 0}}
.section-head{max-width:44rem;margin:0 0 36px}
.section-head h2{margin:0 0 14px}
.alt{background:var(--bg-2)}
.steps3{display:grid;gap:16px;counter-reset:s;list-style:none;margin:0;padding:0}
@media (min-width:760px){.steps3{grid-template-columns:repeat(3,1fr);gap:20px}}
.steps3 li{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:22px;position:relative;counter-increment:s}
.steps3 li::before{content:counter(s);display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--navy);color:#F6F0E6;font:700 1rem/1 var(--sans);margin-bottom:14px}
@media (prefers-color-scheme:dark){.steps3 li::before{background:var(--orange);color:var(--btn-ink)}}
.steps3 h3{margin:0 0 6px}
.steps3 p{margin:0;color:var(--ink-2)}

/* bring your own assistant */
.byo-grid{display:grid;gap:16px}
@media (min-width:760px){.byo-grid{grid-template-columns:repeat(3,1fr)}}
.pill-card{display:flex;gap:14px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.pill-card .ic-wrap{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:var(--accent-soft);color:var(--accent)}
.pill-card h3{font-size:1.15rem;margin:2px 0 4px}
.pill-card p{margin:0;color:var(--ink-2);font-size:.97rem}
.split{display:grid;gap:20px;margin-top:20px}
@media (min-width:860px){.split{grid-template-columns:1fr 1fr}}
.panel{border-radius:var(--radius-lg);padding:26px;border:1px solid var(--line);background:var(--surface)}
.panel h3{font-size:1.45rem;margin:0 0 10px;display:flex;gap:10px;align-items:center}
.panel h3 .ic{color:var(--sky-ink)}
.panel p:last-child{margin-bottom:0}
.panel-key{background:linear-gradient(160deg,var(--navy),#0B2643);color:#F6F0E6;border-color:transparent}
.panel-key h3 .ic{color:var(--peach)}
.panel-key p{color:#D3DCE8}
.fine{font-size:.9rem;color:var(--ink-2)}

/* car rides band */
.night{background:radial-gradient(120% 80% at 80% 0%,var(--night-2),var(--night) 70%);color:var(--night-ink);position:relative;overflow:hidden}
.night .eyebrow{color:var(--peach)}
.night .lead,.night p{color:var(--night-ink-2)}
.night h2,.night h3{color:var(--night-ink)}
.road{position:absolute;left:0;right:0;bottom:0;height:6px;background:repeating-linear-gradient(90deg,var(--orange) 0 48px,transparent 48px 96px);opacity:.55;animation:road 2.4s linear infinite}
@keyframes road{to{background-position:-96px 0}}
.drive-grid{display:grid;gap:14px;list-style:none;margin:0;padding:0}
@media (min-width:640px){.drive-grid{grid-template-columns:repeat(2,1fr)}}
@media (min-width:1000px){.drive-grid{grid-template-columns:repeat(5,1fr)}}
.drive-grid li{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:var(--radius);padding:20px}
.drive-grid .ic{color:var(--sky);margin-bottom:12px}
.drive-grid h3{font-size:1.12rem;margin:0 0 6px}
.drive-grid p{margin:0;font-size:.95rem}
.drive-grid q{color:var(--peach);quotes:"“" "”"}
.passenger{margin:28px 0 0;display:flex;gap:12px;align-items:flex-start;padding:16px 18px;border-radius:16px;background:rgba(239,119,38,.12);border:1px solid rgba(239,119,38,.35);color:var(--night-ink)!important;max-width:46rem}
.passenger .ic{color:var(--orange);margin-top:2px}

/* catalog */
.filters{position:sticky;top:64px;z-index:10;margin:0 -16px 28px;padding:12px 16px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}
.filters::-webkit-scrollbar{display:none}
@media (min-width:720px){.filters{margin:0 -32px 32px;padding:12px 32px;flex-wrap:wrap}}
.chip{flex:none;display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:999px;border:1.5px solid var(--line-2);background:var(--surface);text-decoration:none;font-weight:650;font-size:.92rem;color:var(--ink);min-height:42px}
.chip:hover{border-color:var(--accent);color:var(--ink)}
.chip[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.chip .n{font-weight:600;opacity:.6;font-size:.82rem}
.cat{margin:0 0 56px}
.cat-head{display:flex;gap:14px;align-items:flex-start;margin:0 0 20px}
.cat-head .ic-wrap{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:15px;color:#fff}
.cat-head h3{font-size:clamp(1.5rem,4.4vw,2rem);margin:2px 0 4px}
.cat-head p{margin:0;color:var(--ink-2)}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:14px}
@media (min-width:640px){.cards{grid-template-columns:repeat(2,1fr);gap:20px}}
@media (min-width:1000px){.cards{grid-template-columns:repeat(3,1fr);gap:24px}}
.card{position:relative;display:grid;grid-template-columns:112px 1fr;gap:14px;align-items:start;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px;box-shadow:var(--shadow);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg);border-color:var(--line-2)}
.card:focus-within{border-color:var(--accent)}
@media (min-width:640px){.card{grid-template-columns:1fr;padding:0;overflow:hidden;gap:0}}
.card .cover{border-radius:12px}
@media (min-width:640px){.card .cover{border-radius:0}}
.card-body{padding:2px 2px 2px 0;min-width:0}
@media (min-width:640px){.card-body{padding:18px 20px 20px}}
.card .title{font-family:var(--serif);font-weight:620;letter-spacing:-.01em;font-variation-settings:"SOFT" 50,"opsz" 36;font-size:1.25rem;margin:0 0 6px;line-height:1.18}
@media (min-width:640px){.card .title{font-size:1.4rem}}
.card .title a{text-decoration:none;color:var(--ink)}
.card .title a::after{content:"";position:absolute;inset:0;border-radius:var(--radius)}
.card .title a:focus-visible{outline:none}
.card:has(.title a:focus-visible){outline:3px solid var(--focus);outline-offset:3px}
.card .pitch{margin:0 0 10px;color:var(--ink-2);font-size:.95rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
@media (max-width:639px){.card .pitch{-webkit-line-clamp:2;font-size:.9rem}}
.badge{position:absolute;left:10px;bottom:10px;z-index:2;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;background:rgba(10,26,46,.78);color:#fff;font:700 .78rem/1 var(--sans);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
@media (max-width:639px){.badge{left:6px;bottom:6px;padding:4px 7px;font-size:.7rem}.badge .ic{display:none}}

/* cover */
.cover{position:relative;aspect-ratio:1/1;overflow:hidden;isolation:isolate;background:var(--navy)}
.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}
.cover-fallback{position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.92)}
.cover-ic{width:34%;height:34%;max-width:96px;max-height:96px;stroke-width:1.4;filter:drop-shadow(0 4px 14px rgba(0,0,0,.25))}
.cover-waves{position:absolute;right:-28%;top:-28%;width:90%;aspect-ratio:1;border-radius:50%;border:10px solid rgba(255,255,255,.16);box-shadow:0 0 0 18px transparent,0 0 0 28px rgba(255,255,255,.08)}
.cover-dark{background:radial-gradient(90% 90% at var(--gx,75%) var(--gy,15%),#2A4E7E,transparent 60%),linear-gradient(160deg,#16294A,#060F1C)}
.cover-mystery{background:radial-gradient(80% 80% at var(--gx,80%) var(--gy,10%),rgba(239,119,38,.85),transparent 60%),linear-gradient(155deg,#1A4673,#0E2541)}
.cover-family{background:radial-gradient(80% 80% at var(--gx,20%) var(--gy,10%),rgba(246,199,154,.95),transparent 65%),linear-gradient(150deg,#3FB8E8,#2381BB)}
.cover-adventure{background:radial-gradient(80% 80% at var(--gx,80%) var(--gy,15%),rgba(63,184,232,.75),transparent 60%),linear-gradient(160deg,#1E5B5A,#12355B)}
.ic-wrap.cover-dark,.ic-wrap.cover-mystery,.ic-wrap.cover-family,.ic-wrap.cover-adventure{background-size:cover}

/* facts, stars */
.facts{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:0;font-size:.86rem;color:var(--ink-2)}
.facts span{display:inline-flex;align-items:center;gap:5px}
.genre{font-weight:750;text-transform:uppercase;letter-spacing:.07em;font-size:.72rem;color:var(--accent)}
.genre-adventure{color:var(--sky-ink)}
.genre-kids{color:var(--sky-ink)}
.rated{border:1px solid var(--line-2);border-radius:6px;padding:1px 6px;font-size:.72rem;font-weight:700}
.card .facts .genre{display:none}
@media (max-width:639px){.card .facts{font-size:.8rem;gap:4px 10px}.card .facts .ic{display:none}}
.stars{margin:8px 0 0;font-size:.9rem;color:var(--accent);font-weight:700}

/* story page */
.crumbs{margin:24px 0 0;font-size:.92rem}
.crumbs a{color:var(--ink-2);text-decoration:none;font-weight:600}
.crumbs a:hover{color:var(--accent)}
.story-hero{display:grid;gap:24px;padding:20px 0 40px;align-items:center}
.story-hero .cover{border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);aspect-ratio:16/11}
@media (min-width:860px){.story-hero{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:48px;padding:32px 0 56px}.story-hero .cover{aspect-ratio:1/1}}
.story-hero h1{font-size:clamp(2.3rem,8vw,3.8rem);margin:10px 0 14px}
.story-hero .pitch{font-family:var(--serif);font-style:italic;font-size:clamp(1.12rem,2.8vw,1.35rem);line-height:1.5;margin:20px 0 0;padding-left:18px;border-left:3px solid var(--orange);color:var(--ink);font-variation-settings:"SOFT" 100,"opsz" 24}
.story-body{display:grid;gap:40px;padding-bottom:24px}
@media (min-width:1000px){.story-body{grid-template-columns:minmax(0,1fr) 22rem;gap:56px;align-items:start}.story-side{position:sticky;top:96px}}
.block h2{font-size:clamp(1.5rem,4.4vw,2rem);margin:0 0 14px}
.block+.block{margin-top:44px}
.fallback{border:1px solid var(--line);border-radius:var(--radius-lg);padding:24px;background:var(--surface-2)}
.fallback h2{display:flex;gap:10px;align-items:center}
.copyrow{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:16px 0 6px}
.copied{color:var(--ink-2);font-size:.92rem}
ol.steps{padding:0;margin:14px 0;list-style:none;counter-reset:st}
ol.steps li{position:relative;padding:0 0 14px 44px;counter-increment:st}
ol.steps li::before{content:counter(st);position:absolute;left:0;top:-1px;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:700 .88rem/1 var(--sans);background:var(--accent-soft);color:var(--accent)}
.note{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--line);font-size:.96rem}
.note .ic{color:var(--sky-ink);margin-top:2px}
.safety{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--orange) 40%,transparent);font-weight:600;margin:20px 0}
.safety .ic{color:var(--accent);margin-top:2px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:.96rem}
th,td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{color:var(--ink-2);font-weight:700;font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;background:var(--surface-2)}
td:first-child{font-weight:650;font-family:var(--serif);font-size:1.02rem;font-variation-settings:"opsz" 24}
details.script{margin:20px 0 8px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
details.script summary{cursor:pointer;padding:14px 18px;font-weight:700;list-style-position:inside}
details.script pre{margin:0;padding:0 18px 18px;white-space:pre-wrap;word-break:break-word;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:60vh;overflow:auto;color:var(--ink-2)}
.license{font-size:.94rem;color:var(--ink-2)}
.glance{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;margin-bottom:28px}
.glance h2{font-size:1.3rem;margin:0 0 12px}
.glance dl{margin:0;display:grid;gap:10px}
.glance dl div{display:grid;grid-template-columns:6.5rem 1fr;gap:10px;font-size:.94rem}
.glance dt{color:var(--ink-2);font-weight:650}
.glance dd{margin:0}
.license h2{font-size:1.3rem;color:var(--ink)}

/* connect page */
.tabs{display:flex;flex-wrap:wrap;gap:4px;padding:6px;border-radius:24px;background:var(--surface-2);border:1px solid var(--line);margin:0 0 24px;overflow-x:auto;scrollbar-width:none}
.tabs [role=tab]{flex:1 1 auto;appearance:none;border:0;background:transparent;font:700 .95rem/1 var(--sans);color:var(--ink-2);padding:12px 16px;border-radius:999px;cursor:pointer;min-height:44px}
.tabs [role=tab][aria-selected=true]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
.tabs:not(.ready){display:none}
.assistant{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:24px;margin:0 0 20px;box-shadow:var(--shadow)}
@media (min-width:720px){.assistant{padding:32px}}
.assistant h2{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:0 0 12px;font-size:clamp(1.6rem,5vw,2.2rem)}
.status{font:700 .74rem/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;padding:7px 11px;border-radius:999px;background:var(--accent-soft);color:var(--accent)}
.status-ok{background:color-mix(in srgb,var(--sky) 18%,transparent);color:var(--sky-ink)}
.assistant .plan{color:var(--ink-2)}
.saybox{margin:18px 0;padding:16px 18px;border-radius:16px;background:var(--navy);color:#F6F0E6;font-family:var(--serif);font-size:1.15rem}
.saybox b{display:block;font:700 .72rem/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--peach);margin-bottom:8px}
.assistant ul.notes{margin:0;padding:0;list-style:none;display:grid;gap:10px}

/* prose pages */
.page-head{padding:48px 0 28px}
.page-head h1{font-size:clamp(2.2rem,7.5vw,3.6rem);margin:0 0 14px}
.prose h2{font-size:clamp(1.45rem,4.2vw,1.9rem);margin:44px 0 14px}
.prose h3{margin:28px 0 8px}
.prose ul{padding-left:1.2rem}
.prose li{margin:0 0 8px}
.tool{display:grid;gap:4px;padding:18px 20px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line);margin:0 0 12px}
.tool code{justify-self:start;font-size:.95rem}
.tool p{margin:0;color:var(--ink-2)}

/* cta band + footer */
.cta{padding:56px 0}
.cta .connect-card{max-width:52rem;margin:0 auto}
footer.foot{border-top:1px solid var(--line);padding:40px 0 48px;color:var(--ink-2);font-size:.9rem;background:var(--bg-2)}
.foot-grid{display:grid;gap:24px}
@media (min-width:760px){.foot-grid{grid-template-columns:1.4fr 1fr}}
.foot .brand{margin:0 0 12px}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 0 12px}
.foot nav a{font-weight:650;text-decoration:none;color:var(--ink)}
.foot nav a:hover{color:var(--accent)}
.foot p{margin:0 0 8px}

/* motion */
.rise{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
.rise-2{animation-delay:.08s}.rise-3{animation-delay:.16s}.rise-4{animation-delay:.24s}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
[hidden]{display:none!important}
`;

// ============================================================================ PAGE SHELL
type Shell = { title: string; description: string; body: string; origin: string; path: string; script?: string };
const NAV: [string, string][] = [["/#stories", "Stories"], ["/connect", "Connect"], ["/how-it-works", "How it works"], ["/write", "Write"]];

const FONTS = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,400..700,0..100;1,9..144,400..700,0..100&family=Plus+Jakarta+Sans:wght@400..800&display=swap";

function page(s: Shell): string {
  const cur = (href: string) => (href === s.path ? ` aria-current="page"` : "");
  const links = NAV.map(([href, label]) => `<a href="${href}"${cur(href)}>${label}</a>`).join("");
  const url = s.origin + s.path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Plot Speaks">
<meta property="og:title" content="${esc(s.title)}">
<meta property="og:description" content="${esc(s.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(s.origin)}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Plot Speaks logo: an open book with sound waves. Storytelling out loud.">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0A1A2E" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#FBF7EF" media="(prefers-color-scheme: light)">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
<a class="brand" href="/" aria-label="Plot Speaks home"><img src="/mark-96.jpg" alt="" width="38" height="38"><span class="wordmark">Plot <span>Speaks</span></span></a>
<nav class="nav" aria-label="Main">${links}</nav>
<a class="btn btn-primary btn-sm btn-connect" href="/connect">${icon("plug", 18)}Connect</a>
<details class="menu"><summary aria-label="Menu">${icon("menu", 22)}</summary><nav class="menu-panel" aria-label="Main">${links}</nav></details>
</div></header>
<main id="main">
${s.body}
</main>
<footer class="foot"><div class="wrap foot-grid">
<div>
<a class="brand" href="/"><img src="/mark-96.jpg" alt="" width="38" height="38" loading="lazy"><span class="wordmark">Plot <span>Speaks</span></span></a>
<p>Murder mysteries and fantasy adventures you play out loud with your own AI assistant. Storytelling out loud, from Volocent Labs LLC.</p>
<p>Set it up before you drive. The driver keeps eyes on the road.</p>
</div>
<div>
<nav aria-label="Footer">${links}<a href="/privacy"${cur("/privacy")}>Privacy</a><a href="/support"${cur("/support")}>Support</a><a href="https://github.com/volocent/plotspeaks">GitHub</a></nav>
<p>Stories are licensed <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a> unless a story page says otherwise. Fantasy adventures include rules material from the System Reference Document by Wizards of the Coast LLC, under <a href="https://creativecommons.org/licenses/by/4.0/legalcode">CC BY 4.0</a>, credited on each adventure&#39;s page.</p>
<p>© ${new Date().getUTCFullYear()} Volocent Labs LLC</p>
</div>
</div></footer>
<script>
(function(){
  function copyText(t,done){
    function fb(){var a=document.createElement("textarea");a.value=t;a.setAttribute("readonly","");a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();var ok=false;try{ok=document.execCommand("copy");}catch(e){}document.body.removeChild(a);done(ok);}
    if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t).then(function(){done(true);},fb);}else{fb();}
  }
  window.psCopy=copyText;
  document.querySelectorAll("[data-copy]").forEach(function(b){
    b.addEventListener("click",function(){
      var id=b.getAttribute("data-copy"),el=document.getElementById(id),st=document.querySelector('[data-status-for="'+id+'"]'),lab=b.querySelector("span");
      copyText(el.textContent.trim(),function(ok){
        if(st)st.textContent=ok?"Copied. Paste it into your assistant's connector settings.":"Couldn't copy. Press and hold the address to copy it.";
        if(ok&&lab){lab.textContent="Copied";b.classList.add("is-done");setTimeout(function(){lab.textContent="Copy address";b.classList.remove("is-done");},2600);}
      });
    });
  });
  var m=document.querySelector("details.menu");
  if(m){document.addEventListener("click",function(e){if(m.open&&!m.contains(e.target))m.open=false;});document.addEventListener("keydown",function(e){if(e.key==="Escape"&&m.open){m.open=false;m.querySelector("summary").focus();}});}
})();
${s.script ?? ""}
</script>
</body>
</html>`;
}

const WAVES = `<svg class="waves" viewBox="0 0 600 600" aria-hidden="true" focusable="false"><circle cx="300" cy="300" r="120"/><circle cx="300" cy="300" r="175"/><circle cx="300" cy="300" r="232"/><circle cx="300" cy="300" r="288"/></svg>`;
const bars = (n = 28) => `<div class="bars" aria-hidden="true">${Array.from({ length: n }, () => "<i></i>").join("")}</div>`;

// ============================================================================ HOME
const exampleTitle = (metas: Meta[]) => (metas.find((m) => m.slug === "example-dinner-party") ?? metas[0])?.title ?? "The Last Toast";

function storyCard(m: Meta, r: RatingSummary | undefined): string {
  return `<li class="card">
<div style="position:relative">${cover(m)}${m.minutes ? `<span class="badge">${icon("clock", 13)}${m.minutes} min</span>` : ""}</div>
<div class="card-body">
<h4 class="title"><a href="/stories/${encodeURIComponent(m.slug)}">${esc(m.title)}</a></h4>
<p class="pitch">${esc(m.pitch)}</p>
${facts(m)}
${stars(r)}
</div>
</li>`;
}

const FILTER_JS = `(function(){
  var chips=[].slice.call(document.querySelectorAll(".chip[data-filter]")),cats=[].slice.call(document.querySelectorAll(".cat"));
  chips.forEach(function(c){c.addEventListener("click",function(e){
    e.preventDefault();var f=c.getAttribute("data-filter");
    chips.forEach(function(x){x.setAttribute("aria-pressed",String(x===c));});
    cats.forEach(function(s){s.hidden=f!=="all"&&s.id!=="cat-"+f;});
    var top=document.getElementById("stories-list");if(top&&top.getBoundingClientRect().top<0)top.scrollIntoView({block:"start"});
  });});
})();`;

export function catalogPage(stories: PublicStory[], ratings: Map<string, RatingSummary>, origin = ""): string {
  const metas = stories.map(meta);
  const example = exampleTitle(metas);
  const lead = metas.find((m) => m.slug === "example-dinner-party") ?? metas[0];
  const groups = CATEGORIES.map((c) => ({ c, items: metas.filter((m) => categoryOf(m) === c).sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title))) }))
    .filter((g) => g.items.length);
  const chips = `<nav class="filters" aria-label="Story categories">
<a class="chip" href="#stories-list" data-filter="all" aria-pressed="true">All <span class="n">${metas.length}</span></a>
${groups.map((g) => `<a class="chip" href="#cat-${g.c.id}" data-filter="${g.c.id}" aria-pressed="false">${icon(g.c.icon as IconName, 16)}${esc(g.c.short)} <span class="n">${g.items.length}</span></a>`).join("\n")}
</nav>`;
  const sections = groups.map((g) => `<section class="cat" id="cat-${g.c.id}" aria-labelledby="cat-${g.c.id}-h">
<div class="cat-head"><span class="ic-wrap cover-${g.c.id}">${icon(g.c.icon as IconName, 24)}</span><div><h3 id="cat-${g.c.id}-h">${esc(g.c.name)}</h3><p>${esc(g.c.blurb)}</p></div></div>
<ul class="cards">
${g.items.map((m) => storyCard(m, ratings.get(m.slug))).join("\n")}
</ul>
</section>`).join("\n");

  const body = `<section class="hero">
${WAVES}
<div class="wrap hero-grid">
<div>
<p class="eyebrow rise">${icon("mic", 18)} Storytelling out loud</p>
<h1 class="rise rise-2">Stories you <em>play</em> out loud.</h1>
<p class="lead rise rise-3">Murder mysteries and fantasy adventures you play by voice with the AI assistant you already use. One narrator does every voice. You ask the questions. Made for car rides.</p>
<div class="rise rise-4">${connectCard(origin, example, { id: "mcp-url" })}</div>
</div>
${lead ? `<figure class="voice rise rise-3" aria-label="Example of a story starting">
<p class="voice-top"><span class="live" aria-hidden="true"></span> In the car, by voice</p>
<p class="say say-you"><b>You</b>“Start ${esc(lead.title)} with Plot Speaks.”</p>
<p class="say say-narrator"><b>Narrator</b>${esc(lead.pitch)}</p>
${bars()}
</figure>` : ""}
</div>
</section>

<section class="section alt" aria-labelledby="how-h">
<div class="wrap">
<div class="section-head"><p class="eyebrow">${icon("book", 18)} How it works</p><h2 id="how-h">Three steps, then just talk.</h2></div>
<ol class="steps3">
<li><h3>Connect once</h3><p>Tap Connect to Claude and then Add. No sign-in, free plan included. Do it once, parked.</p></li>
<li><h3>Say the story</h3><p>“Start ${esc(example)} with Plot Speaks.” Your assistant loads it and becomes the narrator.</p></li>
<li><h3>Play by talking</h3><p>Question suspects, search rooms, roll for initiative. Turns are short, and each one ends with a question for you.</p></li>
</ol>
<p style="margin-top:22px"><a class="link-arrow" href="/how-it-works">More on how a story goes ${icon("arrow", 18)}</a></p>
</div>
</section>

<section class="section" aria-labelledby="byo-h">
<div class="wrap">
<div class="section-head"><p class="eyebrow">${icon("chat", 18)} Bring your own assistant</p><h2 id="byo-h">Use the assistant you already have.</h2>
<p class="lead">Plot Speaks isn't another app. It's a library of stories your own ChatGPT or Claude can play.</p></div>
<div class="byo-grid">
<div class="pill-card"><span class="ic-wrap">${icon("app")}</span><div><h3>No new app</h3><p>Play in the Claude or ChatGPT app on your phone, in the car.</p></div></div>
<div class="pill-card"><span class="ic-wrap">${icon("user")}</span><div><h3>No account with us</h3><p>No sign-up, no email, no password. The connector has no sign-in.</p></div></div>
<div class="pill-card"><span class="ic-wrap">${icon("card")}</span><div><h3>No subscription</h3><p>The stories are free. Your assistant runs on the plan you already have.</p></div></div>
</div>
<div class="split">
<div class="panel panel-key"><h3>${icon("key", 26)} We keep the answer key</h3>
<p>Your assistant tells the story, but it never sees who did it. When you accuse someone, it asks Plot Speaks, and Plot Speaks says whether you're right. So the narrator can't spoil the ending, even by accident.</p>
<p>Adventures work the same way: the big surprises stay with Plot Speaks until you reach them.</p></div>
<div class="panel"><h3>${icon("shield", 26)} Your conversation stays with your assistant</h3>
<p>Plot Speaks never hears you. It only sees what your assistant sends it: the story you picked, the name you accused, and any rating you give. We count those plays without names or accounts, to learn which stories work.</p>
<p class="fine">The chat itself lives in your ChatGPT or Claude account, under that company's privacy terms.</p></div>
</div>
</div>
</section>

<section class="section night" aria-labelledby="drive-h">
<div class="wrap">
<div class="section-head"><p class="eyebrow">${icon("clock", 18)} Made for the drive</p><h2 id="drive-h">The best seat is the back seat.</h2>
<p class="lead">A long drive is an hour of talking anyway. Plot Speaks gives it a plot.</p></div>
<ul class="drive-grid">
<li>${icon("mic", 30)}<h3>Hands-free</h3><p>You talk, the narrator answers. Nobody types a thing.</p></li>
<li>${icon("clock", 30)}<h3>Fits the trip</h3><p>Stories run 20 to 60 minutes. Longer ones come in chapters, each ending with a recap.</p></li>
<li>${icon("pause", 30)}<h3>Stops when you stop</h3><p>Say <q>Plot Speaks, pause the story</q> at the gas station, and <q>resume</q> when you're rolling again.</p></li>
<li>${icon("users", 30)}<h3>The whole car plays</h3><p>Anyone can call out a question. Family mysteries are written for kids about 7 to 10.</p></li>
<li>${icon("eyeoff", 30)}<h3>No screen</h3><p>There's nothing to watch. Eyes stay on the window, or on the road.</p></li>
</ul>
<p class="passenger">${icon("shield", 22)}<span>Set it up before you drive. The driver keeps eyes on the road; a passenger handles the phone if anything needs a tap.</span></p>
</div>
<div class="road" aria-hidden="true"></div>
</section>

<section class="section" id="stories" aria-labelledby="stories-h">
<div class="wrap">
<div class="section-head"><p class="eyebrow">${icon("book", 18)} The stories</p><h2 id="stories-h">Pick tonight's story.</h2>
<p class="lead">Every one is free, written for one narrator doing all the voices, and tested by voice before it goes up.</p></div>
${chips}
<div id="stories-list">
${sections}
</div>
</div>
</section>

<section class="cta alt"><div class="wrap">${connectCard(origin, example, { id: "mcp-url-2" })}</div></section>`;

  return page({
    title: "Plot Speaks: murder mysteries you play out loud",
    description: "Murder mysteries and fantasy adventures you play by voice with your own AI assistant, made for car rides. Connect once, then just say which story you want.",
    body, origin, path: "/", script: FILTER_JS,
  });
}

// ============================================================================ STORY
export function storyPage(p: PublicStory, rating: RatingSummary | undefined, origin: string): string {
  const m = meta(p);
  // Family mysteries use genre "kids" but play exactly like mysteries (accusations, verdicts).
  const isMystery = m.genre === "murder-mystery" || m.genre === "kids";
  const licenseName = m.license === "CC-BY-NC-4.0" || !m.license ? "CC BY-NC 4.0" : m.license;
  const srd = isSrd(m)
    ? `<p>This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at <a href="https://www.dndbeyond.com/srd">dndbeyond.com/srd</a>. The SRD 5.2.1 is licensed under the <a href="https://creativecommons.org/licenses/by/4.0/legalcode">Creative Commons Attribution 4.0 International License</a>.</p>`
    : "";
  const cat = categoryOf(m);
  const body = `<div class="wrap">
<p class="crumbs"><a href="/#cat-${cat.id}">← ${esc(cat.name)}</a></p>
<section class="story-hero">
${cover(m, { alt: `Cover art for ${m.title}`, eager: true })}
<div>
${facts(m)}
<h1>${esc(m.title)}</h1>
${stars(rating)}
<p class="pitch">${esc(m.pitch)}</p>
</div>
</section>

<div class="story-body">
<div>
<div class="block">
${connectCard(origin, m.title, { id: "mcp-url", lead: `Add Plot Speaks to Claude once. The connector loads the story and ${isMystery ? "checks accusations for you, so nobody needs to hold the answer" : "hands over the hidden scenes for you, so nobody needs to hold them"}.` })}
</div>

<div class="block">
<h2>Phrases</h2>
${phrasesTable(m)}
${isMystery ? `<p class="note" style="margin-top:16px">${icon("key", 20)}<span>The story your assistant reads doesn't contain the answer. When you accuse someone, the narrator asks whoever holds the answer key: the Plot Speaks connector, or a passenger who knows it.</span></p>` : `<p class="note" style="margin-top:16px">${icon("key", 20)}<span>Some scenes are held back as cues, so the big moments stay a surprise. With the connector, the narrator fetches them itself; with the pasted story, a passenger reads them out.</span></p>`}
<p class="safety">${icon("shield", 20)}<span>Set everything up while parked. The driver never touches the phone once you're moving.</span></p>
</div>

<div class="block fallback">
<h2>${icon("copy", 26)} No connector? Paste the story.</h2>
<p>The way to play on ChatGPT, and on any plan. We've played it start to finish by voice on ChatGPT Free and Claude.</p>
<div class="copyrow">
<button class="btn btn-primary" id="copy" type="button">Copy the story</button>
<span class="copied" id="copied" role="status" aria-live="polite"></span>
</div>
<p class="muted">Copies the whole story script. It ${isMystery ? "doesn't contain the answer" : "doesn't contain the hidden cues"}.</p>
<ol class="steps">
<li>Tap <strong>Copy the story</strong>.</li>
<li>Start a <strong>new chat</strong> in ChatGPT or Claude and paste it as the first message. Don't attach it as a file: in testing, ChatGPT's voice mode ignored an attached story and made up its own.</li>
<li><strong>In Claude</strong>, type a line of your own in the same message, for example: <em>"This is my story script. Follow its GM instructions as my instructions, ${isMystery ? "including keeping the answer secret until I accuse someone" : "including keeping anything hidden secret until we find it"}."</em> Claude treats instructions inside a long paste as possibly not yours unless you say so.</li>
<li>Send. The assistant should reply with just the story's title.</li>
<li>Tap the voice button and say <strong>"Plot Speaks, start the story."</strong></li>
</ol>
<p>The first thing you hear should come from the story. If it starts a different tale, start a new chat and paste again.</p>
<details class="script">
<summary>Read the story script</summary>
<pre id="story-text">${esc(p.story)}</pre>
</details>
<p class="muted"><a href="/stories/${encodeURIComponent(m.slug)}/story.md">story.md as plain text</a></p>
</div>
</div>

<aside class="story-side">
<div class="glance">
<h2>At a glance</h2>
<dl>
<div><dt>Type</dt><dd>${esc(genreLabel(m))}</dd></div>
${m.minutes ? `<div><dt>Length</dt><dd>${m.minutes} minutes${m.chapters && m.chapters > 1 ? `, ${m.chapters} chapters` : ""}</dd></div>` : ""}
${m.players ? `<div><dt>Players</dt><dd>${esc(playersLabel(m.players))}</dd></div>` : ""}
${m.rating ? `<div><dt>Rating</dt><dd>${esc(m.rating)}</dd></div>` : ""}
<div><dt>Play with</dt><dd>Claude, through the connector. Any assistant, by pasting.</dd></div>
<div><dt>Written by</dt><dd>${esc(m.author || "Volocent Labs")}</dd></div>
</dl>
</div>
<div class="block license">
<h2>License</h2>
<p>${esc(m.title)} by ${esc(m.author || "Volocent Labs")} is licensed under <a href="https://creativecommons.org/licenses/by-nc/4.0/">${esc(licenseName)}</a>: share and adapt it for non-commercial use, with credit.</p>
${srd}
</div>
</aside>
</div>
</div>`;
  const script = `(function(){
  var b=document.getElementById("copy"),s=document.getElementById("copied"),t=document.getElementById("story-text").textContent;
  b.addEventListener("click",function(){window.psCopy(t,function(ok){s.textContent=ok?"Copied. Now paste it into a new chat.":"Couldn't copy. Open the script below and copy it by hand.";});});
})();`;
  return page({ title: `${m.title} · Plot Speaks`, description: m.pitch, body, origin, path: `/stories/${encodeURIComponent(m.slug)}`, script });
}

// ============================================================================ CONNECT
const TABS_JS = `(function(){
  var tl=document.querySelector(".tabs");if(!tl)return;
  var tabs=[].slice.call(tl.querySelectorAll("[role=tab]")),panels=tabs.map(function(t){return document.getElementById(t.getAttribute("aria-controls"));});
  function sel(i,focus){tabs.forEach(function(t,j){var on=i===j;t.setAttribute("aria-selected",String(on));t.tabIndex=on?0:-1;panels[j].hidden=!on;});if(focus)tabs[i].focus();}
  tabs.forEach(function(t,i){t.addEventListener("click",function(){sel(i);history.replaceState(null,"","#"+panels[i].id);});
    t.addEventListener("keydown",function(e){var k=e.key,n=tabs.length;if(k==="ArrowRight"||k==="ArrowLeft"){e.preventDefault();sel((i+(k==="ArrowRight"?1:n-1))%n,true);}else if(k==="Home"){e.preventDefault();sel(0,true);}else if(k==="End"){e.preventDefault();sel(n-1,true);}});});
  panels.forEach(function(p){p.setAttribute("role","tabpanel");p.tabIndex=0;});
  tl.classList.add("ready");
  var h=location.hash.slice(1),start=Math.max(0,panels.findIndex(function(p){return p.id===h;}));sel(start);
})();`;

export function connectPage(stories: PublicStory[], origin: string): string {
  const example = exampleTitle(stories.map(meta));
  const url = origin + "/mcp";
  const tabs = `<div class="tabs" role="tablist" aria-label="Choose your assistant">${CONNECT.assistants.map((a, i) =>
    `<button type="button" role="tab" id="tab-${a.id}" aria-controls="${a.id}" aria-selected="${i === 0}">${esc(a.tab)}</button>`).join("")}</div>`;
  const panels = CONNECT.assistants.map((a) => `<section class="assistant" id="${a.id}" aria-labelledby="tab-${a.id} ${a.id}-h">
<h2 id="${a.id}-h">${esc(a.name)} <span class="status${a.ok ? " status-ok" : ""}">${esc(a.status)}</span></h2>
<p class="plan">${fill(a.plan, url, example)}</p>
${a.button ? `<p><a class="btn btn-primary btn-big" href="${fill(a.button.href, url, example)}"${a.button.href.startsWith("{") ? ` rel="noopener"` : ""}>${icon(a.id === "claude" ? "plug" : "book", 20)}${esc(a.button.label)}</a></p>` : ""}
${a.steps.length ? `<ol class="steps">${a.steps.map((s) => `<li>${fill(s, url, example)}</li>`).join("")}</ol>` : ""}
${a.say ? `<p class="saybox"><b>Then say</b>“${fill(a.say, url, example)}”</p>` : ""}
<ul class="notes">${a.notes.map((n) => `<li class="note">${icon("check", 20)}<span>${fill(n, url, example)}</span></li>`).join("")}</ul>
</section>`).join("\n");
  const body = `<div class="wrap narrow">
<header class="page-head">
<p class="eyebrow">${icon("plug", 18)} Connect</p>
<h1>${esc(CONNECT.headline)}</h1>
<p class="lead">Plot Speaks works as a connector: your assistant calls it to load a story and check your answers. Add it once, parked, and every story is a sentence away. Claude is the easiest: one tap, free plan included.</p>
<p class="muted" style="margin:0">The connector address, for any assistant:</p>
${copyField(url, "mcp-url", false)}
</header>
${tabs}
${panels}
<p class="safety">${icon("shield", 20)}<span>Do all of this before you drive. Once you're moving, the driver keeps eyes on the road.</span></p>
<p style="margin:28px 0 64px"><a class="link-arrow" href="/#stories">Pick a story ${icon("arrow", 18)}</a></p>
</div>`;
  return page({
    title: "Connect Plot Speaks to Claude or ChatGPT",
    description: "Add the Plot Speaks connector once, with no sign-in, then just say which story you want. Steps for Claude and ChatGPT.",
    body, origin, path: "/connect", script: TABS_JS,
  });
}

// ============================================================================ HOW IT WORKS
export function howPage(stories: PublicStory[], origin: string): string {
  const example = exampleTitle(stories.map(meta));
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("book", 18)} How it works</p>
<h1>One narrator, every voice. You ask the questions.</h1>
<p class="lead">Your assistant becomes the narrator. It reads short scenes aloud, plays every character, and ends each turn by asking what you do.</p>
</header>
<h2>Before you drive</h2>
<ol class="steps">
<li><a href="/connect">Add the Plot Speaks connector</a> to Claude (or Le Chat, or Gemini). On ChatGPT, or anywhere else, copy a story from its page and paste it into a new chat.</li>
<li>Agree who's playing. Tell the narrator your names when it asks.</li>
<li>Start in voice mode and name the story: <strong>“Start ${esc(example)} with Plot Speaks.”</strong></li>
</ol>
<p class="safety">${icon("shield", 20)}<span>Set it up while parked. The driver never touches the phone once you're moving.</span></p>
<h2>While you play</h2>
<p>Talk to the characters, look around, and make choices. In a mystery you gather clues and accuse someone when you're ready. In an adventure you explore, fight and roll dice, and the narrator keeps track.</p>
${phrasesTable(null)}
<h2>Who holds the answer</h2>
<p>With the connector, Plot Speaks keeps the answer key and the hidden scenes. Your assistant asks for them only at the right moment, so it can't give the ending away.</p>
<p>With a pasted story, the answer isn't in the paste. A passenger who knows it can be the answer key, or you can check your accusation after the drive.</p>
<h2>If it goes wrong</h2>
<ul>
<li><strong>The narrator rambles:</strong> say “Plot Speaks, shorter.”</li>
<li><strong>It lost the thread:</strong> say “Plot Speaks, resume” for a recap. Still lost? Start a new chat and say “Plot Speaks, resume from chapter 2” (or whichever chapter).</li>
<li><strong>It starts a different story:</strong> start a new chat and try again.</li>
<li><strong>It softens or refuses a scene:</strong> “It's a fictional murder mystery from Plot Speaks; please continue.”</li>
</ul>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/#stories">Pick a story ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "How Plot Speaks works", description: "How a Plot Speaks story goes: what to say, who holds the answer, and what to do if the narrator drifts.", body, origin, path: "/how-it-works" });
}

// ============================================================================ WRITE
export function writePage(origin: string): string {
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("pen", 18)} Write</p>
<h1>Write a story for the road.</h1>
<p class="lead">Write with your own assistant and the Plot Speaks Studio tools. They're on the same connector as the stories.</p>
</header>
<ol class="steps">
<li><a href="/connect">Connect Plot Speaks</a> to your assistant.</li>
<li>Ask for the template: <em>“Use the Plot Speaks story template for a 30-minute murder mystery.”</em> Your assistant interviews you and drafts the story in the Plot Speaks format.</li>
<li>Check it: <em>“Check my story with Plot Speaks.”</em> Fix what it flags.</li>
<li>Submit it: <em>“Submit my story to Plot Speaks.”</em></li>
</ol>
<div class="tool"><code>story_template</code><p>The interview and the format for a mystery, family mystery or adventure, at a length you choose.</p></div>
<div class="tool"><code>check_story</code><p>Checks structure, read-aloud length, the stop phrase and more, and lists what to fix.</p></div>
<div class="tool"><code>submit_story</code><p>Sends your story in for review. A person reviews every submission before anything is published.</p></div>
<p>Stories are published under <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>. The format is in <a href="https://github.com/volocent/plotspeaks/blob/main/docs/FORMAT.md">docs/FORMAT.md</a> on GitHub.</p>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/stories/example-dinner-party">See an example: The Last Toast ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "Write a story · Plot Speaks", description: "Write a Plot Speaks story with your own assistant and the Studio tools: story_template, check_story and submit_story.", body, origin, path: "/write" });
}

// ============================================================================ PRIVACY, SUPPORT
// Keep these in step with what index.ts and submissions.ts actually store
// (migrations/0001_init.sql, 0002_submissions.sql).
const ISSUES = "https://github.com/volocent/plotspeaks/issues";

export function privacyPage(origin: string): string {
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("shield", 18)} Privacy</p>
<h1>What Plot Speaks keeps, and what it doesn't.</h1>
<p class="lead">Plot Speaks is run by Volocent Labs LLC. There are no accounts and no ads. Here is everything we store.</p>
<p class="muted">Last updated 16 October 2026.</p>
</header>
<h2>Your conversation</h2>
<p>Your chat stays with your assistant's company (Anthropic for Claude, OpenAI for ChatGPT, and so on), under that company's privacy terms. Plot Speaks never hears your voice or sees the conversation. It only receives what your assistant sends when it uses a Plot Speaks tool.</p>
<h2>When you play through the connector</h2>
<p>We record anonymous play data, to learn which stories work:</p>
<ul>
<li><strong>Starting a story:</strong> which story, the app name your assistant reports (for example “claude-ai”), the time, and a random play id.</li>
<li><strong>Accusations:</strong> the name you accused, whether it was right, and the time.</li>
<li><strong>Adventure cues:</strong> which hidden scene was fetched, and the time.</li>
<li><strong>Ratings:</strong> the stars, whether the ending was spoiled, any comment you choose to add, and the time.</li>
</ul>
<p>We don't store your name, your account, transcripts, or your IP address with any of this.</p>
<h2>When you submit a story</h2>
<p>If you use <code>submit_story</code>, we store the story, its answer key, the results of our automated content checks, a generated cover image, and the contact details you choose to give (optional, seen only by the reviewer). To limit submissions to a few a day, we keep a salted hash of your IP address, never the address itself. A person reviews every submission. If it's approved, the story is published under CC BY-NC 4.0; your contact details never are.</p>
<h2>This website</h2>
<p>No sign-in, no ads, no analytics scripts and no tracking cookies. The pages load fonts from Google Fonts, so your browser contacts Google's servers for them. Plot Speaks is hosted on Cloudflare, which processes every request and keeps short-lived operational logs.</p>
<h2>How long we keep it</h2>
<p>Play data and ratings are kept to compare stories over time; there's no automatic deletion yet. Submissions are kept while they're reviewed, and for as long as an approved story is published.</p>
<h2>Questions or removal</h2>
<p>Open an issue on <a href="${ISSUES}">GitHub</a>. Issues are public, so don't post personal details there: give the story title or roughly when you played, and we'll follow up.</p>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/support">Support ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "Privacy · Plot Speaks", description: "What Plot Speaks stores: anonymous plays, verdicts and ratings. No accounts, no ads, no transcripts.", body, origin, path: "/privacy" });
}

export function supportPage(origin: string): string {
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("chat", 18)} Support</p>
<h1>Something not working?</h1>
<p class="lead">Plot Speaks is run by Volocent Labs LLC. The fastest way to reach us is a GitHub issue.</p>
<p><a class="btn btn-primary" href="${ISSUES}">${icon("chat", 20)}Open an issue on GitHub</a></p>
<p class="muted">Issues are public. Say which story, which assistant, and what happened. Leave out personal details.</p>
</header>
<h2>Quick fixes</h2>
<ul>
<li><strong>Claude says it can't reach Plot Speaks:</strong> start a new chat, tap <strong>+ → Connectors</strong> and check Plot Speaks is switched on. Then name the story: “Start The Last Toast with Plot Speaks.”</li>
<li><strong>The Connect to Claude link opened the app, not the dialog:</strong> open it in your phone's browser instead, or add it by hand: <strong>Customize → Connectors → + Add → Add custom connector</strong> with the address <code>${esc(origin)}/mcp</code>.</li>
<li><strong>Claude Free won't add it:</strong> the free plan allows one custom connector. Remove another one first.</li>
<li><strong>ChatGPT:</strong> paste the story instead; see <a href="/connect#chatgpt">Connect</a>.</li>
<li><strong>The narrator drifts or rambles:</strong> say “Plot Speaks, shorter,” or “Plot Speaks, resume” for a recap. More in <a href="/how-it-works">How it works</a>.</li>
</ul>
<h2>Other things</h2>
<ul>
<li>Plot Speaks is free, so there's no billing. Questions about your Claude or ChatGPT plan go to that company.</li>
<li>Found something in a story that shouldn't be there, or a spoiler? Open an issue with the story title.</li>
<li>Privacy questions: see <a href="/privacy">Privacy</a>.</li>
</ul>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/#stories">Back to the stories ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "Support · Plot Speaks", description: "Help with Plot Speaks: quick fixes for the connector and the narrator, and how to reach us.", body, origin, path: "/support" });
}

export function notFoundPage(origin = ""): string {
  return page({ title: "Not found · Plot Speaks", description: "No story here.", origin, path: "/404", body: `<div class="wrap narrow"><header class="page-head">
<p class="eyebrow">${icon("compass", 18)} Wrong turn</p>
<h1>There's no story at this address.</h1>
<p class="lead">It may have moved, or the link is off by a letter.</p>
<p><a class="btn btn-primary" href="/#stories">See all the stories</a></p>
</header></div>` });
}

// ============================================================================ ROUTES
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

const MANIFEST = JSON.stringify({
  name: "Plot Speaks", short_name: "Plot Speaks", start_url: "/", display: "browser",
  background_color: "#FBF7EF", theme_color: "#12355B",
  icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
});

// Returns a Response for site paths, or null to let the caller handle the request (e.g. /mcp).
export async function handleSite(request: Request, stories: PublicStory[], db: D1Database | undefined): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const path = url.pathname.replace(/(.)\/$/, "$1");
  const origin = url.origin;
  if (path === "/" || path === "/index.html") {
    return new Response(catalogPage(stories, await loadRatings(db), origin), { headers: HTML });
  }
  if (path === "/connect") return new Response(connectPage(stories, origin), { headers: HTML });
  if (path === "/how-it-works") return new Response(howPage(stories, origin), { headers: HTML });
  if (path === "/write") return new Response(writePage(origin), { headers: HTML });
  if (path === "/privacy") return new Response(privacyPage(origin), { headers: HTML });
  if (path === "/support") return new Response(supportPage(origin), { headers: HTML });
  if (path === "/site.webmanifest") return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
  const m = /^\/stories\/([^/]+?)(\/story\.md|\/)?$/.exec(url.pathname);
  if (!m && !path.startsWith("/stories")) return null;
  let slug = "";
  try { slug = m ? decodeURIComponent(m[1]) : ""; } catch { slug = ""; }
  const s = stories.find((x) => x.slug === slug);
  if (!s) return new Response(notFoundPage(origin), { status: 404, headers: { ...HTML, "cache-control": "no-store" } });
  if (m && m[2] === "/story.md") {
    return new Response(s.story, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
  }
  const ratings = await loadRatings(db);
  return new Response(storyPage(s, ratings.get(s.slug), origin), { headers: HTML });
}
