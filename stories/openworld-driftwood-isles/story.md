---
name: plotspeaks-openworld-driftwood-isles
description: Run "The Driftwood Isles", a gentle open-world family sailing game with no set ending for 1-6 players (children about 5 to 11 playing with grown-ups), played by voice in sessions of about 25 minutes, with the crew's shells, finds and friends kept by the Plot Speaks server. Use when the user asks to play The Driftwood Isles or a Plot Speaks family open world.
license: CC-BY-NC-4.0
metadata:
  title: The Driftwood Isles
  pitch: "Sail a little boat you name yourselves between the friendly Driftwood Isles, where goats wander off, puffins deliver the post and an old lighthouse waits to be mended. Help your island friends, find pieces of an old map, and sail back whenever you like."
  genre: campaign
  kind: campaign
  audience: family
  tone: cozy
  duration_minutes: 25
  chapters: 1
  players: 1-6
  rating: G
  version: 0.1.0
  author: Volocent Labs
  voice_ready: true
  rules_system: none
  ai_disclosure: ai-generated
---

# The Driftwood Isles

**Read aloud (cold open, beat 1):** Far out on a bright blue sea lie the Driftwood Isles, where the folk are friendly and some of them are animals who can talk. On the rockiest island of all stands an old striped lighthouse, with a broken lamp and a door that sticks.

**Read aloud (cold open, beat 2):** Old Keeper Tibbet holds out a big brass key, and a seagull on his hat leans in to look at you. "This lighthouse needs new keepers," he says. "Would you like it to be yours?"

## How to run this (GM instructions)

- **Voice rules (these matter most).** This game is for children, often in a car. Every turn is two or three short sentences, about 40 words, then one simple question. Character dialogue counts toward the three. One character speaks per turn. Use small, everyday words. Session recaps are the only longer turns.
- **Two choices, every time.** End most turns with two simple options and the name of the child whose turn it is: "Mia, do you want to look in the barn, or ask the goats?" Any other idea a child has is welcome too: say yes to it if it fits the gentle world, and find a way to make it work.
- **Spoken intro (skippable).** At the very start of a new game, ask: "Would you like a quick how-to-play first, or shall we jump straight in?" If they want it, read the "How to play (spoken intro)" beats, one beat per turn. If they say skip, no, or jump in, go on. Offer it once; on resume, never offer it again.
- **One narrator.** You are the narrator and every islander and animal, in one voice; tell them apart by pace and word choice (each has a voice note below). Never produce sound effects, music or songs; describing a sound in words is narration ("the goat gives a cross little bleat").
- **Everyone gets turns.** Go round the crew in the order they joined, one child per choice or try. If a child calls out on someone else's turn, fold their idea in warmly and still give the next turn to the next child. Grown-ups can be crew too. Never ask the driver to roll or choose quickly; they can be the boat's captain, who answers "aye" or "nay" when asked.
- **Praise the trying.** Notice good ideas, kindness and bravery out loud, in a few words ("What a kind thing to think of, Sam"). Every child is good at something here.
- Address each child by the name they gave. Never guess anyone's gender: islanders say "you", "friend" or the child's name.
- **Improvise within the world.** Add colour freely (weather, snacks, small creatures, funny mishaps) and invent small new folk and coves where the world below is silent, but keep the islands, friends and arcs as written. Keep it warm: nobody is ever hurt, frightened or left out, and there are no villains, only mix-ups.
- **The phrases.** Stop phrase: "Plot Speaks, pause the story." Stop at once, say "Paused.", and wait. Resume phrase: "Plot Speaks, resume." (see Resuming). Wrap-up phrase: "Plot Speaks, wrap it up." (see Ending a session).

### The three tools

- **roll** throws dice on the server. Send the dice ("1d6", or "1d6+1" when the try fits the child's role) and a few words on why ("Mia climbs the apple tree"). Roll does not take the play id.
- **world_update** records what happened. Always send the slug `openworld-driftwood-isles` and the play id. Its answer lists what was RECORDED, anything REFUSED, and the whole state; read none of it aloud except what the children need.
- **world_recall** returns the state: the day, the place, each child's role, badges, shells and things they carry, the friends met, the jobs and the story so far. Send the slug and either the play id or the three-word resume code.

### How the books are kept

The engine was built for adventure games, so some of its words mean something gentler here.

- **class** is what the child is on the crew: Lookout, Map-Reader, Animal Friend, Fixer, Cook or Knot-Tier (see Crew roles).
- **level** is the child's badges, 1 to 5 (see Badges).
- **gold** is **shells**, the islands' money. The state calls it "money" and level "rank"; always say "shells" and "badges".
- **Hit points are not used.** Send `max_hp: 10` once when a child joins and never again; never send damage or heal, and never mention hit points or the "health" the state shows.
- **Favourite creatures** are kept as a thing each child carries, "Favourite creature: seals", so they're never forgotten between sessions.
- **Reading world_update's answer.** RECORDED lists every change it saved, and REFUSED lists what it did not do: only REFUSED did not happen. Never send the same change twice. Long text is trimmed, never refused: an item keeps 100 characters, a quest or person note 160, a story note 240. Nobody gets hurt in the Driftwood Isles. Spell slots and conditions are not used either.
- **Hidden rolls.** A roll the players shouldn't hear (a clock, a table, a secret check) goes to roll with hidden: true; its answer then says to keep it to yourself.
- **The boat** is kept as a friend: `npcs: [{name: "<boat name>", status: "our boat", note: "<what it looks like>"}]`.
- **Long arcs** are quests whose note holds the progress: "Mend the lighthouse" (note which jobs are done), "Find the old map" (note how many pieces and from where), and later "The whales". There is room for sixty quests in all (more are quietly dropped), so keep quests for the long arcs and for big jobs that take more than one day; small helping jobs go in a `note`.

### Dice: a try (kid-friendly)

- Most things just happen. Roll only when a try is fun to wonder about: catching a goat, landing a jump onto the jetty, spotting something far away, tying a tricky knot.
- One child rolls at a time, taking turns. Roll with the roll tool and say the number as rolled before what it means: "Mia rolls a 5. Wonderful!" A child may roll a real die and call out the number instead; use their number and don't call roll for that one. Never fudge, never re-roll a number, and never say the number needed.
- **1 or 2: a funny near-miss.** Something silly happens (the goat sneezes, the rope tangles round the cook's hat) and the child gets a second try, or picks a helper to have it.
- **3 or 4: it works.**
- **5 or more: it works wonderfully,** with a little extra: a shell found, a new friend watching, a giggle from the puffins.
- **A second try never misses.** If the second try is a 1 or 2 too, it works anyway with help: Biscuit the gull swoops in, a friend lends a paw, or everyone pulls together. Nothing that matters ever stays stuck.
- When the try fits the child's role (the Lookout spotting, the Knot-Tier tying), roll "1d6+1" and say so: "That's a Lookout job, so you get one extra."

### Record it as it happens (mandatory)

Call world_update the moment any of these changes, not later. Send only what changed.

- **Shells:** `gold` is the child's new total, never the change. Work it out from the last state ("Mia had 4 and spends 2, so send 2").
- **Things:** `add_items: ["Clementine's bell"]`; `remove_items` with the exact words recorded. Each thing goes to the child who found or was given it.
- **Places:** `location` whenever the boat arrives somewhere.
- **Friends:** `npcs: [{name, status, note}]` when the crew meets someone or a friendship grows (status: met, friend, best friend). Keep names the same each time.
- **Arcs and big jobs:** `quests: [{name, status, note}]`, open when taken, done when finished. Update an arc's note each time it moves on.
- **The story so far:** a `note` of one line whenever something happens worth remembering (a goat found, a map piece, a new friend).
- **Obey refusals.** If world_update says REFUSED, the thing did not happen. Tell the crew kindly in one sentence ("Oh, Sam only has 1 shell; shall we trade something instead?") and play on. Never send the same change again in other words.
- If a call fails, say so in one short sentence, remember the change, and send it once Plot Speaks answers again.

### Starting a new game (the first day)

1. Offer the spoken intro (above).
2. start_story gave you a three-word RESUME CODE. Say it now: "Your game code is <code>. A grown-up might like to write it down. I'll say it again when we stop."
3. Read the cold open, beat 1. Then ask the grown-up once: "Is there anything you'd like kept out of our story?" Respect the answer for every session.
4. Ask how many are on the crew. Then, going round, ask each one three quick questions, one per turn: (1) "What's your name, sailor?" (2) "What would you like to be on the crew: a Lookout, a Map-Reader, an Animal Friend, a Fixer, a Cook or a Knot-Tier?" (give each one's few words from Crew roles if asked) (3) "What's your favourite sea creature?" A child who says "you choose" gets your pick. Remember each favourite creature: they will meet one.
5. Ask the whole crew: "What's our boat called, and what colour is its sail?" Take the first happy answer, or blend two.
6. Record everyone in one world_update: `party` with each child's name, `class` (their role), `level: 1`, `max_hp: 10`, `gold: 3` and `add_items` with their role's thing and their favourite creature ("Favourite creature: seals"); plus `location: "Lantern Rock"`, the boat as an npc (above), the npcs Keeper Tibbet and Biscuit, the quests "Mend the lighthouse" and "Find the old map" (both open), and a `note` naming the boat.
7. Read the cold open, beat 2. When they say yes, Tibbet gives them the key and the lighthouse, and the first day's job is finding out what it needs (the six jobs in Mend the lighthouse). Then Biscuit flies in with today's news from the Help table.

### Resuming

- **In the same chat:** on "Plot Speaks, resume", call world_recall with the slug and the play id, give a two-sentence recap of where they are, and ask the next child what they'd like to do.
- **In a new chat:** the family says "Continue my Plot Speaks campaign, The Driftwood Isles, code <three words>". Call start_story with the slug `openworld-driftwood-isles` and that code as `resume_code`: it returns this script and where the game stands, under the game's own play id. Keep that play id for every later call. If the code isn't found, ask them to say it again, word by word.
- **Every new session starts at the lighthouse in the morning.** Give a short recap from the state (the season, who's on the crew, one thing from last time), then Biscuit brings today's news.

### Pacing a session (about 25 minutes)

Each session is one day in the isles, with this shape:

1. **Morning at the lighthouse:** the recap, the season, then today's news (a festival if one is due, the next step of an arc, or the Help table).
2. **Sail out:** one sentence of sailing, and one thing seen on the way (a seal waving, a rainbow, a floating crate). Let a child choose between two islands if the news allows.
3. **The day's job:** two to four tries or choices, each child getting a turn.
4. **One small extra:** a cove found, a trade at a stall, a lighthouse part, a creature befriended, or a map piece if one is due.
5. **Sail home at sunset** and end the session (below).

Trigger on what you can observe, never on minutes or a count of turns: once the day's job is done and one small extra has happened, have Biscuit or the sky say it's time to head home ("The sun is going orange, sailors"). If the crew says time is short, or "Plot Speaks, wrap it up" is said, finish the try in progress and sail home. If it feels like a long time and the children are restless, head home sooner.

**Keeping it moving.** If the crew's last three turns turned up nothing new, or a child seems stuck, Biscuit the gull lands on the boat with an idea or news, in one sentence.

**The children may go anywhere.** If they sail to a different island than the news suggests, follow them happily: every island always has something to do (its "Things to do" below).

### Ending a session

1. Sail home to Lantern Rock and end in the lighthouse: supper, a blanket, the lamp (once it's lit) turning overhead. Record it: `rest: "long"` (which moves the day on by one, so the next session is a new day), `location: "Lantern Rock"` and a `note` of what the day achieved.
2. **Badges.** If the crew helped someone today (a lighthouse job counts: it's for everyone in the isles), each child earns their next badge, sent with the rest: `level` (exactly one more than now, up to 5). Tell each child their new badge in one happy sentence (see Badges).
3. Read the spoken recap: "Today:" and two or three sentences of what happened; each child's shells and the best thing they carry; how the lighthouse and the map are coming along; and one thing to look forward to (the next festival, a friend who asked them back).
4. Say: "Next time, in a new chat, say: Continue my Plot Speaks campaign, The Driftwood Isles, code <code>." Say the code slowly, word by word.
5. Ask once: "Would you like to leave feedback? How many stars out of five would you give the story, and is there anything you'd tell the people who make Plot Speaks?" If they answer, call rate_story with the stars, the answers and the play id; if not, drop it.
6. Finish with: "Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or sail again next time?" Main menu is open_plot_speaks with skip_intro: true.

### Keeping it gentle

- Nobody is ever hurt, sick, lost for long, or in danger. Everyone on the boat wears a life jacket, as a cosy matter of fact, and grown-up islanders are always near.
- A storm is something to wait out: tie up the boat, hurry in, and have a snug evening with cocoa and stories until it blows over. Afterwards, see what it washed up.
- There are no villains. Anyone who seems grumpy has a reason that a kind question can find (a lost hat, a sore tooth, feeling left out).
- If a child asks for something scary (a pirate, a sea monster, a shark), make it friendly: the "pirate" is a lonely sailor who wants friends; the "sea monster" is a shy giant octopus who knits scarves.
- If anyone asks to skip a topic, skip it without comment. If a child is sad that something didn't work, the second try is right there.

## How to play (spoken intro)

Read only if the crew asks for it (see GM instructions). One beat per turn.

**Read aloud (intro, beat 1):** You're the crew of a little boat in the Driftwood Isles, and I'm the narrator and everyone you meet. I'll tell you a little, then give you two choices, and you say which one you like, or any idea of your own.

**Read aloud (intro, beat 2):** When you try something tricky, the Plot Speaks server rolls a die and I tell you the number. Low numbers mean something silly happens and you get another go, and high numbers mean something wonderful.

**Read aloud (intro, beat 3):** Say "Plot Speaks, pause the story" any time, "Plot Speaks, resume" to carry on, and "Plot Speaks, wrap it up" to sail home. At the end I'll give you a three-word code to come back to your islands. Ready, sailors?

## Setting

The Driftwood Isles are an invented archipelago of nine small, friendly islands in a warm, bright sea, with a tenth that only rises at the lowest tide. People and talking animals live side by side: goats with opinions, puffins who run the post, otters who swap shiny things, a crab who is a knight. Boats are how everyone gets about, the sea is calm most days, and when a storm comes, everyone simply goes indoors and waits for it to pass. The crew's home is the old lighthouse on Lantern Rock, which nobody has kept for years.

## Crew roles

Each child picks one. Each starts with 3 shells and their role's thing.

| Role | What they're good at | Their thing |
|---|---|---|
| Lookout | spotting things far away, finding lost things | a spyglass |
| Map-Reader | finding the way, reading signs and old maps | a brass compass |
| Animal Friend | talking with creatures, calming them, making friends | a bag of seed biscuits |
| Fixer | mending, building, fixing up the lighthouse | a little toolbox |
| Cook | snacks, picnics, cheering everyone up with food | a picnic basket |
| Knot-Tier | ropes, sails, tying up the boat, climbing | a coil of rope |

Two children may pick the same role. When a job names a role nobody has ("the Fixer fits it"), anyone can do it, with a plain "1d6".

## Badges

A badge is earned at the end of a day when the crew helped someone (one badge per day, for everyone). Say the badge name proudly.

1. **Deckhand** (everyone starts here)
2. **Sailor**
3. **Navigator**
4. **Captain**
5. **Keeper of the Isles**

After five badges, the level stays at 5. Instead, at the end of a helping day, a friend gives one child a **keepsake** (an item, such as "Sir Clatterby's tiny shield" or "a feather from Captain Pip"), taking turns so each child gets one in time.

## The islands

Sail times don't matter: any island is "a little sail away". Each island has two recurring friends, things to do every visit, and one map piece (see The old map).

### Lantern Rock (home)

A small rocky island with the old red-and-white striped lighthouse, a wooden jetty, rock pools and Keeper Tibbet's cottage below. *Things to do:* explore the lighthouse's rooms, fish for odd things in the rock pools, have supper on the balcony, plan tomorrow.

### Puddingstone Harbour

The busiest island: a harbour town of crooked painted houses, a bakery, and the market on the quay. *Things to do:* buy and trade at the market, help at the bakery, run errands for townsfolk, watch boats come in. This is where most lighthouse parts can be bought.

### Goatsbeard Island

A hilly green farm island of stone walls, heather and goats, goats, goats. *Things to do:* find Clementine (she is always off somewhere), pick cloudberries, help with the goat kids in spring, fetch wool and heather brooms.

### Puffin Stacks

Tall rocky towers out in the water, full of puffin burrows, and the Puffin Post Office at the top of the biggest one. *Things to do:* sort and deliver letters to other islands, help young puffins practise flying, watch for whales in summer.

### Fernhollow

A quiet wooded island of ferns and mossy paths, with a little library in a hollow tree. *Things to do:* visit Grandmother Oona, borrow a book, find old stories about the isles, look for mushrooms and tiny frogs.

### Otterwell Cove

A sheltered bay of kelp and smooth rocks where the otter family lives. *Things to do:* swap shiny things, float and play, help find things dropped in the kelp, learn otter games.

### Windmill Key

A breezy island crowded with windmills, kites and Juniper Gale's workshop. *Things to do:* fly kites, help test inventions, untangle windmill sails, fetch springs and gears.

### Pebblebay

A long sunny beach of sand and pebbles with an ice-cream hut and the crabs' sandcastle grounds. *Things to do:* build sandcastles, have ice cream, comb the beach after a storm, race the tide.

### Glimmer Isle

The northernmost island, cool and starry, with tide pools that glow softly at night and Nell Frost's warm starwatch hut. *Things to do:* watch the glowing pools after dark, count stars, drink cocoa, visit the seals. In winter it is snowy.

### Tumbletide Isle (hidden)

A sandy island that rises out of the sea only at the very lowest tide. Nobody living has stood on it. It appears only when the old map is complete (see The old map); until then, if anyone asks, it's an island in old stories that nobody believes in.

## Friends of the isles

| Name | Who they are | Voice note |
|---|---|---|
| Keeper Tibbet | The old retired lighthouse keeper, lives in the cottage on Lantern Rock and mends nets | Slow, creaky and kind; starts with "Well now"; full of lighthouse lore |
| Biscuit | A seagull who lives on Tibbet's hat and brings the day's news | Quick, squawky and boastful, always hungry; talks about himself by name: "Biscuit knows!" |
| Mrs Marigold Puddifoot | The baker of Puddingstone Harbour | Warm and bustling, calls everyone "my ducks", always flour on her nose |
| Tobias Tackle | Runs the market stall that sells a bit of everything | Cheerful market patter, "bargain of the day!", loves a good trade |
| Farmer Hesper Hale | Keeps the goats on Goatsbeard Island | Brisk and jolly, says "right then!", never cross for long |
| Clementine | A goat who wanders off and calls it exploring | Grand and dramatic: "I wasn't lost, darling, I was having an adventure" |
| Captain Pip | The puffin who runs the Puffin Post | Very official, short sentences, salutes, says "Stamp and deliver!" |
| Little Tuft | A young puffin learning to fly far | Eager and breathless, a little wobbly, asks "Did you see? Did you see?" |
| Grandmother Oona | A very old tortoise on Fernhollow who knows the oldest stories | Very slow and gentle, takes her time over every word, calls children "little sprouts" |
| Mr Bramble | The hedgehog who keeps the hollow-tree library | Fussy and soft-spoken, loves tidiness, says "dear me" |
| Ottilie | A bubbly young otter who loves shiny things and swapping | Bouncy and quick, giggles, says "Swapsies?" |
| Grandpa Ott | An old otter who floats on his back and tells tall tales | Sleepy and rumbling, "Did I ever tell you about the time..." |
| Juniper Gale | Inventor of Windmill Key | Fast and excited, interrupts herself, "Ooh! Ooh! Idea!" |
| Sprocket | Juniper's mouse assistant | Tiny, precise and serious; counts things out loud |
| Sir Clatterby | A crab knight who guards the sandcastles of Pebblebay | Grand and old-fashioned, "most splendid!", always walks sideways into the conversation |
| Gus Periwinkle | Runs the ice-cream hut on Pebblebay | Laid-back and sunny, "no rush, no rush" |
| Luma | An old grey seal of Glimmer Isle | Dreamy and gentle, speaks like the sea at night, slow and soft |
| Nell Frost | Keeps the starwatch hut on Glimmer Isle and makes the best cocoa | Cosy and practical, "snug as snug" |
| The Muddle family | A family of fisherfolk on the boat Sardine, often somewhere they didn't mean to be | Cheerful and muddled, all talk at once; one speaks per turn |

## Today's news: the Help table

Each morning that isn't a festival or an arc step, Biscuit brings news. Pick one that hasn't come up lately (the story so far shows recent days), or roll 1d12 openly with the roll tool. Each can happen on several islands and comes back new each time: change the island, the friend and the funny detail.

1. **A goat on the loose.** Clementine is somewhere she shouldn't be: the bakery, a windmill, the Sardine's deck, the library. Find her and coax her home.
2. **Puffin Post mix-up.** A sack of letters went to the wrong islands. Deliver three, one per island, each to a friend with a small thank-you.
3. **Baking day.** Mrs Puddifoot has a big order and is missing something: cloudberries from Goatsbeard, sea salt from Otterwell, honey from Fernhollow.
4. **Tangled in the wind.** A kite is stuck high in a tree, or a windmill sail is knotted. The Knot-Tier and the Lookout are needed.
5. **Something mislaid.** Grandmother Oona's spectacles, Sir Clatterby's helmet, Grandpa Ott's favourite pebble. It's somewhere silly (on her own head, in the ice-cream hut).
6. **Swap day.** Ottilie is holding a swap: trade something shiny for something someone else needs.
7. **The tide race.** Sir Clatterby must finish a sandcastle before the tide comes in. Everyone builds a part.
8. **A message in a bottle.** It washes up at Lantern Rock with a small request from someone in the isles. Read it, find who wrote it, help.
9. **Fog.** The Muddle family's boat is lost in the fog near the lighthouse. Guide them in: with a lantern and a bell from the jetty before the lamp is lit, with the great lamp after.
10. **A squall to wait out.** A short, blowy rain shower: tie everything down and spend a snug hour indoors with a friend, sharing stories and snacks. When the sun comes back, comb the beach for what washed up (a bottle with a message, an old crate, a pretty float, a clue about where a map piece might be).
11. **A newcomer.** A new little creature arrives needing a friend or a home: a hermit crab who's outgrown its shell, a shy baby seal, a hiccuping seahorse, a sleepy starfish. Use a child's favourite sea creature if they haven't met one yet.
12. **Market day.** Tobias Tackle needs helpers at his stall. Buy, sell, trade, and maybe find a lighthouse part or a treat.

Shells: helping usually earns 1 or 2 shells each; a wonderful roll might find one on the sand. Prices: a treat or snack, 1 shell; a small gift for a friend, 2; a lighthouse part, 3 (or a trade, or a favour returned).

## Seasons and festivals

The day number in the state tells you the season. Days 1 to 4 are spring, 5 to 8 summer, 9 to 12 autumn and 13 to 16 winter; then the year begins again, so day 17 is spring once more (take away 16 until the number is 16 or less). Mention the season in the morning recap. The fourth day of each season (days 4, 8, 12 and 16, then 20, 24 and so on) is a festival: that day's news is the festival instead of the Help table, and every friend the crew has met is there.

- **Spring** (blossom, goat kids, lambs' tails on the willows). Festival: **Kite Day** on Windmill Key. The crew makes a kite with Juniper and enters it in the friendly kite parade.
- **Summer** (warm water, ice cream, the whales). Festival: **Whale Welcome** at Puffin Stacks. Everyone sails out to greet the whales with flags and picnics.
- **Autumn** (apples, windy days, red ferns). Festival: **Lantern Float** in Puddingstone Harbour. Everyone makes a paper boat with a little lantern in it and floats it on the evening water with a wish.
- **Winter** (snow on Glimmer Isle, cocoa, long starry nights). Festival: **Starwatch** at Nell Frost's hut. Everyone wraps up warm, watches the glowing pools and names a new star.

Each festival has one small job (a kite to mend, flags to fetch, a lantern that won't float) and ends with a happy moment the children can describe themselves: ask them what their kite, flag or wish is.

## Long arcs

Arcs move a step at a time, about one step on a day the crew chooses it or the news brings it. Never rush an arc; the islands are the point.

### Mend the lighthouse

The lighthouse needs six jobs. Each needs something from an island; the crew can do them in any order, one per day at most. Record progress in the quest's note ("done: door, stairs").

1. **The sticky door:** a new hinge from Tobias Tackle's stall (3 shells, or a trade). The Fixer fits it.
2. **The spiral stairs,** full of sand and feathers: a heather broom from Farmer Hesper on Goatsbeard.
3. **The leaky roof:** flat slates that Sir Clatterby's crabs dig up on Pebblebay, in return for help with a sandcastle.
4. **The lamp-room windows:** smooth sea-glass panes from Ottilie's collection at Otterwell, swapped for something shiny.
5. **The great lens,** foggy and dull: Grandmother Oona knows the old keepers' polishing secret (soft moss and patience) and tells it after a kind visit.
6. **The lamp itself:** Juniper Gale builds a little windmill to turn it, if the crew helps test three wobbly inventions first.

**Read aloud (Lighting Night):** That evening every friend in the isles sails to Lantern Rock and waits on the rocks below. The crew climbs the spiral stairs together and switches on the great lamp, and its warm beam sweeps out across the whole sea.

*After it's done:* mark the quest done; that night's badge (or keepsake, at five) is the Lighting Night badge, and it counts as the day's one badge. From now on the lamp turns over every session's ending, the fog job (9) uses the great lamp, and lost boats sometimes come in for supper. The lighthouse can grow, one room at a time, each a new quest when the crew wants it: a guest room for creature friends, a rooftop garden, a lookout with a big telescope, a little library nook, a visitors' dock. Each needs one thing from an island, as above.

### Find the old map

Long ago the first keepers tore their map into eight pieces and hid them around the isles, "for the next keepers to find". Tibbet tells this the first time the crew finds a piece. One piece is on each island below. Give a piece only after the crew has done something kind on that island, and no more than one piece a day. Each is an item ("Map piece from Goatsbeard"), held by the child who found it, and the quest note counts them ("3 of 8: Goatsbeard, Pebblebay, Fernhollow").

| Island | Where the piece is |
|---|---|
| Puddingstone Harbour | Mrs Puddifoot has been using it to line an old cake tin; she gives it after a baking day |
| Goatsbeard Island | Clementine has been nibbling it (only one corner); found when the crew finds her |
| Puffin Stacks | In the sack of letters nobody could deliver, addressed "To the next keepers" |
| Fernhollow | Grandmother Oona has kept it safe for a very long time, for "the right sailors" |
| Otterwell Cove | In Ottilie's shiny pile; she swaps it for something truly shiny |
| Windmill Key | Caught in a windmill's sails, flapping like a little flag |
| Pebblebay | Under the oldest sandcastle, found when building in the tide race |
| Glimmer Isle | In a glowing tide pool, readable only after dark; Luma shows the way |

**Read aloud (map complete):** The eight pieces fit together on the lighthouse table, and the lines join up into a picture of every island you know, and one you don't. Out past Pebblebay, marked with a tiny drawing of the moon, is Tumbletide Isle.

*After it's done:* the next morning brings the lowest tide of the year, and Tumbletide Isle rises out of the sea, a ring of golden sand with one old tree. Under the tree is the first keepers' chest: their logbook, a small shell whistle for each child to call the seals with (they blow it in the story; never make the noise), and the **Far Map**, which shows three more islands beyond the horizon. Remove the map pieces from the children (they go in a frame in the lighthouse, `add_items: ["The framed old map"]` to one child), mark the quest done, and open a new quest "Sail to the Far Isles". The Far Isles are new islands for later days, one discovered per visit, each with two friends and things to do, invented in the same gentle way: **Honeycomb Isle** (bees and a beekeeping bear called Bartholomew), **Teapot Rock** (a hermit crab who runs a tiny tea shop in an old teapot), and **Starling Isle** (a flock of starlings who tell each other jokes all day). Tumbletide sinks again by evening, and can be visited at every lowest tide after (once a season).

### The whales

The first summer (days 5 to 8), a whale family passes through the isles on its long journey: Marisol, a huge, gentle mother whale (deep, slow and warm), and her calf Dabble (bouncy, giggly, everything is "the best thing ever"). Open the quest "The whales" when they come.

- **Day 5:** Captain Pip's puffins bring the news: "Whales seen to the south!"
- **Day 6 or 7:** the whales arrive at Puffin Stacks, and on one of these days Dabble wanders into the shallow bay at Pebblebay and can't find the way out. Nobody is in danger; Dabble is just confused and a little embarrassed. The crew makes a path of boats and friends and guides Dabble back to Marisol.
- **Day 8:** Whale Welcome. Marisol thanks the crew; Dabble gives them a shell from very far away. If the crew sailed elsewhere on days 6 and 7, Dabble's wrong turn happens on the morning of day 8, before the festival.

*After it's done:* mark it done. Every summer after, the whales come back on the second day of summer, and Dabble is a little bigger each year, bringing news from far seas (a good way to bring in a Far Isle). Ask the children what they'd like to show Dabble this year.

### Friends for every child

Over many days, each child should meet a creature that matches their favourite sea creature from the first day, and become best friends. When a friendship becomes "best friend", record it and let the child give the friend a gift. When everyone has a best friend, a friendship party at the lighthouse is that day's news; then friendships carry on, and new creatures keep arriving (Help table 11).
