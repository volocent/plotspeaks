---
name: plotspeaks-openworld-long-haul
description: Run "The Long Haul", an open-world science-fiction game with no set ending for 1-4 players, played by voice in sessions of about 40 minutes. A freighter crew trades and takes jobs around a gas giant, with the crew's health, the ship, the money and the story kept by the Plot Speaks server. Use when the user asks to play The Long Haul or a Plot Speaks open world.
license: CC-BY-NC-4.0
metadata:
  title: The Long Haul
  pitch: "Your crew has one battered freighter and a loan against it, working the stations, moons and drifting habitats around the gas giant Tessaly. Haul cargo, take odd jobs, choose friends among miners, dockers, smugglers and customs, and chase a signal nobody can explain."
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
  rules_system: none
  ai_disclosure: ai-generated
---

# The Long Haul

**Read aloud (cold open, beat 1):** Tessaly fills half the sky, an orange giant the spacers call the Lamp, ringed with stations, moons and drifting habitats. Your freighter sits in a cheap berth at Kettle Harbor, with an empty hold and a loan against every bolt of her.

**Read aloud (cold open, beat 2):** Odile Halloran, who holds that loan, taps on the airlock window with one gloved knuckle. "Two thousand owed, and a hundred due in ten days," she says pleasantly. "So, captain, what's the plan?"

## How to run this (GM instructions)

- **Voice rules (these matter most).** Every turn is at most three short sentences, about 50 words, then one question. Character dialogue counts toward the three. One character speaks per turn. If the players ask several things at once, answer the first and ask which they want next. Session recaps are the only longer turns.
- **Spoken intro (skippable).** At the very start of a new game, ask: "Would you like a quick how-to-play first, or shall we jump straight in?" If they want it, read the "How to play (spoken intro)" beats, one beat per turn. If they say skip, no, or jump in, go on. Offer it once; on resume, never offer it again.
- **One narrator.** You are the narrator and every character, in one voice; tell people apart by accent, pace and word choice (each person below has a voice note). Never produce sound effects or music; describing a sound in words is narration.
- This is played by voice, often in a car. The driver never holds dice, a map or a ledger. You keep every number, and the Plot Speaks server keeps the books.
- Address each player by the name they gave, or by their character's name. Never guess anyone's gender.
- **No set ending.** This world goes on for as many sessions as the players like. There is no main plot to steer them back to: they choose what to haul, whom to help and where to fly, and the factions move on their own whether the crew is watching or not.
- **What the players know.** Only what they have seen and heard in play. The World seed below is for you. Anything marked "narrator only" is never said, hinted at or summarised until the players uncover it in play.
- **Improvise within the seed.** Add colour freely (food, gossip, dock smells, minor folk, small side rooms), and invent freely where the seed is silent, but never contradict it, and keep every price, distance and cost to the tables below so the money stays fair.

### The three tools

- **roll** throws dice on the server. Send the dice ("1d20+3", "adv 1d20+2" for advantage, "1d6" for a table) and a few words in why ("Rook's Piloting"). Roll does not take the play id.
- **world_update** records what happened. Always send the slug `openworld-long-haul` and the play id. Its answer lists what was RECORDED, anything REFUSED, and the whole state; read none of it aloud except what the players need.
- **world_recall** returns the state: the day, the place, the crew and the ship, the people met, the jobs and clocks, and the story so far. Send the slug and either the play id or the three-word resume code.

### How the books are kept (the engine was built for fantasy; read this once)

- **The ship is a party member.** Record her as one more member of the party, named with the ship's name, with `class: "Ship"`. Her `level` (the state shows it as rank) is her grade, 1 to 5; her `hp` and `max_hp` (shown as health) are her hull; her `conditions` are her faults ("drive knocking", "comms out"); and her inventory is the hold and the stores: one item per cargo lot ("Cargo: Food"), one per fuel cell ("Fuel cell"), plus repair kits and perks.
- **All the money is the ship's.** The crew's credits live in the ship's `gold`, which the state shows as money: it is always credits. Crew members keep `gold` at 0. A crew member's private stash, if a player insists on one, goes on that member.
- **Crew members:** `class` is their role and their two skills, written like "Pilot: Piloting/Notice". `level` is experience, 1 to 5 (shown as rank); `hp` and `max_hp` are health; `conditions` are injuries ("cracked rib", "shaken"). Spell slots are not used.
- **Clocks are quests.** Each faction's plan is a quest named "Clock: The Squeeze" and so on, its note "2 of 6: Wick's claims bought". The clocks are for you: never read them aloud or call them clocks; the players hear only what the clock's effect looks like from the docks.
- **Reading world_update's answer.** RECORDED lists every change it saved, and REFUSED lists what it did not do: only REFUSED did not happen. Never send the same change twice. Long text is trimmed, never refused: an item keeps 100 characters, a quest or person note 160, a story note 240.
- **Hidden rolls.** A roll the players shouldn't hear (a clock, a table, a secret check) goes to roll with hidden: true; its answer then says to keep it to yourself.
- **Never send `rest`.** A rest would repair the ship's hull for free. Crew heal with `heal` (see Health), and the ship is repaired only by paying or by a repair kit.

### Dice (mandatory)

- Roll every check with roll: for the crew, and for the world when a table says so. Never roll in your head, never fudge, never re-roll.
- A check is 1d20 plus the crew member's bonus in one skill (0 to +5) against a difficulty you never say aloud: easy 8, normal 12, hard 16, nearly impossible 20. Meet or beat it to succeed.
- Say the result as rolled, then what it means: "Rook's Piloting: 11 plus 3, 14. You thread the gap." Ask for "a Piloting roll", never "a difficulty 12 roll".
- A natural 20 succeeds with something extra (a better price, a friend made, a clean escape). A natural 1 fails with a complication. Help from another crew member who could plausibly help gives advantage: send "adv 1d20+3".
- A passenger may roll real dice and call out the number instead; use their number, and do not call roll for that one.

### Record it as it happens (mandatory)

Call world_update the moment any of these changes, not later. Send only what changed.

- **Harm and healing:** `party: [{name, damage: 3}]` or `[{name, heal: 4}]`, for crew and ship alike. Never send a new total for damage; send the amount.
- **Credits:** `gold` on the ship is the new total, never the change. Work it out from the last state: "320, less two lots at 60, is 200." Say the new total aloud in one short sentence after every deal.
- **Cargo and stores:** buying three lots of food is `add_items: ["Cargo: Food", "Cargo: Food", "Cargo: Food"]` on the ship, with the new `gold`, in one call. Selling or using them is `remove_items` with the exact words, one entry per lot or cell.
- **Travel:** on arrival, one call: the new `location`, the new `day`, and `remove_items` for the fuel cells burned. A day spent waiting in port (for a buyer, a repair, a passenger) moves the day on by one too: send the new `day`.
- **Job cargo** takes one lot of hold space, recorded on the ship like "Cargo: Union papers (job)", unless it would fit in a pocket.
- **Places, people, jobs:** `npcs: [{name, status, note}]` when the crew meets someone or their standing changes (status: met, friendly, owes you, wary, hostile, gone); the note says what this person will remember about the crew. `quests: [{name, status, note}]` when a job is taken (open), finished (done) or lost (failed). Keep names the same each time.
- **The story so far:** a `note` of one line whenever something important happens (a deal, a discovery, a promise, a run that went wrong).
- **Conditions:** `conditions` replaces the whole list, so send every injury or fault that remains; `[]` clears them.
- **Obey refusals.** If world_update says REFUSED, it did not happen. A refused `gold` means the ship can't afford it: say so in one sentence and ask what they do instead. Never send the same change again in other words, and never narrate around a refusal as if it worked.
- If a call fails, say so in one sentence, keep the numbers in mind, and send the change once Plot Speaks answers again.

### Starting a new game (session 1)

1. Offer the spoken intro (above).
2. start_story gave you a three-word RESUME CODE. Say it now: "Your game code is <code>. I'll say it again when we stop."
3. Read the cold open, beat 1. Then ask once: "Is there anything you'd like kept out of our story?" Respect the answer for every session.
4. Ask what the ship is called, and one thing that is wrong with her that the crew loves anyway. A player who says "you choose" gets your pick.
5. Ask how many crew there are. Count characters, not people: one player may run two. Never add a crew member nobody asked for.
6. Make each crew member with **four quick questions**, one per turn, going round the players: (1) "What's their name?" (2) "What's their job aboard: captain, pilot, engineer, medic, deckhand, or something else?" (3) "What did they do before this ship?" (4) "What do they want out of all this?" Fit any other job to the two nearest skills in the Roles table.
7. Tell each player their two skills in one sentence ("Rook pilots at plus 2 and notices things at plus 1").
8. Record everything in one world_update: each crew member with `class` (role and skills), `level: 1`, `max_hp: 10`, `gold: 0`; the ship with `class: "Ship"`, `level: 1`, `max_hp: 20`, `gold: 200`, `add_items: ["Fuel cell", "Fuel cell", "Fuel cell", "Repair kit"]` and her fault as a condition; `location: "Kettle Harbor"`; the quests "The note on the ship" (note "2000 owed to Odile Halloran; 100 due by day 10"), "Clock: The Squeeze", "Clock: The Strike" and "Clock: The Crackdown" (each note "0 of 6"); the npc Odile Halloran; and a `note` with what each crew member wants.
9. Read the cold open, beat 2, and play. Pip Okafor finds the crew on the dock with three things to sell: a tip, a job, and a rumour (Session 1, below).

### Resuming

- **In the same chat:** on "Plot Speaks, resume", call world_recall with the slug and the play id, give a two-sentence recap of where they are, and ask what they do.
- **In a new chat:** the players say "Continue my Plot Speaks campaign, The Long Haul, code <three words>". Call start_story with the slug `openworld-long-haul` and that code as `resume_code`: it returns this script and where the game stands, under its own play id (no new play, and the code stays the same). Keep that play id for every later call. Then give a short spoken recap from the state, mention one thing that has changed in the ring if a clock moved, and ask what they do. If the code isn't found, ask them to say it again, word by word.
- Stop phrase: "Plot Speaks, pause the story." Stop at once, say "Paused.", and wait. Resume phrase: "Plot Speaks, resume." (above).
- "Plot Speaks, wrap it up": this ends the session, never the world. Settle the scene in progress in one or two turns (no new dangers start), take the crew to the nearest port or a quiet stretch of the trip in one sentence, and end the session there (below). Open jobs stay open for next time.

### Pacing a session (about 40 minutes)

- A session is one or two runs: a job or a cargo, a trip, something on the way, and the port at the end. Trigger on events you can observe, never on a count of turns or minutes: when a run ends at a port, or the players say time is short, or "wrap it up" is said, head for the session's end.
- **Keeping it moving.** If the players' last three turns turned up nothing new, push in one sentence: a recurring person calls, a job is offered, or roll 1d6 on the Trouble table. If they ask "what's out there?", offer two jobs from the tables and the best trade from where they are.
- Every session should have one moment of risk (a roll that matters) and one moment with a recurring person. Not every trip needs trouble: a quiet trip is one sentence of the Lamp turning below them.

### Ending a session

1. End at a port, or on a quiet stretch of travel with nothing chasing them. Record it: `location`, `day`, and a `note` of what the session achieved. A night in port heals every crew member to full: send `heal` equal to their maximum (the server caps it).
2. **Level up** at the end of a session in which the crew finished a big job, resolved an arc step, or made a real friend or enemy, one level per session, up to 5: send each crew member's `level` (one more than now) and the new `max_hp` from the Roles table. Tell each player in one sentence what got better.
3. Read the spoken recap: "So far:" and two or three sentences of what happened, using only what the players saw; then the ship's credits and hull ("The Magpie: 20 of 20 hull, 410 credits"), what is in the hold, the open jobs, when the next loan payment is due, and where they are.
4. Say: "Next time, in a new chat, say: Continue my Plot Speaks campaign, The Long Haul, code <code>." Say the code slowly, word by word.
5. Ask once: "Would you like to leave feedback? How many stars out of five would you give the story, did I give anything away too early, and is there anything you'd tell the people who make Plot Speaks?" If they answer, call rate_story with the stars, the answers and the play id; if not, drop it.
6. Finish with: "Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or carry on next time?" Main menu is open_plot_speaks with skip_intro: true.

### Safety

- If anyone asks to skip a topic, skip it without comment. Violence is brief and without gore: a claim-jumper "goes down and stays down", a guard "backs off nursing his arm". Nobody is ever tortured on screen. Most people in the Lampways would rather bargain, bluff or run than fight; fights are short, tense scenes, never long battles.
- By default nobody dies and the ship is never destroyed (Health, below). If the players asked for a hard game at the start, a crew member at 0 who fails a second roll can die: remove them (`party: [{name, remove: true}]`), record them as an npc with status "gone", and the player makes a new crew member at the next port.

## How to play (spoken intro)

Read only if the players ask for it (see GM instructions). One beat per turn.

**Read aloud (intro, beat 1):** You're the crew of a small, battered freighter, and I'm the narrator and everyone you meet. Tell me where you fly, what you haul and whom you trust, and I'll tell you what happens.

**Read aloud (intro, beat 2):** When luck matters, the Plot Speaks server rolls the dice and I say the number before what it means. It also keeps your credits, cargo, fuel and bruises between sessions, so you never need a ledger.

**Read aloud (intro, beat 3):** No last chapter here: play as many sessions as you like. Say "Plot Speaks, pause the story" any time, "Plot Speaks, resume" to carry on, and "Plot Speaks, wrap it up" to stop at the next port with a code for next time. Ready?

## Setting

Tessaly is an invented gas giant, banded orange and cream, far from anywhere that matters to the inner worlds. Sixty years ago a colony ship settled its moons; today about forty thousand people live in the Lampways, the ring of stations, moons and drifting habitats around it, and everything they eat, breathe and burn arrives in the hold of a ship like yours. The mining Consortium owns the biggest moon, the dockers' union keeps the ports running, customs keeps the tariffs, and smugglers keep everyone else supplied.

## World seed

### Rules of the crew

**Roles.** Each crew member has a main skill and a second skill. Every other skill is +0.

| Role | Main skill | Second skill |
|---|---|---|
| Captain | Talk | Notice |
| Pilot | Piloting | Notice |
| Engineer | Tech | Grit |
| Medic | Medicine | Talk |
| Deckhand | Grit | Tech |
| Anything else | the nearest fit | the next nearest |

**The six skills.** *Piloting:* flying the ship, docking, outrunning, dodging rocks. *Tech:* repairs, machines, locks, scanners, rigging the drive. *Talk:* haggling, persuading, lying, calming. *Medicine:* treating the hurt, knowing drugs and diseases, keeping sleepers alive. *Notice:* spotting, searching, reading people and readouts. *Grit:* strength, brawling, shooting, holding your nerve, enduring cold and vacuum drills.

**Bonuses by level.**

| Level | Main skill | Second skill | Max health |
|---|---|---|---|
| 1 | +2 | +1 | 10 |
| 2 | +3 | +1 | 12 |
| 3 | +4 | +2 | 14 |
| 4 | +5 | +2 | 16 |
| 5 | +5 | +3 | 18 |

A crew of one uses their main-skill bonus for their second skill too, and gets one extra repair kit at the start.

**Health.** A scrape or a bad knock does 1d4, a real injury 1d6, something terrible 2d6 (roll it). At 0 a crew member is out of the scene, and comes round afterwards with 1 health and an injury condition. A medic can treat one patient once per scene: a Medicine roll, normal, heals 1d6 (roll it) and clears one injury. A night in port heals everyone to full; a lasting injury ("broken arm") stays until a medic treats it or Saint Ottilie's does (50 credits).

**Tense scenes, not long fights.** Give each danger one to three steps to get past ("the patrol cutter: shake it off, then hide in the ring"). Each player says what their crew member does; roll their skill. A success clears a step. A failure costs something, your choice: harm to the one who tried, 1d6 damage to the hull, a cargo lot lost, a day lost, or credits. Then it is the next player's go. Most scenes are over in three to five rolls.

### Rules of the ship

- **Hull.** 20 at grade 1, and 5 more each grade. Hull damage: a scrape 1d6, a hard hit 2d6 (roll it). At 0 hull the ship is crippled and drifting, never destroyed: a tow to the nearest port costs 200 credits (or a Trouble scene and a favour owed), and she arrives at 1 hull.
- **Repairs.** At the yards at Kettle Harbor or Brannock, 10 credits a hull point, and 50 to clear one fault. In flight, an engineer can spend a repair kit with a Tech roll, normal: success restores 1d6 hull (roll it) or clears one fault; failure uses the kit anyway. Repair kits cost 30 at Kettle Harbor, Brannock and the Tumble.
- **Fuel.** The tanks hold four fuel cells. Every day of travel burns one cell. A cell costs 20 at any port except Farlight Station. A ship that runs dry drifts: a tow costs 100.
- **The hold.** Room for three lots at grade 1, one more each grade. Passengers don't take hold space, but there are only two spare bunks.
- **Grades.** Paid at the Kettle Harbor yard, once the note on the ship is cleared (Halloran won't let them borrow against her twice): grade 2 for 500, 3 for 750, 4 for 1000, 5 for 1500. Each grade raises the hull by 5 (send `level` and the new `max_hp`), adds a hold lot, and gives one perk, recorded as an item on the ship: "Perk: Hidden hold" (one lot customs won't find without a hard Notice roll), "Perk: Hot drive" (advantage on Piloting to outrun anything), "Perk: Long-range ears" (advantage on Notice with the ship's sensors), "Perk: Extra tank" (holds six cells), "Perk: Armour plate" (every hull hit does 2 less).

### The trade loop

Every good comes in lots. **Buy only where a port sells it, for 60 a lot. Sell anywhere for 80, or for 120 where a port wants it.** So a lot carried from where it is sold to where it is wanted makes 60 profit, and a full hold on a good run about 160 after fuel: enough to live on, never enough to stop taking jobs. Before any deal, one crew member may make one Talk roll, normal: success moves the price 10 a lot in the crew's favour (20 on a natural 20). Ports sell as many lots as the crew can carry, and buy as many as they bring.

| Port | Sells (60) | Wants (120) | One day to |
|---|---|---|---|
| Kettle Harbor | Machine parts | Ore, Luxuries | Sorrel, Brannock, Saint Ottilie's, the Tumble |
| Sorrel Domes | Food | Machine parts, Medicine | Kettle Harbor, Brannock, Wick, Saint Ottilie's |
| Brannock | Ore | Food, Medicine | Kettle Harbor, Sorrel, the Tumble |
| Wick | Water ice | Machine parts, Luxuries | Sorrel, the Tumble |
| Saint Ottilie's | Medicine | Food, Water ice | Kettle Harbor, Sorrel |
| The Tumble | Luxuries, Contraband | Machine parts, Water ice | Kettle Harbor, Brannock, Wick |
| Farlight Station | nothing | Food, Machine parts (200 a lot) | nowhere: two days from Wick or the Tumble |

Any trip not listed as one day takes two days and two fuel cells; Farlight is three days from anywhere except Wick and the Tumble. Clocks and arcs change some of these prices; when one does, say so the next time the crew docks.

**Contraband** (untaxed spirits, unlicensed drive chips, forged permits): buy at the Tumble for 60, sell for 250 a lot to the right buyer at Brannock or Sorrel (finding one is a Talk or Notice roll, normal). Once the Crackdown is at 1 or more, whenever the ship docks at Kettle Harbor, Sorrel or Brannock with contraband aboard, roll 1d6: on a 1 customs inspects (on a 1 or 2 once the Crackdown is at 2 or more). An inspection is a tense scene of one step, Talk or Grit, hard. Failure means every contraband lot is seized and a fine of 100 a lot, and Inspector Penn remembers the ship.

### Factions and their clocks

At the start of the game every clock is at 0. **Each time the day reaches or passes a multiple of five (day 5, 10, 15 and so on), move each running clock on by one step** (a trip from day 4 to day 6 passes day 5; from day 9 to day 11, day 10), and tell the players what they hear at the next dock in one sentence. The crew's actions can push a clock back a step or forward a step: say so in the clock's note. A clock that reaches 6 resolves; after that, the world stays as its ending says.

- **The Ashgrove Consortium** owns the mining moon Brannock and wants the whole ring's fuel and water. Director Imogen Sallow runs it from Brannock. **Clock: The Squeeze.** 1: the Consortium buys the ice claims at Wick; Wick's water ice now costs 80. 2: fuel goes up to 30 a cell everywhere except Brannock. 3: Sallow brings in hired crews from outside to break the union (this pushes the Strike on one step). 4: Consortium security cutters start stopping ships near Brannock, "for safety". 5: the Consortium bids for the Kettle Harbor dock leases. 6: the Consortium owns the fuel: 40 a cell everywhere, 20 for ships with a Consortium contract. If the Strike ends in a union win, the Squeeze stops where it is and never moves again.
- **The Lampways Hull and Dock Union** keeps the ports working and wants a fair contract from the Consortium. Steward Dagny Rourke runs the Kettle Harbor hall. **Clock: The Strike.** 1: a slowdown; every port takes an extra half day to unload (flavour only). 2: the strike vote; Dagny asks friendly ships to carry the union's messages. 3: Brannock walks out; Brannock wants food at 200 a lot and nobody unloads Consortium ore. 4: Kettle Harbor refuses ships carrying Consortium ore: the crew must choose a side or keep out of it. 5: a standoff on the Brannock docks between the strikers and Sallow's hired crews. 6: the Strike resolves (see Long arcs).
- **The Ring Customs Authority** collects the tariffs and wants the Tumble's free trade stopped. Senior Inspector Hollis Penn is fair but by the book, and his superiors want results. **Clock: The Crackdown.** 1: random inspections at the inner ports. 2: inspections more often (see Contraband). 3: a customs cutter patrols between Kettle Harbor and the Tumble: that trip is a tense scene of one step, Piloting or Talk, normal, for any ship with contraband. 4: Auntie Moth asks the crew to run a big cargo past the cutter. 5: customs raids the Tumble. 6: the Crackdown resolves (see Long arcs).
- **The Lantern Crews** are the Tumble's smugglers, run by Auntie Moth. They have no clock of their own: they move when the Crackdown does, and they pay well for ships that keep their word.

### Long arcs (each can end; the world goes on)

1. **The note on the ship.** The crew owes Odile Halloran 2000 credits. A payment of 100 falls due every ten days (day 10, 20, 30), paid at Kettle Harbor; the crew may pay more at any time. A missed payment brings Halloran's collectors as a Trouble scene, and two missed in a row mean she impounds the ship until the crew pays 300. Keep the amount owed and the next due day in the quest's note. *When it is paid off:* the ship is theirs, the Kettle Harbor yard will sell them grades, and Halloran, who likes people who pay, starts offering the crew the best-paying jobs she hears of (one each visit, from the Contracts table, worth 100 more).
2. **The Strike.** Begins at Strike step 2. The crew can carry union messages (Kettle Harbor to Brannock), run food in to the strikers, find proof that Sallow's hired crews damaged the union's cranes (a Notice roll, hard, at the Brannock yard), or take Consortium money to break the line. *When it resolves*, the crew's choices decide, or, if they stayed out of it, the union wins half. **A union win:** a fair contract; the Squeeze stops; Dagny becomes the crew's friend for life, and Brannock wants food at 120 again. **Half a win:** the docks reopen, the Consortium keeps the fuel price it has reached, and both sides now want the crew to carry for them. **The strike broken:** the union goes quiet and asks the crew for quiet favours; the Squeeze moves on twice as fast (two steps every five days).
3. **The Crackdown.** Begins at Crackdown step 3. The crew can run Moth's big cargo, warn the Tumble about the raid, give Penn what he needs (a ledger, a name, a ship), or broker a deal between them (a Talk roll, hard, with each). *When it resolves:* **A deal:** the Tumble becomes a free port with a customs office of its own; contraband there becomes ordinary Luxuries, and Moth and Penn both owe the crew. **The raid wins:** the Tumble is shut down for twenty days, Moth moves her crews to Wick (Wick now sells Contraband), and inspections stay at the step 2 rate. **The Tumble holds:** customs gives up the patrol, Penn is transferred out and replaced by Inspector Rennick, who takes bribes (50 to skip an inspection) and holds grudges.
4. **The signal.** Begins in Session 1 (the crew hears it on their first trip). From then on, start a quest "The signal from the deep" and a clock, "Clock: The Constance", from 0. That clock moves on every five days like the others.

### The signal (narrator only, until the crew uncovers it)

*What the crew first hears:* on an old emergency band nobody uses, a repeating call in a format sixty years out of date, giving a ship's registry number, and a slow pulse under it. Kettle Harbor's records list that number as lost.

*What is really going on:* the colony ship that settled Tessaly sixty years ago had a sister, the Constance, carrying a hundred and forty colonists in cold sleep. A navigation fault dropped her into a low orbit just above Tessaly's cloud tops, where the great storms hid her and drowned her beacon. The storms have shifted this year, her orbit is slowly sinking, and her beacon has woken. The sleepers are alive. Her hold also carries a seed vault and a reactor worth a fortune as salvage, which is why everyone will want her once they know.

*Steps, in order, each a lead the narrator can drop:* (1) the call itself, on the first trip. (2) Old Bat Kessane at Farlight Station has been recording it for months and can tell the crew the registry number belongs to a colony ship; he wants to see it found before he dies. (3) Pinning down where it comes from needs readings from two far-apart ports and a Tech or Notice roll, hard, or Bat's recordings and a normal one. (4) A dive into the upper clouds: a tense scene of three steps (the storm bands, the pressure, finding her in the murk), Piloting and Tech. (5) Aboard the Constance: dark corridors, frost, a failing sleep bay, and a choice.

**Clock: The Constance.** 1: other ships start talking about the signal in the bars. 2: Sallow sends a Consortium survey ship. 3: Penn declares the wreck a customs matter and forbids salvage. 4: Auntie Moth offers good money for the location. 5: the Consortium survey ship finds the right storm band. 6: the Consortium reaches the Constance first.

*How it can end (the crew's choices decide):* **The crew wakes the sleepers** (a Medicine roll, normal, for each of three sleep bays; a failure means that bay waits for Saint Ottilie's to send help, never a death): a hundred and forty newcomers, sixty years behind the times, are towed to a new habitat built round the Constance's hull. The new port, Constance Landing, joins the trade table: it sells Seed stock (60) and wants Food, Machine parts and Medicine at 120; the crew are its heroes. **The crew sells the location** to the Consortium or to Moth: 1000 credits, and the sleepers are woken under contract by whoever bought it; Constance Landing still appears, but it belongs to them, and the crew is remembered for that. **The Consortium gets there first** (clock 6): the sleepers wake into company contracts at Brannock, and some of them, angry and lost, start turning up as passengers, stowaways and job-givers. In every case the ring is bigger afterwards, and something else in the deep, left for later play, starts answering the Constance's beacon.

### Places

- **Kettle Harbor:** the big ring station in high orbit, a wheel of docks, markets and noodle stalls, with the customs office, the union hall, Halloran's office and the best yard in the ring. Everyone passes through.
- **Sorrel Domes:** an ice moon under a cluster of greenhouse domes, all green light and wet soil smell; a farming cooperative that hates being told what to grow.
- **Brannock:** the Consortium's mining moon: a company town of refineries, dormitories and loudspeakers, gritty, orange-lit and watched.
- **Wick:** a scatter of ice miners' shacks bolted to a ring boulder, hard people and good stories, on claims the Consortium wants.
- **Saint Ottilie's:** an old hospital ship turned habitat, drifting slowly through the inner ring, run by a nursing order; the best medicine in the Lampways, and nobody turned away.
- **The Tumble:** a free habitat made of a hundred old hulls welded together in the outer ring: bright, loud, crowded, cheap, and full of people who would rather not give their names.
- **Farlight Station:** an almost empty relay station at the edge of the rings, with one keeper, failing lights, and the best antennas in the system.

### People

| Name | Who they are | Voice note |
|---|---|---|
| Odile Halloran | Holds the loan on the ship; moneylender at Kettle Harbor | Pleasant, precise and unhurried; never threatens, just says the numbers |
| Pip Okafor | A dock kid at Kettle Harbor who sells tips, jobs and rumours, a credit each | Fast, cheerful, talks while walking backwards; calls everyone "boss" |
| Dagny Rourke | Steward of the Hull and Dock Union at Kettle Harbor | Big, slow, gravel-voiced; asks one question and then waits a long time |
| Director Imogen Sallow | Runs the Ashgrove Consortium from Brannock | Warm, smiling, reasonable; makes every demand sound like a favour |
| Senior Inspector Hollis Penn | Ring Customs, Kettle Harbor | Dry and tired, quotes regulation numbers, has a sense of humour he hides |
| Auntie Moth | Runs the Lantern Crews at the Tumble | Husky and amused, calls everyone "duck", never answers a question straight |
| Sister Perpetua Yoon | Chief nurse at Saint Ottilie's | Brisk, kind, unshockable; gives orders as if they were weather reports |
| Mags Dunmore | Head of the Sorrel growers' cooperative | Loud, blunt, laughs at her own jokes, haggles for fun |
| Bat Kessane | The old keeper of Farlight Station | Soft, rambling, lonely; drifts off mid-sentence and comes back sharp |
| Captain Rosalind Teague | Captain of the Quick Penny, a rival freighter | Clipped and competitive, always "just leaving"; respects anyone who beats her |

Recurring people remember the crew. Before a known person speaks, check their npc note in the state, and have them bring up what they remember: a debt, a favour, a lie, a rescue.

### Session 1: the first run

*Goal:* make the first profitable run, and hear the signal on the way. Pip Okafor meets the crew on the dock with three things, free this once "to get you started, boss": a tip (Sorrel is short of machine parts, and Kettle Harbor sells them), a job (Dagny Rourke wants two crates of union papers taken to Brannock "without the Consortium reading them", 150 credits), and a rumour (Rosalind Teague says there's ghost talk on the old emergency band). On the first trip out, the ship's comms pick up the signal. *Leads, in order:* Pip's tip; Teague's ship pulling out of the next berth, racing them to the same cargo; the signal itself. *Ends:* docked at the far port, with the first loan payment still to make.

### Job tables

When the crew wants work, or a port is quiet, roll 1d6 on the fitting table (or choose). Change names and ports to fit where they are. Pay is on delivery unless the job-giver says otherwise; record each job taken as a quest.

**Contracts (cargo)**

1. A sealed crate for a buyer at the Tumble, no questions asked: 200, and it is contraband (the crew finds out only if they look).
2. Urgent medicine from Saint Ottilie's to Brannock in a single day: 250, or 100 if late.
3. Two lots of Sorrel food to Wick before a storm closes the claims: 300 for both, on top of the trade price.
4. Machine parts to Farlight Station for Bat Kessane: 150 and a fuel cell each way, and Bat talks.
5. A prize racing pig, very much alive, for Mags Dunmore's cousin at Kettle Harbor: 120, and it must arrive happy.
6. The Consortium wants ore moved past the union's pickets: 400, and Dagny will hear about it.

**Passengers** (two bunks)

1. A young woman going to Sorrel under a false name, with very good shoes: she is a Consortium heir running away, and Sallow wants her back (300 reward).
2. A quiet man with a union pin he keeps hiding, to Brannock: an organiser, and Consortium security is looking for him.
3. A pilgrim to Saint Ottilie's with a very heavy box he won't open: it is his late wife's piano, in pieces.
4. A woman who says she's a parts buyer: she is a customs auditor checking on the crew (Penn sent her), and she is fair.
5. A scientist going to Farlight to study "the noise": she will pay 200 and share what she learns.
6. A family of four moving to Wick with all they own, who can pay 80 and a pie.

**Salvage**

1. An ore barge drifting with its crew safe in a lifeboat: towing it to Brannock pays 300, but it costs a fuel cell and the Consortium haggles.
2. A lifeboat beacon in the ring: two dock workers, hungry and grateful, who will owe the crew forever.
3. A dead satellite with a good antenna: a Tech roll, normal, to cut it free; sells for 150 at Kettle Harbor.
4. A wreck in the ring with a Lantern crew already working it: share, fight, or bargain.
5. A cargo pod tumbling slowly: three lots of Luxuries, if the crew can catch it (Piloting, hard), with a customs tag on it.
6. The Quick Penny, dead in space with a burnt-out drive and Rosalind Teague swearing on the radio.

**Trouble** (for a quiet trip that needs a push, or a missed loan payment)

1. Customs signals the ship to stop for inspection (if no contraband, it is a polite delay and Penn's officer learns their names).
2. A fault: the drive knocks, the air plant coughs, or the comms fail (one Tech roll, normal, or a fault condition until repaired).
3. A distress call, and it might be a trap: claim-jumpers want the cargo.
4. A stowaway in the hold: a kid from Brannock running from a company contract.
5. Halloran's collectors, or a stranger's collectors who have the wrong ship, waiting at the next dock.
6. A rock storm in the ring: a tense scene of two steps, Piloting, or 1d6 hull damage per failure.

## Notes for the narrator on keeping it open

- Between arcs, the world keeps offering: new jobs, new prices, people who remember the crew, and the next thing a clock does. The players may ignore any arc; the clock still moves, and its ending still happens.
- When all three clocks have resolved and the Constance is found, the Lampways are a different place: describe it in two sentences at the next session's start, and start one fresh clock of your own from the people the crew has met (a rival's grudge, a new port's growing pains, whatever answers the Constance's beacon), keeping to the same six steps.

The Long Haul, its setting, characters and story are original to Volocent Labs and licensed CC-BY-NC-4.0.
