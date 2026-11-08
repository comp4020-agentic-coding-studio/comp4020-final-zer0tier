# VirtuePets

A multiplayer virtual pet game, inspired by QQ Pets. Create an account to
claim a pet. Train it, send it to work, fight, or visit other players' pets.
Every change shows up live in every open window.

## Getting in

Choose **Create account**, pick a player ID and password, and you're home with
your pet. Walk with **W/A/S/D**, press **Space** beside your pet or the
furniture, and walk out the front door to reach town. **Escape** opens the menu.
To see another player, open the **Arena** in town and press **Visit** beside
their pet. Every rule, control and the API are in the
[player and developer guide](docs/GUIDE.md) (`/guide/` in the app).

## What good means

**Good means the game is interactable with the other people playing it.** A
virtual pet you raise alone is just a to-do list. QQ Pets was worth coming
back to because your pet lived beside everyone else's. So VirtuePets is good
when what you do reaches other players, what they do reaches you, and none of
it is lost. Those are the final project's three fixed requirements, read as
the point of the game, not boxes to tick:

- **Other people are really there.** Each player has one account and one pet.
  Anyone can look at any pet, but only its owner can act for it. Visiting is
  how players reach each other: you can play with, feed, clean, give gifts to,
  or steal from a pet you visit, always *as your own pet*. A visitor can help,
  but never use up or harm what someone else owns. *Enforced:*
  `spec/pets.test.ts`, `spec/touch.test.ts`, `spec/help.test.ts`,
  `spec/gift.test.ts`.
- **You see each other act.** Every change to a pet, and every fight, reaches
  every open window within a second. Adventure is the deliberate exception:
  one player's own run is never broadcast. *Enforced:*
  `spec/realtime.test.ts` opens real WebSockets and fails if any event takes
  longer than a second.
- **Nothing you did is lost.** Pets, accounts, fights, and unfinished lessons
  and shifts live in SQLite on the Fly volume. *Enforced:* signing back in
  returns the same pet. *Checked by hand:* I killed the server halfway through
  a shift; the shift still finished and paid on time.
- **Interacting is fair.** Fights follow published rules, the bot keeps pace
  with the median player, and a strong pet can't drain a weak one.
  *Enforced:* `spec/fight.test.ts`.

Some of "good" can only be judged by playing, not by `spec/`: whether waiting
30 minutes for a lesson feels like anticipation or a chore, and whether the
Arena is more fun with a room full of people — the capstone showcase this is
built for.

**What I chose not to build (yet):** chat and trading. A gift moves your own
items to someone else, but nothing comes back, so it can never be a lopsided
trade, and guestbook notes use fixed phrases so there's nothing to moderate.
Needs that drop while you're away are built but switched off until players
have tried them.

**What I read or looked at:**

- Clay Shirky,
  ["Situated Software"](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
  (2004). Software for a small group works when it shows the group to itself
  ("What does everyone else think?") and doesn't rely on people checking
  back. It pushed me to keep everything in sync and make it easy for players
  to interact: every change reaches every open window live, and the Arena
  shows who else is playing.
- The
  [Final Project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/):
  its multi-user, real-time, and persists requirements are the backbone of
  this definition.
- QQ Pets (Tencent, 2005), the game this one is modelled on: study for
  stats, work for money, care for your pet's needs, and share a world with
  other players.
