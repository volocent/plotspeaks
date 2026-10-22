// Plot Speaks website, served by the same Worker as the MCP endpoint.
//
//   GET /                        home: what it is, bring your own AI, car rides, the stories
//   GET /stories/<slug>          one story: cover, pitch, connect (primary), copy-and-paste (fallback)
//   GET /stories/<slug>/story.md the public story.md as plain text
//   GET /stories/<slug>/passenger for the passenger: holds the answer key in paste play, fetched
//                                tap by tap from /api/stories/<slug>/... (index.ts), never in the HTML
//   GET /connect                 how to add the connector, per assistant
//   GET /how-it-works            how a session goes, the phrases, what to do if it goes wrong
//   GET /write                   for writers: the Studio tools and submit_story
// Static files (logo, icons, og image, covers) live in worker/public and are served by the
// assets binding before this code runs; index.ts answers other /covers/ paths (submissions, 404).
//
// NO SECRETS ON THESE PAGES. The generated story data also carries each mystery's Endings
// detail lines (the verdicts check_accusation returns), the full reveals (reveal_solution) and
// each adventure's cue read-aloud text (get_cue).
// This module never sees them: it only accepts a PublicStory, which index.ts builds with
// toPublic() from the slug and the public story.md text alone, and every field shown here
// (title, genre, rating, pitch...) is parsed from that text's front matter and cold open.
// worker/test/smoke.mjs fetches every page and asserts that no answer-key line and no ending or
// cue text appears.
//
// All story-derived text is escaped with esc(). The only scripts are small inline ones: the copy
// buttons, the category filter, the /connect tabs and the passenger page. Every page but the
// passenger page works without them (it needs script to fetch a line on tap).
import { kindOf, isFamily } from "../../tools/check-story/rules.mjs";
import type { Profile } from "./profile";
import news from "./generated/news.json";

export type PublicStory = { slug: string; story: string; testing?: boolean };
// passed: players (not testers) who marked a story still being tested as passing their test.
export type RatingSummary = { avg: number; count: number; passed?: number };

type Meta = {
  slug: string; title: string; description: string; genre: string; tone: string; kind: string; audience: string; players: string;
  minutes: number | null; chapters: number | null; rating: string; license: string;
  rulesSystem: string; author: string; pitch: string; testing: boolean;
  // metadata.style: "gamebook" puts a choose-your-path story on its own shelf (Ben, 2026-10-17).
  style: string;
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
  // metadata.pitch (Ben, 2026-10-16): a two-sentence summary of the situation with no clue and no
  // answer, written per story. Older stories without one fall back to the cold open's first beat.
  const pitch = field("pitch");
  return {
    slug: p.slug,
    title: field("title") || p.slug,
    description,
    genre: field("genre"),
    tone: field("tone").toLowerCase(),
    style: field("style").toLowerCase(),
    kind: kindOf({ kind: field("kind"), genre: field("genre") }) as string,
    audience: isFamily({ audience: field("audience"), genre: field("genre") }) ? "family" : "general",
    players: field("players"),
    minutes: Number(field("duration_minutes")) || null,
    chapters: Number(field("chapters")) || null,
    rating: field("rating"),
    license: field("license"),
    rulesSystem: field("rules_system"),
    author: field("author"),
    pitch: pitch || plain(beat1 ? beat1[1] : description),
    testing: Boolean(p.testing),
  };
}

// ============================================================================ CONNECT STEPS
// The one place to update connector instructions. Shown on /connect (full) and summarised on
// the home and story pages. Strings may hold simple trusted HTML (<strong>, <em>, <a>, <code>):
// they are written here, never taken from a story or a request. "{url}" is replaced with the
// connector address, "{claude}" with the Claude install link and "{story}" with a story title.
// Source: docs/research-notes/connector-setup-2026.md (read 2026-10-16), "Connect in 30
// seconds". Voice through the connector is confirmed for Claude only (our test, 2026-10-15).
// The order here is the order of the Connect buttons (home, story pages) and of /connect:
// Claude, ChatGPT, Gemini, then everything else under "Other assistants" (OTHERS below).
// Each assistant has a short pop-up version ("pop", the dialog the Connect buttons open) and the
// full /connect version (plan, steps, notes). Placeholders in pop strings, besides the above:
// "{pick}" (how to get a story to paste) and "{passenger}" (the passenger page, linked when the
// page is a story page).
type Assistant = {
  id: string; name: string; tab: string; status: string; ok?: boolean; plan: string;
  // The Connect button's label. Text only, no company logos (Ben, 2026-10-16: brand rules are
  // being checked). aiButtons() has the slot: give an assistant `logo` (trusted inline SVG) and
  // it shows before the name.
  btn: string; logo?: string;
  // The pop-up's heading. Text-only wording from directories-and-logos-2026.md §1: "Connect to
  // Claude", "Use with ChatGPT", "Works with Gemini". Never "partnered with".
  title: string;
  button?: { href: string; label: string };
  steps: string[]; open?: string; say?: string; notes: string[];
  pop: { lead: string; steps?: string[]; stepsHead?: string; alt?: { head: string; text: string }; notes: string[] };
  others?: boolean;
};
// "Other assistants": a one-liner each in the pop-up, the steps on /connect. popup: false keeps an
// entry on /connect only. The old /connect anchors (#lechat, #more, #copilot) land on the Other tab.
// Mistral renamed Le Chat to Vibe on 2026-05-28 (docs/research-notes/directories-and-logos-2026.md §3);
// the id stays "lechat" so old links still land on it.
type Other = { id: string; name: string; status: string; line: string; how?: string; popup: boolean };
const OTHERS: Other[] = [
  { id: "lechat", name: "Vibe (formerly Le Chat)", status: "Free plan works", popup: true,
    line: "Free plan works. We haven't tested voice play yet.",
    how: "In Vibe on the web (chat.mistral.ai), open <strong>Connectors → + Add Connector → Custom MCP Connector</strong>. Name it <strong>PlotSpeaks</strong> (no spaces), paste <code>{url}</code> and tap <strong>Connect</strong>." },
  { id: "perplexity", name: "Perplexity", status: "Paid plans · untested", popup: true,
    line: "Paid plans can add it by its address. We haven't played a story through it yet.",
    how: "<strong>Plugins → Add custom → Connector → Add MCP connector → Remote</strong>. Name it Plot Speaks, paste <code>{url}</code>, choose <strong>OAuth</strong> if it asks (or use the address without an account and choose <strong>None</strong>), tick the box and tap <strong>Add</strong>." },
  { id: "grok", name: "Grok", status: "Untested", popup: true,
    line: "It can add a custom connector by address, but which plans and devices support it isn't documented. Untested.",
    how: "Go to <strong>grok.com/connectors → New Connector → Custom</strong> and paste <code>{url}</code>." },
  // Claude Code (the directory form's "Claude Code external link" points here, #claude-code). Text
  // only, not voice: for writers drafting and checking a story, or trying a game at the keyboard.
  { id: "claude-code", name: "Claude Code", status: "For writers · text", popup: true,
    line: "Write and check your own story or game from the terminal: Claude Code can use every Plot Speaks tool, including write_story, review_story and submit_story. Play there is by text, not voice.",
    how: "Run <code>claude mcp add --transport http plot-speaks https://account.plotspeaks.com/mcp</code>, then in Claude Code type <code>/mcp</code>, pick plot-speaks and sign in with Google (it keeps your saved progress). Without an account: <code>claude mcp add --transport http plot-speaks https://plotspeaks.com/mcp</code>. Then ask: <em>\"Help me write a Plot Speaks story.\"</em>" },
  // Meta AI: the Meta AI app and meta.ai don't support connectors (directories-and-logos-2026.md §2.4, 2026-10-16).
  { id: "metaai", name: "Meta AI", status: "No connectors yet", popup: true,
    line: "Meta AI can't add connectors yet. Pasting a story may work, but we haven't tested it." },
  { id: "copilot", name: "Microsoft Copilot", status: "Not supported", popup: false,
    line: "Copilot's consumer app has no way to add a custom connector. Pasting a story may work, but we haven't tested it." },
];
// The opening line (Ben, 2026-10-16): "Open Plot Speaks" gives a short intro and the choice of
// browsing, starting or writing a story. Naming a story still goes straight in.
const OPEN_LINE = "Open Plot Speaks.";
// Claude's documented prefilled "Add custom connector" link (directory-vs-custom docs).
const claudeLink = (mcpUrl: string) =>
  `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("Plot Speaks")}&connectorUrl=${encodeURIComponent(mcpUrl)}`;
const CONNECT: { headline: string; short: string; assistants: Assistant[] } = {
  headline: "Connect once, then just say which story you want.",
  short: "Pick your assistant and connect it once. Plot Speaks brings the story and keeps the answer key.",
  assistants: [
    {
      id: "claude", name: "Claude", tab: "Claude", btn: "Claude", title: "Connect to Claude", status: "Recommended · works by voice", ok: true,
      plan: "Works on every Claude plan, including Free. Free accounts can add one custom connector, and Plot Speaks will use it. On a Team or Enterprise account, your admin adds it first.",
      button: { href: "{claude}", label: "Connect to Claude" },
      steps: [
        "Tap <strong>Connect to Claude</strong>. It opens claude.ai in your browser. Sign in to Claude if asked.",
        "Check the name says <strong>Plot Speaks</strong> and tap <strong>Add</strong>. A Plot Speaks window opens: <strong>sign in with Google</strong> and tap <strong>Allow</strong>. That's what keeps your saved progress in stories and games.",
        "Open the Claude app, start a new chat, tap <strong>+ → Connectors</strong> and make sure Plot Speaks is on.",
        "Tap the voice button and say <strong>“Open Plot Speaks.”</strong> for a quick intro and a choice of stories, or name one: <strong>“Start {story} with Plot Speaks.”</strong> Allow Plot Speaks when Claude asks, or choose <em>Always allow</em> so it doesn't ask mid-drive.",
      ],
      open: OPEN_LINE,
      say: "Start {story} with Plot Speaks.",
      notes: [
        "Adding it works best in a browser, so on a phone open the link there. Once added, the connector shows up in the Claude phone app on its own.",
        "Voice works: in our test, Claude's voice mode loaded the story and checked an accusation through the connector.",
        "Say “Open Plot Speaks” or the story's name. A vague “play something” can send Claude on a detour.",
        "<strong>Asked to allow Plot Speaks?</strong> Choose <strong>Always allow</strong> each time it asks (a game uses a handful of tools), or set them all at once under <strong>Settings → Connectors → Plot Speaks</strong>. Then it stops asking.",
        "Doing it by hand: <strong>Customize → Connectors → + Add → Add custom connector</strong>, name it Plot Speaks and paste <code>{url}</code>.",
        "Rather not sign in? <a href=\"{claudeplain}\" rel=\"noopener\">Connect without an account</a> (or paste <code>{url}</code>). Every story and game still plays, but nothing is saved between chats.",
      ],
      pop: {
        lead: "One tap. Check the name says <strong>Plot Speaks</strong>, tap <strong>Add</strong>, then <strong>sign in with Google</strong> and tap <strong>Allow</strong>. Signing in keeps your saved progress in stories and games.",
        notes: [
          "Rather not sign in? <a href=\"{claudeplain}\" rel=\"noopener\">Connect without an account</a>. Everything plays, but nothing is saved between chats.",
          "<strong>On a phone</strong>, open the link in your browser. Once it's added, Plot Speaks appears in the Claude app and works in voice mode.",
          "In a new chat, tap <strong>+ → Connectors</strong> and make sure Plot Speaks is on.",
          "<strong>Asked to allow Plot Speaks?</strong> Choose <strong>Always allow</strong> each time it asks (a game uses a handful of tools), or set them all at once under <strong>Settings → Connectors → Plot Speaks</strong>. Then it stops asking.",
          "<strong>Free plan:</strong> one custom connector is included, and Plot Speaks can be it. On Team or Enterprise, your admin adds it first.",
        ],
      },
    },
    {
      id: "chatgpt", name: "ChatGPT", tab: "ChatGPT", btn: "ChatGPT", title: "Use with ChatGPT", status: "Free and Plus: paste",
      plan: "Today, custom connectors in ChatGPT need a <strong>Business, Enterprise or Edu</strong> plan. On <strong>Free and Plus</strong>, paste the story instead. It plays start to finish by voice: we've tested it on ChatGPT Free.",
      button: { href: "/stories", label: "Pick a story to paste" },
      steps: [
        "Open a story page and tap <strong>Copy the story</strong>.",
        "Start a <strong>new chat</strong> and paste it as the first message. Don't attach it as a file.",
        "Send, then tap the voice button and say <strong>“Plot Speaks, start the story.”</strong>",
      ],
      say: "Plot Speaks, start the story.",
      notes: [
        "Without the connector, the answer key isn't in the chat. A passenger can hold it: every story page links a <strong>passenger page</strong> that shows the line to read aloud when the narrator asks.",
        "On a Business, Enterprise or Edu plan, add it on the web: <strong>Plugins → + → Add custom MCP server</strong>, paste <code>{url}</code> and choose OAuth, then sign in with Google when it asks.",
        "A ChatGPT app listing is planned, so Free and Plus can connect too. Until then, paste.",
      ],
      pop: {
        lead: "Today, custom connectors in ChatGPT need a <strong>Business, Enterprise or Edu</strong> plan. On Free and Plus, paste the story instead: it plays start to finish by voice.",
        stepsHead: "On Free or Plus",
        steps: [
          "{pick}",
          "Start a <strong>new chat</strong> and paste it as the first message. Don't attach it as a file.",
          "Tap the voice button and say <strong>“Plot Speaks, start the story.”</strong>",
          "Give {passenger} to a passenger. It holds the answer key, so they read out the verdict when the narrator asks.",
        ],
        alt: { head: "On Business, Enterprise or Edu", text: "On the web: <strong>Plugins → + → Add custom MCP server</strong>, paste the address and choose OAuth, then sign in with Google when it asks." },
        notes: [
          "A ChatGPT app listing is planned, so Free and Plus can connect too. No date yet.",
          "The family mysteries aren't offered in ChatGPT (its rules on content for under-13s). Play them in Claude, or by paste.",
        ],
      },
    },
    {
      id: "gemini", name: "Gemini", tab: "Gemini", btn: "Gemini", title: "Works with Gemini", status: "Typed chat · US, 18+",
      plan: "Gemini can add custom apps for people in the US who are 18 or older, on a personal Google account with Keep Activity turned on. Not on work or school accounts.",
      steps: [
        "In your phone's browser, open <strong>gemini.google.com/customize/connectors</strong> (or <strong>Menu → Settings → Connected Apps</strong>; it may sit under Personal Intelligence).",
        "Tap <strong>+ Custom</strong> (or <strong>Add a custom app</strong>), paste <code>{url}</code>, tap <strong>Next</strong> and sign in with Google when it asks.",
        "It then works in the Gemini app too In a chat, type <strong>@</strong> and tap <strong>Plot Speaks</strong> in the list (saying it doesn't pick it), and add <strong>open</strong> for the intro or the story's name. Don't say \"open Plot Speaks\" without the @: Gemini takes that as opening a phone app. Not in the list? Close the Gemini app completely and reopen it.",
      ],
      button: { href: "https://gemini.google.com/customize/connectors", label: "Open Gemini" },
      open: "@ → Plot Speaks → open",
      say: "@ → Plot Speaks → start {story}",
      notes: ["Signing in works in Gemini (checked 2026-10-20), so your progress is saved there too.", "<strong>Gemini asks you to confirm each answer.</strong> That's Gemini's rule for any app that saves something (your score, your place in a story), and it can't be turned off yet. Claude can be set to Always allow.", "Gemini Live, the voice-conversation mode, can't use custom apps yet (Google lists only its own apps and a few partners there), so Plot Speaks plays in a regular Gemini chat: tap the microphone in the chat box to speak each turn."],
      pop: {
        lead: "For people in the <strong>US</strong>, <strong>18 or older</strong>, on a <strong>personal</strong> Google account with Keep Activity on. Not on work or school accounts.",
        steps: [
          "Add it on the web: in your phone's browser, open <strong>gemini.google.com/customize/connectors</strong> (or <strong>Menu → Settings → Connected Apps</strong>; it may sit under Personal Intelligence).",
          "Tap <strong>+ Custom</strong> (or <strong>Add a custom app</strong>), paste the address, tap <strong>Next</strong> and sign in with Google when it asks.",
          "It then works in the Gemini app too. In a chat, type <strong>@</strong> and tap <strong>Plot Speaks</strong> in the list (saying it doesn't pick it), then <strong>open</strong>. Not in the list? Close the Gemini app completely and reopen it.",
        ],
        notes: ["Signing in works in Gemini (checked 2026-10-20), so your progress is saved there too.", "<strong>Gemini asks you to confirm each answer.</strong> That's Gemini's rule for any app that saves something (your score, your place in a story), and it can't be turned off yet. Claude can be set to Always allow.", "Gemini Live, the voice-conversation mode, can't use custom apps yet (Google lists only its own apps and a few partners there), so Plot Speaks plays in a regular Gemini chat: tap the microphone in the chat box to speak each turn."],
      },
    },
    {
      id: "other", name: "Other assistants", tab: "Other", btn: "Other assistants", title: "Other assistants", status: "Vibe, Perplexity, Grok",
      plan: "These can add Plot Speaks by its address too. We've tested voice play on Claude (connector) and ChatGPT (paste) only.",
      steps: [], others: true,
      open: OPEN_LINE,
      notes: ["If one gives you trouble, paste the story instead: open any story page and tap <strong>Copy the story</strong>."],
      pop: {
        lead: "These can add Plot Speaks by its address too. We've tested voice play on Claude and ChatGPT only.",
        notes: ["Anything else: paste the story. Open a story page and tap <strong>Copy the story</strong>."],
      },
    },
  ],
};
// The connector with an account (Ben, 2026-10-17: signing in is the preferred way, so progress is
// saved). It lives on its own host: account.plotspeaks.com on prod, account-dev on dev.
export function accountUrlFor(mcpUrl: string): string {
  try {
    const u = new URL(mcpUrl);
    if (u.hostname === "plotspeaks.com" || u.hostname === "www.plotspeaks.com") u.hostname = "account.plotspeaks.com";
    else if (u.hostname === "dev.plotspeaks.com" || u.hostname.endsWith(".workers.dev")) u.hostname = "account-dev.plotspeaks.com";
    return u.toString();
  } catch { return mcpUrl; }
}
// {url}/{claude}: the account connector (preferred). {plainurl}/{claudeplain}: the one without an account.
const fill = (s: string, url: string, story: string, extra: Record<string, string> = {}) =>
  // Function replacements, so a "$&" or "$'" in a title is inserted as written.
  s.replace(/\{url\}/g, () => esc(accountUrlFor(url))).replace(/\{claude\}/g, () => esc(claudeLink(accountUrlFor(url))))
    .replace(/\{plainurl\}/g, () => esc(url)).replace(/\{claudeplain\}/g, () => esc(claudeLink(url))).replace(/\{story\}/g, () => esc(story))
    .replace(/\{(pick|passenger)\}/g, (all, k) => extra[k] ?? all);

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
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  shield: `<path d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6Z"/><path d="m9 12 2 2 4-4"/>`,
  play: `<path d="M8.5 5.5v13l10-6.5Z" fill="currentColor"/>`,
  pausebars: `<path d="M9 6v12M15 6v12" stroke-width="3"/>`,
};
type IconName = keyof typeof ICON;
const icon = (name: IconName, size = 24, cls = "ic") =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;

// Cover palettes and the "Classic / Dark / Family" filter inside the Mysteries shelf. A category is
// the look of a card; the shelf it sits on is its kind (KINDS below).
const CATEGORIES: Category[] = [
  { id: "dark", name: "Dark murder mysteries", short: "Dark", icon: "moon",
    blurb: "Grim cases for grown-ups, best told after the kids are asleep.",
    match: (m) => m.kind === "mystery" && m.audience !== "family" && m.tone === "dark" },
  { id: "mystery", name: "Murder mysteries", short: "Classic", icon: "glass",
    blurb: "A body, a handful of suspects, and one of them did it. Ask questions, then accuse.",
    match: (m) => m.kind === "mystery" && m.audience !== "family" && m.tone !== "dark" },
  { id: "family", name: "Family mysteries", short: "Family", icon: "star",
    blurb: "Nobody gets hurt. Something goes missing and the kids crack the case. For ages about 7 to 10.",
    match: (m) => m.kind === "mystery" && m.audience === "family" },
  { id: "adventure", name: "Fantasy adventures", short: "Fantasy", icon: "compass",
    blurb: "Swords, spells and dice rolls. Make choices as a party and see where the road goes.",
    match: (m) => m.kind === "adventure" },
  { id: "branching", name: "Choose your path", short: "Choose your path", icon: "arrow",
    blurb: "Every choice changes the story, and the story remembers what you did.",
    match: (m) => m.kind === "branching" && m.style !== "gamebook" },
  { id: "trivia", name: "Trivia", short: "Trivia", icon: "star",
    blurb: "Boards of questions by category and difficulty. Keep score, and challenge a ruling you think is wrong.",
    match: (m) => m.kind === "trivia" },
  { id: "game", name: "Games", short: "Games", icon: "users",
    blurb: "Parlour games the narrator runs for the whole car: twenty questions, werewolf and more.",
    match: (m) => m.kind === "game" && m.style !== "winddown" },
  // Last in the list so the indexes the shelves use for their blurbs stay put.
  { id: "gamebook", name: "Your-choice adventures", short: "Your-choice", icon: "compass",
    blurb: "Classic gamebook adventures told to you aloud. You are the hero; every scene ends with two or three clear choices; some paths lead to glory and some to a sticky end, and you can always go back and choose again.",
    match: (m) => m.kind === "branching" && m.style === "gamebook" },
  { id: "campaign", name: "Open worlds", short: "Open worlds", icon: "shield",
    blurb: "No set ending: a world that remembers you, played over as many sessions as you like. Frontier towns, a freighter crew, a detective agency, gentle islands, and D&D-style campaigns.",
    match: (m) => m.kind === "campaign" },
  { id: "winddown", name: "Wind-downs", short: "Wind-downs", icon: "moon",
    blurb: "Slow, quiet pieces read softly at the end of the day: a walk to the sea, a cabin in the snow, a breathing count, and two for children. For passengers or home, not the driver.",
    match: (m) => m.kind === "game" && m.style === "winddown" },
];
const categoryOf = (m: Meta): Category => CATEGORIES.find((c) => c.match(m)) ?? CATEGORIES[1];
// The shelves, in order. Mysteries gather three categories under one shelf with filter chips.
type Kind = { id: string; name: string; icon: IconName; blurb: string; cats: string[]; note?: string };
const KINDS: Kind[] = [
  { id: "mystery", name: "Mysteries", icon: "glass", cats: ["mystery", "dark", "family"],
    blurb: "Someone is dead, or something is missing, and one of the people in front of you did it. Ask questions, then accuse.",
    note: "Family mysteries aren't offered in ChatGPT (its rules on content for under-13s); play them in Claude, or by paste." },
  { id: "adventure", name: "Adventures", icon: "compass", cats: ["adventure"], blurb: CATEGORIES[3].blurb },
  { id: "gamebook", name: "Your-choice adventures", icon: "compass", cats: ["gamebook"], blurb: "Classic gamebook adventures told to you aloud. You are the hero; every scene ends with two or three clear choices; some paths lead to glory and some to a sticky end, and you can always go back and choose again." },
  { id: "branching", name: "Choose your path", icon: "arrow", cats: ["branching"], blurb: CATEGORIES[4].blurb },
  { id: "trivia", name: "Trivia", icon: "star", cats: ["trivia"], blurb: CATEGORIES[5].blurb },
  { id: "game", name: "Games", icon: "users", cats: ["game"], blurb: CATEGORIES[6].blurb },
  { id: "campaign", name: "Open worlds", icon: "shield", cats: ["campaign"], blurb: CATEGORIES.find((c) => c.id === "campaign")!.blurb },
  { id: "winddown", name: "Wind-downs", icon: "moon", cats: ["winddown"], blurb: CATEGORIES.find((c) => c.id === "winddown")!.blurb },
];
const kindShelf = (m: Meta): Kind => KINDS.find((k) => k.id === (m.kind === "branching" && m.style === "gamebook" ? "gamebook" : m.kind === "game" && m.style === "winddown" ? "winddown" : m.kind)) ?? KINDS[0];

const GENRE: Record<string, string> = { "murder-mystery": "Murder mystery", adventure: "Fantasy adventure", kids: "Family mystery" };
const genreLabel = (m: Meta) =>
  m.genre === "murder-mystery" && m.tone === "dark" ? "Dark murder mystery"
    : m.kind === "branching" && m.style === "gamebook" ? "Your-choice adventure"
    : m.kind === "campaign" && !isSrd(m) ? "Open world"
    : GENRE[m.genre] ?? (m.genre ? m.genre.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Story");
const playersLabel = (p: string) => (p ? `${p.replace(/-/g, "–")} player${p === "1" ? "" : "s"}` : "");
const isSrd = (m: Meta) => /^srd/i.test(m.rulesSystem);
const authorOf = (m: Meta) => m.author || "Volocent Labs";
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

/**
 * The address to add (Ben, 2026-10-20): the account address by default. A signed-in visitor sees only that
 * (the server marks <body data-signed="in">); anyone else is asked to sign in first and told why, gets the
 * same address, and can choose to continue without an account, which shows the other address.
 */
function addressBlock(mcpUrl: string, id: string, label = "The address to add"): string {
  return `<div class="addr" data-addr>
<div class="if-out addr-ask">
<p class="addr-why"><strong>Sign in first?</strong> With a Google account, Plot Speaks keeps your progress: what you've played, the trivia you've already heard and your campaigns. You'll be asked to sign in when your assistant connects.</p>
<p><a class="btn btn-ghost btn-sm" data-signin href="/auth/google/start?next=/connect">${icon("user", 18)}Sign in with Google</a></p>
</div>
<p class="addr-h">${esc(label)}:</p>
${copyField(accountUrlFor(mcpUrl), `${id}-account`, false)}
<div class="if-out">
<p><button class="linkish" type="button" data-noacct>No thanks, continue without an account</button></p>
<div class="addr-plain" hidden><p class="addr-h">Without an account (everything plays; nothing is saved between chats):</p>${copyField(mcpUrl, `${id}-plain`, false)}</div>
</div>
</div>`;
}

function copyField(url: string, id: string, big = false): string {
  return `<div class="urlbox${big ? " urlbox-big" : ""}">
<code class="url" id="${id}">${esc(url)}</code>
<button class="btn ${big ? "btn-primary" : "btn-ghost"}" type="button" data-copy="${id}">${icon("copy", 20)}<span>Copy address</span></button>
</div>
<p class="copy-status" role="status" aria-live="polite" data-status-for="${id}"></p>`;
}


// ============================================================================ CONNECT BUTTONS
// BYO-AI, the headline idea (Ben, 2026-10-16; "AI" over "assistant" 2026-10-21). One Connect button per assistant, text only (no
// logos until each company's brand rules are checked; see Assistant.logo for the slot). Without
// script each button is a link to that assistant's /connect section; DIALOG_JS turns it into a
// button that opens the pop-up from connectDialogs(), which every page with buttons includes.
function byoaBadge(): string {
  return `<span class="byoa-badge"><span class="byoa-tag">BYO-AI</span><span class="byoa-name">Bring your own AI</span></span>`;
}
// `say` is the phrase that opens Plot Speaks or starts this page's story. Once the visitor has
// marked an assistant as connected (localStorage, CONNECTED_JS), the Connect buttons give way to
// one "Open in <assistant>" action: a link that opens a new chat with the phrase typed in (Claude
// and ChatGPT take a q= parameter), or a copy button where no such link exists (Gemini, others).
function aiButtons(label = "Connect your assistant", say = OPEN_LINE): string {
  const q = encodeURIComponent(say);
  // Only the words after the @: Gemini binds the app when it is picked from the @ list, never from pasted text.
  const geminiSay = say === OPEN_LINE ? "open" : `${say.replace(/ with Plot Speaks\.?$/i, "").replace(/^Start/, "start")}`;
  return `<ul class="ai-btns" aria-label="${esc(label)}">
${CONNECT.assistants.map((a) => `<li><a class="ai-btn" href="/connect#${a.id}" data-dialog="dlg-${a.id}">${a.logo ? `<span class="ai-btn-logo" aria-hidden="true">${a.logo}</span>` : ""}<span class="ai-btn-name">${esc(a.btn)}</span><span class="ai-btn-act"><span class="act-off">${icon("plug", 16)}Connect</span><span class="act-on">${icon("check", 16)}Connected</span></span></a></li>`).join("\n")}
</ul>
<div class="byoa-on" hidden>
<ul class="byoa-on-list">
<li data-on="claude" hidden><span class="status status-ok">Connected</span><strong>Claude</strong><a class="btn btn-primary btn-sm" href="https://claude.ai/new?q=${q}" rel="noopener">${icon("plug", 18)}Open in Claude</a><button class="linkish" type="button" data-on-remove="claude">Remove</button></li>
<li data-on="chatgpt" hidden><span class="status status-ok">Connected</span><strong>ChatGPT</strong><a class="btn btn-primary btn-sm" href="https://chatgpt.com/?q=${q}" rel="noopener">${icon("plug", 18)}Open in ChatGPT</a><button class="linkish" type="button" data-on-remove="chatgpt">Remove</button></li>
<li data-on="gemini" hidden><span class="status status-ok">Connected</span><strong>Gemini</strong><a class="btn btn-primary btn-sm" href="https://gemini.google.com/app" target="_blank" rel="noopener" data-copy-phrase="${esc(geminiSay)}">${icon("plug", 18)}Copy &amp; open Gemini</a><button class="linkish" type="button" data-on-remove="gemini">Remove</button></li>
<li data-on="other" hidden><span class="status status-ok">Connected</span><strong>Your assistant</strong><button class="btn btn-primary btn-sm" type="button" data-copy-phrase="${esc(say)}">${icon("copy", 18)}Copy the phrase</button><button class="linkish" type="button" data-on-remove="other">Remove</button></li>
</ul>
<span class="copied" role="status" aria-live="polite"></span>
<p class="byoa-on-say">Claude and ChatGPT open a new chat with <strong>“${esc(say)}”</strong> ready to send; Gemini opens with <strong>“${esc(geminiSay)}”</strong> copied: type <strong>@</strong>, tap <strong>Plot Speaks</strong> in the list, then paste. Not in the list? Close the Gemini app completely and reopen it. In Claude you can just say it in voice mode.</p>
</div>`;
}
// The home page's call to action, in the hero and again at the bottom: badge, buttons, the line.
function connectPanel(opts: { id: string; heading?: string }): string {
  return `<section class="byoa" aria-labelledby="${opts.id}-h">
${byoaBadge()}
${opts.heading ? `<h2 class="byoa-h" id="${opts.id}-h">${esc(opts.heading)}</h2>` : `<h2 class="byoa-h byoa-h-sm" id="${opts.id}-h">Connect your AI assistant once.</h2>`}
${aiButtons()}
<p class="byoa-line">Then just say <strong>“${esc(OPEN_LINE)}”</strong> No new app, no subscription. On Claude, sign in with Google when you connect and Plot Speaks keeps your saved progress in stories and games.</p>
</section>`;
}

type DialogCtx = { url: string; story: string; storyPage?: { passenger: string; isMystery: boolean } };
function connectDialogs(ctx: DialogCtx): string {
  const { url, story, storyPage } = ctx;
  const extra = {
    pick: storyPage
      ? `Copy this story: <span class="dlg-copy"><button class="btn btn-primary btn-sm" type="button" data-copy-story>${icon("copy", 18)}Copy the story</button><span class="copied" role="status" aria-live="polite"></span></span>`
      : `<a href="/stories" data-close>Pick a story</a> and tap <strong>Copy the story</strong> on its page.`,
    passenger: storyPage ? `<a href="${esc(storyPage.passenger)}">the passenger page</a>` : "the story's <strong>passenger page</strong> (every story page links one)",
  };
  const f = (s: string) => fill(s, url, story, extra);
  const sayStory = `Start ${story} with Plot Speaks.`;
  const thenSay = (a: Assistant) => {
    if (a.id === "gemini") return `<p class="saybox"><b>Then type</b>@ → Plot Speaks → “${esc(storyPage ? `start ${story}` : "open")}”<span class="saybox-sub">Type @ and tap Plot Speaks in the list (saying it doesn't pick it), then the rest. Not in the list? Close the Gemini app completely and reopen it. ${storyPage ? "Or “open” for the intro." : `Or name a story: “start ${esc(story)}”.`}</span></p>`;
    const sub = a.id === "chatgpt" ? "With the connector. Pasted a story? Say “Plot Speaks, start the story.”"
      : storyPage ? `Or “${esc(OPEN_LINE)}” for a quick intro and the other stories.` : `Or name a story: “${esc(sayStory)}”`;
    return `<p class="saybox"><b>Then say</b>“${esc(storyPage && a.id !== "chatgpt" ? sayStory : OPEN_LINE)}”<span class="saybox-sub">${sub}</span></p>`;
  };
  const list = (items: string[], cls = "steps") => items.length ? `<ol class="${cls}">${items.map((s) => `<li>${f(s)}</li>`).join("")}</ol>` : "";
  const notes = (items: string[]) => items.length ? `<ul class="dlg-notes">${items.map((n) => `<li${/^Rather not sign in\?/.test(n) ? ' class="if-out"' : ""}>${f(n)}</li>`).join("")}</ul>` : "";
  return CONNECT.assistants.map((a) => {
    const id = `dlg-${a.id}`;
    const copy = a.id === "claude" ? copyField(accountUrlFor(url), `${id}-url`, false) : addressBlock(url, `${id}-url`);
    let inner = `<p class="dlg-lead">${f(a.pop.lead)}</p>`;
    if (a.id === "claude") {
      inner += `<p class="dlg-cta"><a class="btn btn-primary btn-big" href="${esc(claudeLink(accountUrlFor(url)))}" target="_blank" rel="noopener" data-connected="claude">${icon("plug", 20)}Connect to Claude</a></p>
<p class="dlg-or">or copy the sign-in address</p>${copy}${notes(a.pop.notes)}`;
    } else if (a.id === "gemini") {
      // Gemini has no one-tap link like Claude's: the address is added by hand under Connected Apps. The
      // box reads the same, with the address first (copy it, then open Gemini and paste it).
      inner += `<p class="dlg-cta"><a class="btn btn-primary btn-big" href="https://gemini.google.com/customize/connectors" target="_blank" rel="noopener" data-connected="gemini" data-copy-url="${esc(accountUrlFor(url))}">${icon("plug", 20)}Copy the address and open Gemini</a></p>
<p class="dlg-or">Then tap <strong>+ Custom</strong> and paste it. Or copy it here:</p>${copy}
${list(a.pop.steps ?? [])}${notes(a.pop.notes)}`;
    } else if (a.id === "chatgpt") {
      inner += `<h3 class="dlg-h">${esc(a.pop.stepsHead ?? "")}</h3>${list(a.pop.steps ?? [])}`;
      if (a.pop.alt) inner += `<h3 class="dlg-h">${esc(a.pop.alt.head)}</h3><p>${f(a.pop.alt.text)}</p>${copy}`;
      inner += notes(a.pop.notes);
    } else if (a.others) {
      inner += copy + `<ul class="dlg-others">${OTHERS.filter((o) => o.popup).map((o) => `<li><p class="dlg-other-h"><strong>${esc(o.name)}</strong> <span class="status">${esc(o.status)}</span></p><p>${f(o.line)}</p></li>`).join("")}</ul>${notes(a.pop.notes)}`;
    } else {
      inner += list(a.pop.steps ?? []) + copy + notes(a.pop.notes);
    }
    return `<dialog class="cdlg" id="${id}" aria-labelledby="${id}-h">
<div class="cdlg-in">
<div class="cdlg-head">
<h2 id="${id}-h">${esc(a.title)} <span class="status${a.ok ? " status-ok" : ""}">${esc(a.status)}</span></h2>
<button class="cdlg-x" type="button" data-close aria-label="Close">${icon("close", 22)}</button>
</div>
<div class="cdlg-body">
${inner}
${thenSay(a)}
<p class="dlg-done"><button class="btn btn-ghost btn-sm" type="button" data-connected="${a.id}">${icon("check", 18)}I've connected ${esc(a.btn)}</button><span>This page and every story page will then show an <strong>Open in ${esc(a.btn)}</strong> button too. Remembered on this device only; you can add more than one.</span></p>
<p class="dlg-more"><a class="link-arrow" href="/connect#${a.id}">Full details on the Connect page ${icon("arrow", 18)}</a></p>
</div>
</div>
</dialog>`;
  }).join("\n");
}
// Opens a pop-up from its button: native <dialog> + showModal() (focus stays inside, Esc closes),
// a click on the backdrop or any [data-close] closes it, and focus returns to the button.
const DIALOG_JS = `(function(){
  var btns=[].slice.call(document.querySelectorAll("a[data-dialog]"));
  btns.forEach(function(b){
    var d=document.getElementById(b.getAttribute("data-dialog"));
    if(!d||typeof d.showModal!=="function")return;
    b.setAttribute("role","button");b.setAttribute("aria-haspopup","dialog");
    function open(e){e.preventDefault();d._from=b;d.showModal();var s=d.querySelector(".cdlg-body");if(s)s.scrollTop=0;}
    b.addEventListener("click",open);
    b.addEventListener("keydown",function(e){if(e.key===" "){open(e);}});
  });
  [].forEach.call(document.querySelectorAll("dialog.cdlg"),function(d){
    var down=false;
    d.addEventListener("pointerdown",function(e){down=e.target===d;});
    d.addEventListener("click",function(e){
      if(e.target===d&&down){d.close();return;}
      var c=e.target.closest&&e.target.closest("[data-close]");if(c){if(c.tagName==="A")d._from=null;d.close();}
    });
    d.addEventListener("close",function(){if(d._from){d._from.focus();d._from=null;}});
  });
})();`;
// "Did it connect?" (Ben, 2026-10-20). Tapping Connect to Claude or Open Gemini opens that assistant in a
// new tab and this box on the page, which can't be dismissed without an answer. Yes marks the assistant
// connected on this device; no asks what happened, records it (/api/connect-feedback, no name or
// address), and shows what to try for that problem. The ids here are what the endpoint accepts.
const CONNECT_ISSUES: Record<"claude" | "gemini", { id: string; label: string; tip: string }[]> = {
  claude: [
    { id: "opened-app", label: "The link opened the Claude app, not the Add connector screen", tip: "Open the link in your phone's <strong>browser</strong> (Safari or Chrome), not the Claude app. Or add it by hand: in Claude, <strong>Customize → Connectors → + Add → Add custom connector</strong>, name it Plot Speaks and paste <code>{url}</code>." },
    { id: "limit", label: "It says I already have a custom connector (Free plan)", tip: "Claude's Free plan has room for one custom connector. Remove the other one under <strong>Customize → Connectors</strong>, then tap Connect to Claude again." },
    { id: "signin", label: "Signing in with Google didn't work", tip: "Try once more in your browser, and allow the Google window if it is blocked. Or connect without an account: add <code>{plainurl}</code> instead. Everything plays; nothing is saved between chats." },
    { id: "workspace", label: "I'm on a Team or Enterprise plan and can't add it", tip: "On Team and Enterprise plans an admin adds custom connectors first. Send them the address: <code>{url}</code>." },
    { id: "no-answer", label: "It's added, but Claude doesn't use Plot Speaks", tip: "In a new chat, tap <strong>+ → Connectors</strong> and make sure Plot Speaks is switched on. Then say <strong>“Open Plot Speaks.”</strong>" },
    { id: "allow", label: "It keeps asking me to allow Plot Speaks", tip: "Choose <strong>Always allow</strong> when it asks, once for each tool, or set them all under <strong>Settings → Connectors → Plot Speaks</strong>. After that Claude stops asking." },
    { id: "other", label: "Something else", tip: "Tell us above what happened and we'll look into it. You can also write to <strong>contact@plotspeaks.com</strong>." },
  ],
  gemini: [
    { id: "no-menu", label: "I can't find Connected Apps or Add a custom app", tip: "Custom apps need a <strong>personal</strong> Google account in the <strong>US</strong>, 18 or older, with Keep Activity on (not a work or school account). Open <strong>gemini.google.com/customize/connectors</strong> in a browser; it may sit under Personal Intelligence." },
    { id: "credentials", label: "It asked for credentials or Advanced features", tip: "Leave Advanced features empty and tap Next: Plot Speaks registers itself. If it still asks, use the address without an account: <code>{plainurl}</code>." },
    { id: "signin", label: "Signing in didn't work", tip: "Use the address that needs no account: <code>{plainurl}</code>. Everything plays; nothing is saved between chats." },
    { id: "no-answer", label: "It's added, but Gemini doesn't use Plot Speaks", tip: "In a new chat type <strong>@</strong> and pick <strong>Plot Speaks</strong> from the list, then <strong>open</strong>. Without the @, \"open Plot Speaks\" makes Gemini look for a phone app. Not in the list? Close the Gemini app completely and reopen it. Gemini Live (voice conversation) can't use custom apps yet; use the microphone in a regular chat instead." },
    { id: "not-in-app", label: "It works on the web, but the Gemini app doesn't list Plot Speaks", tip: "Close the Gemini app completely (swipe it away) and open it again: the app only picks up a custom app added on the web after a restart. Then type <strong>@</strong> and it's in the list. Still missing? Update the app, and check it's signed in to the same personal Google account." },
    { id: "confirm", label: "It asks me to confirm every answer", tip: "That's Gemini's rule: it asks before any app saves something, and checking an answer saves your score. There's no setting to turn it off yet. For play without prompts, Claude can be set to Always allow." },
    { id: "no-voice", label: "It works when I type, but not in Gemini Live", tip: "That's Gemini, not your setup: Gemini Live can only use Google's own apps and a few partners for now. Play in a regular chat and tap the microphone in the chat box for each turn. For hands-free voice, Claude's voice mode plays Plot Speaks today." },
    { id: "other", label: "Something else", tip: "Tell us above what happened and we'll look into it. You can also write to <strong>contact@plotspeaks.com</strong>." },
  ],
};
function checkDialog(mcpUrl: string): string {
  const f = (s: string) => s.replace(/\{url\}/g, esc(accountUrlFor(mcpUrl))).replace(/\{plainurl\}/g, esc(mcpUrl));
  const names: Record<string, string> = { claude: "Claude", gemini: "Gemini" };
  const retry: Record<string, string> = { claude: claudeLink(accountUrlFor(mcpUrl)), gemini: "https://gemini.google.com/customize/connectors" };
  const issues = (Object.keys(CONNECT_ISSUES) as ("claude" | "gemini")[]).map((a) => `<div class="cc-issues" data-cc-for="${a}" hidden>
${CONNECT_ISSUES[a].map((x, i) => `<label><input type="radio" name="cc-issue-${a}" value="${x.id}"${i === 0 ? " required" : ""}><span>${esc(x.label)}</span></label>`).join("\n")}
</div>`).join("\n");
  const tips = (Object.keys(CONNECT_ISSUES) as ("claude" | "gemini")[]).flatMap((a) => CONNECT_ISSUES[a].map((x) => `<p class="cc-tip" data-tip="${a}:${x.id}" hidden>${f(x.tip)}</p>`)).join("\n");
  const retries = Object.keys(retry).map((a) => `<a class="btn btn-primary" data-cc-retry="${a}" hidden href="${esc(retry[a])}" target="_blank" rel="noopener" data-connected="${a}"${a === "gemini" ? ` data-copy-url="${esc(accountUrlFor(mcpUrl))}"` : ""}>${icon("plug", 18)}Try ${a === "claude" ? "Connect to Claude" : "Open Gemini"} again</a>`).join("");
  return `<dialog class="cdlg cc" id="conn-check" aria-labelledby="cc-h">
<div class="cdlg-in">
<div class="cdlg-head"><h2 id="cc-h">Did it connect?</h2></div>
<div class="cdlg-body">
<div data-step="ask">
<p class="dlg-lead">Finish the steps in the tab that just opened, then come back: did Plot Speaks connect to <strong data-cc-name>${esc(names.claude)}</strong>?</p>
<p class="cc-row"><button class="btn btn-primary" type="button" data-cc="yes">${icon("check", 18)}Yes, it's connected</button><button class="btn btn-ghost" type="button" data-cc="no">No, it didn't work</button></p>
</div>
<div data-step="why" hidden>
<p class="dlg-lead">Sorry about that. What happened?</p>
${issues}
<label class="cc-note-l" for="cc-note">Anything else we should know? (optional)</label>
<textarea id="cc-note" rows="3" maxlength="800"></textarea>
<p class="cc-row"><button class="btn btn-primary" type="button" data-cc="send">Show me what to try</button></p>
<p class="cc-small">We keep the problem you pick and what you type, with no name or address, to fix these steps.</p>
</div>
<div data-step="tips" hidden>
<h3 class="dlg-h">Try this</h3>
${tips}
<p class="cc-row">${retries}<button class="btn btn-ghost" type="button" data-cc="close">Close</button></p>
<p class="cc-small">Still stuck? Write to <strong>contact@plotspeaks.com</strong> and we'll help.</p>
</div>
<div data-step="done" hidden>
<p class="dlg-lead" data-done-for="claude">You're set. Open a new chat in Claude and say <strong>“Open Plot Speaks.”</strong></p>
<p class="dlg-lead" data-done-for="gemini" hidden>You're set. Open a new chat in Gemini, type <strong>@</strong>, tap <strong>Plot Speaks</strong> in the list, then type <strong>open</strong>. Not in the list? Close the Gemini app completely and reopen it.</p>
<p class="cc-row"><button class="btn btn-primary" type="button" data-cc="close">Done</button></p>
</div>
</div>
</div>
</dialog>`;
}
const CHECK_JS = `(function(){
  var d=document.getElementById("conn-check");if(!d||typeof d.showModal!=="function")return;
  var NAMES={claude:"Claude",gemini:"Gemini"},id="claude";
  function step(n){[].forEach.call(d.querySelectorAll("[data-step]"),function(s){s.hidden=s.getAttribute("data-step")!==n;});var b=d.querySelector(".cdlg-body");if(b)b.scrollTop=0;}
  function send(outcome,issue){try{fetch("/api/connect-feedback",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({assistant:id,outcome:outcome,issue:issue||null,note:outcome==="no"?(d.querySelector("#cc-note").value||null):null,page:location.pathname})}).catch(function(){});}catch(e){}}
  window.psConnectCheck=function(a){
    id=NAMES[a]?a:"claude";
    var n=d.querySelector("[data-cc-name]");if(n)n.textContent=NAMES[id];
    [].forEach.call(d.querySelectorAll("[data-cc-for]"),function(x){x.hidden=x.getAttribute("data-cc-for")!==id;});
    [].forEach.call(d.querySelectorAll("[data-cc-retry]"),function(x){x.hidden=x.getAttribute("data-cc-retry")!==id;});
    [].forEach.call(d.querySelectorAll("[data-done-for]"),function(x){x.hidden=x.getAttribute("data-done-for")!==id;});
    [].forEach.call(d.querySelectorAll("input[type=radio]"),function(r){r.checked=false;});
    d.querySelector("#cc-note").value="";
    step("ask");
    [].forEach.call(document.querySelectorAll("dialog[open]"),function(o){if(o!==d)o.close();});
    if(!d.open)d.showModal();
  };
  // An answer is needed: Esc and a click outside don't close it.
  d.addEventListener("cancel",function(e){e.preventDefault();});
  d.addEventListener("click",function(e){
    var t=e.target.closest&&e.target.closest("[data-cc]");if(!t)return;
    var act=t.getAttribute("data-cc");
    if(act==="yes"){send("yes");if(window.psConnectedAdd)window.psConnectedAdd(id);step("done");}
    else if(act==="no"){step("why");}
    else if(act==="send"){var r=d.querySelector('[data-cc-for="'+id+'"] input:checked');var issue=r?r.value:"other";send("no",issue);
      [].forEach.call(d.querySelectorAll("[data-tip]"),function(x){x.hidden=x.getAttribute("data-tip")!==id+":"+issue;});step("tips");}
    else if(act==="close"){d.close();}
  });
})();`;

// The visitor's connected assistant, remembered in this browser only (localStorage "ps.assistant";
// a private window or cleared data just shows the Connect buttons again). Set by the Connect to
// Claude link and the "I've connected" buttons; cleared by Change.
// The header's Connect button: the account's assistants (data-assistants, signed in) or this browser's.
const HEADER_JS = `(function(){
  var OPEN={claude:["Claude","https://claude.ai/new"],gemini:["Gemini","https://gemini.google.com/app"],chatgpt:["ChatGPT","https://chatgpt.com/"],other:["Your assistant",""]};
  var box=document.querySelector("[data-cmenu]");if(!box)return;
  var btn=box.querySelector("[data-cmenu-btn]"),pop=box.querySelector("[data-cmenu-pop]"),list=box.querySelector("[data-cmenu-list]");
  function ids(){var b=document.body,a=b.getAttribute("data-assistants");if(b.getAttribute("data-signed")==="in"&&a)return a.split(",").filter(function(x){return OPEN[x];});
    try{var v=JSON.parse(localStorage.getItem("ps.assistants")||"null");return Array.isArray(v)?v.filter(function(x){return OPEN[x];}):[];}catch(e){return [];}}
  function draw(){var a=ids();btn.classList.toggle("is-on",a.length>0);
    list.innerHTML=a.map(function(x){var o=OPEN[x];return o[1]?'<li><a href="'+o[1]+'" target="_blank" rel="noopener">Open in '+o[0]+'</a></li>':'<li><span>'+o[0]+'</span></li>';}).join("");
    if(!a.length)close();}
  function close(){pop.hidden=true;btn.setAttribute("aria-expanded","false");}
  btn.addEventListener("click",function(e){if(!btn.classList.contains("is-on"))return;e.preventDefault();pop.hidden=!pop.hidden;btn.setAttribute("aria-expanded",String(!pop.hidden));});
  document.addEventListener("click",function(e){if(!box.contains(e.target))close();});
  document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});
  window.psHeader=draw;draw();
})();`;
const CONNECTED_JS = `(function(){
  var KEY="ps.assistants",OLD="ps.assistant",NAMES={claude:"Claude",chatgpt:"ChatGPT",gemini:"Gemini",other:"your assistant"};
  function get(){try{var v=JSON.parse(localStorage.getItem(KEY)||"null");if(Array.isArray(v))return v.filter(function(x){return NAMES[x];});var o=localStorage.getItem(OLD);return o&&NAMES[o]?[o]:[];}catch(e){return [];}}
  function save(a){try{if(a.length)localStorage.setItem(KEY,JSON.stringify(a));else localStorage.removeItem(KEY);localStorage.removeItem(OLD);}catch(e){}if(document.body.getAttribute("data-signed")==="in")document.body.setAttribute("data-assistants",a.join(","));if(window.psHeader)window.psHeader();}
  // Signed in, the badges follow the account (Ben, 2026-10-22): the page carries the account's list, and
  // adding or removing one here updates it there.
  var signed=document.body.getAttribute("data-signed")==="in",acct=document.body.getAttribute("data-assistants");
  function sync(k,ids){if(!signed||!ids.length)return;try{fetch("/api/assistants",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(k==="add"?{add:ids}:{remove:ids}),keepalive:true}).catch(function(){});}catch(e){}}
  function add(id){var a=get();if(a.indexOf(id)<0)a.push(id);save(a);sync("add",[id]);}
  function remove(id){save(get().filter(function(x){return x!==id;}));sync("remove",[id]);}
  if(signed&&acct!==null){var srv=acct?acct.split(",").filter(function(x){return NAMES[x];}):[],loc=get(),up=srv.length?[]:loc;
    save(srv.concat(up));if(up.length)sync("add",up);}
  function apply(){
    var ids=get();
    [].forEach.call(document.querySelectorAll(".ai-btn[data-dialog]"),function(b){b.classList.toggle("is-on",ids.indexOf(b.getAttribute("data-dialog").replace("dlg-",""))>=0);});
    [].forEach.call(document.querySelectorAll(".byoa-on"),function(b){
      b.hidden=!ids.length;var say=b.nextElementSibling;if(say&&say.classList.contains("saybox"))say.hidden=Boolean(ids.length);
      [].forEach.call(b.querySelectorAll("li[data-on]"),function(li){li.hidden=ids.indexOf(li.getAttribute("data-on"))<0;});
    });
    [].forEach.call(document.querySelectorAll("[data-conn]"),function(p){var on=ids.indexOf(p.getAttribute("data-conn"))>=0;p.classList.toggle("is-on",on);var tab=document.getElementById("tab-"+p.getAttribute("data-conn"));if(tab)tab.classList.toggle("is-on",on);});
  }
  document.addEventListener("click",function(e){
    var t=e.target.closest&&e.target.closest("[data-connected],[data-on-remove],[data-copy-phrase]");if(!t)return;
    if(t.hasAttribute("data-copy-url")&&navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t.getAttribute("data-copy-url")).catch(function(){});}
    if(t.hasAttribute("data-connected")){var cid=t.getAttribute("data-connected");if(t.tagName==="A"&&window.psConnectCheck){setTimeout(function(){window.psConnectCheck(cid);},300);return;}add(cid);apply();var d=t.closest("dialog");if(d&&t.tagName!=="A")d.close();return;}
    if(t.hasAttribute("data-on-remove")){e.preventDefault();remove(t.getAttribute("data-on-remove"));apply();return;}
    var p=t.getAttribute("data-copy-phrase"),s=t.closest(".byoa-on").querySelector(".copied");
    function done(ok){if(s){s.textContent=ok?(t.tagName==="A"?"Copied. In Gemini, type @, tap Plot Speaks in the list, then paste.":"Copied. Paste it into a new chat, or just say it."):"Copy failed; say it instead: "+p;}}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(p).then(function(){done(true);},function(){done(false);});}else done(false);
  });
  window.psConnectedAdd=function(id){add(id);apply();};
  document.addEventListener("click",function(e){
    var n=e.target.closest&&e.target.closest("[data-noacct]");
    if(n){var box=n.closest("[data-addr]");var pl=box&&box.querySelector(".addr-plain");if(pl){pl.hidden=false;n.hidden=true;}return;}
    var si=e.target.closest&&e.target.closest("[data-signin]");
    if(si){si.setAttribute("href","/auth/google/start?next="+encodeURIComponent(location.pathname+location.hash));}
  });
  apply();
})();`;

function phrasesTable(m: Meta | null): string {
  const isMystery = !m || m.genre === "murder-mystery" || m.genre === "kids";
  const chapters = !m || (m.chapters !== null && m.chapters > 1);
  return `<div class="table-wrap"><table class="phrases">
<thead><tr><th scope="col">Say</th><th scope="col">What happens</th></tr></thead>
<tbody>
${!m ? `<tr><td>"Open Plot Speaks."</td><td>With the connector: a quick intro, then the choice to browse the stories, start one or write your own.</td></tr>\n` : ""}<tr><td>"Plot Speaks, start the story."</td><td>The narrator reads the opening and asks what you do.</td></tr>
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
  --bg:#EDF1F7;--bg-2:#E1E8F1;--surface:#FFFFFF;--surface-2:#F3F6FB;
  --ink:#13294A;--ink-2:#43536B;--line:#D2DBE7;--line-2:#A7B6CA;
  --accent:#B4520C;--accent-soft:rgba(239,119,38,.12);--sky-ink:#14709E;--ok:#2E9E5B;--ok-ink:#1D6E3E;--ok-soft:rgba(46,158,91,.12);
  --btn:#EF7726;--btn-ink:#14233D;--btn-hover:#F58A3E;
  --shadow:0 1px 2px rgba(19,41,74,.10),0 8px 24px -12px rgba(19,41,74,.26);
  --shadow-lg:0 2px 6px rgba(19,41,74,.10),0 24px 48px -24px rgba(19,41,74,.40);
  --glow:rgba(243,192,149,.55);--focus:#0F6FA8;
  --night:#0B1D33;--night-2:#12355B;--night-ink:#F6F0E6;--night-ink-2:#B8C6D8;
  --radius:18px;--radius-lg:28px;--wrap:72rem;
  --serif:"Fraunces",Georgia,"Times New Roman",serif;
  --sans:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
  --bg:#0A1A2E;--bg-2:#0D2139;--surface:#112846;--surface-2:#0F2440;
  --ink:#F5EFE5;--ink-2:#AEBDD0;--line:#1F3B60;--line-2:#2A4C78;
  --accent:#F7A060;--accent-soft:rgba(239,119,38,.16);--sky-ink:#6FCBF2;--ok:#3FC47A;--ok-ink:#7FE0A8;--ok-soft:rgba(63,196,122,.16);
  --btn:#F28A3C;--btn-ink:#111E33;--btn-hover:#F69B55;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -14px rgba(0,0,0,.6);
  --shadow-lg:0 2px 6px rgba(0,0,0,.3),0 30px 60px -28px rgba(0,0,0,.8);
  --glow:rgba(63,184,232,.16);--focus:#7FD3F7;
  --night:#050E1A;--night-2:#163E6B}}
/* The home hero is a night band in both themes (Ben, 2026-10-20: the dark theme looked better): the dark
   palette, scoped to the hero, so the first screen looks the same whatever the visitor's setting. */
.hero{--bg:#0A1A2E;--bg-2:#0D2139;--surface:#112846;--surface-2:#0F2440;--ink:#F5EFE5;--ink-2:#AEBDD0;--line:#1F3B60;--line-2:#2A4C78;--accent:#F7A060;--sky-ink:#6FCBF2;--btn:#F28A3C;--btn-ink:#111E33;--ok-ink:#7FE0A8;--ok-soft:rgba(63,196,122,.16);--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px -14px rgba(0,0,0,.6);--shadow-lg:0 2px 6px rgba(0,0,0,.3),0 30px 60px -28px rgba(0,0,0,.8);color:var(--ink);background:var(--bg)}
.hero .say-you{background:#1E4E80}
.hero .waves circle:nth-child(1),.hero .waves circle:nth-child(2){stroke:var(--peach);opacity:.16}
@media (prefers-color-scheme:light){.hero{background:radial-gradient(120% 90% at 85% 0%,#163E6B,#0A1A2E 62%)}}
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
.cmenu{position:relative}
.btn-connect .cm-on,.btn-connect.is-on .cm-off{display:none}
.btn-connect.is-on .cm-on{display:inline-flex;align-items:center;gap:inherit}
.btn-connect.is-on{background:#2E9E5B;border-color:#2E9E5B;color:#fff;box-shadow:none}
.btn-connect.is-on:hover{background:#278A4F;border-color:#278A4F;color:#fff}
.cmenu-pop{position:absolute;right:0;top:calc(100% + 8px);min-width:230px;padding:8px;border-radius:16px;background:var(--surface);border:1px solid var(--line-2);box-shadow:var(--shadow);z-index:60}
.cmenu-h{margin:4px 10px 6px;font:700 .72rem/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2)}
.cmenu-list{list-style:none;margin:0;padding:0}
.cmenu-list a,.cmenu-list span,.cmenu-more{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;color:var(--ink);text-decoration:none;font-weight:600}
.cmenu-list a:hover,.cmenu-more:hover{background:var(--surface-2)}
.cmenu-more{margin-top:4px;border-top:1px solid var(--line);border-radius:0 0 10px 10px;color:var(--ink-2)}
.acct{font-weight:700;font-size:.95rem;text-decoration:none;color:var(--ink);padding:9px 14px;border-radius:999px;border:1.5px solid var(--line-2);white-space:nowrap}
.acct:hover{border-color:var(--accent)}
.why{display:grid;gap:12px;padding:0;list-style:none;margin:20px 0 28px}
.why li{padding:14px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--line)}
.door-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.door{display:flex;align-items:center;gap:16px;padding:20px;border-radius:20px;background:var(--surface);border:1.5px solid var(--line-2);box-shadow:var(--shadow);text-decoration:none;color:var(--ink)}
.door:hover{border-color:var(--accent)}
.door > span:nth-child(2){flex:1;display:grid;gap:4px;min-width:0}
.door strong{font-family:var(--serif);font-size:1.5rem}
.door .ic-wrap{flex:none;display:grid;place-items:center;width:52px;height:52px;border-radius:16px;color:#fff}
.door-n{font-weight:700;color:var(--accent)}
.door-p{color:var(--ink-2);font-size:.98rem}
.testing-note{margin:0 0 22px}
.menu{position:relative}
.menu summary{list-style:none;cursor:pointer;display:grid;place-items:center;width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--surface)}
.menu summary::-webkit-details-marker{display:none}
.menu[open] summary{border-color:var(--accent)}
.menu-panel{position:absolute;right:0;top:52px;min-width:220px;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-lg);padding:8px;display:grid}
.menu-panel a{padding:12px 14px;border-radius:10px;text-decoration:none;font-weight:600}
.menu-panel a:hover,.menu-panel a[aria-current=page]{background:var(--accent-soft);color:var(--ink)}
/* Page tabs under the header on phones and tablets: four equal tabs, the current one underlined. */
.pagetabs{border-top:1px solid var(--line)}
.pagetabs .wrap{display:flex;gap:0;min-height:0}
.pagetabs a{flex:1 1 auto;min-width:0;text-align:center;text-decoration:none;font-weight:650;font-size:clamp(.74rem,3.1vw,.92rem);letter-spacing:-.01em;padding:13px 2px 11px;color:var(--ink-2);border-bottom:3px solid transparent;white-space:nowrap}
.pagetabs a[aria-current=page]{color:var(--ink);border-bottom-color:var(--accent)}
.pagetabs a:hover{color:var(--ink)}
@media (min-width:860px){.nav{display:flex}.pagetabs{display:none}.top .btn-connect{display:inline-flex}:root{--head-h:64px}}

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
.hero-grid>*{min-width:0}
@media (min-width:960px){.hero{padding:72px 0 88px}.hero-grid{grid-template-columns:1.1fr .9fr;gap:56px}.waves{right:-60px;top:-160px;width:760px;height:760px;opacity:.9}}
.hero h1{margin:0 0 18px;white-space:nowrap;font-size:min(4.4rem,calc((100vw - 32px) / 13.2))}
@media (min-width:900px){.hero h1{font-size:min(3.4rem,calc((50vw - 64px) / 13.2))}}
.hero h1 em{font-style:italic;font-weight:560;color:var(--accent)}
.hero .lead{margin-bottom:28px}
.hero-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}

/* voice demo card */
.voice{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:22px;position:relative;max-width:30rem;justify-self:center;width:100%}
@media (min-width:960px){.hero-grid{align-items:stretch}.hero .byoa{margin-bottom:0}.hero-grid>.voice{margin:0;max-width:none;display:flex;flex-direction:column;justify-content:center;padding:30px 30px}.hero-grid>.voice .voice-top{font-size:.9rem;margin-bottom:22px}.hero-grid>.voice .say{padding:16px 20px;margin-bottom:18px;max-width:96%}.hero-grid>.voice .say-you{font-size:1.12rem}.hero-grid>.voice .say-narrator{font-size:1.14rem}.hero-grid>.voice .bars{height:46px;margin:8px 0 4px}.hero-grid>.voice .sample{margin-top:20px}}
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
/* the card's audio sample: without JS a plain player; with JS a button, and the bubbles follow the speaker */
.sample{display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px;margin-top:14px}
.sample audio{width:100%;height:44px}
.sample-btn{padding-left:8px;gap:10px}
.sample-btn .knob{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--btn);color:var(--btn-ink);flex:none}
.sample-btn .knob .ic-pause,.is-playing .sample-btn .knob .ic-play{display:none}
.is-playing .sample-btn .knob .ic-pause{display:block}
.sample-time{font:600 .86rem/1 var(--sans);color:var(--ink-2);font-variant-numeric:tabular-nums}
.thread{display:flex;flex-direction:column;gap:8px}
.thread .say{margin:0;padding:10px 14px;font-size:.98rem;line-height:1.4}
.thread .say b{margin-bottom:3px}
.thread .say-narrator{font-size:1rem}
.hero-grid>.voice .thread .say{padding:7px 13px;margin:0;line-height:1.32}
.hero-grid>.voice .thread .say b{font-size:.66rem;margin-bottom:2px}
.hero-grid>.voice .thread .say-you{font-size:.93rem}
.hero-grid>.voice .thread .say-narrator{font-size:.95rem}
.hero-grid>.voice:has(.thread){padding:22px 24px}
.hero-grid>.voice:has(.thread) .voice-top{margin-bottom:12px}
.hero-grid>.voice:has(.thread) .bars{height:30px;margin:8px 0 0}
.hero-grid>.voice:has(.thread) .sample{margin-top:10px}
.js-sample.is-on .thread .say.is-said{opacity:.8}
.js-sample{cursor:pointer}
.js-sample .sample audio{display:none}
.js-sample .bars i{animation-play-state:paused}
.js-sample:not(.is-on) .bars i{animation:none}
.js-sample:not(.is-on) .bars i:nth-child(2n){height:50%}.js-sample:not(.is-on) .bars i:nth-child(3n){height:75%}.js-sample:not(.is-on) .bars i:nth-child(5n){height:40%}.js-sample:not(.is-on) .bars i:nth-child(7n){height:95%}
.js-sample.is-playing .bars i{animation-play-state:running}
.js-sample .say{transition:opacity .25s ease,box-shadow .25s ease}
.js-sample.is-on .say{opacity:.55}
.js-sample.is-on .say.is-speaking{opacity:1;box-shadow:0 0 0 3px var(--orange)}

/* story page: the Connect row */
.connect-row{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow);padding:24px 20px;position:relative;overflow:hidden}
.connect-row::after{content:"";position:absolute;right:-60px;top:-60px;width:180px;height:180px;border-radius:50%;border:14px solid var(--sky);opacity:.12;pointer-events:none}
.connect-row h2{font-size:clamp(1.45rem,4.6vw,1.95rem);margin:0 0 10px;max-width:22ch}
.connect-row>p:not(.eyebrow):not(.saybox){color:var(--ink-2)}
.connect-row .saybox{margin:16px 0 14px}
.connect-alt{display:flex;gap:10px;align-items:flex-start;margin:0;font-size:.96rem}
.connect-alt .ic{color:var(--accent);margin-top:3px}
@media (min-width:720px){.connect-row{padding:32px}}
.urlbox{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch;margin:18px 0 4px}
.urlbox .url{flex:1 1 220px;display:flex;align-items:center;min-height:50px;padding:12px 16px;border-radius:14px;background:var(--bg);border:1.5px dashed var(--line-2);font-size:1rem;color:var(--ink);word-break:break-all}
.urlbox .btn{flex:1 1 auto}
@media (min-width:520px){.urlbox .btn{flex:0 0 auto}}
.btn-big{min-height:58px;padding:16px 28px;font-size:1.08rem;flex:1 1 auto;max-width:100%}
@media (min-width:520px){.btn-big{flex:0 0 auto}}
.urlbox .btn-ghost{background:var(--surface)}
.copy-status{min-height:1.4em;margin:6px 0 0;font-size:.9rem;color:var(--ink-2)}

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

/* bring your own AI */
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
.filters{position:sticky;top:var(--head-h,117px);z-index:10;margin:0 -16px 28px;padding:12px 16px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}
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
.badge.badge-testing{left:auto;right:10px;bottom:auto;top:10px;background:var(--orange,#EF7726);color:#fff}
.saybox-sm{margin:12px 0 0;padding:10px 12px;font-size:.98rem}
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
.cover-branching{background:radial-gradient(80% 80% at var(--gx,25%) var(--gy,15%),rgba(246,199,154,.8),transparent 60%),linear-gradient(155deg,#2381BB,#12355B)}
.cover-trivia{background:radial-gradient(80% 80% at var(--gx,70%) var(--gy,20%),rgba(239,119,38,.7),transparent 60%),linear-gradient(150deg,#F3C095,#D9894A)}
.cover-game{background:radial-gradient(80% 80% at var(--gx,30%) var(--gy,20%),rgba(63,184,232,.55),transparent 60%),linear-gradient(155deg,#3E7A5C,#1D3F35)}
.cover-campaign{background:radial-gradient(80% 80% at var(--gx,75%) var(--gy,15%),rgba(239,119,38,.55),transparent 60%),linear-gradient(160deg,#4B2E5C,#1F1330)}
/* Shelf header accents, one per kind (plan section 3). */
.ic-wrap.kind-mystery{background:linear-gradient(155deg,#1A4673,#0E2541)}
.ic-wrap.kind-adventure{background:linear-gradient(160deg,#EF7726,#C25A12)}
.cover-gamebook{background:radial-gradient(80% 80% at var(--gx,70%) var(--gy,20%),rgba(255,214,120,.75),transparent 60%),linear-gradient(155deg,#2E8B57,#14452F)}
.ic-wrap.kind-gamebook{background:linear-gradient(155deg,#4CC38A,#2E8B57)}
.ic-wrap.kind-branching{background:linear-gradient(155deg,#3FB8E8,#2381BB)}
.ic-wrap.kind-trivia{background:linear-gradient(150deg,#E9A770,#C9773A)}
.ic-wrap.kind-game{background:linear-gradient(155deg,#4F8F6C,#2D5C47)}
.ic-wrap.kind-campaign{background:linear-gradient(160deg,#6B4280,#3A2249)}
.subfilters{display:flex;flex-wrap:wrap;gap:8px;margin:-6px 0 18px}
.ww-input{width:100%;font:inherit;font-size:1.05rem;padding:12px;border-radius:14px;border:1.5px solid var(--line-2);background:var(--surface);color:var(--ink)}
.ww-card{font-family:var(--display,inherit);font-size:clamp(1.6rem,6vw,2.2rem);padding:22px;border-radius:18px;background:var(--surface-2);border:1.5px solid var(--line-2);margin:12px 0}
.ww-pick{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
.ww-pick [aria-pressed=true]{background:var(--ink);color:var(--bg)}
.ww-news{font-size:1.25rem;padding:18px;border-radius:16px;background:var(--surface-2)}
.chip-sm{min-height:38px;padding:7px 13px;font-size:.88rem}
.cat-note{margin:6px 0 0;font-size:.92rem;color:var(--ink-2)}

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
.note.tip>span{flex:1;min-width:0}
.tip-x{flex:none;margin:-4px -6px 0 0;padding:6px;border:0;border-radius:999px;background:transparent;color:var(--ink-2);cursor:pointer;line-height:0}
.tip-x:hover{background:var(--surface-2);color:var(--ink)}
.tip-x:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
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
.saybox-sub{display:block;margin-top:6px;font:500 .9rem/1.4 var(--sans);color:#C9D5E4}
.saybox-alt{background:var(--surface-2);color:var(--ink);border:1px solid var(--line)}
.saybox.saybox-alt b{color:var(--accent)}
.saybox b{display:block;font:700 .72rem/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--peach);margin-bottom:8px}
.assistant ul.notes{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.others{list-style:none;margin:18px 0;padding:0;display:grid;gap:12px}
.others li{padding:16px 18px;border-radius:var(--radius);border:1px solid var(--line);background:var(--surface-2);scroll-margin-top:96px}
.others h3{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:1.2rem;margin:0 0 6px}
.others .status{font-size:.64rem;padding:5px 8px}
.others p{margin:0 0 6px;color:var(--ink-2)}
.others p:last-child{margin:0}
.others .how{color:var(--ink)}

/* prose pages */
.page-head{padding:48px 0 28px}
.page-head h1{font-size:clamp(2.2rem,7.5vw,3.6rem);margin:0 0 14px}
.prose h2{font-size:clamp(1.45rem,4.2vw,1.9rem);margin:44px 0 14px}
.prose h3{margin:28px 0 8px}
.prose ul{padding-left:1.2rem}
.prose li{margin:0 0 8px}
.prose .pill-card h3{margin:2px 0 4px}
.prose .byo-grid{grid-template-columns:1fr}
@media (min-width:760px){.prose .byo-grid{grid-template-columns:repeat(3,1fr)}.prose .pill-card{flex-direction:column}}
.tool{display:grid;gap:4px;padding:18px 20px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line);margin:0 0 12px}
.tool code{justify-self:start;font-size:.95rem}
.tool p{margin:0;color:var(--ink-2)}

/* BYO-AI: badge, assistant chips (names only, never logos), ways to play */
.byoa{margin:0 0 26px;padding:18px 18px 20px;border-radius:var(--radius-lg);background:radial-gradient(120% 90% at 100% 0%,#1B4A7A,transparent 60%),linear-gradient(160deg,var(--navy),#0B2643);color:#F6F0E6;box-shadow:var(--shadow-lg);border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden;isolation:isolate}
.byoa::after{content:"";position:absolute;z-index:-1;right:-70px;bottom:-90px;width:220px;height:220px;border-radius:50%;border:16px solid var(--orange);opacity:.16;box-shadow:0 0 0 30px rgba(63,184,232,.08)}
@media (min-width:720px){.byoa{padding:24px 26px 26px}}
.byoa .byoa-badge{background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.2);color:#F6F0E6}
.byoa .byoa-tag{background:var(--orange);color:#14233D}
.byoa .byoa-tag::after{background:var(--sky);box-shadow:0 0 0 2px #143A63}
.byoa .byoa-line{color:#C9D5E4}
.byoa .byoa-line strong{color:#FFFDF9}
.byoa-badge{display:inline-flex;align-items:center;gap:10px;padding:4px 16px 4px 4px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--line-2),var(--shadow);font:700 .95rem/1 var(--sans);color:var(--ink)}
.byoa-tag{display:inline-block;padding:8px 12px 7px;border-radius:999px;background:var(--ink);color:var(--bg);font:800 .82rem/1 var(--sans);letter-spacing:.16em;position:relative}
.byoa-tag::after{content:"";position:absolute;right:-2px;top:-2px;width:10px;height:10px;border-radius:50%;background:var(--orange);box-shadow:0 0 0 2px var(--surface)}
.byoa-h{font-size:clamp(1.4rem,4.4vw,1.8rem);color:#FFFDF9;margin:16px 0 0;max-width:24ch;text-wrap:balance}
.byoa-h-sm{white-space:nowrap;max-width:none;font-size:min(1.6rem,calc((100vw - 96px) / 17))}
@media (min-width:900px){.byoa-h-sm{font-size:1.6rem}}
.byoa .ai-btn{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2);color:#FFFDF9;box-shadow:none}
.byoa .ai-btn:hover{background:rgba(255,255,255,.14);border-color:var(--peach);color:#FFFDF9}
.byoa .ai-btn:focus-visible{outline-color:var(--sky)}
/* Connect buttons: name, then a Connect pill. .ai-btn-logo is the slot for a logo later. */
.ai-btns{list-style:none;margin:16px 0 14px;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (min-width:560px){.ai-btns{grid-template-columns:repeat(4,minmax(0,1fr))}}
.ai-btns li{display:flex;min-width:0}
/* Side by side with the sample card on a narrow desktop the four buttons are cramped: two by two there. */
@media (min-width:960px) and (max-width:1179px){.hero .ai-btns{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ai-btn{flex:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:12px;min-height:92px;padding:14px 14px 13px;border-radius:18px;background:var(--surface);border:1.5px solid var(--line-2);box-shadow:var(--shadow);color:var(--ink);text-decoration:none;cursor:pointer;transition:transform .15s ease,border-color .15s ease,background-color .15s ease}
.ai-btn:hover{border-color:var(--accent);color:var(--ink);transform:translateY(-2px)}
.ai-btn:active{transform:translateY(0) scale(.99)}
.ai-btn-logo{display:block;width:28px;height:28px}
.ai-btn-name{font:650 1.2rem/1.12 var(--serif);font-variation-settings:"SOFT" 50,"opsz" 36}
.ai-btn-act{display:inline-flex;align-items:center;gap:6px;padding:7px 12px 7px 9px;border-radius:999px;background:var(--btn);color:var(--btn-ink);font:750 .84rem/1 var(--sans)}
.byoa-on{margin:16px 0 14px;padding:16px 18px;border-radius:18px;background:var(--surface);border:1.5px solid var(--line-2);box-shadow:var(--shadow)}
[data-signed="in"] .if-out{display:none!important}
.addr{margin:10px 0 4px}
.addr-ask{padding:14px 16px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line);margin:0 0 12px}
.addr-why{margin:0 0 10px;font-size:.98rem}
.addr .addr-h{margin:10px 0 6px;font-size:.95rem;color:var(--ink-2)}
.w-form{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:8px 0 12px}
.w-form input{flex:1;min-width:12rem;padding:12px 14px;border-radius:14px;border:1.5px solid var(--line-2);background:var(--surface);color:var(--ink);font:600 1.15rem var(--sans)}
.w-form label{font-weight:700}
.watch-card p{margin:0 0 10px;color:var(--ink-2)}
.w-example{margin:28px 0 0;max-width:36rem}
.w-example img{display:block;width:100%;height:auto;border-radius:18px;border:1px solid var(--line);margin:8px 0 10px}
.w-example figcaption{color:var(--ink-2)}
.watch-card .w-form{margin:0}
.watch-card .w-form input{min-width:0;font-size:1rem;padding:10px 12px}
.w-board{max-width:36rem}
.t-head{display:flex;gap:16px;align-items:center;margin:8px 0 18px}
.t-cover{width:96px;height:96px;border-radius:16px;object-fit:cover;flex:none}
.t-meta{min-width:0}
.t-sub{margin:0 0 4px;color:var(--ink-2);font-size:1.05rem}
.t-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.t-line{display:flex;gap:14px;align-items:baseline;padding:10px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--line-2);font-size:1.15rem}
.t-at{flex:none;min-width:3.2em;color:var(--ink-2);font:600 .95rem var(--sans);font-variant-numeric:tabular-nums}
.t-label{min-width:0;overflow-wrap:anywhere}
.t-line.ok{border-left-color:var(--ok)}
.t-line.ok .t-label{color:var(--ok-ink)}
.t-line.warn{border-left-color:var(--orange)}
.t-line.now{border-left-color:var(--orange);font-weight:700}
.t-line.ok.now{border-left-color:var(--ok)}
.t-note{margin:14px 0 0;color:var(--ink-2)}
.w-scores{list-style:none;padding:0;margin:8px 0 16px;display:flex;flex-wrap:wrap;gap:10px}
.w-scores li{display:flex;gap:12px;align-items:baseline;padding:10px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--line);font-size:1.15rem}
.w-scores strong{font:700 1.5rem var(--serif)}
.w-open,.w-last{padding:18px 20px;border-radius:18px;background:var(--navy);color:#F6F0E6;margin:0 0 16px}
.w-last.ok{background:#1D6E3E}
.w-open .w-k,.w-last .w-k{color:#C9D5E4}
.w-k{margin:0 0 6px;font:700 .85rem/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
.w-clue{margin:0;font:500 clamp(1.3rem,4.5vw,1.8rem)/1.35 var(--serif)}
.w-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.w-cat{display:grid;gap:6px}
.w-cat-h{margin:0;font:750 .95rem/1.2 var(--sans);text-align:center;min-height:2.4em;display:grid;place-items:center}
.w-cell{margin:0;padding:12px 0;border-radius:12px;background:var(--btn);color:var(--btn-ink);text-align:center;font:800 1.3rem var(--sans)}
.w-cell.done{background:var(--surface-2);color:var(--ink-2);opacity:.55;text-decoration:line-through}
.w-final{margin:16px 0 0;font-weight:700}
.badges{list-style:none;padding:0;margin:12px 0;display:flex;flex-wrap:wrap;gap:10px}
.badges li{display:flex;flex-direction:column;gap:2px;padding:10px 14px;border-radius:14px;border:1.5px solid var(--ok);background:var(--ok-soft)}
.badge-name{display:inline-flex;align-items:center;gap:6px;font-weight:750;color:var(--ok-ink)}
.badge-why{font-size:.85rem;color:var(--ink-2)}
.pstats{list-style:none;padding:0;margin:12px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.pstats li{padding:12px 14px;border-radius:14px;background:var(--surface);border:1px solid var(--line);display:flex;flex-direction:column}
.pstats strong{font:700 1.5rem/1.1 var(--serif)}
.pstats span{font-size:.88rem;color:var(--ink-2)}
.pform{display:grid;gap:8px;max-width:30rem;margin:12px 0}
.pform input[type=text],.pform input:not([type]){padding:10px 12px;border-radius:12px;border:1.5px solid var(--line-2);background:var(--surface);color:var(--ink);font:inherit}
.pcheck{display:flex;gap:10px;align-items:flex-start;font-size:.95rem}
.pform .btn{justify-self:start}
.cc-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:16px 0 0}
.cc-issues{display:grid;gap:8px;margin:6px 0 14px}
.cc-issues[hidden]{display:none}
.cc-issues label{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);cursor:pointer;font-size:.98rem}
.cc-issues input{margin-top:3px;accent-color:var(--accent)}
.cc-note-l{display:block;font-weight:600;font-size:.92rem;margin:4px 0 6px}
#cc-note{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:12px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink);font:inherit}
.cc-small{font-size:.86rem;color:var(--ink-2);margin:12px 0 0}
.cc-tip{padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line);margin:0 0 4px}
.conn-state{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:6px 0 10px}
.conn-state .conn-on{display:none}
.conn-state.is-on .conn-on{display:inline-flex;align-items:center;gap:6px}
.conn-state.is-on .conn-off{display:none}
.tabs [role=tab].is-on::after{content:" ✓";color:var(--accent)}
.addr-h{margin:12px 0 6px;font-size:.95rem;color:var(--ink-2)}
.byoa-on-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.byoa-on-list .status-ok,.conn-state .status-ok{background:var(--ok-soft);color:var(--ok-ink)}
.byoa-on{border-color:var(--ok)!important}
.conn-state.is-on{padding:8px 12px;border-radius:14px;border:1.5px solid var(--ok);background:var(--ok-soft)}
.tabs [role=tab].is-on::after{color:var(--ok)}
.byoa-on-list li{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:1.02rem}
.byoa-on-list li[hidden]{display:none}
.byoa-on .copied{display:block;margin-top:8px}
.ai-btn-act{white-space:nowrap}
.hero .ai-btns{gap:8px}.hero .ai-btn{padding:12px 10px 11px}.hero .ai-btn-name{font-size:1.12rem}
.ai-btn .act-on{display:none}
.ai-btn.is-on .act-on{display:inline-flex;align-items:center;gap:6px}
.ai-btn.is-on .act-off{display:none}
.ai-btn.is-on{border-color:var(--ok);background:var(--ok-soft)}
.ai-btn.is-on .ai-btn-act{background:var(--ok);color:#06210F;box-shadow:none;padding:6px 9px 6px 7px;font-size:.78rem}
.byoa .ai-btn.is-on{border-color:#3FC47A;background:rgba(63,196,122,.18)}
.byoa .ai-btn.is-on .ai-btn-act{background:#3FC47A;color:#06210F}
.byoa-on-say{margin:12px 0 0;color:var(--ink-2);font-size:.98rem}
.linkish{appearance:none;background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit}
.dlg-done{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin:18px 0 6px;color:var(--ink-2);font-size:.95rem}
.byoa-line{margin:0;color:var(--ink-2);font-size:1.02rem;max-width:36rem}
.byoa-line strong{color:var(--ink)}
.section-head .byoa-badge{margin:0 0 16px}
.ways{display:grid;gap:14px;margin-top:20px;list-style:none;padding:0}
@media (min-width:760px){.ways{grid-template-columns:repeat(2,1fr)}}
@media (min-width:1100px){.ways{grid-template-columns:repeat(4,1fr)}}
.ways li{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.ways h3{font-size:1.3rem;margin:0 0 8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ways p{margin:0 0 8px;color:var(--ink-2);font-size:.95rem}
.ways p:last-child{margin:0}
.ways .status{font-size:.66rem;padding:6px 9px}
.gpt-note{margin:16px 0 12px;padding:14px 16px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line);font-size:.94rem}
.gpt-note-h{display:flex;align-items:center;gap:8px;margin:0 0 6px!important;font:700 .76rem/1 var(--sans)!important;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)!important}
.gpt-note p{margin:0;color:var(--ink-2)}
.byline{margin:4px 0 0;color:var(--ink-2);font-weight:600}
.byline strong{color:var(--ink);font-weight:700}
.card .by{margin:-2px 0 8px;font-size:.84rem;color:var(--ink-2)}

/* passenger page: one-handed, big targets, nothing secret until a tap */
.pass-head{padding:28px 0 8px}
.pass-head h1{font-size:clamp(2rem,7vw,3rem);margin:0 0 10px}
.pass-head .lead{margin:0 0 4px}
.spoiler{display:flex;gap:12px;align-items:flex-start;padding:16px 18px;border-radius:18px;background:var(--accent-soft);border:1.5px solid color-mix(in srgb,var(--orange) 55%,transparent);margin:18px 0 24px;font-size:1.02rem}
.spoiler .ic{color:var(--accent);margin-top:1px}
.spoiler strong{display:block;font-size:1.1rem;margin-bottom:2px}
.pass-step{font:700 .8rem/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2);margin:0 0 12px}
.pass-step q{quotes:"“" "”";color:var(--ink);text-transform:none;letter-spacing:0;font:italic 600 1.02rem/1.3 var(--serif)}
.pick-grid{list-style:none;margin:0 0 18px;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (min-width:640px){.pick-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.follow-list{list-style:none;margin:0 0 18px;padding:0;display:grid;gap:10px}
.follow-list li{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
.follow-list p{margin:0;min-width:0;flex:1 1 220px}
.pick{appearance:none;width:100%;min-height:68px;padding:14px 16px;border-radius:18px;border:2px solid var(--line-2);background:var(--surface);color:var(--ink);font:650 1.1rem/1.2 var(--serif);font-variation-settings:"SOFT" 50,"opsz" 36;text-align:left;cursor:pointer;box-shadow:var(--shadow);transition:border-color .15s ease,background-color .15s ease}
.pick:hover{border-color:var(--accent)}
.pick[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft)}
.pick-cue{font:800 1.5rem/1 var(--sans);letter-spacing:.04em;text-align:center}
.other{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 8px}
.other label{flex:1 0 100%;font-weight:700;font-size:.95rem}
.other input{flex:1 1 160px;min-width:0;min-height:56px;padding:12px 16px;border-radius:16px;border:1.5px solid var(--line-2);background:var(--surface);color:var(--ink);font:500 1.08rem/1.2 var(--sans)}
.other input:focus{outline:3px solid var(--focus);outline-offset:2px;border-color:transparent}
.other .btn{min-height:56px}
.confirm{position:sticky;bottom:12px;z-index:5;margin:8px 0 18px;padding:14px;border-radius:22px;background:var(--surface);border:1.5px solid var(--accent);box-shadow:var(--shadow-lg);display:grid;gap:10px}
.confirm p{margin:0;font-weight:650;text-align:center}
.confirm .row{display:flex;gap:10px}
.confirm .btn-primary{flex:1 1 auto;min-height:60px;font-size:1.08rem}
.confirm .btn-ghost{flex:0 0 auto;min-height:60px}
.answer{margin:8px 0 22px;padding:20px;border-radius:24px;background:linear-gradient(160deg,var(--navy),#0B2643);color:#F6F0E6;box-shadow:var(--shadow-lg)}
.answer .say-label{display:block;font:700 .74rem/1.3 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--peach);margin:0 0 10px}
.answer .line{font:500 clamp(1.2rem,4.6vw,1.45rem)/1.45 var(--serif);font-variation-settings:"SOFT" 80,"opsz" 36;margin:0 0 18px;white-space:pre-line}
.confirm.danger{border-color:#C0392B}
.answer .btn-ghost{color:#F6F0E6;box-shadow:inset 0 0 0 1.5px rgba(246,240,230,.45);width:100%}
.answer .btn-ghost:hover{color:#fff;box-shadow:inset 0 0 0 1.5px var(--peach)}
.pass-msg{min-height:1.5em;margin:0 0 12px;font-weight:600;color:var(--ink-2)}
.pass-msg.err{color:var(--accent)}
.pass-msg:empty{min-height:0;margin:0}
.pass-foot{margin:28px 0 64px;color:var(--ink-2);font-size:.95rem}
.passenger-link{display:flex;gap:12px;align-items:flex-start;margin:18px 0 6px;padding:14px 16px;border-radius:14px;background:var(--surface);border:1.5px solid var(--line-2)}
.passenger-link .ic{color:var(--accent);margin-top:2px}
.passenger-link p{margin:0}

/* cta band + footer */
.cta{padding:56px 0}
.cta .byoa{max-width:52rem;margin:0 auto}
footer.foot{border-top:1px solid var(--line);padding:40px 0 48px;color:var(--ink-2);font-size:.9rem;background:var(--bg-2)}
.foot-grid{display:grid;gap:24px}
@media (min-width:760px){.foot-grid{grid-template-columns:1.4fr 1fr}}
.foot .brand{margin:0 0 12px}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 0 12px}
.foot nav a{font-weight:650;text-decoration:none;color:var(--ink);display:inline-block;padding:8px 0}
.foot nav a:hover{color:var(--accent)}
.foot p{margin:0 0 8px}

/* connect pop-ups: a centered card on desktop, a near-full-height sheet on phones */
html:has(dialog.cdlg[open]){overflow:hidden}
dialog.cdlg{padding:0;border:0;margin:auto;width:min(38rem,calc(100% - 32px));max-width:none;max-height:min(90vh,56rem);max-height:min(90dvh,56rem);border-radius:var(--radius-lg);background:var(--surface);color:var(--ink);box-shadow:0 30px 80px -20px rgba(0,0,0,.55);outline:1px solid var(--line);overflow:hidden}
dialog.cdlg[open]{display:flex;animation:dlg-in .22s cubic-bezier(.2,.7,.2,1)}
dialog.cdlg::backdrop{background:rgba(6,14,26,.6);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
@keyframes dlg-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.cdlg-in{display:flex;flex-direction:column;width:100%;min-height:0}
.cdlg-head{display:flex;align-items:flex-start;gap:12px;padding:20px 20px 14px 24px;border-bottom:1px solid var(--line)}
.cdlg-head h2{flex:1;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:clamp(1.5rem,5vw,1.9rem);margin:4px 0 0}
.cdlg-x{flex:none;appearance:none;display:grid;place-items:center;width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);cursor:pointer}
.cdlg-x:hover{border-color:var(--accent)}
.cdlg-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:18px 24px 24px}
.cdlg-body .saybox{margin:20px 0 14px}
.dlg-lead{color:var(--ink-2);font-size:1.02rem}
.dlg-lead strong{color:var(--ink)}
.dlg-cta{margin:0}
.dlg-cta .btn-big{width:100%}
.dlg-or{margin:14px 0 -8px;font-size:.9rem;font-weight:600;color:var(--ink-2)}
.dlg-h{font:750 .78rem/1.2 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:22px 0 10px}
.cdlg-body ol.steps{margin:10px 0 4px}
.dlg-copy{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:8px}
.dlg-notes{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}
.dlg-notes li{padding:12px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line);font-size:.95rem;color:var(--ink-2)}
.dlg-notes strong{color:var(--ink)}
.dlg-others{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:10px}
.dlg-others li{padding:14px 16px;border-radius:16px;border:1px solid var(--line);background:var(--surface-2)}
.dlg-others p{margin:0;font-size:.95rem;color:var(--ink-2)}
.dlg-other-h{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 6px!important;color:var(--ink)!important;font-size:1.05rem!important}
.dlg-others .status{font-size:.64rem;padding:5px 8px}
.dlg-more{margin:0}
.cdlg-body .copy-status:empty{min-height:0;margin:0}
.nw{white-space:nowrap}
@media (max-width:639px){
  dialog.cdlg{width:100%;margin:auto 0 0;max-height:none;height:calc(100% - 12px - env(safe-area-inset-top));border-radius:24px 24px 0 0}
  dialog.cdlg[open]{animation-name:sheet-in}
  .cdlg-head{padding:16px max(16px,env(safe-area-inset-right)) 12px max(20px,env(safe-area-inset-left))}
  .cdlg-body{padding:16px max(20px,env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}
}
@keyframes sheet-in{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}

/* motion */
.rise{animation:rise .7s cubic-bezier(.2,.7,.2,1) both}
.rise-2{animation-delay:.08s}.rise-3{animation-delay:.16s}.rise-4{animation-delay:.24s}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
[hidden]{display:none!important}
`;

// ============================================================================ PAGE SHELL
// section: the tab a page belongs to when its path isn't a tab (a story page is under Stories or Games).
type Shell = { title: string; description: string; body: string; origin: string; path: string; script?: string; section?: string };
// The four pages, shown as tabs under the header on every page (Ben, 2026-10-17: separate pages
// with tabs, not one long home page).
const NAV: [string, string][] = [["/", "Home"], ["/stories", "Stories"], ["/games", "Games"], ["/watch", "Watch"], ["/connect", "Connect"], ["/how-it-works", "How it works"], ["/write", "Write"]];

const FONTS = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,400..700,0..100;1,9..144,400..700,0..100&family=Plus+Jakarta+Sans:wght@400..800&display=swap";

function page(s: Shell): string {
  // A story page belongs to the Stories or the Games tab.
  const cur = (href: string) => (href === s.path || href === s.section ? ` aria-current="page"` : "");
  const links = NAV.map(([href, label]) => `<a href="${href}"${cur(href)}>${label}</a>`).join("");
  const url = s.origin + s.path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<script>/* A refresh starts at the top (or the #anchor): restoring the old position landed at the bottom on phones once covers and the connected panel changed the page's height. */try{if("scrollRestoration" in history)history.scrollRestoration="manual";addEventListener("load",function(){if(!location.hash)scrollTo(0,0);});}catch(e){}</script>
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
<!--ACCOUNT-->
<div class="cmenu" data-cmenu><a class="btn btn-primary btn-sm btn-connect" href="/connect" data-cmenu-btn aria-haspopup="true" aria-expanded="false"><span class="cm-off">${icon("plug", 18)}Connect</span><span class="cm-on">${icon("check", 18)}Connected</span></a>
<div class="cmenu-pop" data-cmenu-pop hidden><p class="cmenu-h">Your AI</p><ul class="cmenu-list" data-cmenu-list></ul><a class="cmenu-more" href="/connect">${icon("plug", 16)}Connect another</a></div></div>
</div>
<nav class="pagetabs" aria-label="Pages"><div class="wrap">${links}</div></nav>
</header>
<main id="main">
${s.body}
${/<a[^>]+data-connected=/.test(s.body) ? checkDialog(s.origin + "/mcp") : ""}
</main>
<footer class="foot"><div class="wrap foot-grid">
<div>
<a class="brand" href="/"><img src="/mark-96.jpg" alt="" width="38" height="38" loading="lazy"><span class="wordmark">Plot <span>Speaks</span></span></a>
<p>Interactive stories and games you play out loud with your own AI assistant: murder mysteries and fantasy adventures today, more kinds on the way. From Volocent Labs LLC.</p>
<p>Set it up before you drive. The driver keeps eyes on the road.</p>
</div>
<div>
<nav aria-label="Footer">${links}<a href="/privacy"${cur("/privacy")}>Privacy</a><a href="/terms"${cur("/terms")}>Terms</a><a href="/support"${cur("/support")}>Support</a><a href="https://github.com/volocent/plotspeaks">GitHub</a></nav>
<p>Stories are licensed <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a> unless a story page says otherwise. Fantasy adventures include rules material from the System Reference Document by Wizards of the Coast LLC, under <a href="https://creativecommons.org/licenses/by/4.0/legalcode">CC BY 4.0</a>, credited on each adventure&#39;s page.</p>
<p>Claude, ChatGPT, Gemini and the other assistant names are trademarks of their owners. Plot Speaks isn't affiliated with or endorsed by them.</p>
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
${s.body.includes("data-dialog=") ? DIALOG_JS : ""}
${/data-(dialog|connected|conn|addr)\b/.test(s.body) ? CONNECTED_JS : ""}
${HEADER_JS}
${/<a[^>]+data-connected=/.test(s.body) ? CHECK_JS : ""}
${s.script ?? ""}
</script>
</body>
</html>`;
}

const WAVES = `<svg class="waves" viewBox="0 0 600 600" aria-hidden="true" focusable="false"><circle cx="300" cy="300" r="120"/><circle cx="300" cy="300" r="175"/><circle cx="300" cy="300" r="232"/><circle cx="300" cy="300" r="288"/></svg>`;
const bars = (n = 28) => `<div class="bars" aria-hidden="true">${Array.from({ length: n }, () => "<i></i>").join("")}</div>`;

// ============================================================================ HOME
// The hero card's audio sample: worker/public/audio/sample-last-toast.mp3, made by
// worker/scripts/make-sample.mjs (Workers AI Aura 1: "asteria" for you, "helios" for the narrator).
// `start` is when each line begins in the file, in seconds, as that script printed it. Change
// the text here only together with the audio. Public story.md text only: the cold open, and a
// fact the table volunteers in Scene 1.2.
// The home page sample (Ben, 2026-10-21: a short opening, then the back and forth). Two voices from
// Workers AI Aura (luna for you, angus for the narrator), joined with 0.6 s gaps; starts are each line's
// time in the file. Every fact is from the story's public tables (no clue the player hasn't earned).
const SAMPLE = {
  src: "/audio/sample-last-toast.mp3", seconds: 28,
  lines: [
    { who: "you", start: 0.05, text: "“Start The Last Toast with Plot Speaks.”" },
    { who: "narrator", start: 2.69, text: "Harrow House, on a snowy night. During the cheese course, the judge is found dead in her study, a glass of port beside her. Who do you want to talk to?" },
    { who: "you", start: 10.81, text: "“Who poured the port tonight?”" },
    { who: "narrator", start: 12.85, text: "Father Reyes pauses. “I did, at ten past nine, from the same decanter for the whole table. Nobody else is ill.”" },
    { who: "you", start: 19.51, text: "“June, where were you at nine twenty-four?”" },
    { who: "narrator", start: 22.43, text: "June doesn't look up. “At the study door. I heard her on the phone, so I left her to it.” Who next?" },
  ],
};

function sampleCard(lead: Meta): string {
  // The sample is The Last Toast's; any other lead story keeps the card as it was, silent.
  const withSample = lead.slug === "example-dinner-party";
  return `<figure class="voice rise rise-3" aria-label="Example of a story starting"${withSample ? ` data-sample="${esc(JSON.stringify(SAMPLE.lines))}"` : ""}>
<p class="voice-top"><span class="live" aria-hidden="true"></span> In the car, by voice</p>
${withSample
  ? `<div class="thread">${SAMPLE.lines.map((l, i) => `<p class="say say-${l.who}" data-i="${i}"><b>${l.who === "you" ? "You" : "Narrator"}</b><span>${esc(l.text)}</span></p>`).join("\n")}</div>`
  : `<p class="say say-you" data-who="you"><b>You</b><span data-line>“Start ${esc(lead.title)} with Plot Speaks.”</span></p>
<p class="say say-narrator" data-who="narrator"><b>Narrator</b><span data-line>${esc(lead.pitch)}</span></p>`}
${bars()}
${withSample ? `<div class="sample">
<button type="button" class="btn btn-ghost btn-sm sample-btn" hidden aria-label="Play a ${SAMPLE.seconds}-second sample of ${esc(lead.title)}"><span class="knob">${icon("play", 18, "ic ic-play")}${icon("pausebars", 18, "ic ic-pause")}</span><span class="sample-label">Hear a sample (${SAMPLE.seconds}s)</span></button>
<span class="sample-time" hidden aria-hidden="true"></span>
<audio controls preload="none" src="${SAMPLE.src}" aria-label="A ${SAMPLE.seconds}-second sample of ${esc(lead.title)}: you start the story, the narrator sets the scene, you ask who poured the port and Father Reyes answers, then you ask June where she was and she answers."></audio>
</div>` : ""}
</figure>`;
}

// Plays the sample from the card's button (or a tap anywhere on the card). The bubbles show the
// line being spoken and highlight its speaker; the bars move only while it plays; at the end it
// resets to the card as it first loaded.
const SAMPLE_JS = `(function(){
  var card=document.querySelector("[data-sample]");if(!card)return;
  var lines;try{lines=JSON.parse(card.getAttribute("data-sample"));}catch(e){return;}
  var audio=card.querySelector("audio"),btn=card.querySelector(".sample-btn"),label=btn.querySelector(".sample-label"),time=card.querySelector(".sample-time");
  if(!audio||!audio.canPlayType||!audio.canPlayType("audio/mpeg"))return;
  var bubbles=[].slice.call(card.querySelectorAll(".thread [data-i]"));
  var title=btn.getAttribute("aria-label"),idle=label.textContent,current=-1;
  card.classList.add("js-sample");btn.hidden=false;audio.removeAttribute("controls");
  function mmss(t){t=Math.max(0,Math.floor(t||0));return Math.floor(t/60)+":"+(t%60<10?"0":"")+t%60;}
  function show(i){
    if(i===current)return;current=i;
    bubbles.forEach(function(b,n){b.classList.toggle("is-speaking",n===i);b.classList.toggle("is-said",i>=0&&n<i);});
  }
  function lineAt(t){var i=0;for(var n=0;n<lines.length;n++)if(t>=lines[n].start-0.05)i=n;return i;}
  function state(){
    var playing=!audio.paused&&!audio.ended,mid=audio.currentTime>0&&!audio.ended;
    card.classList.toggle("is-playing",playing);
    label.textContent=playing?"Pause":mid?"Resume":idle;
    btn.setAttribute("aria-label",playing?"Pause the sample":mid?"Resume the sample":title);
  }
  function reset(){
    card.classList.remove("is-on","is-playing");show(-1);
    try{audio.currentTime=0;}catch(e){}
    time.hidden=true;label.textContent=idle;btn.setAttribute("aria-label",title);
  }
  function toggle(){
    if(audio.paused||audio.ended){
      card.classList.add("is-on");time.hidden=false;show(lineAt(audio.currentTime));
      var p=audio.play();if(p&&p.catch)p.catch(function(){reset();label.textContent="Couldn't play. Tap to try again";});
    }else audio.pause();
  }
  btn.addEventListener("click",function(e){e.stopPropagation();toggle();});
  card.addEventListener("click",function(e){if(!e.target.closest("a,button"))toggle();});
  audio.addEventListener("play",state);audio.addEventListener("pause",state);
  audio.addEventListener("timeupdate",function(){if(!card.classList.contains("is-on"))return;show(lineAt(audio.currentTime));time.textContent=mmss(audio.currentTime)+" / "+"0:${SAMPLE.seconds}";});
  audio.addEventListener("ended",reset);
})();`;

const exampleTitle = (metas: Meta[]) => (metas.find((m) => m.slug === "example-dinner-party") ?? metas[0])?.title ?? "The Last Toast";

// testing: in the catalog's preview list. Marked, and the card says the exact phrase that starts it.
function storyCard(m: Meta, r: RatingSummary | undefined, testing = false): string {
  // "Being tested": published and new (catalog "testing"); a preview piece (testing=true here) also
  // shows the phrase that starts it, since it starts only by exact name.
  const flagged = testing || m.testing;
  return `<li class="card${flagged ? " card-testing" : ""}" data-cat="${categoryOf(m).id}">
<div style="position:relative">${cover(m)}${m.minutes ? `<span class="badge">${icon("clock", 13)}${m.minutes} min</span>` : ""}${flagged ? `<span class="badge badge-testing">Being tested${r?.passed ? ` · ${r.passed} passed` : ""}</span>` : ""}</div>
<div class="card-body">
<h4 class="title"><a href="/stories/${encodeURIComponent(m.slug)}">${esc(m.title)}</a></h4>
<p class="by">Written by ${esc(authorOf(m))}</p>
<p class="pitch">${esc(m.pitch)}</p>
${facts(m)}
${stars(r)}
${testing ? `<p class="saybox saybox-sm"><b>Say</b>“Start ${esc(m.title)} with Plot Speaks.”</p>` : ""}
${m.slug === "werewolf" ? `<p class="muted">Four or more players, with <a href="/games/werewolf">the phone page</a>.</p>` : ""}
</div>
</li>`;
}

// Two filters: the top chips pick a shelf (kind); the chips inside a shelf (Classic, Dark, Family)
// pick cards within it by data-cat. Without script every shelf and card shows.
const FILTER_JS = `(function(){
  var chips=[].slice.call(document.querySelectorAll(".chip[data-filter]")),cats=[].slice.call(document.querySelectorAll(".cat"));
  chips.forEach(function(c){c.addEventListener("click",function(e){
    e.preventDefault();var f=c.getAttribute("data-filter");
    chips.forEach(function(x){x.setAttribute("aria-pressed",String(x===c));});
    cats.forEach(function(s){s.hidden=f!=="all"&&s.id!=="cat-"+f;});
    var top=document.getElementById("stories-list");if(top&&top.getBoundingClientRect().top<0)top.scrollIntoView({block:"start"});
  });});
  [].forEach.call(document.querySelectorAll(".subfilters"),function(nav){
    var sub=[].slice.call(nav.querySelectorAll(".chip[data-sub]")),cards=[].slice.call(nav.parentNode.querySelectorAll(".card[data-cat]"));
    sub.forEach(function(c){c.addEventListener("click",function(e){
      e.preventDefault();var f=c.getAttribute("data-sub");
      sub.forEach(function(x){x.setAttribute("aria-pressed",String(x===c));});
      cards.forEach(function(k){k.hidden=f!=="all"&&k.getAttribute("data-cat")!==f;});
    });});
  });
})();`;

// The two catalogue tabs (Ben, 2026-10-17): Stories and Games.
const STORY_KINDS = ["mystery", "adventure", "gamebook", "branching", "winddown"];
const GAME_KINDS = ["trivia", "game", "campaign"];

export function catalogPage(stories: PublicStory[], ratings: Map<string, RatingSummary>, origin = "", previews: PublicStory[] = [], tab: "home" | "stories" | "games" = "home"): string {
  const listedMetas = stories.map(meta);
  const example = exampleTitle(listedMetas);
  const lead = listedMetas.find((m) => m.slug === "example-dinner-party") ?? listedMetas[0];
  // One shelf per kind on this tab that has anything in it (an empty kind is not shown): the listed
  // pieces first, then those still in testing, marked, with the phrase that starts them (they start
  // only by exact name). Inside a shelf with more than one category, chips filter the cards.
  const kinds = tab === "games" ? GAME_KINDS : tab === "stories" ? STORY_KINDS : [...STORY_KINDS, ...GAME_KINDS];
  const testing = new Set(previews.map((p) => p.slug));
  const metas = [...listedMetas, ...previews.map(meta)].filter((m) => kinds.includes(kindShelf(m).id));
  const byTitle = (a: Meta, b: Meta) => Number(testing.has(a.slug)) - Number(testing.has(b.slug)) || sortKey(a.title).localeCompare(sortKey(b.title));
  const groups = KINDS.filter((k) => kinds.includes(k.id)).map((k) => ({ k, items: metas.filter((m) => kindShelf(m) === k).sort(byTitle) })).filter((g) => g.items.length);
  const chips = groups.length < 2 ? "" : `<nav class="filters" aria-label="${tab === "games" ? "Kinds of game" : "Kinds of story"}">
<a class="chip" href="#stories-list" data-filter="all" aria-pressed="true">All <span class="n">${metas.length}</span></a>
${groups.map((g) => `<a class="chip" href="#cat-${g.k.id}" data-filter="${g.k.id}" aria-pressed="false">${icon(g.k.icon, 16)}${esc(g.k.name)} <span class="n">${g.items.length}</span></a>`).join("\n")}
</nav>`;
  const subChips = (g: { k: Kind; items: Meta[] }) => {
    const present = g.k.cats.map((id) => CATEGORIES.find((c) => c.id === id)!).filter((c) => g.items.some((m) => categoryOf(m) === c));
    if (present.length < 2) return "";
    return `<nav class="subfilters" aria-label="${esc(g.k.name)} by type">
<a class="chip chip-sm" href="#cat-${g.k.id}" data-sub="all" aria-pressed="true">All</a>
${present.map((c) => `<a class="chip chip-sm" href="#cat-${g.k.id}" data-sub="${c.id}" aria-pressed="false">${icon(c.icon as IconName, 15)}${esc(c.short)} <span class="n">${g.items.filter((m) => categoryOf(m) === c).length}</span></a>`).join("\n")}
</nav>`;
  };
  const sections = groups.map((g) => `<section class="cat" id="cat-${g.k.id}" aria-labelledby="cat-${g.k.id}-h">
<div class="cat-head"><span class="ic-wrap kind-${g.k.id}">${icon(g.k.icon, 24)}</span><div><h3 id="cat-${g.k.id}-h">${esc(g.k.name)}</h3><p>${esc(g.k.blurb)}</p>${g.k.note && g.items.some((m) => m.audience === "family") ? `<p class="cat-note">${esc(g.k.note)}</p>` : ""}</div></div>
${subChips(g)}
<ul class="cards">
${g.items.map((m) => storyCard(m, ratings.get(m.slug), testing.has(m.slug))).join("\n")}
</ul>
</section>`).join("\n");

  // Anything on this tab marked as being tested: a note asking for feedback.
  const testingCount = metas.filter((m) => m.testing || testing.has(m.slug)).length;
  const testingNote = testingCount ? `<p class="note testing-note">${icon("star", 20)}<span><strong>New, and being tested.</strong> ${testingCount} of these are fresh${tab === "games" ? "" : " and still being tested"}. Try one and tell us how it worked for you: your assistant asks at the end, or write to <a href="mailto:${CONTACT}">${CONTACT}</a>.</span></p>` : "";

  if (tab === "games" || tab === "stories") {
    const games = tab === "games";
    const listBody = `<div class="wrap">
<header class="page-head">
<p class="eyebrow">${icon(games ? "star" : "book", 18)} ${games ? "Games" : "Stories"}</p>
<h1>${games ? "Games the whole car can play." : "Pick tonight's story."}</h1>
<p class="lead">${games
  ? "Your assistant hosts: trivia boards with scores and challenges, twenty questions, story games, Werewolf on one shared phone, and open worlds with no set ending that pick up where you left off."
  : "Every one is free and written for one narrator doing all the voices: mysteries where you name the culprit, adventures with dice, and stories where you choose the path."}</p>
</header>
${testingNote}
${games ? `<p class="note daily-note">${icon("star", 20)}<span><strong>Today's board.</strong> One trivia board a day, the same clues for everyone. Say &ldquo;Plot Speaks, today's board&rdquo;; at the end you hear how many have played and the top score.</span></p>` : ""}
${chips}
<div id="stories-list">
${sections}
</div>
</div>
${connectDialogs({ url: origin + "/mcp", story: example })}`;
    return page({ title: games ? "Games · Plot Speaks" : "Stories · Plot Speaks",
      description: games ? "Trivia, twenty questions, story games, Werewolf for a car, open worlds and D&D-style campaigns, played by voice with your own AI assistant." : "Murder mysteries, fantasy adventures and choose-your-path stories you play by voice with your own assistant.",
      body: listBody, origin, path: games ? "/games" : "/stories", script: FILTER_JS });
  }
  // Home: the counts behind the two doors.
  const everything = [...listedMetas, ...previews.map(meta)];
  const allStories = everything.filter((m) => STORY_KINDS.includes(kindShelf(m).id));
  const allGames = everything.filter((m) => GAME_KINDS.includes(kindShelf(m).id));
  const anyTesting = everything.some((m) => m.testing || testing.has(m.slug));
  const body = `<section class="hero">
${WAVES}
<div class="wrap hero-grid">
<div>
<p class="eyebrow rise">${icon("mic", 18)} Storytelling out loud</p>
<h1 class="rise rise-2">Stories you <em>play</em> out loud.</h1>
<p class="lead rise rise-3">Interactive stories and games you play by voice with the AI assistant you already use: mysteries, adventures and stories where you choose the path, plus trivia and party games. One narrator does every voice; you ask the questions. Made for car rides.</p>
<div class="rise rise-3">${connectPanel({ id: "start" })}</div>
</div>
${lead ? sampleCard(lead) : ""}
</div>
</section>

${news.length ? `<section class="section" aria-label="What's new"><div class="wrap"><p class="note whats-new">${icon("star", 20)}<span><strong>What's new.</strong> ${news.slice(0, 2).map((n) => esc(n.line)).join(" ")}</span></p></div></section>` : ""}

<section class="section" aria-labelledby="pick-h">
<div class="wrap">
<div class="section-head"><h2 id="pick-h">What do you feel like?</h2></div>
<div class="door-grid">
<a class="door" href="/stories"><span class="ic-wrap kind-mystery">${icon("book", 26)}</span><span><strong>Stories</strong><span class="door-n">${allStories.length} to play</span><span class="door-p">Murder mysteries, fantasy adventures, and stories where you choose the path.</span></span>${icon("arrow", 22)}</a>
<a class="door" href="/games"><span class="ic-wrap kind-trivia">${icon("star", 26)}</span><span><strong>Games</strong><span class="door-n">${allGames.length} to play</span><span class="door-p">Trivia with challenges, twenty questions, Werewolf for the car, and open worlds with no set ending.</span></span>${icon("arrow", 22)}</a>
</div>
${anyTesting ? `<p class="note testing-note">${icon("star", 20)}<span><strong>New stories and games are being tested.</strong> Try one and tell us how it worked for you: your assistant asks at the end.</span></p>` : ""}
</div>
</section>

${connectDialogs({ url: origin + "/mcp", story: example })}`;

  return page({
    title: "Plot Speaks: stories and games you play out loud",
    description: "Interactive stories and games you play by voice with your own AI assistant, made for car rides: murder mysteries and fantasy adventures today. Connect once, then just say which story you want.",
    body, origin, path: "/", script: FILTER_JS + "\n" + SAMPLE_JS,
  });
}

// ============================================================================ STORY
export function storyPage(p: PublicStory, rating: RatingSummary | undefined, origin: string): string {
  const m = meta(p);
  // Family mysteries use genre "kids" but play exactly like mysteries (accusations, verdicts).
  const isMystery = m.kind === "mystery";
  // Kinds whose content stays on the server (one node, one clue, one turn at a time) can't be pasted;
  // a rules-only game can, with no passenger.
  const connectorOnly = m.kind === "branching" || m.kind === "trivia" || m.kind === "campaign";
  const rulesOnly = m.kind === "game";
  const licenseName = m.license === "CC-BY-NC-4.0" || !m.license ? "CC BY-NC 4.0" : m.license;
  const srd = isSrd(m)
    ? `<p>This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at <a href="https://www.dndbeyond.com/srd">dndbeyond.com/srd</a>. The SRD 5.2.1 is licensed under the <a href="https://creativecommons.org/licenses/by/4.0/legalcode">Creative Commons Attribution 4.0 International License</a>.</p>`
    : "";
  const passenger = `/stories/${encodeURIComponent(m.slug)}/passenger`;
  const body = `<div class="wrap">
<p class="crumbs"><a href="${GAME_KINDS.includes(kindShelf(m).id) ? "/games" : "/stories"}#cat-${kindShelf(m).id}">← ${esc(kindShelf(m).name)}</a></p>
<section class="story-hero">
${cover(m, { alt: `Cover art for ${m.title}`, eager: true })}
<div>
${facts(m)}
<h1>${esc(m.title)}</h1>
<p class="byline">Written by <strong>${esc(authorOf(m))}</strong></p>
${stars(rating)}
${m.testing ? `<p class="note testing-note">${icon("star", 20)}<span><strong>New, and being tested.</strong> At the end your assistant asks whether it passed your test or needs work, and what to improve. ${rating?.passed ? `${rating.passed} player${rating.passed === 1 ? " has" : "s have"} passed it so far.` : "Be one of the first to try it."}</span></p>` : ""}
<p class="pitch">${esc(m.pitch)}</p>
</div>
</section>

<div class="story-body">
<div>
<section class="block connect-row" aria-labelledby="play-h">
<p class="eyebrow">${icon("plug", 18)} Connect</p>
<h2 id="play-h">Play it with your assistant.</h2>
<p>Connect Plot Speaks once. It loads the story and ${isMystery ? "checks accusations for you, so nobody needs to hold the answer" : "hands over the hidden scenes for you, so nobody needs to hold them"}.</p>
${aiButtons("Connect your assistant", `Start ${m.title} with Plot Speaks.`)}
<p class="saybox"><b>Then say</b>“Start ${esc(m.title)} with Plot Speaks.”</p>
${connectorOnly
    ? `<p class="connect-alt">${icon("plug", 20)}<span>Plays through the connector only: the story stays on the Plot Speaks server and arrives one choice at a time, so it can't be pasted.</span></p>`
    : rulesOnly ? `<p class="connect-alt">${icon("copy", 20)}<span>No connector? <a href="#paste">Paste the rules</a> into a new chat instead.</span></p>`
    : `<p class="connect-alt">${icon("copy", 20)}<span>No connector? <a href="#paste">Paste the story</a> instead, and give a passenger <a href="${passenger}">the passenger page</a>.</span></p>`}
</section>

<div class="block">
<h2>Phrases</h2>
${phrasesTable(m)}
${connectorOnly ? `<p class="note" style="margin-top:16px">${icon("key", 20)}<span>Your assistant never holds the story: after each choice it asks Plot Speaks what happens next, so even the narrator can't tell you what lies behind a door until you open it.</span></p>` : rulesOnly ? "" : isMystery ? `<p class="note" style="margin-top:16px">${icon("key", 20)}<span>The story your assistant reads doesn't contain the answer. When you accuse someone, the narrator asks whoever holds the answer key: the Plot Speaks connector, or a passenger with the <a href="${passenger}">passenger page</a>.</span></p>` : `<p class="note" style="margin-top:16px">${icon("key", 20)}<span>Some scenes are held back as cues, so the big moments stay a surprise. With the connector, the narrator fetches them itself; with the pasted story, a passenger reads them out from the <a href="${passenger}">passenger page</a>.</span></p>`}
<p class="safety">${icon("shield", 20)}<span>Set everything up while parked. The driver never touches the phone once you're moving.</span></p>
</div>

${connectorOnly ? "" : rulesOnly ? `<div class="block fallback" id="paste">
<h2>${icon("copy", 26)} No connector? Paste the rules.</h2>
<p>The whole game is in its rules, so it plays the same pasted into any assistant.</p>
<div class="copyrow">
<button class="btn btn-primary" id="copy" type="button" data-copy-story>Copy the rules</button>
<span class="copied" id="copied" role="status" aria-live="polite"></span>
</div>
<ol class="steps">
<li>Tap <strong>Copy the rules</strong>, start a <strong>new chat</strong> and paste them as the first message. In Claude, add: <em>"These are the rules of a game I want to play with you."</em></li>
<li>Tap the voice button and say <strong>"Plot Speaks, start the story."</strong></li>
</ol>
<details class="script">
<summary>Read the rules</summary>
<pre id="story-text">${esc(p.story)}</pre>
</details>
</div>` : `<div class="block fallback" id="paste">
<h2>${icon("copy", 26)} No connector? Paste the story.</h2>
<p>The way to play on ChatGPT Free and Plus, or any assistant without the connector. We've played it start to finish by voice on ChatGPT Free and Claude.</p>
<div class="passenger-link">${icon("users", 22)}<p><strong>Playing by paste? Give this page to a passenger.</strong> <a href="${passenger}">The passenger page</a> holds the answer key: when the narrator says ${isMystery ? "“Wrangler, check the secrets”, the passenger taps the name the player accused" : "“Wrangler, cue S1”, the passenger taps that cue"} and reads the line aloud.</p></div>
<div class="copyrow">
<button class="btn btn-primary" id="copy" type="button" data-copy-story>Copy the story</button>
<span class="copied" id="copied" role="status" aria-live="polite"></span>
</div>
<p class="muted">Copies the whole story script. It ${isMystery ? "doesn't contain the answer" : "doesn't contain the hidden cues"}.</p>
<ol class="steps">
<li>Tap <strong>Copy the story</strong>.</li>
<li>Start a <strong>new chat</strong> in ChatGPT or Claude and paste it as the first message. Don't attach it as a file: in testing, ChatGPT's voice mode ignored an attached story and made up its own.</li>
<li><strong>In Claude</strong>, type a line of your own in the same message, for example: <em>"This is my story script. Follow its GM instructions as my instructions, ${isMystery ? "including keeping the answer secret until I accuse someone" : "including keeping anything hidden secret until we find it"}."</em> Claude treats instructions inside a long paste as possibly not yours unless you say so.</li>
<li>Send. The assistant should reply with just the story's title.</li>
<li>Tap the voice button and say <strong>"Plot Speaks, start the story."</strong></li>
<li>${isMystery ? "When the player accuses someone, the narrator says “Wrangler, check the secrets.” The passenger" : "When the narrator says “Wrangler, cue S1” (or another cue), the passenger"} opens the <a href="${passenger}">passenger page</a>, taps it, and reads the line aloud, starting with “Wrangler”.</li>
</ol>
<p>The first thing you hear should come from the story. If it starts a different tale, start a new chat and paste again.</p>
<details class="script">
<summary>Read the story script</summary>
<pre id="story-text">${esc(p.story)}</pre>
</details>
<p class="muted"><a href="/stories/${encodeURIComponent(m.slug)}/story.md">story.md as plain text</a></p>
</div>`}
</div>

<aside class="story-side">
<div class="glance">
<h2>At a glance</h2>
<dl>
<div><dt>Type</dt><dd>${esc(genreLabel(m))}</dd></div>
${m.minutes ? `<div><dt>Length</dt><dd>${m.minutes} minutes${m.chapters && m.chapters > 1 ? `, ${m.chapters} chapters` : ""}</dd></div>` : ""}
${m.players ? `<div><dt>Players</dt><dd>${esc(playersLabel(m.players))}</dd></div>` : ""}
${m.rating ? `<div><dt>Rating</dt><dd>${esc(m.rating)}</dd></div>` : ""}
<div><dt>Play with</dt><dd>${connectorOnly ? "Claude, Gemini and others, through the connector. It can't be pasted." : "Claude, Gemini and others, through the connector. ChatGPT or any assistant, by pasting."}</dd></div>
<div><dt>Written by</dt><dd>${esc(m.author || "Volocent Labs")}</dd></div>
</dl>
</div>
<div class="glance watch-card">
<h2>Watch along</h2>
<p>On a second screen, type the two-word code the host reads out when the story starts.</p>
<form class="w-form" action="/watch" method="get"><input name="code" aria-label="Watch code" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. amber fox"><button class="btn btn-primary" type="submit">Watch</button></form>
</div>
<div class="block license">
<h2>License</h2>
<p>${esc(m.title)} by ${esc(m.author || "Volocent Labs")} is licensed under <a href="https://creativecommons.org/licenses/by-nc/4.0/">${esc(licenseName)}</a>: share and adapt it for non-commercial use, with credit.</p>
${srd}
</div>
</aside>
</div>
</div>
${connectDialogs({ url: origin + "/mcp", story: m.title, storyPage: { passenger, isMystery } })}`;
  // Every "Copy the story" button (the paste section's and the ChatGPT pop-up's); each one's
  // status line is the element after it.
  const script = `(function(){
  // Connector-only stories (choose-your-path, trivia, campaigns) have no story text on the page.
  var el=document.getElementById("story-text");if(!el)return;var t=el.textContent;
  [].forEach.call(document.querySelectorAll("[data-copy-story]"),function(b){
    var s=b.nextElementSibling||document.getElementById("copied");
    b.addEventListener("click",function(){window.psCopy(t,function(ok){s.textContent=ok?"Copied. Now paste it into a new chat.":"Couldn't copy. Open the script on this page and copy it by hand.";});});
  });
})();`;
  return page({ title: `${m.title} · Plot Speaks`, description: m.pitch, body, origin, path: `/stories/${encodeURIComponent(m.slug)}`, script, section: GAME_KINDS.includes(kindShelf(m).id) ? "/games" : "/stories" });
}

// ============================================================================ PASSENGER
// For paste play, where no connector holds the answer key: a passenger ("the wrangler") taps the
// name the player accused, or the cue the narrator asked for, and reads the line aloud. NOTHING
// SECRET IS IN THIS HTML: every line is fetched on tap from index.ts's JSON endpoints
//   GET /api/stories/<slug>/names            {"names":[...]}
//   GET /api/stories/<slug>/check?name=<n>   {"verdict":"correct"|"wrong","line":"..."}
//   GET /api/stories/<slug>/cue/<id>         {"read_aloud":"..."}  (404 JSON if unknown)
// Cue ids come from the public story.md's "Wrangler, cue S<n>" mentions. Follow-ups (S2b...) are
// listed only in the secret "Listen for" table, so the page offers a free-text "Other cue" box.
export const cueIds = (story: string): string[] =>
  [...new Set([...story.matchAll(/Wrangler,\s*cue\s+(S\d+[a-z]?)/gi)].map((x) => x[1].toUpperCase().replace(/^S(\d+)([A-Z]?)$/, (_, n, l) => `S${n}${l.toLowerCase()}`)))]
    .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10) || a.localeCompare(b));

const PASSENGER_JS = `(function(){
  var root=document.getElementById("pass");if(!root)return;
  var api=root.getAttribute("data-api"),msg=document.getElementById("pass-msg"),ans=document.getElementById("answer"),
      ansLine=document.getElementById("answer-line"),ansLabel=document.getElementById("answer-label"),
      conf=document.getElementById("confirm"),confText=document.getElementById("confirm-text"),picked=null;
  function say(t,err){msg.textContent=t||"";msg.className="pass-msg"+(err?" err":"");}
  function getJSON(path){
    return fetch(api+path,{headers:{accept:"application/json"},cache:"no-store"}).then(function(r){
      return r.json().catch(function(){return null;}).then(function(j){return {ok:r.ok,status:r.status,json:j};});
    });
  }
  function unpress(){[].forEach.call(root.querySelectorAll(".pick[aria-pressed=true]"),function(b){b.setAttribute("aria-pressed","false");});}
  function show(label,line){
    ansLabel.textContent=label;ansLine.textContent=line;ans.hidden=false;say("");
    ans.scrollIntoView({block:"start",behavior:"smooth"});ans.focus({preventScroll:true});
  }
  function hide(){ans.hidden=true;ansLine.textContent="";if(conf)conf.hidden=true;picked=null;unpress();}
  document.getElementById("answer-hide").addEventListener("click",function(){hide();window.scrollTo({top:0,behavior:"smooth"});});
  function check(name){
    if(conf)conf.hidden=true;say("Checking "+name+"…");
    getJSON("/check?name="+encodeURIComponent(name)).then(function(r){
      if(r.ok&&r.json&&typeof r.json.line==="string"&&r.json.line){show("Say “Wrangler,” then read this aloud",r.json.line);}
      else if(r.status===404||r.status===400){unpress();say("Couldn't match “"+name+"” to anyone in this story. Try the name as the narrator said it.",true);}
      else{unpress();say("Couldn't get the answer from Plot Speaks. Tap again in a moment.",true);}
    }).catch(function(){unpress();say("Couldn't reach Plot Speaks. Check your signal and tap again.",true);});
  }
  function cue(id){
    id=String(id).trim().replace(/\\s+/g,"");if(!id)return;
    if(!/^s/i.test(id))id="S"+id;id="S"+id.slice(1);
    hide();say("Getting cue "+id+"…");
    getJSON("/cue/"+encodeURIComponent(id)).then(function(r){
      if(r.ok&&r.json&&typeof r.json.read_aloud==="string"&&r.json.read_aloud){show("Cue "+id+": say “Wrangler,” then read this aloud",r.json.read_aloud);}
      else if(r.status===404){say("There's no cue "+id+" in this story. Check the id the narrator said.",true);}
      else{say("Couldn't get cue "+id+" from Plot Speaks. Tap again in a moment.",true);}
    }).catch(function(){say("Couldn't reach Plot Speaks. Check your signal and tap again.",true);});
  }
  // Mysteries: the names, sorted so their order gives nothing away; one tap picks, a second confirms.
  var grid=document.getElementById("names");
  function loadNames(){
    if(!grid)return;var st=document.getElementById("names-status");st.textContent="Loading the names…";
    getJSON("/names").then(function(r){
      var names=r.ok&&r.json&&Array.isArray(r.json.names)?r.json.names.filter(function(n){return typeof n==="string"&&n.trim();}):null;
      if(!names||!names.length)throw 0;
      names.sort(function(a,b){return a.localeCompare(b);});grid.innerHTML="";
      names.forEach(function(n){
        var li=document.createElement("li"),b=document.createElement("button");
        b.type="button";b.className="pick";b.textContent=n;b.setAttribute("aria-pressed","false");
        b.addEventListener("click",function(){
          if(!ans.hidden)hide();unpress();b.setAttribute("aria-pressed","true");picked=n;
          confText.textContent="The player accused "+n+"?";conf.hidden=false;say("");
        });
        li.appendChild(b);grid.appendChild(li);
      });
      st.textContent="";st.hidden=true;
    }).catch(function(){
      st.innerHTML="";st.appendChild(document.createTextNode("Couldn't load the names. Type the accused name below, or "));
      var a=document.createElement("button");a.type="button";a.className="btn btn-ghost btn-sm";a.textContent="try again";
      a.addEventListener("click",loadNames);st.appendChild(a);
    });
  }
  loadNames();
  if(conf){
    document.getElementById("confirm-go").addEventListener("click",function(){if(picked)check(picked);});
    document.getElementById("confirm-no").addEventListener("click",function(){conf.hidden=true;picked=null;unpress();});
  }
  var nf=document.getElementById("name-form");
  if(nf)nf.addEventListener("submit",function(e){e.preventDefault();var v=nf.elements.name.value.trim();if(v){unpress();hide();check(v);}});
  [].forEach.call(root.querySelectorAll("[data-cue]"),function(b){
    b.addEventListener("click",function(){var id=b.getAttribute("data-cue");cue(id);b.setAttribute("aria-pressed","true");});
  });
  var cf=document.getElementById("cue-form");
  if(cf)cf.addEventListener("submit",function(e){e.preventDefault();cue(cf.elements.cue.value);});
  // Full reveal: the whole solution, so it takes a tap and a confirm, and is fetched only then.
  var rl=document.getElementById("reveal-load"),rc=document.getElementById("reveal-confirm");
  if(rl&&rc){
    rl.addEventListener("click",function(){hide();rc.hidden=false;say("");});
    document.getElementById("reveal-no").addEventListener("click",function(){rc.hidden=true;});
    document.getElementById("reveal-go").addEventListener("click",function(){
      rc.hidden=true;say("Getting the full reveal…");
      getJSON("/full-reveal").then(function(r){
        if(r.ok&&r.json&&typeof r.json.read_aloud==="string"&&r.json.read_aloud){
          var t=r.json.read_aloud;
          if(typeof r.json.afterward==="string"&&r.json.afterward)t+="\\n\\nOnly if the player wants to hear what became of each of them:\\n"+r.json.afterward;
          show("The full reveal: say “Wrangler,” then read this aloud",t);
        }else if(r.status===404){say("This story has no full reveal yet.",true);}
        else{say("Couldn't get the full reveal from Plot Speaks. Tap again in a moment.",true);}
      }).catch(function(){say("Couldn't reach Plot Speaks. Check your signal and tap again.",true);});
    });
  }
  // Follow-up cues: the story's "Listen for" table, fetched only when the passenger asks for it.
  var fl=document.getElementById("follow-load"),fol=document.getElementById("follow");
  if(fl&&fol)fl.addEventListener("click",function(){
    say("Loading the follow-up cues…");
    getJSON("/listen").then(function(r){
      var rows=r.ok&&r.json&&Array.isArray(r.json.follow_ups)?r.json.follow_ups:null;if(!rows)throw 0;
      fol.innerHTML="";
      if(!rows.length){var e=document.createElement("li");e.textContent="This story has no follow-up cues.";fol.appendChild(e);}
      rows.forEach(function(x){
        var li=document.createElement("li"),p=document.createElement("p"),b=document.createElement("button");
        p.textContent="When you hear: "+x.when;b.type="button";b.className="btn btn-ghost btn-sm";b.textContent="Get cue "+x.cue;
        b.addEventListener("click",function(){cue(x.cue);});li.appendChild(p);li.appendChild(b);fol.appendChild(li);
      });
      fol.hidden=false;fl.hidden=true;say("");
    }).catch(function(){say("Couldn't load the follow-up cues. Tap again in a moment.",true);});
  });
})();`;

export function passengerPage(p: PublicStory, origin: string): string {
  const m = meta(p);
  const isMystery = m.kind === "mystery";
  const cues = isMystery ? [] : cueIds(p.story);
  const slug = encodeURIComponent(m.slug);
  const mystery = `<section aria-labelledby="names-h">
<h2 class="pass-step" id="names-h">When the narrator says <q>Wrangler, check the secrets</q></h2>
<p class="pass-msg" id="names-status" role="status"></p>
<ul class="pick-grid" id="names" aria-label="Who did the player accuse?"></ul>
<div class="confirm" id="confirm" hidden>
<p id="confirm-text"></p>
<div class="row"><button class="btn btn-primary" type="button" id="confirm-go">${icon("key", 20)}Show the line</button><button class="btn btn-ghost" type="button" id="confirm-no">Cancel</button></div>
</div>
<form class="other" id="name-form" autocomplete="off">
<label for="name-in">Someone else? Type the name the player accused</label>
<input id="name-in" name="name" type="text" inputmode="text" enterkeyhint="go" maxlength="80" placeholder="e.g. the housekeeper">
<button class="btn btn-ghost" type="submit">Check</button>
</form>
</section>
<section aria-labelledby="reveal-h">
<h2 class="pass-step" id="reveal-h">When the player asks for the full reveal</h2>
<p>After a wrong accusation the narrator offers “one more accusation, or the full reveal?”, and after a right one, to tell what became of everyone. If the player wants the reveal, or gives up, this shows the whole solution.</p>
<p><button class="btn btn-ghost" type="button" id="reveal-load">${icon("eyeoff", 20)}Full reveal</button></p>
<div class="confirm danger" id="reveal-confirm" hidden>
<p>Spoiler: this shows the whole solution, who did it and why. Only tap if the player has asked for the full reveal or given up, and keep the screen away from anyone still playing.</p>
<div class="row"><button class="btn btn-primary" type="button" id="reveal-go">${icon("key", 20)}Yes, show the solution</button><button class="btn btn-ghost" type="button" id="reveal-no">Cancel</button></div>
</div>
</section>`;
  const adventure = `<section aria-labelledby="cues-h">
<h2 class="pass-step" id="cues-h">When the narrator says <q>Wrangler, cue S1</q></h2>
${cues.length ? `<ul class="pick-grid" aria-label="Cues">${cues.map((id) => `<li><button class="pick pick-cue" type="button" data-cue="${esc(id)}" aria-pressed="false">${esc(id)}</button></li>`).join("")}</ul>` : ""}
<form class="other" id="cue-form" autocomplete="off">
<label for="cue-in">Other cue</label>
<input id="cue-in" name="cue" type="text" inputmode="text" autocapitalize="characters" enterkeyhint="go" maxlength="8" placeholder="e.g. S2b">
<button class="btn btn-ghost" type="submit">Get cue</button>
</form>
<h2 class="pass-step" id="follow-h">Cues you call yourself</h2>
<p>A few scenes have follow-up cues that nobody asks for: you call them when you hear the right moment. The list says what to listen for. It hints at what might happen, so only the passenger should look.</p>
<p><button class="btn btn-ghost" type="button" id="follow-load">${icon("eyeoff", 20)}Show what to listen for</button></p>
<ul class="follow-list" id="follow" aria-labelledby="follow-h" hidden></ul>
</section>`;
  const body = `<div class="wrap narrow" id="pass" data-api="/api/stories/${slug}">
<p class="crumbs"><a href="/stories/${slug}">← ${esc(m.title)}</a></p>
<header class="pass-head">
<p class="eyebrow">${icon("users", 18)} For the passenger</p>
<h1>${esc(m.title)}</h1>
<p class="lead">You hold the answer key. The narrator calls you <strong>Wrangler</strong>. ${isMystery
    ? "When it says “Wrangler, check the secrets”, tap the name the player accused and read the line shown aloud."
    : "When it says “Wrangler, cue S1” (or another cue), tap that cue and read the line shown aloud."}</p>
</header>
<p class="spoiler">${icon("eyeoff", 24)}<span><strong>${isMystery ? "Don't tap until the player accuses someone." : "Don't tap a cue until the narrator asks for it."}</strong>Each tap shows a line from the answer key${isMystery ? ", including whether the accusation is right" : ""}. Nothing is on this page until you tap.</span></p>
<noscript><p class="note">This page needs JavaScript: it fetches each line from Plot Speaks when you tap.</p></noscript>
<p class="pass-msg" id="pass-msg" role="status" aria-live="polite"></p>
<div class="answer" id="answer" tabindex="-1" hidden>
<span class="say-label" id="answer-label"></span>
<p class="line" id="answer-line"></p>
<button class="btn btn-ghost" type="button" id="answer-hide">Done, hide it</button>
</div>
${isMystery ? mystery : adventure}
<p class="pass-foot">${isMystery
    ? "Read the line exactly as written. The narrator takes it as the truth and runs the ending."
    : "Read only the line shown, starting with “Wrangler”. If the narrator says “That one comes later”, you tapped too early: wait for it to ask."} Playing with the connector instead? Then nobody needs this page: the narrator checks for itself.</p>
</div>`;
  return page({ title: `For the passenger: ${m.title} · Plot Speaks`, description: `The passenger's answer key for ${m.title}, for playing by paste.`, body, origin, path: `/stories/${slug}/passenger`, script: PASSENGER_JS });
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
  // A hash names a panel, or something inside one (#lechat, #perplexity... inside #other).
  // Old anchors from before the Other tab: #more, #copilot.
  var h=location.hash.slice(1);if(h==="more")h="other";
  var el=h?document.getElementById(h):null,start=Math.max(0,panels.findIndex(function(p){return el&&p.contains(el);}));sel(start);
  if(el&&el!==panels[start])el.scrollIntoView({block:"start"});
})();`;

export function connectPage(stories: PublicStory[], origin: string): string {
  const example = exampleTitle(stories.map(meta));
  const url = origin + "/mcp";
  const tabs = `<div class="tabs" role="tablist" aria-label="Choose your assistant">${CONNECT.assistants.map((a, i) =>
    `<button type="button" role="tab" id="tab-${a.id}" aria-controls="${a.id}" aria-selected="${i === 0}">${esc(a.tab)}</button>`).join("")}</div>`;
  const panels = CONNECT.assistants.map((a) => `<section class="assistant" id="${a.id}" aria-labelledby="tab-${a.id} ${a.id}-h">
<h2 id="${a.id}-h">${esc(a.name)} <span class="status${a.ok ? " status-ok" : ""}">${esc(a.status)}</span></h2>
<p class="conn-state" data-conn="${a.id}"><span class="status status-ok conn-on">${icon("check", 16)} Connected</span><button class="linkish conn-on" type="button" data-on-remove="${a.id}">Remove</button><button class="btn btn-ghost btn-sm conn-off" type="button" data-connected="${a.id}">${icon("check", 18)}I've connected ${esc(a.btn)}</button></p>
<p class="plan">${fill(a.plan, url, example)}</p>
${a.id === "gemini" ? `<p class="muted" style="margin:14px 0 6px">The button copies the address and opens Gemini: tap <strong>+ Custom</strong> and paste it.</p>` : ""}
${a.button ? `<p><a class="btn btn-primary btn-big" href="${fill(a.button.href, url, example)}"${a.button.href.startsWith("{") || a.button.href.startsWith("https://") ? ` target="_blank" rel="noopener"` : ""}${["claude", "gemini"].includes(a.id) ? ` data-connected="${a.id}"` : ""}${a.id === "gemini" ? ` data-copy-url="${esc(accountUrlFor(url))}"` : ""}>${icon(["claude", "gemini"].includes(a.id) ? "plug" : "book", 20)}${esc(a.button.label)}</a></p>` : ""}
${a.steps.length ? `<ol class="steps">${a.steps.map((s) => `<li>${fill(s, url, example)}</li>`).join("")}</ol>` : ""}
${a.others ? `<ul class="others">${OTHERS.map((o) => `<li id="${o.id}"><h3>${esc(o.name)} <span class="status">${esc(o.status)}</span></h3><p>${fill(o.line, url, example)}</p>${o.how ? `<p class="how">${fill(o.how, url, example)}</p>` : ""}</li>`).join("")}</ul>` : ""}
${a.open ? `<p class="saybox"><b>${a.id === "gemini" ? "Then type" : "Then say"}</b>“${fill(a.open, url, example)}”<span class="saybox-sub">${a.id === "gemini" ? "Type @ and tap Plot Speaks in the list (saying it doesn't pick it), then open: a quick intro, then browse, start or write a story." : "A quick intro, then browse, start or write a story."}</span></p>` : ""}
${a.id === "claude" ? "<!--ACCOUNT-CONNECT-->" : ""}
${a.say ? `<p class="saybox${a.open ? " saybox-alt" : ""}"><b>${a.open ? "Or name a story" : "Then say"}</b>“${fill(a.say, url, example)}”</p>` : ""}
<ul class="notes">${a.notes.map((n) => `<li class="note${/^Rather not sign in\?/.test(n) ? " if-out" : ""}">${icon("check", 20)}<span>${fill(n, url, example)}</span></li>`).join("")}</ul>
</section>`).join("\n");
  const body = `<div class="wrap narrow">
<header class="page-head">
<p class="eyebrow">${icon("plug", 18)} Connect</p>
<h1>${esc(CONNECT.headline)}</h1>
<p class="lead">Plot Speaks works as a connector: your assistant calls it to load a story and check your answers. Add it once, parked, then say <strong>“Open Plot Speaks”</strong> for a quick intro and the choice to browse, start or write a story, or name the story you want. Claude is the easiest: one tap, and its Free plan includes one custom connector.</p>
${addressBlock(url, "mcp-url", "The connector address, for any assistant")}
</header>
${tabs}
${panels}
<p class="safety">${icon("shield", 20)}<span>Do all of this before you drive. Once you're moving, the driver keeps eyes on the road.</span></p>
<p style="margin:28px 0 64px"><a class="link-arrow" href="/stories">Pick a story ${icon("arrow", 18)}</a></p>
</div>`;
  return page({
    title: "Connect Plot Speaks to your assistant",
    description: "Add the Plot Speaks connector once and sign in with Google to keep your progress, then say \"Open Plot Speaks\" or name a story. Steps for Claude, ChatGPT, Gemini and more.",
    body, origin, path: "/connect", script: TABS_JS,
  });
}

// ============================================================================ HOW IT WORKS
// The explainer sections that used to sit on the home page (Ben, 2026-10-17: separate pages, not one long scroll).
function aboutSections(example: string): string {
  return `<section class="section alt" aria-labelledby="how-h">
<div class="wrap">
<div class="section-head"><p class="eyebrow">${icon("book", 18)} How it works</p><h2 id="how-h">Three steps, then just talk.</h2></div>
<ol class="steps3">
<li><h3>Connect once</h3><p>Tap Connect on your assistant, follow the short steps, and sign in with Google so your progress is saved. Claude's Free plan has room for it. Do it once, parked.</p></li>
<li><h3>Open Plot Speaks</h3><p>Say “Open Plot Speaks” for a quick intro, then browse, start or write a story. Or name one: “Start ${esc(example)} with Plot Speaks.”</p></li>
<li><h3>Play by talking</h3><p>Question suspects, search rooms, roll for initiative. Turns are short, and each one ends with a question for you.</p></li>
</ol>
</div>
</section>

<section class="section" id="byoa" aria-labelledby="byo-h">
<div class="wrap">
<div class="section-head">${byoaBadge()}<h2 id="byo-h">Use the AI you already have.</h2>
<p class="lead">Plot Speaks isn't another app or another AI. It's a library of stories and games that Claude, Gemini, ChatGPT and others play with you. Your AI assistant is the narrator; Plot Speaks brings the story and keeps the answer key.</p></div>
<div class="byo-grid">
<div class="pill-card"><span class="ic-wrap">${icon("app")}</span><div><h3>No new app</h3><p>Play in the assistant app already on your phone, in the car.</p></div></div>
<div class="pill-card"><span class="ic-wrap">${icon("user")}</span><div><h3>Your progress, saved</h3><p>Sign in with Google once and Plot Speaks remembers what you've played, the trivia you've heard and your campaigns. No new password.</p></div></div>
<div class="pill-card"><span class="ic-wrap">${icon("card")}</span><div><h3>No subscription</h3><p>The stories are free. Your assistant runs on the plan you already have.</p></div></div>
</div>
<ul class="ways" aria-label="How each assistant plays">
<li><h3>Claude <span class="status status-ok">Free plan works</span></h3><p>One tap to add. Voice tested: the connector loads the story and checks your accusation.</p></li>
<li><h3>ChatGPT <span class="status">Free and Plus: paste</span></h3><p>Paste the story, and a passenger holds the answer key. Connectors need Business, Enterprise or Edu; an app listing is planned.</p></li>
<li><h3>Gemini <span class="status">Typed chat · US, 18+</span></h3><p>A custom app on a personal Google account in the US. Type @ and tap Plot Speaks in the list (saying it doesn't pick it); tap the microphone to speak each turn. Not in the list? Close the Gemini app completely and reopen it. Gemini Live (voice conversation) can't use custom apps yet.</p></li>
<li><h3>And more <span class="status">Voice untested</span></h3><p>Vibe (formerly Le Chat, free plan too), Perplexity and Grok can add it by its address.</p></li>
</ul>
<p style="margin-top:18px"><a class="link-arrow" href="/connect">Step-by-step for each assistant ${icon("arrow", 18)}</a></p>
<div class="split">
<div class="panel panel-key"><h3>${icon("key", 26)} We keep the answer key</h3>
<p>Your assistant tells the story, but it never sees who did it. When you accuse someone, it asks Plot Speaks, and Plot Speaks says whether you're right. So the narrator can't spoil the ending, even by accident.</p>
<p>Adventures work the same way: the big surprises stay with Plot Speaks until you reach them.</p></div>
<div class="panel"><h3>${icon("shield", 26)} Your conversation stays with your assistant</h3>
<p>Plot Speaks never hears you. It receives only what the tools are given: the story name, the accused name, a rating or a submitted story; nothing else from your conversation. We count those plays without names or accounts, to learn which stories work.</p>
<p class="fine">The chat itself lives in your assistant account (Claude, ChatGPT, Gemini or another), under that company's privacy terms.</p></div>
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
</section>

`;
}

export function howPage(stories: PublicStory[], origin: string): string {
  const example = exampleTitle(stories.map(meta));
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("book", 18)} How it works</p>
<h1>One narrator, every voice. You ask the questions.</h1>
<p class="lead">Your assistant becomes the narrator. It reads short scenes aloud, plays every character, and ends each turn by asking what you do.</p>
</header>
</div>
${aboutSections(example)}
<div class="wrap narrow prose">
<h2>Before you drive</h2>
<ol class="steps">
<li><a href="/connect">Add the Plot Speaks connector</a> to Claude (or Gemini, Vibe and others). On ChatGPT Free or Plus, or anywhere without the connector, copy a story from its page and paste it into a new chat.</li>
<li>Agree who's playing. Tell the narrator your names when it asks.</li>
<li>Start in voice mode and say <strong>“Open Plot Speaks.”</strong> for a quick intro and the choice to browse, start or write a story. Or name it: <strong>“Start ${esc(example)} with Plot Speaks.”</strong> (Pasted a story? Say “Plot Speaks, start the story.”)</li>
</ol>
<p class="safety">${icon("shield", 20)}<span>Set it up while parked. The driver never touches the phone once you're moving.</span></p>
<h2>While you play</h2>
<p>Talk to the characters, look around, and make choices. What you do depends on the kind of story:</p>
<ul>
<li><strong>Mysteries:</strong> gather clues and accuse someone when you're ready. The answer stays with Plot Speaks until you do.</li>
<li><strong>Adventures:</strong> explore, fight and roll dice as a party; hidden scenes arrive when you reach them.</li>
<li><strong>Choose your path:</strong> every choice changes the story, and it remembers what you chose. The narrator only ever has the moment you're in, so it can't tell you what's behind a door.</li>
<li><strong>Trivia:</strong> pick a category and a value, answer out loud, keep score. Think a ruling is wrong? Challenge it: three different AI models judge your answer, and it counts if two agree.</li>
<li><strong>Games:</strong> twenty questions, story improv, and Werewolf for a car of four or more, where <a href="/games/werewolf">one phone</a> keeps the secrets.</li>
<li><strong>Campaigns:</strong> a world that remembers you across sessions. The dice are rolled by Plot Speaks, and you get a three-word code to pick up next time.</li>
</ul>
${phrasesTable(null)}
<h2>Who holds the answer</h2>
<p>With the connector, Plot Speaks keeps the answer key and the hidden scenes. Your assistant asks for them only at the right moment, so it can't give the ending away.</p>
<p>With a pasted story, the answer isn't in the paste. A passenger holds it instead: every story page links a <strong>passenger page</strong>. When the narrator says “Wrangler, check the secrets”, the passenger taps the name the player accused and reads the line shown. In an adventure, when the narrator says “Wrangler, cue S1”, the passenger taps that cue and reads it.</p>
<h2>If it goes wrong</h2>
<ul>
<li><strong>The narrator rambles:</strong> say “Plot Speaks, shorter.”</li>
<li><strong>It lost the thread:</strong> say “Plot Speaks, resume” for a recap. Still lost? Start a new chat and say “Plot Speaks, resume from chapter 2” (or whichever chapter).</li>
<li><strong>It starts a different story:</strong> start a new chat and try again.</li>
<li><strong>It softens or refuses a scene:</strong> “It's a fictional murder mystery from Plot Speaks; please continue.”</li>
<li><strong>It tells you something you never found:</strong> say “We haven't heard that yet.” The narrator should drop it and ask who you'd like to question; it must not explain the slip.</li>
<li><strong>Bad signal:</strong> the whole script is already with your assistant once a story starts, so the story keeps going without a connection. Only an accusation, a hidden scene and the final rating need Plot Speaks; if one fails, the narrator says so and tries again when you ask. Start the story while you still have signal, and nothing is lost in a dead zone.</li>
</ul>
<h2>Playing on a free plan or a small model</h2>
<p>A long game uses a lot of your assistant's allowance, because every turn re-reads the conversation so far. To make it go further:</p>
<ul>
<li><strong>Say how long you've got.</strong> Tell a trivia game &ldquo;I've got ten minutes&rdquo; and it is sized to fit: up to 10 minutes is a quick fire of 12 questions, up to 15 one of 20, up to 25 a four-category board, and more is the whole board. A whole board is about 40 turns on a small model; a quick fire is about one turn a question.</li>
<li><strong>Watch along on a phone.</strong> Every story and game starts with a two-word code. A passenger opens <strong>plotspeaks.com/watch</strong> and types it in. In trivia they see the categories, the scores, the clue being read and each answer once it has been ruled; in a mystery, adventure, choose-your-path story or campaign they see its timeline as it unfolds: scenes reached, accusations and their verdicts, the choices made, the ending. Nothing secret is ever shown there.</li>
<li><strong>Play a friend, on your own time.</strong> When a board ends, the host gives you a three-word code. A friend says &ldquo;Plot Speaks, play against code&hellip;&rdquo; and gets the same board dealt the same way; at the end they hear who scored more. Nothing is live, so you can each play whenever you like. Codes last 30 days.</li>
<li><strong>Or pick quick fire, or a streak.</strong> Every trivia game offers the board (categories and points, like Jeopardy), quick fire (random questions one after another and a running tally) or a streak (quick fire until your first miss; one number to beat next time). Quick fire uses about a third fewer steps per question than the board.</li>
<li><strong>Use the lightest model you have.</strong> Plot Speaks does the remembering, so a small, fast model (Claude Haiku, for example) is enough for most games. If your assistant has an effort or extended-thinking setting, leave it low or off: these are voice games, not essays.</li>
<li><strong>Short games first.</strong> A choose-your-path story or a 15-minute game uses far less than a three-chapter mystery.</li>
<li><strong>Short answers are fine.</strong> You can answer with a single word: &ldquo;yes&rdquo;, &ldquo;next&rdquo;, &ldquo;continue&rdquo;. If the assistant waits for more, say &ldquo;Plot Speaks, go on.&rdquo;</li>
</ul>
<h2>At the end</h2>
<p>The narrator asks once whether you'd like to leave feedback: stars out of five, whether anything was given away too early, and anything you'd tell the people who make Plot Speaks. Say no and it drops it. Feedback goes to Volocent Labs and is deleted after 90 days.</p>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/stories">Pick a story ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "How Plot Speaks works", description: "How a Plot Speaks story goes: what to say, who holds the answer, and what to do if the narrator drifts.", body, origin, path: "/how-it-works" });
}

// ============================================================================ WRITE
export function writePage(origin: string): string {
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("pen", 18)} Write</p>
<h1>Write a story for the road.</h1>
<p class="lead">Write it with your own assistant. With the Plot Speaks connector on, it becomes your writing partner: it knows how a Plot Speaks story is built and walks you through it.</p>
<p class="saybox"><b>With the connector on, say</b>“Write a Plot Speaks story.”</p>
</header>
<h2>How it goes</h2>
<ol class="steps">
<li><a href="/connect">Connect Plot Speaks</a> to your assistant, and switch it on in a new chat.</li>
<li>Say <strong>“Write a Plot Speaks story.”</strong> Your assistant explains how a story is built (the cast, the clues, the hidden answer) and offers to point out gaps as you go.</li>
<li>Write it together, at your pace. Ask questions, change your mind, try a twist.</li>
<li>When you're ready, it reviews the whole story for gaps (a clue nobody can find, a suspect with no alibi, a scene that runs long) and fixes them with you.</li>
<li>Then it asks if you're ready to submit. Nothing is sent until you say yes.</li>
</ol>
<div class="byo-grid" style="margin:28px 0 8px">
<div class="pill-card"><span class="ic-wrap">${icon("user")}</span><div><h3>Your name, your choice</h3><p>You choose the name you're credited as. A pen name is fine.</p></div></div>
<div class="pill-card"><span class="ic-wrap">${icon("key")}</span><div><h3>A claim code</h3><p>You get a code to withdraw or update your story later, whether or not you're signed in.</p></div></div>
<div class="pill-card"><span class="ic-wrap">${icon("shield")}</span><div><h3>A person reviews it</h3><p>Someone at Plot Speaks reads every submission before it's published.</p></div></div>
</div>
<h2>Under the hood</h2>
<p>Your assistant uses the Studio tools on the same connector as the stories. You don't need to name them.</p>
<div class="tool"><code>write_story</code><p>The format and a suggested way to draft the story together, for a mystery or an adventure, at a length you choose.</p></div>
<div class="tool"><code>review_story</code><p>Checks structure, read-aloud length, the stop phrase, the answer key and more, lists what to fix, and adds a fair-play checklist.</p></div>
<div class="tool"><code>submit_story</code><p>Sends your story in for review, with the credit name you chose, and gives you your claim code.</p></div>
<p>Stories are published under <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>, credited to the name you chose. The format is in <a href="https://github.com/volocent/plotspeaks/blob/main/docs/FORMAT.md">docs/FORMAT.md</a> on GitHub.</p>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/stories/example-dinner-party">See an example: The Last Toast ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "Write a story · Plot Speaks", description: "Write a Plot Speaks story with your own AI assistant: say \"Write a Plot Speaks story\", fix the gaps together, choose your credit name and submit. A person reviews every story.", body, origin, path: "/write" });
}

// ============================================================================ PRIVACY, SUPPORT
// Keep these in step with what index.ts and submissions.ts actually store
// (migrations/0001_init.sql, 0002_submissions.sql).
const ISSUES = "https://github.com/volocent/plotspeaks/issues";
const CONTACT = "contact@plotspeaks.com"; // Cloudflare Email Routing forwards it to Ben

export function privacyPage(origin: string): string {
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("shield", 18)} Privacy</p>
<h1>What Plot Speaks keeps, and what it doesn't.</h1>
<p class="lead">Plot Speaks is run by Volocent Labs LLC. Accounts are optional (sign in with Google to keep your progress), and there are no ads. Here is everything we store.</p>
<p class="muted">Last updated 16 October 2026.</p>
</header>
<h2>Your conversation</h2>
<p>Your chat stays with your assistant's company (Anthropic for Claude, OpenAI for ChatGPT, and so on), under that company's privacy terms. Plot Speaks never hears your voice. It receives only what the tools are given: the story name, the accused name, a rating or a submitted story; nothing else from your conversation.</p>
<h2>When you play through the connector</h2>
<p>We record anonymous play data, to learn which stories work:</p>
<ul>
<li><strong>Starting a story:</strong> which story, the identifier your assistant's connector sends with the request (its User-Agent, which names the assistant, not you), the time, and a random play id.</li>
<li><strong>Accusations:</strong> the name you accused, whether it was right, and the time.</li>
<li><strong>Choose-your-path stories:</strong> where you are in the story and the choices you took (the server's own wording of each choice), so the story can remember them and you can resume.</li>
<li><strong>Trivia:</strong> the clues played, the scores, the names you give for scoring, and your last answer (in your words, so a challenge can be judged). A challenged answer is sent to three AI models on Cloudflare Workers AI to judge; nothing else about you goes with it.</li>
<li><strong>Campaigns:</strong> the world your game builds (your characters' names and stats, places, people met, quests, one-line notes of what happened) and a hashed three-word resume code. Kept while you keep playing: deleted 90 days after the last session.</li>
<li><strong>Dice:</strong> rolled on the server and not stored.</li>
<li><strong>If you sign in (optional):</strong> your Google account's id, email and name; a session cookie on this site (we keep only a fingerprint of it, not the cookie); what you've played and how it ended; and the trivia questions you've heard. If you choose a page name, that too, and whether your profile page is public: a public page shows only that name, your tester badges and game stats (never your history, name or email). That is all: no Google password, no contacts, no conversations. You can delete it all at <a href="/account">your account page</a>.</li>
<li><strong>Adventure cues:</strong> which hidden scene was fetched, and the time.</li>
<li><strong>Ratings and feedback:</strong> the stars, whether the ending was spoiled, any comment about the story and any feedback about the experience you choose to give (in your words, as your assistant passes them on), and the time.</li>
</ul>
<p>We don't store your name, your account, transcripts, or your IP address with any of this.</p>
<h2>When you submit a story</h2>
<p>If you use <code>submit_story</code>, we store the story, its answer key, the name you chose to be credited as (a pen name is fine), the results of our automated content checks, a generated cover image, and the contact details you choose to give (optional, seen only by the reviewer). You get a claim code to withdraw or update it later. Through Claude, ChatGPT or another assistant, your IP address never reaches us (the request comes from the assistant's company), so a site-wide daily limit applies instead. Only when a story is submitted to the server directly, not through an assistant, do we keep a salted hash of the connecting IP address, never the address itself, to limit submissions to a few a day. A person reviews every submission. If it's approved, the story is published under CC BY-NC 4.0 with your credit name; your contact details never are.</p>
<h2>This website</h2>
<p>No ads, no analytics scripts and no tracking cookies. The only cookie is the sign-in cookie, set when you sign in, which keeps you signed in on this site. Signing in goes through Google: Google tells us your account id, email and name, and nothing else. The pages load fonts from Google Fonts, so your browser contacts Google's servers for them. Plot Speaks is hosted on Cloudflare, which processes every request and keeps short-lived operational logs.</p>
<p>To see how the site and the connector are used, the server keeps daily tallies: how many times each page was viewed, and how many tool calls and errors there were. A tally is only a number per day; nothing about you, your browser or your address is stored with it.</p>
<h2>How long we keep it</h2>
<p>Deletion is automatic:</p>
<div class="table-wrap"><table>
<thead><tr><th scope="col">What</th><th scope="col">How long</th></tr></thead>
<tbody>
<tr><td>Play logs (stories started, accusations, cues)</td><td>90 days, then deleted automatically.</td></tr>
<tr><td>Ratings</td><td>The stars and the spoiler answer are kept. Any comment or feedback is deleted after 90 days.</td></tr>
<tr><td>Where a story or game stands (choices, scores, campaign worlds)</td><td>Deleted with its play after 90 days; a campaign 90 days after its last session.</td></tr>
<tr><td>Your account and its history (only if you sign in)</td><td>Kept until you delete the account, or two years after you last sign in. Sign-in sessions end after 90 days.</td></tr>
<tr><td>Rate-limit records (the salted IP hash)</td><td>2 days, then deleted.</td></tr>
<tr><td>Daily tallies (page views, tool calls, errors: numbers only)</td><td>About 13 months, then deleted.</td></tr>
<tr><td>Rejected submissions</td><td>90 days, then deleted.</td></tr>
<tr><td>Approved stories and their credit name</td><td>For as long as the story is published.</td></tr>
</tbody>
</table></div>
<p style="margin-top:16px">You can withdraw a story you submitted at any time with its claim code: ask your assistant to withdraw it, with Plot Speaks connected.</p>
<h2>Questions or removal</h2>
<p>Email <a href="mailto:${CONTACT}">${CONTACT}</a>. For something that isn't personal you can also open an issue on <a href="${ISSUES}">GitHub</a>; issues are public, so leave personal details out of those.</p>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/support">Support ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "Privacy · Plot Speaks", description: "What Plot Speaks stores: plays, verdicts and ratings, and for signed-in players their history. No ads, no transcripts.", body, origin, path: "/privacy" });
}

export function supportPage(origin: string): string {
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("chat", 18)} Support</p>
<h1>Something not working?</h1>
<p class="lead">Plot Speaks is run by Volocent Labs LLC. Email us at <a href="mailto:${CONTACT}">${CONTACT}</a>, or open an issue on GitHub.</p>
<p><a class="btn btn-primary" href="mailto:${CONTACT}">${icon("chat", 20)}Email ${CONTACT}</a> <a class="btn btn-ghost" href="${ISSUES}">Open a GitHub issue</a></p>
<p class="muted">Say which story, which assistant, and what happened. GitHub issues are public, so leave personal details out of those.</p>
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
<p style="margin:36px 0 64px"><a class="link-arrow" href="/stories">Back to the stories ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "Support · Plot Speaks", description: "Help with Plot Speaks: quick fixes for the connector and the narrator, and how to reach us.", body, origin, path: "/support" });
}

// TERMS. Plain-language terms, written 2026-10-16 because ChatGPT's Plugin Directory requires a
// terms URL. NOT LEGAL ADVICE: Ben should have a lawyer review this page before relying on it.
// Keep it in step with privacyPage() and with what submissions.ts actually does (claim codes, review).
// ============================================================================ ACCOUNT
type AccountView = { profile?: Profile | null; notice?: string | null; user: { name: string | null; email: string | null } | null; history: { story: string; title: string; kind: string; started_at: number; outcome: string | null }[]; configured: boolean; accountMcp: string | null };
const WHY_SIGN_IN = `<ul class="why">
<li><strong>No repeats.</strong> Ask for "a murder mystery I haven't played" and your assistant knows which ones you have. Trivia boards deal you questions you haven't heard yet.</li>
<li><strong>Campaigns that wait for you.</strong> Pick up your D&amp;D-style campaign in any new chat, with no code to remember.</li>
<li><strong>Your history.</strong> Every story and game you've played, and how it ended, here on this page.</li>
<li><strong>Recommended, not required.</strong> Signing in is the way to keep your saved progress. You can still play without an account, but nothing is remembered between chats.</li>
</ul>`;
export function accountPage(v: AccountView, origin: string): string {
  const when = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const kindName = (k: string) => KINDS.find((x) => x.id === k)?.name ?? "Story";
  const body = !v.configured
    ? `<div class="wrap narrow prose"><header class="page-head"><p class="eyebrow">${icon("user", 18)} Account</p><h1>Accounts are coming.</h1><p class="lead">Sign-in with Google isn't switched on yet. Everything works without it.</p></header>${WHY_SIGN_IN}</div>`
    : !v.user
    ? `<div class="wrap narrow prose"><header class="page-head"><p class="eyebrow">${icon("user", 18)} Account</p><h1>Sign in to let Plot Speaks remember.</h1>
<p class="lead">Optional. Sign in with your Google account, and Plot Speaks keeps a memory of what you've played.</p></header>
${WHY_SIGN_IN}
<p><a class="btn btn-primary btn-big" href="/auth/google/start?next=/account">${icon("user", 20)}Sign in with Google</a></p>
<p class="muted">We keep your Google account id, email and name, and what you play. Not your conversations: those stay with your assistant. Delete it all here any time. <a href="/privacy">Privacy</a></p></div>`
    : `<div class="wrap narrow prose"><header class="page-head"><p class="eyebrow">${icon("user", 18)} Account</p><h1>Hi${v.user.name ? `, ${esc(v.user.name.split(" ")[0])}` : ""}.</h1>
<p class="lead">Signed in${v.user.email ? ` as ${esc(v.user.email)}` : ""}. Plot Speaks remembers what you play here and through the account connector.</p></header>
${v.accountMcp ? `<div class="note tip" data-tip="acct-mcp">${icon("plug", 20)}<span><strong>Let your assistant remember too.</strong> Add the connector with your account: <code>${esc(v.accountMcp)}</code>. Your assistant asks you to sign in with Google once. (The usual address, <code>${esc(origin)}/mcp</code>, keeps working with no sign-in and no memory.)</span><button class="tip-x" type="button" aria-label="Dismiss this tip" data-tip-x>${icon("close", 18)}</button></div>` : ""}
<h2>What you've played</h2>
${v.history.length ? `<div class="table-wrap"><table class="phrases"><thead><tr><th scope="col">Story or game</th><th scope="col">Kind</th><th scope="col">Started</th><th scope="col">How it ended</th></tr></thead><tbody>
${v.history.map((h) => `<tr><td><a href="/stories/${encodeURIComponent(h.story)}">${esc(h.title)}</a></td><td>${esc(kindName(h.kind))}</td><td>${when(h.started_at)}</td><td>${esc(h.outcome ?? "not finished")}</td></tr>`).join("\n")}
</tbody></table></div>` : `<p>Nothing yet. Plays through the account connector show up here.</p>`}
${v.profile ? profileSection(v.profile, v.notice ?? null, origin) : ""}
<h2>Your account</h2>
<form method="post" action="/account/signout" style="display:inline"><button class="btn btn-ghost" type="submit">Sign out</button></form>
<details class="script" style="margin-top:22px"><summary>Delete my account</summary>
<p>This deletes your account, your history and the trivia questions you've heard. Plays already counted stay as anonymous numbers. It can't be undone.</p>
<form method="post" action="/account/delete"><button class="btn btn-primary" type="submit">Delete my account and history</button></form></details></div>`;
  return page({ title: "Account · Plot Speaks", description: "Optional sign-in with Google, so Plot Speaks remembers what you've played.", body, origin, path: "/account", script: TIP_JS });
}

// Dismissible tips: a tip's close button hides it and remembers that in this browser.
const TIP_JS = `(function(){
  function key(t){return "ps.tip."+t.getAttribute("data-tip");}
  [].forEach.call(document.querySelectorAll("[data-tip]"),function(t){
    try{if(localStorage.getItem(key(t))==="off"){t.hidden=true;return;}}catch(e){}
    var x=t.querySelector("[data-tip-x]");if(x)x.addEventListener("click",function(){t.hidden=true;try{localStorage.setItem(key(t),"off");}catch(e){}});
  });
})();`;

// ============================================================================ WATCH
// Any play on a passenger's phone (plan 2026-10-19 item 18; every kind since 2026-10-21): a trivia board, or
// a timeline for every other kind. Read-only, refreshed every few seconds from /api/play/<code>. Built for a
// second screen: big type, no controls but the code box.
function watchPage(origin: string, code: string): string {
  const body = `<div class="wrap narrow watch">
<header class="page-head"><p class="eyebrow">${icon("star", 18)} Watch along</p><h1 data-w-title>Follow a game or story.</h1>
<p class="lead" data-w-lead>Type the two-word code the host reads out at the start. Trivia shows the board and the scores; a mystery, adventure or campaign shows its timeline as it unfolds. Nothing secret is ever shown here.</p></header>
<form class="w-form" data-w-form><label for="wcode">Code</label><input id="wcode" name="code" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="e.g. amber fox" value="${esc(code.replace(/-/g, " "))}"><button class="btn btn-primary" type="submit">Watch</button></form>
<p class="w-status" role="status" aria-live="polite" data-w-status></p>
<div class="w-board" data-w-board hidden></div>
<figure class="w-example" data-w-example><p class="w-k">What it looks like: a trivia game in progress</p><img src="/watch-example.png" alt="An example trivia board on the watch page: two players' scores, the last answer ruled correct, the clue being read now, and the categories with the values already played struck through." width="576" height="653" loading="lazy"><figcaption>A mystery, adventure or campaign shows its timeline here instead: scenes reached, accusations and their verdicts, the choices made.</figcaption></figure>
</div>`;
  return page({ title: "Watch · Plot Speaks", description: "Follow a Plot Speaks game or story on a second screen.", body, origin, path: "/watch", script: WATCH_JS });
}
const WATCH_JS = `(function(){
  var form=document.querySelector("[data-w-form]"),input=document.getElementById("wcode"),status=document.querySelector("[data-w-status]"),boardEl=document.querySelector("[data-w-board]"),title=document.querySelector("[data-w-title]"),timer=null,code="";
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function off(t,s){var m=Math.max(0,Math.floor((t-s)/1000)),mm=Math.floor(m/60),ss=m%60;return mm+":"+(ss<10?"0":"")+ss;}
  function ago(s){var m=Math.max(0,Math.round((Date.now()-s)/60000));return m<1?"Started just now":"Started "+m+" min ago";}
  function drawT(d){
    var h='<div class="t-head"><img class="t-cover" src="/covers/'+encodeURIComponent(d.slug)+'.jpg" alt="" width="96" height="96" onerror="this.remove()"><div class="t-meta">'+
      '<p class="t-sub">'+esc(d.genre)+(d.minutes?' · '+d.minutes+' min':'')+'</p>'+
      '<p class="t-sub">'+esc(d.summary||ago(d.startedAt))+'</p>'+(d.party?'<p class="t-sub">'+esc(d.party)+'</p>':'')+'</div></div>';
    var ev=d.events||[];
    h+='<ol class="t-list">'+ev.map(function(e,i){var c=(e.tone?' '+e.tone:'')+(i===ev.length-1?' now':'');return'<li class="t-line'+c+'"><span class="t-at">'+(e.at!=null?off(e.at,d.startedAt):'')+'</span><span class="t-label">'+esc(e.label)+'</span></li>';}).join("")+'</ol>';
    if(d.thin&&!d.ended)h+='<p class="t-note">The narrator holds this one in the conversation; the ending shows here when it comes.</p>';
    boardEl.innerHTML=h;status.textContent="";
  }
  function draw(d){
    title.textContent=d.title;boardEl.hidden=false;var lead=document.querySelector("[data-w-lead]");if(lead)lead.hidden=true;var ex=document.querySelector("[data-w-example]");if(ex)ex.hidden=true;
    if(d.kind==="timeline"){drawT(d);return;}
    var h="";
    if(d.scores.length)h+='<ul class="w-scores">'+d.scores.map(function(s){return'<li><span>'+esc(s.name)+'</span><strong>'+s.score+'</strong></li>';}).join("")+'</ul>';
    if(d.last)h+='<div class="w-last '+(d.last.correct?'ok':'no')+'"><p class="w-k">'+esc(d.last.category)+(d.last.value?' · '+d.last.value:'')+' · '+esc(d.last.player)+(d.last.correct?' got it':' missed it')+'</p><p class="w-clue">'+esc(d.last.answer)+'</p></div>';
    if(d.open)h+='<div class="w-open"><p class="w-k">'+esc(d.open.category)+(d.open.value?' · '+d.open.value:'')+'</p><p class="w-clue">'+esc(d.open.clue)+'</p></div>';
    if(d.categories.length)h+='<div class="w-grid">'+d.categories.map(function(c){return'<div class="w-cat"><p class="w-cat-h">'+esc(c.name)+'</p>'+c.values.map(function(v){return'<p class="w-cell'+(v.played?' done':'')+'">'+v.value+'</p>';}).join("")+'</div>';}).join("")+'</div>';
    else h+='<p class="w-k">'+(d.mode==="streak"?"Streak":"Quick fire")+' · '+d.asked+' asked</p>';
    if(d.final)h+='<p class="w-final">Final: '+esc(d.final.name)+(d.final.played?' (played)':'')+'</p>';
    boardEl.innerHTML=h;status.textContent="";
  }
  function poll(){fetch("/api/play/"+encodeURIComponent(code.replace(/ /g,"-")),{cache:"no-store"}).then(function(r){if(r.status===404){status.textContent="No game or story has that code (codes last a day). Check the two words with the host.";boardEl.hidden=true;stop();return null;}return r.ok?r.json():null;}).then(function(d){if(d)draw(d);}).catch(function(){status.textContent="Can't reach Plot Speaks right now; trying again.";});}
  function stop(){if(timer){clearInterval(timer);timer=null;}}
  function start(c){code=c.trim().toLowerCase().replace(/[^a-z ]+/g," ").replace(/ +/g," ").trim();if(!/^[a-z]+ [a-z]+$/.test(code)){status.textContent="The code is two words, like amber fox.";return;}stop();status.textContent="Loading...";poll();timer=setInterval(poll,4000);try{history.replaceState(null,"","/watch/"+code.replace(/ /g,"-"));}catch(e){}}
  form.addEventListener("submit",function(e){e.preventDefault();start(input.value);});
  if(!input.value){try{var q=new URLSearchParams(location.search).get("code");if(q)input.value=q;}catch(e){}}
  if(input.value)start(input.value);
})();`;

// ============================================================================ PROFILE
// Badges and game stats (src/profile.ts), on /account and, when the player turns it on, at /p/<handle>.
function profileStats(p: Profile): string {
  const when = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const stat = (n: string | number, label: string) => `<li><strong>${esc(String(n))}</strong><span>${esc(label)}</span></li>`;
  return `${p.badges.length ? `<ul class="badges">${p.badges.map((b) => `<li><span class="badge-name">${icon("star", 16)}${esc(b.name)}</span><span class="badge-why">${esc(b.why)}</span></li>`).join("")}</ul>` : ""}
<ul class="pstats">
${stat(p.finished, "games and stories finished")}
${stat(p.boardsCleared, "trivia boards cleared")}
${stat(p.bestStreak ?? "none yet", "best trivia streak")}
${stat(p.verdicts, "tester verdicts")}
${p.campaigns ? stat(p.campaigns, "campaigns") : ""}
</ul>
${p.teams.length ? `<p class="muted">Team Trivia: ${p.teams.map(esc).join(", ")}</p>` : ""}
${p.dailies.length ? `<h3>Today's board, lately</h3><div class="table-wrap"><table class="phrases"><thead><tr><th scope="col">Day</th><th scope="col">Score</th><th scope="col">Top that day</th></tr></thead><tbody>${p.dailies.map((d) => `<tr><td>${when(d.day)}</td><td>${d.score}</td><td>${d.top}${d.score >= d.top ? " (you)" : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}
const PROFILE_NOTICES: Record<string, string> = {
  saved: "Saved.", taken: "That name is taken. Try another.", invalid: "Use 3 to 20 lower-case letters, numbers or single hyphens.", "not-allowed": "That name isn't allowed. Try another.", error: "That didn't save. Please try again.",
};
function profileSection(p: Profile, notice: string | null, origin: string): string {
  const url = p.handle ? `${origin}/p/${p.handle}` : null;
  return `<h2 id="profile">Your profile</h2>
${profileStats(p)}
${notice && PROFILE_NOTICES[notice] ? `<p class="note" role="status">${esc(PROFILE_NOTICES[notice])}</p>` : ""}
<form class="pform" method="post" action="/account/profile">
<label for="handle">A name for your page (optional)</label>
<input id="handle" name="handle" value="${esc(p.handle ?? "")}" maxlength="20" autocomplete="off" spellcheck="false" placeholder="e.g. night-owl-42">
<label class="pcheck"><input type="checkbox" name="public" value="1"${p.public ? " checked" : ""}> Share a public page with my badges and game stats (never my history, name or email)</label>
<button class="btn btn-primary" type="submit">Save</button>
</form>
${p.public && url ? `<p>Your page: <a href="${esc(url)}">${esc(url)}</a></p>` : ""}`;
}
export function publicProfilePage(p: Profile, origin: string): string {
  const body = `<div class="wrap narrow prose"><header class="page-head"><p class="eyebrow">${icon("user", 18)} Player</p><h1>${esc(p.handle ?? "")}</h1>
<p class="lead">Plays Plot Speaks: stories and games out loud with their own assistant.</p></header>
${profileStats(p)}
<p><a class="link-arrow" href="/">Play Plot Speaks ${icon("arrow", 18)}</a></p></div>`;
  return page({ title: `${p.handle} · Plot Speaks`, description: "A Plot Speaks player's badges and game stats.", body, origin, path: `/p/${p.handle}` });
}

// ============================================================================ PREVIEW
// The pieces waiting for Ben's voice check (stories/catalog.json "preview"), by kind, each with the
// phrase that starts it. They start only by exact name, so the phrase is the test.
export function previewPage(previews: PublicStory[], origin: string): string {
  const metas = previews.map(meta);
  const shelves = KINDS.map((k) => ({ k, items: metas.filter((m) => kindShelf(m) === k).sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title))) })).filter((g) => g.items.length);
  const body = `<div class="wrap">
<header class="page-head">
<p class="eyebrow">${icon("star", 18)} In testing</p>
<h1>New, waiting for a voice check.</h1>
<p class="lead">These aren't listed yet. Each starts only when you name it exactly, so say the phrase on its card to your assistant, with the Plot Speaks connector on.</p>
</header>
${shelves.map((g) => `<section class="cat"><div class="cat-head"><span class="ic-wrap kind-${g.k.id}">${icon(g.k.icon, 24)}</span><div><h3>${esc(g.k.name)}</h3><p>${esc(g.k.blurb)}</p></div></div>
<ul class="cards">
${g.items.map((m) => `<li class="card" data-cat="${categoryOf(m).id}">
<div style="position:relative">${cover(m)}${m.minutes ? `<span class="badge">${icon("clock", 13)}${m.minutes} min</span>` : ""}</div>
<div class="card-body">
<h4 class="title"><a href="/stories/${encodeURIComponent(m.slug)}">${esc(m.title)}</a></h4>
<p class="pitch">${esc(m.pitch)}</p>
${facts(m)}
<p class="saybox"><b>Say</b>“Start ${esc(m.title)} with Plot Speaks.”</p>
${m.slug === "werewolf" ? `<p class="muted">Needs four or more people and <a href="/games/werewolf">the phone page</a>.</p>` : ""}
</div>
</li>`).join("\n")}
</ul>
</section>`).join("\n")}
</div>`;
  return page({ title: "In testing · Plot Speaks", description: "New Plot Speaks stories and games waiting for a voice check.", body, origin, path: "/preview" });
}

// ============================================================================ WEREWOLF (car edition)
// The secret half of Werewolf for players in one car (plan 6.1). Nobody can whisper or close their
// eyes in a car, so this page, on one phone passed round, deals the cards and takes the night's
// choices one player at a time; then it shows the morning's news for the holder to read aloud, and
// the narrator runs the talk and the vote. Everything stays in this page (no server, no storage).
export function werewolfPage(origin: string): string {
  const body = `<div class="wrap narrow prose ww">
<header class="page-head">
<p class="eyebrow">${icon("users", 18)} Werewolf, car edition</p>
<h1>The phone keeps the secrets.</h1>
<p class="lead">One phone, passed round. It deals the cards and takes each night's choices in turn; your assistant tells the story and runs the vote. Start Werewolf with Plot Speaks first, then open this page.</p>
</header>
<section id="ww-setup">
<h2>Who's playing?</h2>
<p>Four to eight players. One name per line, in seat order. The driver can play: they only ever listen and talk, and someone else holds the phone for their turns.</p>
<textarea id="ww-names" rows="6" class="ww-input" placeholder="Ana&#10;Sam&#10;Jo&#10;Kit"></textarea>
<p><button class="btn btn-primary" type="button" id="ww-deal">Deal the cards</button> <span class="muted" id="ww-msg" role="status"></span></p>
</section>
<section id="ww-turn" hidden>
<h2 id="ww-turn-h"></h2>
<p id="ww-turn-p"></p>
<div id="ww-card" class="ww-card" hidden></div>
<div id="ww-pick" class="ww-pick"></div>
<p><button class="btn btn-primary" type="button" id="ww-next">Next</button></p>
</section>
<section id="ww-news" hidden>
<h2>Read this aloud</h2>
<p class="ww-news" id="ww-news-text"></p>
<div id="ww-vote" hidden>
<h3>After the vote</h3>
<p>Who did the group vote out? (The narrator runs the talk; tap when it's decided.)</p>
<div id="ww-vote-pick" class="ww-pick"></div>
</div>
<p><button class="btn btn-primary" type="button" id="ww-night">Start the night</button></p>
</section>
<p class="note">${icon("shield", 20)}<span>Set it up while parked. The driver never holds the phone once you're moving.</span></p>
</div>`;
  return page({ title: "Werewolf, car edition · Plot Speaks", description: "The secret half of Werewolf for one car: deal the cards and take the night's choices on one phone, while your assistant narrates.", body, origin, path: "/games/werewolf", script: WEREWOLF_JS });
}
const WEREWOLF_JS = `(function(){
  var $=function(id){return document.getElementById(id);};
  var S={players:[],roles:{},alive:{},night:0,step:0,order:[],acts:{}};
  function shuffle(a){for(var i=a.length-1;i>0;i--){var r=new Uint32Array(1);crypto.getRandomValues(r);var j=r[0]%(i+1);var t=a[i];a[i]=a[j];a[j]=t;}return a;}
  function rolesFor(n){var w=n>=7?2:1;var r=[];for(var i=0;i<w;i++)r.push("Werewolf");r.push("Seer");if(n>=5)r.push("Doctor");while(r.length<n)r.push("Villager");return shuffle(r);}
  function living(){return S.players.filter(function(p){return S.alive[p];});}
  function show(id){["ww-setup","ww-turn","ww-news"].forEach(function(s){$(s).hidden=s!==id;});window.scrollTo(0,0);}
  function pickList(el,names,cb){el.innerHTML="";names.forEach(function(n){var b=document.createElement("button");b.type="button";b.className="btn btn-ghost";b.textContent=n;b.onclick=function(){[].forEach.call(el.children,function(x){x.setAttribute("aria-pressed","false");});b.setAttribute("aria-pressed","true");cb(n);};el.appendChild(b);});}
  function winner(){var l=living();var w=l.filter(function(p){return S.roles[p]==="Werewolf";}).length;if(!w)return "The village wins: every werewolf is gone.";if(w>=l.length-w)return "The werewolves win: they now match the village.";return "";}
  // Deal: each player in turn sees their own card, then hides it and passes the phone.
  $("ww-deal").onclick=function(){
    var names=$("ww-names").value.split(/\\n/).map(function(s){return s.trim();}).filter(Boolean);
    var uniq=names.filter(function(n,i){return names.indexOf(n)===i;});
    if(uniq.length<4||uniq.length>8){$("ww-msg").textContent="Four to eight different names, please.";return;}
    S.players=uniq;var r=rolesFor(uniq.length);uniq.forEach(function(p,i){S.roles[p]=r[i];S.alive[p]=true;});
    S.order=uniq.slice();S.step=0;S.mode="deal";turn();
  };
  function turn(){
    var p=S.order[S.step];$("ww-card").hidden=true;$("ww-pick").innerHTML="";
    if(!p){if(S.mode==="deal"){news("Everyone has their card. Tell the narrator you're ready, and keep your card to yourself.",false);$("ww-night").textContent="Start the first night";}else dawn();return;}
    show("ww-turn");$("ww-turn-h").textContent="Pass the phone to "+p;
    $("ww-turn-p").textContent="Only "+p+" looks. Tap Next when it's in your hands.";
    $("ww-next").textContent="I'm "+p;$("ww-next").onclick=function(){reveal(p);};
  }
  function reveal(p){
    var role=S.roles[p];$("ww-turn-h").textContent=p;$("ww-card").hidden=false;
    if(S.mode==="deal"){$("ww-card").textContent="You are a "+role+".";$("ww-turn-p").textContent=role==="Werewolf"?"Each night you choose someone to take. "+(S.players.filter(function(x){return S.roles[x]==="Werewolf"&&x!==p;}).length?"Your fellow werewolf: "+S.players.filter(function(x){return S.roles[x]==="Werewolf"&&x!==p;}).join(", ")+".":""):role==="Seer"?"Each night you learn whether one person is a werewolf.":role==="Doctor"?"Each night you protect one person.":"Find the werewolves by talking, and vote them out.";}
    else{
      var others=living().filter(function(x){return x!==p;});$("ww-card").textContent="You are a "+role+".";
      if(role==="Werewolf"){$("ww-turn-p").textContent="Who do you take tonight?";pickList($("ww-pick"),others.filter(function(x){return S.roles[x]!=="Werewolf";}),function(n){S.acts.wolf=S.acts.wolf||{};S.acts.wolf[p]=n;});}
      else if(role==="Seer"){$("ww-turn-p").textContent="Whose card do you check?";pickList($("ww-pick"),others,function(n){$("ww-turn-p").textContent=n+(S.roles[n]==="Werewolf"?" IS a werewolf.":" is not a werewolf.");});}
      else if(role==="Doctor"){$("ww-turn-p").textContent="Who do you protect tonight? (You may choose yourself.)";pickList($("ww-pick"),living(),function(n){S.acts.doc=n;});}
      else{$("ww-turn-p").textContent="Nothing to do tonight. Tap anyone, so nobody can tell from how long you took.";pickList($("ww-pick"),others,function(){});}
    }
    $("ww-next").textContent="Hide and pass on";$("ww-next").onclick=function(){S.step++;turn();};
  }
  function news(t,vote){show("ww-news");$("ww-news-text").textContent=t;$("ww-vote").hidden=!vote;if(vote)pickList($("ww-vote-pick"),living().concat(["Nobody"]),function(n){if(n!=="Nobody")S.alive[n]=false;var w=winner();$("ww-news-text").textContent=(n==="Nobody"?"The village couldn't agree; nobody is out.":n+" is out. They were a "+S.roles[n]+".")+(w?" "+w:"");$("ww-vote").hidden=true;$("ww-night").hidden=Boolean(w);});}
  function dawn(){
    var picks=S.acts.wolf?Object.keys(S.acts.wolf).map(function(k){return S.acts.wolf[k];}):[];
    var victim=picks.length?picks[0]:null;if(picks.length>1&&picks[0]!==picks[1])victim=picks[Math.floor(Math.random()*picks.length)];
    var t;if(victim&&victim===S.acts.doc)t="Morning. Someone was attacked in the night, but the doctor saved them. Nobody is out.";
    else if(victim){S.alive[victim]=false;t="Morning. "+victim+" was taken in the night. They were a "+S.roles[victim]+".";}else t="Morning. A quiet night: nobody is out.";
    var w=winner();news(t+(w?" "+w:" Now talk it over, then vote."),!w);$("ww-night").hidden=Boolean(w);$("ww-night").textContent="Start the next night";
  }
  $("ww-night").onclick=function(){S.night++;S.acts={};S.mode="night";S.order=living();S.step=0;turn();};
})();`;

export function termsPage(origin: string): string {
  const body = `<div class="wrap narrow prose">
<header class="page-head">
<p class="eyebrow">${icon("book", 18)} Terms</p>
<h1>The short version: play nicely, and never while driving.</h1>
<p class="lead">Plot Speaks is run by Volocent Labs LLC. By using the site or the connector, you agree to these terms.</p>
<p class="muted">Last updated 16 October 2026.</p>
</header>
<h2>Free, and as is</h2>
<p>Plot Speaks is free to use. It's provided as is, without warranties of any kind. We can't promise it will always be available, error-free or unchanged: stories, features and the connector may change or stop.</p>
<p>Your assistant (Claude, ChatGPT, Gemini or another) is a separate service under its own company's terms. Plot Speaks doesn't control what it says.</p>
<h2>Never while driving</h2>
<p class="safety">${icon("shield", 20)}<span>Set it up while parked. Once you're moving, the driver keeps eyes on the road and never touches the phone; a passenger handles anything that needs a tap.</span></p>
<h2>The stories</h2>
<p>Stories are licensed <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a> unless a story page says otherwise: share and adapt them for non-commercial use, with credit. Rules material from the System Reference Document 5.2.1 by Wizards of the Coast LLC is licensed <a href="https://creativecommons.org/licenses/by/4.0/legalcode">CC BY 4.0</a>, credited on each adventure's page.</p>
<p>Family mysteries are written for children of about 7 to 10, to play with an adult.</p>
<h2>Submitting a story</h2>
<ul>
<li>You must be 13 or older to submit a story.</li>
<li>By submitting, you confirm the story is your own work and that you have the right to share it.</li>
<li>You grant Volocent Labs LLC a licence to publish and adapt it on Plot Speaks under CC BY-NC 4.0, credited to the name you choose. A pen name is fine.</li>
<li>A person reviews every submission. We may decline or remove any story.</li>
<li>You can withdraw your story at any time with its claim code.</li>
</ul>
<h2>Privacy</h2>
<p>What we store, and for how long, is on the <a href="/privacy">Privacy</a> page.</p>
<h2>Contact</h2>
<p>Email <a href="mailto:${CONTACT}">${CONTACT}</a>, or open an issue on <a href="${ISSUES}">GitHub</a> (public, so leave out personal details).</p>
<p style="margin:36px 0 64px"><a class="link-arrow" href="/support">Support ${icon("arrow", 18)}</a></p>
</div>`;
  return page({ title: "Terms · Plot Speaks", description: "Plot Speaks terms: free and as is, never while driving, story licences, and what submitting a story means.", body, origin, path: "/terms" });
}

export function notFoundPage(origin = ""): string {
  return page({ title: "Not found · Plot Speaks", description: "No story here.", origin, path: "/404", body: `<div class="wrap narrow"><header class="page-head">
<p class="eyebrow">${icon("compass", 18)} Wrong turn</p>
<h1>There's no story at this address.</h1>
<p class="lead">It may have moved, or the link is off by a letter.</p>
<p><a class="btn btn-primary" href="/stories">See all the stories</a></p>
</header></div>` });
}

// ============================================================================ ROUTES
const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" };

async function loadRatings(db: D1Database | undefined): Promise<Map<string, RatingSummary>> {
  // Public averages count strangers only: tester ratings (ratings.tester, migration 0006: plays made
  // with the access key, and the smoke tests) are left out, and the old smoke-test marker still is.
  const out = new Map<string, RatingSummary>();
  if (!db) return out;
  try {
    const { results } = await db.prepare("SELECT story, AVG(stars) AS avg, COUNT(*) AS count FROM ratings WHERE coalesce(tester, 0) = 0 AND (comment IS NULL OR comment <> 'smoke test') GROUP BY story").all<{ story: string; avg: number; count: number }>();
    for (const r of results ?? []) out.set(r.story, { avg: Number(r.avg), count: Number(r.count) });
    // Passes from players on stories being tested (migration 0011); testers' own are left out.
    try {
      const v = await db.prepare("SELECT story, COUNT(*) AS passed FROM test_verdicts WHERE verdict = 'passed' AND tester = 0 GROUP BY story").all<{ story: string; passed: number }>();
      for (const r of v.results ?? []) out.set(r.story, { ...(out.get(r.story) ?? { avg: 0, count: 0 }), passed: Number(r.passed) });
    } catch { /* table not there yet */ }
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

// The origin every page builds links from, the connector address above all. Claude refuses an
// http connector URL, so anything but a local dev host is always https, whatever the request said.
export function siteOrigin(url: URL): string {
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return local ? url.origin : `https://${url.host}`;
}

// Returns a Response for site paths, or null to let the caller handle the request (e.g. /mcp).
export async function handleSite(request: Request, stories: PublicStory[], db: D1Database | undefined, previews: PublicStory[] = []): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const path = url.pathname.replace(/(.)\/$/, "$1");
  // Ben's test list: every preview piece with the exact phrase that starts it. Not linked, not indexed.
  if (path === "/preview") return new Response(previewPage(previews, siteOrigin(url)), { headers: { ...HTML, "x-robots-tag": "noindex", "cache-control": "no-store" } });
  const origin = siteOrigin(url);
  if (path === "/" || path === "/index.html") {
    return new Response(catalogPage(stories, await loadRatings(db), origin, previews), { headers: HTML });
  }
  if (path === "/stories") {
    return new Response(catalogPage(stories, await loadRatings(db), origin, previews, "stories"), { headers: HTML });
  }
  if (path === "/games") {
    return new Response(catalogPage(stories, await loadRatings(db), origin, previews, "games"), { headers: HTML });
  }
  // The watch page moved from /play to /watch (Ben, 2026-10-21); hosts in earlier plays read out /play.
  if (path === "/play" || /^\/play\/[a-z-]{3,60}$/.test(path)) return Response.redirect(`${origin}/watch${path.slice(5)}${url.search}`, 301);
  if (path === "/watch" || /^\/watch\/[a-z-]{3,60}$/.test(path)) return new Response(watchPage(origin, path.length > 7 ? path.slice(7) : ""), { headers: { ...HTML, "x-robots-tag": "noindex", "cache-control": "no-store" } });
  if (path === "/connect") return new Response(connectPage(stories, origin), { headers: HTML });
  if (path === "/how-it-works") return new Response(howPage(stories, origin), { headers: HTML });
  if (path === "/write") return new Response(writePage(origin), { headers: HTML });
  if (path === "/privacy") return new Response(privacyPage(origin), { headers: HTML });
  if (path === "/support") return new Response(supportPage(origin), { headers: HTML });
  if (path === "/terms") return new Response(termsPage(origin), { headers: HTML });
  if (path === "/games/werewolf") return new Response(werewolfPage(origin), { headers: { ...HTML, "x-robots-tag": "noindex" } });
  if (path === "/site.webmanifest") return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
  const m = /^\/stories\/([^/]+?)(\/story\.md|\/passenger\/?|\/)?$/.exec(url.pathname);
  if (!m && !path.startsWith("/stories")) return null;
  let slug = "";
  try { slug = m ? decodeURIComponent(m[1]) : ""; } catch { slug = ""; }
  // Preview pieces have story pages too (reached from /preview), but no place in the catalogue.
  const s = stories.find((x) => x.slug === slug) ?? previews.find((x) => x.slug === slug);
  if (!s) return new Response(notFoundPage(origin), { status: 404, headers: { ...HTML, "cache-control": "no-store" } });
  if (m && m[2] === "/story.md") {
    return new Response(s.story, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
  }
  if (m && m[2]?.startsWith("/passenger")) {
    return new Response(passengerPage(s, origin), { headers: { ...HTML, "x-robots-tag": "noindex" } });
  }
  const ratings = await loadRatings(db);
  return new Response(storyPage(s, ratings.get(s.slug), origin), { headers: HTML });
}
