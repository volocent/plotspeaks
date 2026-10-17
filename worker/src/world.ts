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
export function applyChanges(w0: World, ch: WorldChanges): { world: World; refused: string[]; done: string[] } {
  const w: World = JSON.parse(JSON.stringify(w0));
  const refused: string[] = [];
  const done: string[] = [];
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
    if (p.remove) { w.party = w.party.filter((x) => x !== m); done.push(`${name} left the party`); continue; }
    if (!m) {
      if (w.party.length >= 6) { refused.push(`${name}: the party is full (six)`); continue; }
      const max = int(p.max_hp ?? p.hp, 1, 200, 10);
      m = { name, class: clip(p.class, 30) || "adventurer", level: int(p.level, 1, 5, 1), hp: max, max_hp: max, slots: {}, max_slots: {}, conditions: [], inventory: [], gold: int(p.gold, 0, 1e6, 0) };
      w.party.push(m);
      done.push(`${name} joined (${m.class}, level ${m.level}, ${m.max_hp} HP)`);
    }
    if (p.class) m.class = clip(p.class, 30);
    if (p.level !== undefined) {
      const lv = int(p.level, 1, 5, m.level);
      if (lv < m.level) refused.push(`${name}: levels don't go down`);
      else if (lv > m.level + 1) refused.push(`${name}: one level at a time (level ${m.level} to ${m.level + 1})`);
      else m.level = lv;
    }
    if (p.max_hp !== undefined) {
      // A higher maximum (a level up) raises current HP by the same amount; a lower one caps it.
      const max = int(p.max_hp, 1, 200, m.max_hp);
      m.hp = Math.min(max, m.hp + Math.max(0, max - m.max_hp));
      m.max_hp = max;
    }
    if (p.max_slots) for (const [lvl, n] of Object.entries(p.max_slots)) if (/^[1-5]$/.test(lvl)) { m.max_slots[lvl] = int(n, 0, 4, 0); m.slots[lvl] = Math.min(m.slots[lvl] ?? m.max_slots[lvl], m.max_slots[lvl]); }
    if (p.damage) { m.hp = Math.max(0, m.hp - int(p.damage, 0, 500, 0)); done.push(`${name} takes ${int(p.damage, 0, 500, 0)} (${m.hp}/${m.max_hp})`); if (m.hp === 0) done.push(`${name} is down: death saves (roll 1d20 each turn)`); }
    if (p.heal) { m.hp = Math.min(m.max_hp, m.hp + int(p.heal, 0, 500, 0)); done.push(`${name} heals to ${m.hp}/${m.max_hp}`); }
    if (p.hp !== undefined && !p.damage && !p.heal && w0.party.some((x) => same(x.name, name))) {
      const hp = int(p.hp, 0, 500, m.hp);
      if (hp > m.max_hp) refused.push(`${name}: ${hp} HP is above their maximum ${m.max_hp}`); else m.hp = hp;
    }
    if (p.spend_slot) {
      const lvl = String(p.spend_slot);
      if ((m.slots[lvl] ?? 0) <= 0) refused.push(`${name} has no level-${lvl} spell slot left (they come back on a long rest)`);
      else { m.slots[lvl] -= 1; done.push(`${name} spends a level-${lvl} slot (${m.slots[lvl]} left)`); }
    }
    if (p.conditions) m.conditions = p.conditions.map((c) => clip(c, 30)).filter(Boolean).slice(0, 8);
    for (const it of p.add_items ?? []) if (m.inventory.length < 40) m.inventory.push(clip(it, 60));
    for (const it of p.remove_items ?? []) {
      const i = m.inventory.findIndex((x) => same(x, it));
      if (i < 0) refused.push(`${name} isn't carrying "${clip(it, 60)}"`); else m.inventory.splice(i, 1);
    }
    if (p.gold !== undefined && w0.party.some((x) => same(x.name, name))) {
      const g = int(p.gold, -1e6, 1e6, m.gold);
      if (g < 0) refused.push(`${name} can't have less than no gold`); else m.gold = g;
    }
  }
  if (ch.rest === "long") {
    // A long rest restores HP and slots and ends short-term conditions ("poisoned", "used Action
    // Surge"); lasting ones (curses, petrification, exhaustion, diseases) stay for the narrator to handle.
    for (const m of w.party) { m.hp = m.max_hp; m.slots = { ...m.max_slots }; m.conditions = m.conditions.filter((c) => /curse|petrif|exhaust|disease/i.test(c)); }
    // The rest moves the day on, unless this same update already set the day.
    if (ch.day === undefined || int(ch.day, 1, 100000, w.day) <= w0.day) w.day += 1;
    done.push(`long rest: everyone at full HP and slots; it is day ${w.day}`);
  } else if (ch.rest === "short") done.push("short rest: each character may spend Hit Dice to heal (roll them, then send heal)");
  for (const n of ch.npcs ?? []) {
    const name = clip(n.name, 50);
    if (!name) continue;
    const old = w.npcs.find((x) => same(x.name, name));
    const status = clip(n.status, 30).toLowerCase();
    if (old && old.status === "dead" && status && status !== "dead") { refused.push(`${name} is dead, and the dead stay dead`); continue; }
    if (old) { if (status) old.status = status; if (n.note) old.note = clip(n.note, 160); }
    else if (w.npcs.length < 60) w.npcs.push({ name, status: status || "met", note: clip(n.note, 160) });
  }
  for (const q of ch.quests ?? []) {
    const name = clip(q.name, 60);
    if (!name) continue;
    const old = w.quests.find((x) => same(x.name, name));
    const status = (["open", "done", "failed"].includes(String(q.status)) ? q.status : undefined) as Quest["status"] | undefined;
    if (old) { if (status) old.status = status; if (q.note) old.note = clip(q.note, 160); }
    else if (w.quests.length < 30) w.quests.push({ name, status: status ?? "open", note: clip(q.note, 160) });
  }
  if (ch.note) w.log = [...w.log, `Day ${w.day}: ${clip(ch.note, 240)}`].slice(-40);
  return { world: w, refused, done };
}

/** The compact state the narrator reads at the start of each session and after every update. */
export function recall(w: World): string {
  const party = w.party.length
    ? w.party.map((m) => `- ${m.name}, ${m.class} ${m.level}: ${m.hp}/${m.max_hp} HP${Object.keys(m.max_slots).length ? `; slots ${Object.keys(m.max_slots).sort().map((l) => `L${l} ${m.slots[l] ?? 0}/${m.max_slots[l]}`).join(", ")}` : ""}${m.conditions.length ? `; ${m.conditions.join(", ")}` : ""}${m.gold ? `; ${m.gold} gp` : ""}${m.inventory.length ? `; carrying ${m.inventory.join(", ")}` : ""}`).join("\n")
    : "- (no characters yet: help the players make them, then record them with world_update)";
  return [
    `DAY ${w.day}${w.location ? `, ${w.location}` : ""}.`,
    `PARTY:\n${party}`,
    w.quests.length ? `QUESTS:\n${w.quests.map((q) => `- ${q.name} (${q.status})${q.note ? `: ${q.note}` : ""}`).join("\n")}` : "",
    w.npcs.length ? `PEOPLE MET:\n${w.npcs.map((n) => `- ${n.name} (${n.status})${n.note ? `: ${n.note}` : ""}`).join("\n")}` : "",
    w.log.length ? `STORY SO FAR (latest last):\n${w.log.slice(-8).map((l) => `- ${l}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Server-side dice: "1d20+5", "2d6", "adv 1d20+3" (advantage), "dis 1d20" (disadvantage), "4d6 drop lowest". */
export function roll(expr: string, rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): { text: string; total: number } | { error: string } {
  const e = expr.trim().toLowerCase();
  const mode = /^(adv|advantage)\b/.test(e) ? "adv" : /^(dis|disadvantage)\b/.test(e) ? "dis" : null;
  const m = /(\d{0,2})d(\d{1,3})\s*([+-]\s*\d{1,3})?(\s*drop lowest)?/.exec(e);
  if (!m) return { error: `"${expr.slice(0, 40)}" isn't a dice roll; try "1d20+3" or "2d6".` };
  const n = Math.min(Number(m[1] || 1), 20), sides = Number(m[2]), mod = m[3] ? Number(m[3].replace(/\s/g, "")) : 0;
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
export const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) => WORDS[n % WORDS.length]).join(" ");
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
    .bind(playId, JSON.stringify(w).slice(0, 32000), Date.now());
