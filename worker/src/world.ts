// Campaign engine (kind: campaign; plan sections 4c and 5e).
//
// A D&D-style campaign (SRD 5.2.1) improvised by the narrator from a world seed in story.md, with
// the bookkeeping on the server so it survives between sessions and can't drift: the party's hit
// points, spell slots and inventory, where they are, who they've met (the dead stay dead), the
// quests, the day. roll() throws dice on the server, so the narrator can't fudge them. A campaign is
// resumed in a new chat with a spoken three-word code (stored hashed, like claim codes).

export type Member = { name: string; class: string; level: number; hp: number; max_hp: number; slots: Record<string, number>; max_slots: Record<string, number>; conditions: string[]; inventory: string[]; gold: number };
export type Npc = { name: string; status: string; note: string };
export type Quest = { name: string; status: "open" | "done" | "failed"; note: string };
export type World = { day: number; location: string; party: Member[]; npcs: Npc[]; quests: Quest[]; log: string[]; code?: string };

export const newWorld = (): World => ({ day: 1, location: "", party: [], npcs: [], quests: [], log: [] });

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
// Long text is cut at a word, and the report says so (2026-10-17 QA: cuts landed mid-word, silently).
const cut = (s: unknown, n: number): { text: string; short: boolean } => {
  const t = String(s ?? "").trim();
  if (t.length <= n) return { text: t, short: false };
  const at = t.lastIndexOf(" ", n);
  return { text: (at > n * 0.6 ? t.slice(0, at) : t.slice(0, n)).replace(/[\s,;:.-]+$/, ""), short: true };
};
const SHORT = " (shortened)";
// Repeated things read as one ("Prop ×8"), and items are separated by " | " because items
// themselves contain commas (a skill card "Skills: Shoot 3, Fight 1").
const listItems = (items: string[]) => {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  return [...counts].map(([it, n]) => (n > 1 ? `${it} ×${n}` : it)).join(" | ");
};
const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export type WorldChanges = {
  location?: string; day?: number; note?: string;
  party?: Partial<Member & { remove: boolean; add_items: string[]; remove_items: string[]; damage: number; heal: number; spend_slot: string }>[];
  npcs?: Partial<Npc>[];
  quests?: Partial<Quest>[];
  rest?: "short" | "long";
};

/** Applies the narrator's changes, refusing anything the rules don't allow. Returns the new world and what was refused. */
export function applyChanges(w0: World, ch: WorldChanges, opts: { open?: boolean } = {}): { world: World; refused: string[]; done: string[] } {
  const w: World = JSON.parse(JSON.stringify(w0));
  const refused: string[] = [];
  const done: string[] = [];
  // Words for the report: an open world says health, rank and money (2026-10-17 QA).
  const HP = opts.open ? "health" : "HP", LV = opts.open ? "rank" : "level", MONEY = opts.open ? "money" : "gold";
  if (ch.location) { w.location = clip(ch.location, 120); done.push(`location: ${w.location}`); }
  if (ch.day !== undefined) {
    const d = int(ch.day, 1, 100000, w.day);
    if (d < w.day) refused.push(`day ${d}: time doesn't run backwards (it is day ${w.day})`);
    else if (d !== w.day) { w.day = d; done.push(`day ${d}`); }
  }
  for (const p of ch.party ?? []) {
    const name = clip(p.name, 40);
    if (!name) { refused.push("a party change with no name"); continue; }
    let m = w.party.find((x) => same(x.name, name));
    if (p.remove) {
      if (!m) { refused.push(`${name} isn't in the party`); continue; }
      w.party = w.party.filter((x) => x !== m); done.push(`${name} left the party`); continue;
    }
    if (!m) {
      if (w.party.length >= 6) { refused.push(`${name}: the party is full (six)`); continue; }
      const max = int(p.max_hp ?? p.hp, 1, 200, 10);
      m = { name, class: clip(p.class, 30) || "adventurer", level: int(p.level, 1, 5, 1), hp: max, max_hp: max, slots: {}, max_slots: {}, conditions: [], inventory: [], gold: int(p.gold, 0, 1e6, 0) };
      w.party.push(m);
      done.push(`${name} joined (${m.class}, ${LV} ${m.level}, ${m.max_hp} ${HP}${m.gold ? `, ${m.gold} ${MONEY}` : ""})`);
    }
    if (p.class) m.class = clip(p.class, 30);
    if (p.level !== undefined) {
      const lv = int(p.level, 1, 5, m.level);
      if (lv < m.level) refused.push(`${name}: ${LV} doesn't go down`);
      else if (lv > m.level + 1) refused.push(`${name}: one ${LV} at a time (${m.level} to ${m.level + 1})`);
      else if (lv !== m.level) { done.push(`${name}: ${LV} ${m.level} to ${lv}`); m.level = lv; }
    }
    if (p.max_hp !== undefined) {
      // A higher maximum (a level up) raises current HP by the same amount; a lower one caps it.
      const max = int(p.max_hp, 1, 200, m.max_hp);
      if (max !== m.max_hp && w0.party.some((x) => same(x.name, name))) done.push(`${name}: maximum ${HP} ${m.max_hp} to ${max}`);
      m.hp = Math.min(max, m.hp + Math.max(0, max - m.max_hp));
      m.max_hp = max;
    }
    if (p.max_slots) for (const [lvl, n] of Object.entries(p.max_slots)) if (/^[1-5]$/.test(lvl)) { m.max_slots[lvl] = int(n, 0, 4, 0); m.slots[lvl] = Math.min(m.slots[lvl] ?? m.max_slots[lvl], m.max_slots[lvl]); }
    if (p.damage) { m.hp = Math.max(0, m.hp - int(p.damage, 0, 500, 0)); done.push(`${name} takes ${int(p.damage, 0, 500, 0)} (${m.hp}/${m.max_hp})`); if (m.hp === 0) done.push(opts.open ? `${name} is down (out of the scene until helped up or the danger passes; see the story's rules)` : `${name} is down: death saves (roll 1d20 each turn)`); }
    if (p.heal) { m.hp = Math.min(m.max_hp, m.hp + int(p.heal, 0, 500, 0)); done.push(`${name} heals to ${m.hp}/${m.max_hp}`); }
    if (p.hp !== undefined && !p.damage && !p.heal && w0.party.some((x) => same(x.name, name))) {
      const hp = int(p.hp, 0, 500, m.hp);
      if (hp > m.max_hp) refused.push(`${name}: ${hp} ${HP} is above their maximum ${m.max_hp}`); else if (hp !== m.hp) { m.hp = hp; done.push(`${name} at ${m.hp}/${m.max_hp} ${HP}`); if (m.hp === 0) done.push(opts.open ? `${name} is down (out of the scene until helped up or the danger passes; see the story's rules)` : `${name} is down: death saves (roll 1d20 each turn)`); }
    }
    if (p.spend_slot) {
      const lvl = String(p.spend_slot);
      if ((m.slots[lvl] ?? 0) <= 0) refused.push(`${name} has no level-${lvl} spell slot left (they come back on a long rest)`);
      else { m.slots[lvl] -= 1; done.push(`${name} spends a level-${lvl} slot (${m.slots[lvl]} left)`); }
    }
    if (p.conditions) {
      const cs = p.conditions.map((c) => cut(c, 40)).filter((c) => c.text);
      m.conditions = cs.map((c) => c.text).slice(0, 8);
      done.push(`${name}'s conditions: ${m.conditions.join("; ") || "none"}${cs.some((c) => c.short) ? SHORT : ""}${cs.length > 8 ? " (eight at most; the rest dropped)" : ""}`);
    }
    for (const it of p.add_items ?? []) {
      const { text: item, short } = cut(it, 100);
      if (!item) continue;
      if (m.inventory.length >= 40) refused.push(`${name} can't carry "${item}": forty things is the limit (remove something first)`);
      else { m.inventory.push(item); done.push(`${name} gains "${item}"${short ? SHORT : ""}`); }
    }
    for (const it of p.remove_items ?? []) {
      const i = m.inventory.findIndex((x) => same(x, it));
      if (i < 0) refused.push(`${name} isn't carrying "${clip(it, 100)}"`); else { done.push(`${name} loses "${m.inventory[i]}"`); m.inventory.splice(i, 1); }
    }
    if (p.gold !== undefined && w0.party.some((x) => same(x.name, name))) {
      const g = int(p.gold, -1e6, 1e6, m.gold);
      if (g < 0) refused.push(`${name} can't have less than no ${MONEY} (they have ${m.gold})`); else if (g !== m.gold) { done.push(`${name}'s ${MONEY}: ${m.gold} to ${g}`); m.gold = g; }
    }
  }
  if (ch.rest === "long") {
    // A long rest restores HP and slots and ends short-term conditions ("poisoned", "used Action
    // Surge"); lasting ones (curses, petrification, exhaustion, diseases) stay for the narrator to handle.
    // A ship or vehicle kept as a party member (an open world's freighter) is repaired, not rested.
    const isVehicle = (x: Member) => /^(ship|vehicle)$/i.test(x.class.trim());
    const cleared: string[] = [];
    for (const m of w.party.filter((x) => !isVehicle(x))) {
      m.hp = m.max_hp; m.slots = { ...m.max_slots };
      const kept = m.conditions.filter((c) => /curse|petrif|exhaust|disease/i.test(c));
      if (kept.length < m.conditions.length) cleared.push(`${m.name} (${m.conditions.filter((c) => !kept.includes(c)).join("; ")})`);
      m.conditions = kept;
    }
    const vehicles = w.party.filter(isVehicle).map((x) => x.name);
    // The rest moves the day on, unless this same update already set the day.
    if (ch.day === undefined || int(ch.day, 1, 100000, w.day) <= w0.day) w.day += 1;
    const who = vehicles.length ? `everyone but ${vehicles.join(" and ")} (not rested: repaired only by the story's rules)` : "everyone";
    done.push(opts.open ? `a night's rest: ${who} at full health; it is day ${w.day}` : `long rest: ${who} at full HP and slots; it is day ${w.day}`);
    if (cleared.length) done.push(`the rest cleared conditions for ${cleared.join(", ")}`);
  } else if (ch.rest === "short") done.push("short rest: each character may spend Hit Dice to heal (roll them, then send heal)");
  for (const n of ch.npcs ?? []) {
    const name = clip(n.name, 50);
    if (!name) continue;
    const old = w.npcs.find((x) => same(x.name, name));
    const status = clip(n.status, 30).toLowerCase();
    if (old && old.status === "dead" && status && status !== "dead") { refused.push(`${name} is dead, and the dead stay dead`); continue; }
    const nn = cut(n.note, 160);
    if (old) { if (status) old.status = status; if (n.note) old.note = nn.text; done.push(`${name}: ${old.status}${n.note ? `, note updated${nn.short ? SHORT : ""}` : ""}`); }
    else if (w.npcs.length >= 60) refused.push(`${name}: the list of people is full (sixty); update someone already on it instead`);
    else { w.npcs.push({ name, status: status || "met", note: nn.text }); done.push(`met ${name} (${status || "met"})${nn.short ? `, note${SHORT}` : ""}`); }
  }
  for (const q of ch.quests ?? []) {
    const name = clip(q.name, 60);
    if (!name) continue;
    const old = w.quests.find((x) => same(x.name, name));
    const status = (["open", "done", "failed"].includes(String(q.status)) ? q.status : undefined) as Quest["status"] | undefined;
    const qn = cut(q.note, 160);
    if (old) { if (status) old.status = status; if (q.note) old.note = qn.text; done.push(`quest "${name}": ${old.status}${q.note ? `, note updated${qn.short ? SHORT : ""}` : ""}`); }
    else if (w.quests.length >= 60) refused.push(`quest "${name}": the quest list is full (sixty); reuse a finished one instead`);
    else { w.quests.push({ name, status: status ?? "open", note: qn.text }); done.push(`new quest "${name}" (${status ?? "open"})${qn.short ? `, note${SHORT}` : ""}`); }
  }
  if (ch.note) { const nt = cut(ch.note, 240); w.log = [...w.log, `Day ${w.day}: ${nt.text}`].slice(-40); done.push(`story note added${nt.short ? SHORT : ""}`); }
  return { world: w, refused, done };
}

/** The compact state the narrator reads at the start of each session and after every update. */
// open: an open world without D&D rules (rules_system none), where hit points read as "health",
// levels as "rank" and gold as "money", in whatever the story's own words for them are.
export function recall(w: World, opts: { open?: boolean } = {}): string {
  const o = Boolean(opts.open);
  const party = w.party.length
    ? w.party.map((m) => `- ${m.name}, ${m.class} ${o ? `rank ${m.level}` : m.level}: ${m.hp}/${m.max_hp} ${o ? "health" : "HP"}${Object.keys(m.max_slots).length ? `; slots ${Object.keys(m.max_slots).sort().map((l) => `L${l} ${m.slots[l] ?? 0}/${m.max_slots[l]}`).join(", ")}` : ""}${m.conditions.length ? `; ${m.conditions.join("; ")}` : ""}${m.gold ? `; ${m.gold} ${o ? "money (in this world's own currency)" : "gp"}` : ""}${m.inventory.length ? `; carrying ${listItems(m.inventory)}` : ""}`).join("\n")
    : "- (no characters yet: help the players make them, then record them with world_update)";
  return [
    `DAY ${w.day}${w.location ? `, ${w.location}` : ""}.`,
    `PARTY:\n${party}`,
    w.quests.some((q) => q.status === "open") ? `QUESTS:\n${w.quests.filter((q) => q.status === "open").map((q) => `- ${q.name} (open)${q.note ? `: ${q.note}` : ""}`).join("\n")}` : "",
    // Finished quests by name only, the latest twelve, so a long campaign's state stays short.
    w.quests.some((q) => q.status !== "open") ? `FINISHED: ${w.quests.filter((q) => q.status !== "open").slice(-12).map((q) => `${q.name} (${q.status})`).join("; ")}` : "",
    w.npcs.length ? `PEOPLE MET:\n${w.npcs.map((n) => `- ${n.name} (${n.status})${n.note ? `: ${n.note}` : ""}`).join("\n")}` : "",
    w.log.length ? `STORY SO FAR (latest last):\n${w.log.slice(-8).map((l) => `- ${l}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Server-side dice: "1d20+5", "2d6", "adv 1d20+3" (advantage), "dis 1d20" (disadvantage), "4d6 drop lowest". */
export function roll(expr: string, rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): { text: string; total: number } | { error: string } {
  const e = expr.trim().toLowerCase();
  const mode = /^(adv|advantage)\b/.test(e) ? "adv" : /^(dis|disadvantage)\b/.test(e) ? "dis" : null;
  // \b keeps "100d6" from being read as "00d6"; a count of zero isn't a roll.
  const m = /\b(\d{1,2})?d(\d{1,3})\s*([+-]\s*\d{1,3})?(\s*drop lowest)?/.exec(e);
  if (!m) return { error: `"${expr.slice(0, 40)}" isn't a dice roll; try "1d20+3" or "2d6".` };
  if (m[1] !== undefined && Number(m[1]) < 1) return { error: `Roll at least one die; try "1d20".` };
  const n = Math.min(Number(m[1] ?? 1), 20), sides = Number(m[2]), mod = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
  if (![2, 3, 4, 6, 8, 10, 12, 20, 100].includes(sides)) return { error: `d${sides} isn't a standard die.` };
  const die = () => 1 + Math.floor(rand() * sides);
  const once = () => { const r = Array.from({ length: n }, die); const kept = m[4] && r.length > 1 ? [...r].sort((a, b) => a - b).slice(1) : r; return { r, sum: kept.reduce((a, b) => a + b, 0) }; };
  if (mode) {
    const a = once(), b = once();
    const pick = mode === "adv" ? (a.sum >= b.sum ? a : b) : (a.sum <= b.sum ? a : b);
    const total = pick.sum + mod;
    return { total, text: `${mode === "adv" ? "Advantage" : "Disadvantage"}: rolled ${a.r.join("+")} and ${b.r.join("+")}, keeping ${pick.sum}${mod ? ` ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}` : ""} = ${total}.${sides === 20 && n === 1 ? (pick.sum === 20 ? " A natural 20." : pick.sum === 1 ? " A natural 1." : "") : ""}` };
  }
  const o = once();
  const total = o.sum + mod;
  return { total, text: `Rolled ${o.r.join(" + ")}${m[4] ? " (lowest dropped)" : ""}${mod ? ` ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}` : ""} = ${total}.${sides === 20 && n === 1 ? (o.sum === 20 ? " A natural 20." : o.sum === 1 ? " A natural 1." : "") : ""}` };
}

// Resume codes: three short words, easy to say and hear.
const WORDS = ["amber", "anchor", "apple", "arrow", "aspen", "badger", "banner", "barley", "beacon", "birch", "bramble", "bridge", "candle", "canyon", "cedar", "cinder", "clover", "comet", "copper", "coral", "crane", "crown", "dagger", "dawn", "delta", "ember", "falcon", "fern", "fjord", "flint", "forest", "fox", "garnet", "glacier", "harbor", "hazel", "heron", "hollow", "island", "ivy", "jade", "juniper", "kestrel", "lantern", "lark", "lily", "lotus", "maple", "marble", "meadow", "moon", "moss", "oak", "onyx", "orchid", "otter", "pebble", "pine", "plum", "quartz", "raven", "reef", "ridge", "river", "robin", "rose", "saffron", "sage", "shell", "silver", "slate", "sparrow", "spruce", "star", "stone", "storm", "summit", "swan", "thistle", "thunder", "tide", "tiger", "topaz", "tulip", "valley", "violet", "willow", "wolf", "wren"];
// More words (2026-10-17 review): 89 words made only ~700k codes, few enough to guess. Codes made
// from the first list still work, since a code is looked up by its hashed text.
const MORE_WORDS = ["acorn", "alpine", "aurora", "autumn", "bamboo", "basil", "bear", "beetle", "berry", "bison", "blossom", "bluebell", "boulder", "breeze", "brook", "buffalo", "cactus", "camel", "canoe", "cardinal", "carrot", "castle", "cherry", "chestnut", "cliff", "cobalt", "compass", "cricket", "crystal", "cypress", "daisy", "desert", "dolphin", "dragon", "eagle", "elk", "emerald", "feather", "fig", "firefly", "frost", "garden", "gecko", "ginger", "goose", "granite", "grove", "hawk", "hickory", "honey", "horizon", "iris", "jasmine", "kayak", "kettle", "koala", "lagoon", "lemon", "lime", "linen", "lion", "llama", "lynx", "magnet", "mango", "meteor", "mint", "mustang", "nectar", "nutmeg", "ocean", "olive", "orbit", "owl", "panda", "panther", "parrot", "peach", "pearl", "pepper", "pilot", "planet", "pony", "poppy", "prairie", "puffin", "rabbit", "rain", "rocket", "ruby", "salmon", "sand", "sapphire", "seal", "shadow", "sky", "snow", "spark", "squirrel", "sun", "timber", "turtle", "velvet", "walnut", "whale", "wheat", "wind", "zebra"];
const CODE_WORDS = [...new Set([...WORDS, ...MORE_WORDS])];
// Uniform: reject the top sliver of the 32-bit range so no word is more likely than another.
const pickWord = (): string => {
  const lim = Math.floor(2 ** 32 / CODE_WORDS.length) * CODE_WORDS.length;
  for (;;) { const n = crypto.getRandomValues(new Uint32Array(1))[0]; if (n < lim) return CODE_WORDS[n % CODE_WORDS.length]; }
};
export const newCode = () => [pickWord(), pickWord(), pickWord()].join(" ");
/** Two words, for a watch code a passenger types (plotspeaks.com/play). */
export const newShortCode = () => [pickWord(), pickWord()].join(" ");
export const normCode = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).join(" ");
export async function codeHash(code: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`plotspeaks-campaign:${normCode(code)}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadWorld(db: D1Database | undefined, playId: string): Promise<World | null> {
  if (!db) return null;
  const row = await db.prepare("SELECT state FROM play_state WHERE play_id = ? AND kind = 'campaign'").bind(playId).first<{ state: string }>();
  if (!row) return null;
  try { return JSON.parse(row.state) as World; } catch { return null; }
}
export const saveWorld = (db: D1Database, playId: string, w: World) =>
  db.prepare("INSERT INTO play_state (play_id, kind, state, updated_at) VALUES (?, 'campaign', ?, ?) ON CONFLICT(play_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at")
    // Never cut the JSON short: a truncated world can't be parsed and the campaign is lost. The caps in
    // applyChanges keep it far under D1's row limit.
    .bind(playId, JSON.stringify(w), Date.now());
