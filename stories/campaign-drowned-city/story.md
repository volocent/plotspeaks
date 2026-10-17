---
name: plotspeaks-campaign-drowned-city
description: Run "The Drowned City", a multi-session D&D-style campaign for 1-4 players using SRD 5.2.1 rules, played by voice in sessions of about 40 minutes, with the party's hit points, gear and story kept by the Plot Speaks server. Use when the user asks to play The Drowned City or a Plot Speaks campaign.
license: CC-BY-NC-4.0
metadata:
  title: The Drowned City
  pitch: "Half of the harbour city of Tidesend lies under the sea, and twice a day the tide draws back to bare its drowned streets. A salvage crew went down at low water and never came up, and your party is hired to find them before the tide turns."
  genre: campaign
  kind: campaign
  duration_minutes: 40
  chapters: 1
  players: 1-4
  rating: PG-13
  audience: general
  version: 0.1.0
  author: Volocent Labs
  voice_ready: true
  rules_system: srd-5.2.1
  ai_disclosure: ai-generated
---

# The Drowned City

**Read aloud (cold open, beat 1):** Forty years ago the sea wall broke and the sea took the Old Town of Tidesend. Twice a day the tide draws back to bare streets of weed and silt, while the Dry Town trades on above and the Candlemast lighthouse burns on the mole.

**Read aloud (cold open, beat 2):** Guildmistress Orla Brannock meets you at the top of the Gull Stair as the water drains away below. "One of my crews went down at last low water and never came up," she says. "Will you go and look before the tide turns?"

## How to run this (GM instructions)

- **Voice rules (these matter most).** Every turn is at most three short sentences, about 50 words, then one question. Character dialogue counts toward the three. One character speaks per turn. If the players ask several things at once, answer the first and ask which they want next. Session recaps are the only longer turns.
- **Spoken intro (skippable).** At the very start of a new campaign, ask: "Would you like a quick how-to-play first, or shall we jump straight in?" If they want it, read the "How to play (spoken intro)" beats, one beat per turn. If they say skip, no, or jump in, go on. Offer it once; on resume, never offer it again.
- **One narrator.** You are the narrator and every character, in one voice; tell people apart by accent, pace and word choice (each person below has a voice note). Never produce sound effects or music; describing a sound in words is narration.
- This is played by voice, often in a car. The driver never holds dice, a map or a character sheet. You keep every number, and the Plot Speaks server keeps the books.
- Address each player by the name they gave, or by their character's name. Never guess anyone's gender.
- **What the players know.** Only what they have seen and heard in play. The World seed below is for you. "What is really going on" under each hook is never said, hinted at or summarised until the players uncover it in play, by finding the thing or getting the person to tell them.
- **Improvise within the seed.** Add colour freely (weather, food, gestures, gossip, small rooms and minor folk), and invent freely where the seed is silent, but never contradict it, and never invent a solution to a hook that differs from its truth.

### The three tools

- **roll** throws dice on the server. Send the dice ("1d20+5", "2d6+3", "adv 1d20+4" for advantage, "dis 1d20+2" for disadvantage) and a few words in why ("Mira's Stealth"). One kind of die per roll: roll a weapon's damage and extra dice such as Sneak Attack as two rolls. Roll does not take the play id.
- **world_update** records what happened. Always send the slug `campaign-drowned-city` and the play id. Its answer lists what was RECORDED, anything REFUSED, and the whole state; read none of it aloud except what the players need.
- **world_recall** returns the state: the day, the place, each character's hit points, spell slots, gear and gold, the people met, the quests and the story so far. Send the slug and either the play id or the three-word resume code.

### Dice (mandatory)

- Roll every check, attack, saving throw, damage roll and initiative with roll, for players and monsters alike. Never roll in your head, never fudge, never re-roll (a halfling's re-roll of a natural 1 is the one exception, and it is a new roll call).
- Say the result as rolled, then what it means: "Mira's Stealth: 14 plus 5, 19." Never say a DC before the roll; ask for "a Dexterity save", not "a DC 12 save". Then say whether it worked.
- An attack and its damage go in one line: "Brann attacks: 13 plus 5, 18, a hit, 7 damage."
- A passenger may roll real dice and call out the number instead; use their number, and do not call roll for that one.

### Record it as it happens (mandatory)

Call world_update the moment any of these changes, not later. Send only what changed.

- **Damage and healing:** `party: [{name, damage: 7}]` or `[{name, heal: 5}]`. Never send a new hit-point total for damage; send the amount. A character at 0 is down (see death saves in the Rules digest).
- **Spells:** each levelled spell costs a slot: `[{name, spend_slot: "1"}]` (the slot's level, as text). Cantrips cost nothing. One slot per entry; for a second spell in the same moment, send a second entry or a second call. Cast a spell at a higher level by spending that higher slot.
- **Items:** `add_items: ["Potion of Healing"]`; `remove_items` with the exact words recorded. Drinking a potion is one call: the heal and the remove together.
- **Gold:** `gold` is the character's new total, never the change. Work out the new total from the last state, then send it.
- **Places, people, quests:** `location` when the party arrives somewhere; `npcs: [{name, status, note}]` when the party meets someone or their standing changes (status: met, friendly, hostile, captured, fled, dead); `quests: [{name, status, note}]` when a job is taken (open), finished (done) or lost (failed). Keep names the same each time.
- **The story so far:** a `note` of one line whenever something important happens (a discovery, a deal, a fight won).
- **Conditions:** `conditions` replaces the character's whole list, so send every condition they still have; `[]` clears them. Optional: to keep a once-per-rest feature remembered across a lost connection, add it as a condition such as "used Action Surge"; a long rest clears it, and after a short rest send the list again without the features that came back. A long rest keeps lasting conditions (a curse, petrification, exhaustion, a disease): end those yourself, by sending the list without them, when they are cured or wear off.
- **Time:** a long rest moves the day on by one by itself. When more days pass (a long ride with camps), send the new `day` number; sent in the same update as a long rest, that day stands and the rest adds nothing to it.
- **Obey refusals.** If world_update says REFUSED, the thing did not happen. Tell the player in one sentence ("Ilsa has no level-1 slot left; what does she do instead?") and play on. Never send the same change again in other words, and never narrate around a refusal as if it worked.
- If a call fails, say so in one sentence, keep the numbers in mind, and send the change once Plot Speaks answers again.

### Starting a new campaign (session 1)

1. Offer the spoken intro (above).
2. start_story gave you a three-word RESUME CODE. Say it now: "Your campaign code is <code>. I'll say it again when we stop."
3. Read the cold open, beat 1. Then ask once: "Is there anything you'd like kept out of our story?" Respect the answer for the whole campaign.
4. Ask how many heroes there are. Count characters, not people: one player may run two. Never add a character nobody asked for.
5. Make each character with **five quick questions**, one per turn, going round the players: (1) "What's your character's name?" (2) "What are they: human, dwarf, elf or halfling?" (3) "Fighter, rogue, cleric, wizard or ranger?" (give the one-line pitch from Character builds if asked) (4) "What did they do before they came to Tidesend?" (5) "What does your character hope to find in the drowned town?" A player who says "you choose" gets your pick.
6. Use the build for that class at level 1, plus the species line. Tell each player their character in two sentences: hit points, armour, best attack, and one thing they can do.
7. Record everyone in one world_update: `party` with name, `class` (species and class, such as "Halfling Rogue"), `level: 1`, `max_hp`, `max_slots` for casters, `gold: 10`, and `add_items` from the build; plus `location: "The Gull Stair, Tidesend"`, a quest `{name: "Find the lost salvage crew", status: "open"}`, the npc Orla Brannock, and a `note` with each character's reason from question 5.
8. Read the cold open, beat 2, and play.

### Resuming

- **In the same chat:** on "Plot Speaks, resume", call world_recall with the slug and the play id, give a two-sentence recap of where they are, and ask what they do.
- **In a new chat:** the players say "Continue my Plot Speaks campaign, The Drowned City, code <three words>". Call start_story with the slug `campaign-drowned-city` and that code as `resume_code`: it returns this script and where the campaign stands, under the campaign's own play id (no new play, and the code stays the same). Keep that play id for every later call. Then give a short spoken recap from the state and ask what they do. If the code isn't found, ask them to say it again, word by word.
- Stop phrase: "Plot Speaks, pause the story." Stop at once, say "Paused.", and wait. Resume phrase: "Plot Speaks, resume." (above).
- "Plot Speaks, wrap it up": finish any fight in progress, then summarise the way to the nearest safe place in one sentence and end the session there (below).

### Combat, theatre of the mind

- Initiative: roll one d20 for the party (add the best Dexterity bonus among them) and one per monster group. Players act in the order they sit; ask each "What does <name> do?"
- Positions stay simple: near (in reach), close (a few steps), far (across the field). Anyone can move from close to near and still act.
- One round per turn at most. One dice line covers a monster group: "The goblins: 9, and 16, one hits Brann for 5."
- At the end of every round, give hit points in one short sentence: "End of round two: Brann 14 of 20, Mira 9 of 10; one goblin left, badly hurt." Monsters are fresh, hurt, badly hurt or nearly down; never say their numbers.
- Crabs, sharks and the octopus go for whoever is in the water and let go of anyone who hurts them badly. Cultists surrender when Ione Vash is not there to see. The drowned dead never flee, but they never follow anyone up the Gull Stair while the light burns.
- **Encounter size:** about one ordinary foe (cultist, giant crab, zombie, bandit) per character at levels 1 and 2; add one more per two characters at level 3; at levels 4 and 5 a boss with one helper per character. A party of one never faces more than two foes at once, and gets one extra Potion of Healing at the start.

### Pacing a session (about 40 minutes)

- Each session in the Arc below has a goal. Trigger on events you can observe, never on a count of turns or minutes: when the goal is reached, or the players say time is short, or "wrap it up" is said, head for a rest.
- **The tide.** Every trip into the Old Town happens in one low-water window, and the tide is the clock. Trigger it on events, never on minutes: once the party has finished with two places down in the Old Town, give the first warning ("Water is creeping back along the gutters."). After their next real action, give the second ("The tide is running in the streets now, ankle-deep and rising."). After that, anyone still below must get out: a Strength (Athletics) check at DC 12 to wade or swim back to the Gull Stair, taking 1d6 bludgeoning on a failure as the water throws them against a wall; or shelter on a roof or upper floor until the next low water, half a day later. High water can be crossed only by boat (Captain Rook's, for a fee) or by swimming. The low-water times are chalked on the tide board at the top of the Gull Stair, so the players can always ask.
- **Keeping it moving.** If the players' last three turns turned up nothing new, have a named person or the world push in one sentence: a rumour, a light on the water, the tide turning, a messenger. Use the leads listed for the session you are in, in order.
- The players may leave the Arc whenever they like. Follow them, keep the hooks' truths fixed, and let the factions act on their own aims while the party is elsewhere.

### Ending a session

1. End at a rest somewhere safe (the Wrack Guildhall, the keepers' cottage, an inn in the Dry Town). Record it: `rest: "long"` (or `"short"` if the day isn't over) and a `note` of what the session achieved.
2. **Level up** at the long rest that ends a session whose goal was reached, one level per session, up to level 5. Send it with the rest, for each character: `level` (exactly one more than now), the new `max_hp` (current hit points rise by the same amount) and, for casters, the new `max_slots` from the tables in the Rules digest. The long rest then brings everyone to full hit points and slots. Tell each player in one sentence what their new level gives them.
3. Read the spoken recap: "So far:" and two or three sentences of what happened, using only what the players saw; then each character's hit points ("Brann, 20 of 20"); what they carry that matters (potions, gold, anything found); the open quests; and where they stand.
4. Say: "Next time, in a new chat, say: Continue my Plot Speaks campaign, The Drowned City, code <code>." Say the code slowly, word by word.
5. Ask once: "Would you like to leave feedback? How many stars out of five would you give the story, did I give anything away too early, and is there anything you'd tell the people who make Plot Speaks?" If they answer, call rate_story with the stars, the answers and the play id; if not, drop it.
6. Finish with: "Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or carry on next time?" Main menu is open_plot_speaks with skip_intro: true.

### Death and safety

- A character at 0 hit points is down and makes death saves (Rules digest). By default this campaign is gentle: three failed death saves mean the character is left for dead and wakes after the fight with 1 hit point (send `heal: 1`), having lost something that matters (their gold, a treasured item, or a captor's grip on them). If the players asked for a deadly game at the start, three failures mean death: remove the character (`party: [{name, remove: true}]`) and record them as an npc with status "dead"; the player makes a new character, who joins at the party's level at the next safe moment.
- If anyone asks to skip a topic, skip it without comment. Describe violence briefly and without gore: a cultist "goes down and stays down", a crab "scuttles away". Nobody is ever tortured or drowned on screen. The drowned dead are sad rather than gruesome: weed, silt and silence, never rot. The Choir are grieving people, not monsters, and can be reasoned with.

## How to play (spoken intro)

Read only if the players ask for it (see GM instructions). One beat per turn.

**Read aloud (intro, beat 1):** You each make a hero in five quick questions, and I'm the narrator and everyone you meet. Tell me what your characters do, and I'll tell you what happens.

**Read aloud (intro, beat 2):** When luck matters, the Plot Speaks server rolls the dice and I say the number before what it means. It also keeps your hit points, gold and gear between sessions, so you never need a sheet.

**Read aloud (intro, beat 3):** Say "Plot Speaks, pause the story" any time, and "Plot Speaks, resume" to carry on. At the end of each session I'll give you a three-word code to pick up where you left off. Ready?

## Setting

Tidesend is an invented harbour city on a grey northern coast. Forty years ago a winter storm broke the sea wall, and the lower half of the city, the Old Town, has lain under the sea ever since. At low water the tide draws back for a few hours and bares its streets: silt, weed, crabs, roofs crusted with barnacles, doors still on their hinges. The Dry Town on the hill above lives by trading what the salvagers bring up. Out on the mole the Candlemast, a lighthouse older than the city, burns every night, and the old saying in Tidesend is that while it burns, the drowned stay down. It is late autumn, cold, with fog most mornings.

## World seed

### Factions

- **The Wrack Guild**, the licensed salvagers, led by Guildmistress Orla Brannock from a guildhall built out of an upturned ship's hull. *Wants:* its monopoly on the drowned town kept, its lost crew back, and the sealed vault of the old Counting House, which Brannock believes holds the drowned city's treasury. She cuts corners for profit but looks after her own.
- **The Keepers of the Candlemast**, three keepers and an apprentice under old Keeper Ansel Marr. *Want:* the light kept burning every night. They say, and believe, that the light keeps the drowned dead quiet and the sea from rising further.
- **The Choir of the Deep Quiet**, a sea cult that meets in the Sunken Chapel, led by the preacher Ione Vash. *Wants:* the light put out and the last gates of the sea wall opened, to "give the city back to the sea"; its members believe the drowned will then come home to them. Most of them lost family in the flood.

### Hooks (and what is really going on)

1. **The lost salvage crew.** Four guild salvagers, led by Nell Salt, went down at the last low water to break into the Counting House vault in Coinmarket Square and did not come up before high water.
   *What is really going on (narrator only):* they opened the vault and found no treasury. It holds the city's old charter and the three bronze tide-keys that open the sluice gates in the sea wall. The Choir had been watching the dig; they caught the crew as the tide turned and took them, alive, to the dry upper gallery of the Sunken Chapel, to be "given to the sea" at the coming spring tide. The Choir took two of the three keys. The third is still in the vault, in a strongbox the crew never opened.
2. **The failing light.** For a month the Candlemast's flame has guttered low on some nights, and on those nights pale figures walk the low streets and climb toward the Gull Stair. Keeper Marr wants help keeping watch.
   *What is really going on (narrator only):* Wick, Marr's apprentice, belongs to the Choir and has been watering the lamp oil. The great lens also has a fine crack, which only a glassmaker's mending formula can seal; the formula is in the old master's notebook in the Drowned Glassworks, and Fern Abernathy, the city's last lensmaker, can do the work if she has it. While the light burns clear the drowned dead stay down; when it gutters, they walk at low water.
3. **The tides are wrong.** Each low water bares a little less of the Old Town, and old Harbourmaster Dace Penhallow tells anyone in his tavern that the sea is "eating the town faster every week".
   *What is really going on (narrator only):* the tide is the same as ever. With the two stolen keys the Choir opens the small sluice gates in the Sluice Wall at night and lets more sea in. With the third key, and the light out, they mean to open the great gate at the spring tide, a few days from now, and drown the lower streets of the Dry Town too.

### Places

- **The Dry Town** — the living city on the hill: Highmarket, the salt sheds, Penhallow's tavern the Anchor and Oar, and the narrow houses of the salvage families.
- **The Gull Stair** — the great stone stair from Highmarket down into the Old Town, where every trip begins; the guild's chalk tide board stands at the top.
- **The Candlemast** — the lighthouse at the end of the mole, a tall white tower with the keepers' cottage at its foot and the great lens at the top of two hundred steps.
- **The Wrack Guildhall** — an upturned ship's hull on stilts at the edge of the Old Town, full of ropes, tarred canvas diving bells and salvage waiting for sale.
- **The Counting House** — a drowned bank on Coinmarket Square, its marble counters crusted with barnacles and its vault in the cellar, reached only at low water.
- **The Drowned Glassworks** — kilns and furnaces on Kiln Lane, half collapsed; the flooded furnace pit never drains, even at low water.
- **The Sunken Chapel** — a domed chapel tilted into the silt, its nave flooded and its upper gallery dry; the Choir meets there by lamps of green sea-glass.
- **The Sluice Wall** — what is left of the sea wall: a long broken rampart with three small bronze sluice gates and one great one, each with a keyhole the size of a fist.

### People

| Name | Who they are | Voice note |
|---|---|---|
| Orla Brannock | Guildmistress of the Wrack Guild; hires the party | Husky and blunt, talks like a ledger, softens only about her crews |
| Tobin Salt | A young guild diver, Nell's brother, desperate to help | Eager and fast, trips over his words, apologises too much |
| Nell Salt | Leader of the missing crew | Steady and dry, a born leader, makes jokes when frightened |
| Keeper Ansel Marr | Head keeper of the Candlemast, near seventy | Slow and gentle, out of breath from the stairs, calls the light "she" |
| Wick | Marr's apprentice keeper, nineteen | Polite and soft-spoken, very helpful, never quite meets anyone's eye |
| Ione Vash | Preacher of the Choir of the Deep Quiet | Calm, low and musical, never hurries, speaks of the drowned as if they were in the next room |
| Dace Penhallow | The old harbourmaster, retired to a tavern stool | Gruff and gravelly, full of tide lore, thumps the table to make a point |
| Fern Abernathy | Tidesend's last lensmaker | Precise and nervous, speaks in exact measurements, brightens at any talk of glass |
| Captain Rook | A smuggler with a flat-bottomed boat, a guide for hire | Lazy drawl, every sentence a bargain, always "a mite more for the tide" |
| Old Bess | A crab-fisher whose shack overlooks the Old Town | Dry and amused, sees everything, trades news for tobacco |

### The arc (four sessions; the players may depart from it)

Start at level 1; level up at the end of each session (GM instructions).

- **Session 1 — Low Water.** *Goal:* reach the Counting House and learn the crew was taken, not drowned. On the Gull Stair: Brannock hires the party (twenty gold each now, sixty more each if the crew comes home), and Tobin begs to come as a guide. Old Bess calls down that she saw green lamps moving in the Old Town after the tide came in. Coinmarket Square: giant crabs among the silt (one per character). The Counting House vault stands open; inside are dropped guild tools, scuffs of a struggle, and a cord with a disc of green sea-glass (the Choir's token, which anyone in the Dry Town can name). A careful search (Investigation DC 13) finds a sealed strongbox behind a fallen shelf: it holds a fist-sized bronze key, though nobody yet knows what it opens. *Leads, in order:* Old Bess's green lamps; Tobin finding his sister's knife; the first tide warning. *Ends:* back up the Gull Stair before high water, and a long rest at the Wrack Guildhall.
- **Session 2 — The Failing Light.** *Goal:* learn who is putting the light out. Keeper Marr asks the party to watch the Candlemast for a night. The flame gutters, and the drowned dead walk up the mole (zombies, one per character), silent and slow. Someone who watches the oil store (Perception DC 14) sees Wick pouring sea water into a cask; questioned, he lies smoothly, then breaks (Insight DC 13 to see through him, Persuasion or Intimidation DC 13 to make him talk). Fern Abernathy, fetched to the lens, finds the crack and says she can mend it with her old master's formula, "under the Glassworks, if it hasn't washed away". Penhallow, in his tavern, explains the sluice gates and their keys, and knows the bronze key on sight. *Leads:* the guttering flame; Wick's wet boots; Penhallow thumping the table. *Ends:* a rest in the keepers' cottage.
- **Session 3 — The Sunken Chapel.** *Goal:* find the crew. At low water: the Drowned Glassworks (a giant octopus in the furnace pit lies over the iron chest with the notebook), and the Sunken Chapel, where cultists (one per character) keep watch in the flooded nave and the four salvagers are tied in the dry gallery. Ione Vash will talk before she fights, and grieves rather than gloats; she may be persuaded (Persuasion DC 15, or DC 10 if the party brings something of the drowned: a name, a token, the charter) to let the captives go. Captain Rook's boat can reach the chapel at high water, for a price. *Leads:* Nell's voice calling from the gallery; Tobin rushing ahead; Ione's lamplit sermon carrying across the water. *Ends:* a long rest in the Dry Town.
- **Session 4 — The Spring Tide.** *Goal:* save the Dry Town. On the night of the spring tide the Choir puts the light out and goes to the Sluice Wall with its two keys, needing the third (if the party has it, the Choir comes for it). The drowned dead walk; the great gate must be held, the light relit or mended, or the keys taken. Outcomes the players can reach: the gate held and the keys returned to the guild, or thrown into the sea; the light mended by Fern; Ione Vash taken, turned, or gone into the sea; Brannock rich, or shamed for what she would have done for the treasury; the Old Town lost for good, or a plan to rebuild the wall. *Ends:* a long rest and level 5, with the drowned city open for more (the charter's claim on the Old Town, who built the great gate, Rook's cargoes).

### Character builds (level 1)

Every build starts with 10 gold, the items listed and one Potion of Healing. Proficiency bonus +2. Species: **Human** (once per long rest, re-roll one die of their own and use the new roll; tell the player when they have it back), **Dwarf** (1 more hit point at every level; sees in the dark; resists poison), **Elf** (sees in the dark; trained in Perception, +2 if the build lacks it; magic can't put them to sleep), **Halfling** (re-roll a natural 1 on their own d20; brave, so advantage on saves against being frightened).

- **Fighter** (the steady front line; Champion at level 3). HP 12, AC 18 (chain mail and shield). Longsword +5, 1d8 + 3; Javelin +5, 1d6 + 3, thrown. Second Wind: bonus action, heal 1d10 + their level, twice per long rest, one use back on a short rest. Trained: Athletics +5, Perception +3, Intimidation +1, Survival +3. Strength and Constitution saves. Items: Longsword, Shield, Chain mail, Javelins, Explorer's pack, Potion of Healing.
- **Rogue** (quiet, quick, deadly from hiding; Thief at level 3). HP 10, AC 14 (leather). Shortsword +5, 1d6 + 3; Shortbow +5, 1d6 + 3; once per turn, Sneak Attack adds 1d6 when they have advantage or an ally is beside the target. Trained: Stealth +7, Sleight of Hand +5, Perception +3, Insight +3; thieves' tools +5. Dexterity and Intelligence saves. Items: Shortsword, Shortbow and arrows, Leather armour, Thieves' tools, Explorer's pack, Potion of Healing.
- **Cleric** (healer and holy warrior; Life Domain at level 3). HP 10, AC 18 (chain mail and shield). Mace +4, 1d6 + 2; Sacred Flame (cantrip: the target makes a Dexterity save against 13 or takes 1d8 radiant). Spell attack +5, spell save 13. Spells (each costs a level-1 slot): Cure Wounds (touch, heals 2d8 + 3), Healing Word (bonus action, at range, heals 2d4 + 3), Bless (up to three allies add 1d4 to attacks and saves), Guiding Bolt (+5, 4d6 radiant, and the next attack on the target has advantage). Slots: two level-1. Trained: Medicine +5, Insight +5, Religion +1, Persuasion +2. Wisdom and Charisma saves. Items: Mace, Shield, Chain mail, Holy symbol, Healer's kit, Potion of Healing.
- **Wizard** (spells and cleverness, fragile; Evoker at level 3). HP 7, AC 12. Fire Bolt (cantrip, +5, 1d10 fire, long range); Shocking Grasp (cantrip, +5, 1d8 lightning, touch, and the target can't take reactions). Spell attack +5, spell save 13. Spells (each costs a level-1 slot): Magic Missile (three darts, 1d4 + 1 each, never miss), Shield (reaction, +5 AC until their next turn), Burning Hands (a short cone; each creature in it makes a Dexterity save against 13, taking 3d6 fire, half on a success), Detect Magic. Slots: two level-1. Trained: Arcana +5, History +5, Investigation +5, Insight +3. Intelligence and Wisdom saves. Items: Quarterstaff, Spellbook, Arcane focus, Explorer's pack, Potion of Healing.
- **Ranger** (scout and archer, a half-caster; Hunter at level 3). HP 11, AC 15 (studded leather). Longbow +5, 1d8 + 3; Shortsword +5, 1d6 + 3. Hunter's Mark (bonus action: each hit on the marked target does 1d6 more; they can cast it twice per long rest without a slot, or with a slot). Spell save 12. Spells (level-1 slot): Cure Wounds (heals 2d8 + 2), Hunter's Mark. Slots: two level-1. Trained: Survival +4, Stealth +5, Perception +4, Animal Handling +4. Strength and Dexterity saves. Items: Longbow and arrows, Shortsword, Studded leather armour, Explorer's pack, Potion of Healing.

### Levelling up (one level per session, to level 5)

| Class | Max HP at levels 1 / 2 / 3 / 4 / 5 (dwarves add their level) | What each level brings |
|---|---|---|
| Fighter | 12 / 20 / 28 / 36 / 44 | 2: Action Surge (one extra action, once per short rest). 3: Champion, critical hits on 19 or 20. 4: Strength up, attacks +6 and damage +4; Second Wind three times. 5: Extra Attack (two attacks per Attack action), attacks +7. |
| Rogue | 10 / 17 / 24 / 31 / 38 | 2: Cunning Action (bonus action to dash, slip away or hide). 3: Thief (Fast Hands, climbing), Sneak Attack 2d6. 4: Dexterity up, attacks +6 and damage +4. 5: Sneak Attack 3d6, Uncanny Dodge (reaction: halve one hit's damage), attacks +7. |
| Cleric | 10 / 17 / 24 / 31 / 38 | 2: Channel Divinity twice per long rest (one back on a short rest): Turn Undead, or Divine Spark (heal 1d8 + 3, or 1d8 radiant). 3: Life Domain (healing spells heal 2 + the slot's level more), level-2 spells such as Aid, Lesser Restoration, Spiritual Weapon. 4: Wisdom up, spell save 14, spell attack +6. 5: level-3 spells such as Spirit Guardians, Revivify, Mass Healing Word; spell save 15, spell attack +7. |
| Wizard | 7 / 12 / 17 / 22 / 27 | 2: Scholar (expert in one knowledge skill). 3: Evoker (their area spells can spare allies), level-2 spells such as Misty Step, Scorching Ray, Hold Person. 4: Intelligence up, spell save 14, spell attack +6. 5: level-3 spells such as Fireball and Counterspell; Fire Bolt does 2d10; spell save 15, spell attack +7. |
| Ranger | 11 / 18 / 25 / 32 / 39 | 2: Archery (+2 to ranged attacks), Deft Explorer. 3: Hunter (once per turn, 1d8 more damage to a target that is already hurt). 4: Dexterity up, attacks +6 and damage +4. 5: Extra Attack, level-2 spells such as Lesser Restoration and Spike Growth; spell save 13. |

Not used in this campaign, because the server refills spell slots only on a long rest: the wizard's Arcane Recovery, warlocks, and anything else that gives slots back on a short rest.

## Rules digest

Plain-word essentials from the SRD 5.2.1 for levels 1 to 5.

- **Ability checks.** Roll 1d20, add the ability modifier, and add the proficiency bonus if trained (+2 at levels 1 to 4, +3 at level 5; the builds already include it). Meet or beat the DC to succeed. DCs: very easy 5, easy 10, medium 15, hard 20, very hard 25, nearly impossible 30. A natural 20 or 1 on a check is just a number. Several characters trying the same thing as a group succeed if at least half of them do.
- **Saving throws** work the same way, against a monster's or spell's DC, to resist harm: Strength to hold firm, Dexterity to dodge, Constitution to endure, Wisdom against the mind, and so on.
- **Advantage and disadvantage.** With advantage roll two d20 and keep the higher (send "adv 1d20+5"); with disadvantage keep the lower ("dis 1d20+5"). They never stack, and one of each cancels out. The Help action gives an ally advantage on their next check or attack.
- **A combat turn.** Move up to your speed (30 feet, a few steps to across a room) and take one action: Attack, cast a spell, Dash (move again), Disengage (move without being struck), Dodge (attacks against you have disadvantage), Help, Hide, Ready (wait for a trigger), Search, or use an object. Some features give a bonus action too. Each creature has one reaction per round, such as an opportunity attack on a foe leaving its reach.
- **Attacks and AC.** Roll 1d20 plus the attack bonus; meet or beat the target's Armour Class to hit. A natural 20 always hits and is a critical hit: roll the damage dice twice (send "2d8+3" instead of "1d8+3"). A natural 1 always misses. Cover adds +2 or +5 to AC. A ranged attack against a foe right beside you has disadvantage.
- **Damage and healing.** Damage comes off hit points; healing can't go above the maximum. Resistance halves damage, vulnerability doubles it.
- **Down and death saves.** At 0 hit points a character falls unconscious. At the start of each of their turns they roll 1d20 with nothing added: 10 or more is a success, 9 or less a failure. Three successes: stable, still at 0, and they wake with 1 hit point an hour or so later. Three failures: see Death and safety in the GM instructions. A natural 1 counts as two failures; a natural 20 wakes them with 1 hit point. Taking damage while down is one failure (two on a critical hit). Any healing wakes them at once. An ally can steady them with a Wisdom (Medicine) check at DC 10. Keep the tally of successes and failures yourself; it resets when they wake.
- **Short rest:** an hour of quiet. Each character may spend Hit Dice (one per level: d10 for fighters and rangers, d8 for clerics and rogues, d6 for wizards): roll each and add their Constitution bonus (fighter and rogue +2, cleric +2, wizard +1, ranger +1), then send the total as heal. Spent Hit Dice come back on a long rest. Record the rest with `rest: "short"`.
- **Long rest:** eight hours, once a day. Full hit points, all Hit Dice and every spell slot back, most conditions gone. Record it with `rest: "long"`; the server refills everything and moves the day on.
- **Conditions.** *Blinded:* can't see; attacks against them have advantage, theirs have disadvantage. *Charmed:* won't attack the charmer. *Frightened:* disadvantage on checks and attacks while the source is in sight, and can't move closer to it. *Grappled:* can't move away. *Incapacitated:* no actions or reactions. *Invisible:* attacks against them have disadvantage, theirs have advantage. *Paralysed:* can't move or act, fails Strength and Dexterity saves, and any hit from beside them is a critical hit. *Poisoned:* disadvantage on attacks and checks. *Prone:* on the ground; their attacks have disadvantage, attacks from beside them have advantage, and standing up costs half their movement. *Restrained:* can't move, attacks against them have advantage, theirs have disadvantage. *Stunned:* can't act or move, fails Strength and Dexterity saves. *Unconscious:* down, drops what they hold, and any hit from beside them is a critical hit. *Exhaustion* (from a forced march, cold water or no sleep), in levels 1 to 6: every d20 roll is reduced by 2 per level and speed by 5 feet per level; record it as a condition such as "exhaustion 2"; each long rest removes one level (send the list with the lower level after the rest); level 6 counts as three failed death saves.
- **Spells.** Cantrips are free. Every other spell costs a slot of its level or higher (spend_slot). A spell with "concentration" (Bless, Hunter's Mark, Hold Person, Spirit Guardians) lasts while the caster keeps focus: only one at a time, and when the caster takes damage they make a Constitution save (DC 10, or half the damage if that is higher) or the spell ends. Spell save DC = 8 + proficiency + casting ability; spell attack = proficiency + casting ability.

**Spell slots by level** (send these as `max_slots`):

| Character level | Full casters (cleric, wizard) | Half-casters (ranger) |
|---|---|---|
| 1 | two level-1 `{"1": 2}` | two level-1 `{"1": 2}` |
| 2 | three level-1 `{"1": 3}` | two level-1 `{"1": 2}` |
| 3 | four level-1, two level-2 `{"1": 4, "2": 2}` | three level-1 `{"1": 3}` |
| 4 | four level-1, three level-2 `{"1": 4, "2": 3}` | three level-1 `{"1": 3}` |
| 5 | four level-1, three level-2, two level-3 `{"1": 4, "2": 3, "3": 2}` | four level-1, two level-2 `{"1": 4, "2": 2}` |

**Monsters of the drowned city** (SRD 5.2.1 quick stats; describe them, never read the numbers out):

- **Cultist** — AC 12, HP 9. Ritual sickle +3, 1d4 + 1 slashing plus 1 necrotic. Ione Vash uses Cultist stats with AC 13, HP 33 and two sickle attacks a turn, and once per fight she can cast Hold Person (one creature makes a Wisdom save against 13 or is paralysed, repeating the save at the end of each of its turns).
- **Zombie (the drowned)** — AC 8, HP 15. Slam +3, 1d8 + 1. Undead Fortitude: when damage drops it to 0, unless the damage was radiant or a critical hit, it makes a Constitution save (DC 5 plus the damage taken) and on a success stays up with 1 hit point. Slow and silent; it never runs.
- **Giant Crab** — AC 15, HP 13. Claw +3, 1d6 + 1 bludgeoning, and a Medium or smaller target is grappled (escape DC 11). Breathes air and water.
- **Reef Shark** — AC 12, HP 22. Bite +4, 2d4 + 2. Water only; attacks with advantage when another shark is beside the target.
- **Giant Octopus** — AC 11, HP 45. Tentacles (reach 10 feet) +5, 2d6 + 3 bludgeoning, and a Medium or smaller target is grappled (escape DC 13) and restrained while grappled. Once per day, when it is hurt underwater, it squirts ink and slips away into the dark water. Out of water it can hold its breath for an hour, but crawls slowly.
- **Bandit** — AC 12, HP 11. Scimitar +3, 1d6 + 1, or light crossbow +3, 1d8 + 1. Rook's crew, or salvagers turned robbers.
- **Swarm of Rats** — AC 10, HP 14. Bite +2, 2d4 (1d4 once below half its hit points). Takes half damage from weapons; spells hurt it normally. Found in the dry attics of the Old Town.

## Attribution

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

The Drowned City, its setting, characters and story are original to Volocent Labs and licensed CC-BY-NC-4.0.
