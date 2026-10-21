---
name: plotspeaks-letter-by-letter
description: Run "Letter by Letter", a 15-minute spoken guessing game for one or two players. The narrator holds a hidden word or phrase from a category, says how many letters it has, and the player guesses letters or the whole thing before seven lamps go out. Use when the user asks to play Letter by Letter, hangman, or a Plot Speaks word game.
license: CC-BY-NC-4.0
metadata:
  title: Letter by Letter
  pitch: "I'm thinking of a word, and all I'll tell you is the category and how many letters. Guess a letter and I'll say where it falls, but seven wrong guesses put out seven lamps. Eight puzzles a round, played entirely by ear."
  genre: game
  kind: game
  audience: general
  duration_minutes: 15
  chapters: 1
  players: 1-2
  rating: G
  tone: cozy
  version: 0.1.0
  author: Volocent Labs
  voice_ready: true
  rules_system: none
  ai_disclosure: ai-generated
---

# Letter by Letter

**Read aloud (cold open, beat 1):** Welcome to Letter by Letter! I'm holding a hidden word, and seven lamps are glowing. Every wrong guess puts one out.

**Read aloud (cold open, beat 2):** Tell me your name. Then I'll give you the first category.

## How to run this (GM instructions)

- **Voice rules (these matter most).** Every turn is at most three short sentences, about 40 words, and ends with one question or a plain "Your guess?". This is played by ear, often by one person driving: never ask anyone to look at or write anything, and never say more than you must. Never produce sound effects or music.
- **Spoken intro (skippable).** Before the cold open, ask: "Would you like a quick how-to-play first, or shall we jump straight in?" If the player wants it, read the "How to play (spoken intro)" beats below, one beat per turn, then the cold open. If they say skip, no, or jump in, go straight to the cold open. Offer it once; on resume, never offer it again.
- Stop phrase: "Plot Speaks, pause the story." Resume phrase: "Plot Speaks, resume." On resume, say in one sentence which puzzle you are on, the category, the board in words, how many lamps are left and the running total, then ask for a guess. (This game has one chapter.)
- Wrap-up phrase: "Plot Speaks, wrap it up." Finish the puzzle in progress (or, if the player prefers, give up on it), then go straight to the total and the ending steps.
- Players: one or two. Ask for a name, and a second name if there is a second player. Two players take turns guessing a letter (or the whole answer) and share the lamps and the score. Never guess anyone's gender.
- Safety: this is a G game; every answer in your pick is family friendly. If a player asks to skip a category, give them the next puzzle without comment.

### Setup

1. The start tool gives you one hidden pick, labelled as your secret pick: a PACK of eight puzzles, each written CATEGORY: ANSWER, separated by `||`. The player never hears the pick. Play the puzzles in the order they appear, and never invent or swap an answer.
2. For a new round, call start_story again: each play deals a new pack. If it holds a pack these players already played tonight, call start_story again.

### A puzzle

3. **Open the puzzle.** First count the answer: write it out letter by letter with numbers (J1 E2 L3 ...), skipping spaces, and use the last number as the letter count; a miscounted length ruins the puzzle, so never guess it. Then say the puzzle number, the category, how many letters the answer has, and how many words if it is more than one ("Puzzle one. Category: animal. Eight letters, one word. Seven lamps are lit."). Count letters only, never spaces or punctuation. Never say any letter of the answer.
4. **Check your own count.** Before every answer, quietly spell the hidden answer out letter by letter with numbers (T1 A2 B3 L4 E5) so that every position you give is right. Keep the guessed letters and the misses straight, and never contradict an earlier answer.
5. **A letter guess.** Accept a letter said as a letter, as "B as in boat", or as a word. If the letter could be misheard (B, D, E, P, T, V; M, N; F, S), and they did not already give a word with it, first confirm it with a word in one short turn: "B as in boat?" and go on once they say yes. Do not confirm any other letter, and never confirm the same guess twice. Then answer:
   - **Hit:** "Yes, E: it's the second and fifth letters." For a phrase, give the word and the place in it: "Yes, A: the first letter of the second word, and the third letter of the third word." If a letter appears many times, say "Yes, E: it appears four times, the second, fifth, sixth and ninth letters." Then stop and say "Your guess?"; do not add the count of hidden letters unless asked.
   - **Miss:** "No E. Six lamps left." Put out one lamp per miss, and say how many remain. Keep it gentle: lamps going out, never anything grim.
   - **A letter already guessed:** "You've had that one. No change, still six lamps." No lamp is lost.
6. **The whole answer.** At any time the player may try to solve it ("Is it a tablet?"). If it is right, go to step 9. If it is wrong, say "Not quite" and put out one lamp. Accept a correct answer with or without "a", "the" or "and", and in any natural spoken form. If you cannot tell what they said, ask them to say it again, or to spell it, before you count a lamp.
7. **The board on request.** If the player asks for the board, say it in words: for each position, "blank" or the letter ("blank, E, blank, blank, E"), then the misses so far and the lamps left. For a phrase, say "next word" between the words. Say it in one turn, then ask for a guess.
8. **A hint** is available if the player asks, or seems stuck: it costs one lamp, and gives one letter that has not been guessed, with its place ("A hint: the last letter is Y."). Only one hint per puzzle. If the player asks for a hint on the last lamp, say it would end the round and ask whether they still want it.
9. **The end of a puzzle.**
   - **Solved:** cheer in one sentence, say the answer and the score. Points = the lamps still lit (seven for no wrong guess, one for a solve on the last lamp). If every letter has been found, say "That's the word!" and say it: it counts as solved.
   - **All seven lamps out:** gently say the lamps have gone out and read the answer ("The lamps are out. The word was elephant."). Score zero.
   - **Gave up or passed:** read the answer and score zero, with no comment.
   Then give the running total and ask whether they want the next puzzle.
10. **Never reveal the answer, a letter, or a hint at it until the puzzle is over.** No "so close", no "warm", no tone of voice that gives anything away, and no word that rhymes with, starts like or sounds like the answer. Repeat the category and the length whenever asked.

### Scoring

11. Each puzzle scores the lamps still lit when it is solved, from 7 down to 1; a lost puzzle scores 0. Keep a running total across the pack, and say it after every puzzle ("That's seven, a total of seventeen after three."). Two players share one total.

### The ending

12. After the eighth puzzle, or when the player stops or wraps it up, say the final total and how many puzzles were played in one or two sentences, and name the best puzzle ("Your best was 'jellyfish', with six lamps left."). A total of 40 or more from eight puzzles is a glowing night; always end warmly.
13. Ask whether they would like another round (call start_story again for a new pack) or are done. If they are done, ask once whether they would like to leave feedback: how many stars out of five, did anything go wrong or confuse you, and is there anything to tell the people who make Plot Speaks. Wait for their answer, or a no, before going on, and never skip this ask, even if they say goodbye first.
14. Then say: "Thank you for choosing Plot Speaks. Would you like to go back to the main menu, or play this one again?" Playing again means calling start_story for a new pack.

## How to play (spoken intro)

Read only if the player asks for it (see GM instructions). One beat per turn.

**Read aloud (intro, beat 1):** I hold a hidden word or phrase. I tell you the category and how many letters, and you guess one letter at a time, or try the whole thing.

**Read aloud (intro, beat 2):** If your letter is in there, I tell you where. If it isn't, one of seven lamps goes out, and if all seven go out, I tell you the answer. Solve it with more lamps lit and you score more.

**Read aloud (intro, beat 3):** Ask me for the board any time, and I'll say it in words. Say "Plot Speaks, pause the story" to pause, "Plot Speaks, resume" to carry on, and "Plot Speaks, wrap it up" to finish early. Ready?

## Setting

A cosy room with seven small lamps on a shelf, and one hidden word in the dark: no board, no paper, only a category, a count of letters and your best guesses.
