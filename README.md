# VirtuePets

A multiplayer virtual pet game inspired by QQ Pets. Create an account to claim
a pet, train it, send it to work, fight or visit other players' pets, and watch every
change land live in every open window.

## What good means

**Good means the game is interactable with the other people playing it.** A
virtual pet you raise alone is a to-do list; QQ Pets was worth coming back to
because your pet lived beside everyone else's. So VirtuePets is good when what
you do with your pet reaches other players, and what they do reaches you, and
none of it is lost. That's the final project's three fixed requirements, read as
the point of the game rather than boxes to tick:

- **Other people are really there (multi-user).** Each player has their own
  account and exactly one pet. Anyone can look at any pet in the Arena, but only
  its owner can act for it, so a stranger can't train, shop or fight with
  yours. A player who joins while you're playing appears in your Arena straight
  away. *Enforced:* `spec/pets.test.ts` (one pet per ID, owner-only actions,
  401/403), `spec/fight.test.ts` (new pets listed after the bot).
- **You see each other act (real-time).** Every change to a pet, and every fight,
  reaches every open window within a second, with no reload: your rival's shift
  ending, their level-up, the fight they just started against you. The Arena's
  **Happening now** list shows the whole room what everyone else is doing.
  Adventure is the deliberate exception: it's one player's own exploration, so
  its state is never broadcast to anyone else's window.
  *Enforced:* `spec/realtime.test.ts` opens real WebSockets and fails if any
  event takes longer than a second; `spec/feed.test.ts` checks what the feed
  records.
- **Nothing you did is lost (persists).** Pets, accounts, fights and unfinished
  lessons and shifts live in SQLite on the Fly volume, and a shift that was
  running when the server restarted still finishes and pays. *Enforced:* signing
  back in returns the same pet (`spec/pets.test.ts`). *Checked by hand:* survival
  across a restart, which the spec can't trigger. I killed the server halfway
  through a shift and started it again; the pet was still working, the shift
  finished and paid on time, and the player was still signed in.
- **Interacting is fair.** Fights are decided by published rules (power is
  2 × Strength + Intelligence + Charisma, with limited luck), so training shows
  in the results, and the bot `0` is a fair opponent nobody can control: it
  keeps pace with the median player, so it never becomes a free win. Fights
  have stakes (the winner takes some of the loser's money), but a strong pet
  can't drain a weak one: it has to wait an hour before attacking the same pet
  again, while the pet it attacked can hit back straight away.
  *Enforced:* `spec/fight.test.ts` (stronger claws win the tested matchups; the
  bot can't be signed into; spoils, the cooldown and revenge). *Checked by
  hand:* the bot tracking the median, which the shared spec database can't pin
  down. On a fresh database with pets at 7/5/5, 6/6/5 and 5/5/5 (Strength /
  Intelligence / Charisma), the bot moved to 6/5/5 and every window heard it.

Some of good can only be judged: whether waiting 30 minutes for a lesson feels
like anticipation or a chore, whether prices (a $150 hourglass) make choices
interesting, and whether the Arena is more fun with a room full of people, which
is the capstone showcase this is designed for. Those are tested by playing it
with others, not by `spec/`.

**What I chose not to build (yet):** chat, trading or gifting between pets, and
recruiting other players' pets. Each adds interaction, but the first version
proves the core loop (train, work, fight, see others do the same) before
widening it.

**What I read or looked at:**

- Clay Shirky,
  ["Situated Software"](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
  (2004). Software for a small group works when it shows the group to itself
  ("What does everyone else think?") and doesn't rely on people checking back.
  It made me think it's important to keep everything in sync and make it easier
  for players to interact: every change reaches every open window live, and the
  Arena shows who else is playing.
- The
  [Final Project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/):
  its multi-user, real-time and persists requirements are the backbone of this
  definition.
- QQ Pets (Tencent, 2005), the game this one is modelled on: study for stats,
  work for money, care for your pet's needs, and share a world with other
  players.

## Playing

On desktop windows at least 1120px wide, the game fills the browser with three
panels: your pet and quick care, School/Work/Shop tabs, and the Arena with
Pets/Leaderboard/Activity/Alerts tabs. Long lists scroll within their panels;
short windows can still scroll the page. Theft reports appear in Alerts.
Arrow keys switch tabs; Home/End select the first/last tab. Narrower windows
and phones retain the original stacked layout and controls. The selected Pets
or Leaderboard tab is preserved when resizing.

**Create an account** with a player ID (letters, digits, `-` or `_`, up to 32
characters) and a password of at least 8 characters. Each ID has one account
and one pet, so an ID someone else has signed up with is taken. A new pet starts
with Strength 5, Intelligence 5, Charisma 5 and no money. **Sign in** with the
same ID and password to come back to it. Opening or refreshing the game page
requires a fresh login, including opening it in another tab (tabs share a
session). Your pet and progress are saved. After 5 wrong passwords for an ID, sign-ins to
it from that address wait 15 minutes.

Anyone can look at any pet, but only its owner can study, work, shop, steal or fight
with it. The bot's ID, `0`, can't be signed up or signed into. A pet from before
accounts existed is claimed by the first person to sign up with its ID.

### Pet appearance

Use **Pet appearance** below your pet's header to choose a color and a shape:
**cat, dog, bird, dragon or blob**, then press **Save appearance**. New and
existing pets start as an amber (`#f59e0b`) blob until customized. Changing
appearance is free and works while studying or working. Only the owner can
change it, and it stays saved when you sign out or the server restarts.

The saved color and shape appear in the dashboard header, Arena pets,
leaderboard and **Happening now** feed, including older feed entries. Every open
window updates from the server's broadcast; picking or saving a setting never
previews an unsaved change on the pet.

### School

Every pet starts at primary school. There are four courses:

| Course    | Raises                                         |
| --------- | ---------------------------------------------- |
| Math      | Intelligence                                   |
| PE        | Strength                                       |
| Drama     | Charisma                                       |
| Electives | a random attribute, picked again for each point |

Each lesson earns 1 credit. Lessons are worth more the further the pet gets,
but each level takes more credits to finish:

| School         | Each lesson adds | Credits to move up      |
| -------------- | ---------------- | ----------------------- |
| Primary school | +1               | 5, to middle school     |
| Middle school  | +2               | 10, to high school      |
| High school    | +3               | top level; credits keep counting |

Moving up resets the credit count.

### Stamina, hygiene and work

Every pet has **stamina** and **hygiene**, each from 0 to 100, and starts with
both full. Studying wears a pet out; working mostly gets it dirty:

| Activity          | Takes      | Stamina | Hygiene | Earns                         |
| ----------------- | ---------- | ------- | ------- | ----------------------------- |
| Study             | 30 minutes | −20     | −10     | attribute points and a credit |
| Work, per hour    | 15 min–4 h | −10     | −20     | money (see Work below)        |

Lessons and shifts take real time. The costs come off when the pet starts, and
the reward (points, the credit, or the pay) arrives when it finishes. A busy pet
can't start another lesson or shift, but you can still shop, feed it, clean it
and upgrade its jobs.

A pet that's too tired or too dirty refuses. A shift needs at least its own
costs. To study it needs enough for the lesson *and* an hour's shift afterwards
(30 stamina and 30 hygiene), so a pet can always work its way back to health.

### Work

There are three places to work, each paying by one attribute. Shifts last 15
minutes, 30 minutes, 1 hour, 2 hours or 4 hours. An hour pays the pet's rank
wage plus **$1 per point** of that attribute, so a strong pet earns more on the
construction site than at the office. Pay and costs scale with the shift's
length (a 15-minute shift is a quarter of an hour's; costs round up, pay to the
nearest dollar).

| Location          | Attribute    | Rank 1 ($20/h) | Rank 2 ($40/h, needs 20) | Rank 3 ($70/h, needs 50) |
| ----------------- | ------------ | -------------- | ------------------------ | ------------------------ |
| Construction site | Strength     | Labourer     | Foreman                | Site manager           |
| Office            | Intelligence | Clerk        | Analyst                | Director               |
| Theatre           | Charisma     | Usher        | Actor                  | Star                   |

Every pet starts at rank 1 everywhere. Once its attribute reaches the next
rank's requirement, **Upgrade** moves it up; ranks are kept for good.

### Shop

Buy items at the shop with the pet's money, then use them:

| Item      | Price | Use                                               |
| --------- | ----- | ------------------------------------------------- |
| Food      | $15   | Feed: +40 stamina                                 |
| Soap      | $10   | Clean: +50 hygiene                                |
| Hourglass | $150  | Skip: finishes the current lesson or shift now    |

Stamina and hygiene don't go above 100, and food or soap can't be used when that
need is already full. An **hourglass** skips the wait: the lesson or shift ends
straight away and pays its full reward, as if it had run its whole time. It can
only be used while the pet is studying or working; the busy banner has a Skip
button for it. Open the same pet in two windows and both update together.

### Other pets and fights

The **Arena** lists other pets: the bot first, then the newest. A player who
joins while you're playing appears in your arena straight away. You can also
look any pet up by its player ID. Each shows its school, what it's doing, its
attributes, its power and its wins and losses.

Pet **`0` is a bot**. It always exists, so there's always someone to fight.
It keeps pace with the players: each of its attributes is the **median** of
every player's pet (rounded down, and never below a new pet's 5), updated the
moment any pet's change moves the median. So the bot is always an even match for
a typical player: beating it reliably means your pet is ahead of the pack.

Press **Fight** to open an automatic battle in a small window. Every pet initially
knows only **Claw Strike**, which costs **0 MP**. Each Arena fight starts with full
**HP = Strength + Intelligence + Charisma** and **MP = Intelligence**. These are
battle resources; they do not replace stamina or hygiene, and reset each Arena
fight. Adventure keeps its own HP/MP between encounters, as described below.

Power remains 2 × Strength + Intelligence + Charisma. Each pet rolls a luck
factor between 0.8 and 1.2, and Strength × luck, rounded to at least 1, is
that pet's Claw Strike damage for the battle. Before the fight, a coin toss
decides who strikes first — a fair 50/50 by default, unless the acting
side's equipped Unfair Coin overrides it (see below). Pets alternate attacks
until one reaches 0 HP, using the strongest affordable learned ability (lower
MP cost breaks a damage tie). Claw Strike remains free; learned attacks spend
MP. The surviving pet wins; going first alone no longer guarantees victory.
The winner gets a win and the loser a loss.

The coin toss, and any equipped coin's effect, apply to Arena fights and
revenge the same way they apply to Adventure monster battles: in a fight, the
**attacker's** equipped coin applies; in revenge, the **victim's** does. The
opponent's equipped coin is always ignored, so only one side's coin ever
affects a given battle.

The window shows saved HP/MP changes, attack effects, and an expandable log.
**Skip to result**, **Replay battle**, and **Watch battle** in recent fights
only control playback; they never charge energy or award money again. Closing
the window does not cancel the saved result. Both online players can watch,
and recent fights retain their replay after a restart. Very long battles group
identical middle rounds without changing the outcome. Older fights remain
readable but have no replay. Motion effects respect reduced-motion settings.

**The winner takes 10% of the loser's money** (rounded down, at most $50),
whichever side attacked, so an attacker who loses pays the defender. Fights with
the bot are practice: no money changes hands.

After attacking a pet, the attacker has to wait **an hour** before attacking
that same pet again. The pet it attacked can hit straight back (unless it
attacked that pet itself within the last hour): if someone attacks you, a
message pops up wherever you are on the page, saying who it was, how it went and
what money changed hands, with a **Revenge** button to fight them straight back.

### Theft notifications and revenge

The theft API (`POST /api/pets/:id/steal/:opponent`) transfers $10–$30,
limited by the victim's balance. A pet can be robbed at most once per UTC
calendar day across all players. Protection persists and resets at midnight UTC;
failed attempts do not consume it. You cannot steal from yourself or the bot.

Thefts are saved separately from the public feed. When you sign in, unresolved
reports show who stole from you, when, and how much, with a **Take revenge** button.
They also appear live and survive server restarts and public-feed pruning.
Each theft allows one completed revenge attempt using the same automatic battle
and combat energy requirements. You must be idle; ordinary fight cooldowns do not
block theft revenge. On a win, the thief pays **twice the stolen amount**, and you
gain **+1 Strength, +1 Intelligence and +1 Charisma**. If the thief cannot afford
the full reward, no attempt or energy is spent; try later. A loss spends the attempt
and combat energy but takes no extra money. Revenge never removes daily theft protection.
`GET /api/thefts` returns only your pending reports; `POST /api/pets/:id/revenge/:theft`
accepts only a theft against your own pet. Completed attempts cannot pay out twice.
Signing out clears pending revenge controls; late responses from an earlier
login cannot change the new login’s notifications or buttons.

### Visit and steal

Press **Visit** beside a pet in the Arena (or look it up by player ID) to see
its appearance, activity and balance. **Steal $10–$30** takes a random whole
dollar amount from that pet and adds it to yours. The amount never exceeds
its balance; a pet with less than $10 cannot be robbed. Visiting and stealing
are instant, cost no stamina or hygiene, and work while either pet is busy.
You cannot steal from yourself or the bot.

**Each pet can be robbed once per UTC calendar day, across all players.**
After a successful theft, everyone must wait until midnight UTC to rob that
pet again. The visit shows when its protection ends in your local time.
You can still steal from other eligible pets. Failed attempts do not use up
the target's daily protection, and protection survives signing out and server
restarts. Both balances update live; the owner gets a notification and the
theft appears in **Happening now**.

### Leaderboard

The Arena's **Leaderboard** tab ranks the top 10 players by **most wins** (fewer
losses breaks a tie) or by **most power**; on a tie the player who joined first
stays ahead. The bot isn't on it. It re-ranks live as pets fight and train, and
your own pet is highlighted when it makes the board.

### Happening now

Below your fights, the Arena shows the 15 newest things that happened anywhere
in the game, live: a player joining, every theft, every fight (who won, and any money
taken), a pet moving up a school, and a pet being promoted at work. Ordinary
lessons and shifts stay out of it, so it isn't flooded. Entries about your pet
are highlighted.

Fighting is instant and costs the attacker 10 stamina and 5 hygiene. Like
studying, it needs enough left for an hour's shift afterwards (20 stamina and 25
hygiene), and a busy pet can't start a fight. The defender doesn't pay anything,
and can be attacked while it's busy. Both players see the result straight away.

Still to come: recruiting other players' pets.

## Running it locally

```sh
mise install
pnpm install
pnpm start        # http://localhost:8080, lessons and shifts in real time
pnpm start:test   # the same on a fast clock (a game hour takes 0.1 s)
pnpm check        # in a second terminal, against pnpm start:test
```

Data lives in SQLite at `./data/virtuepets.db` (`/data` on Fly, which is the
attached volume).

## How it's built

Node 24 running TypeScript directly, Express for HTTP, `ws` for WebSockets and
the built-in `node:sqlite` for storage.

- **Accounts:** `POST /api/signup`, `/api/signin` and `/api/signout`, and
  `GET /api/me`. Passwords are hashed with scrypt; a session is a random token
  in an HttpOnly cookie, stored only as a hash.
- **Actions** (owner only): `POST /api/pets/:id/study/:course`,
  `work/:location` (with `{"minutes": 60}`), `upgrade/:location`, `buy/:item`,
  `use/:item`, `fight/:opponent`, `steal/:opponent` and `equip-coin/:coin`
  (`:coin` is `copper-coin`, `silver-coin`, `gold-coin`, or `none` to unequip).
  Equipping is global to the pet and reusable — never consumed — and applies
  to Adventure, Arena, and revenge alike; equipping a coin the pet doesn't own,
  or an unknown coin, returns 409. Stealing returns
  `{ thief, victim, amount }`; both pets include `stealAvailableAt` (epoch
  milliseconds, or `null` before any theft). The server locks and checks the
  target before transferring money, saving protection and recording the feed
  entry in one transaction. Repeated thefts return 429; insufficient funds
  return 409; self/bot targets return 400. The daily limit uses real UTC days,
  independent of `TIME_SCALE`.
- **Appearance** (owner only): `POST /api/pets/:id/appearance` with both
  fields, e.g. `{"color":"#12abef","appearance":"dragon"}`. Color must match
  `/^#[0-9a-f]{6}$/i`; appearance must be `cat`, `dog`, `bird`, `dragon` or
  `blob`. Invalid fields return 400; invalid player IDs return 404, as on other
  pet routes. The response and existing `pet:updated` broadcast contain the
  complete saved pet, including `color` and `appearance`. Clients wait for
  that broadcast to display a change. Both columns migrate in place on startup.
- **Reading** (anyone): `GET /api/pets` lists pets, `GET /api/pets/:id` shows
  one, `GET /api/pets/:id/fights` its recent fights, `GET /api/feed` what's
  been happening across the game (newest first), `GET /api/leaderboard?by=wins`
  (or `power`) the top 10 players, and `GET /api/rules` the
  schools, courses, work locations, items and costs.
- **Real time:** the server broadcasts a `pet:updated` event over the socket
  after every change, a `fight:finished` event after each fight (with the
  `spoils` the winner took), and a `feed:added` event for each new entry in
  Happening now, sent after the change it describes. The feed keeps its newest
  500 entries in SQLite.

## Adventure exploration

Choose **Adventure** under **Make their day** on desktop, or the Adventure
section on a phone, then **Explore the woodland**. Move one block per press with
W/A/S/D, arrow keys, or the on-screen direction buttons. Each of the five fixed
floors starts with a 16 × 16 grid, four regular enemies (slimes and goblins), and at least
one marked treasure chest. Floor five also contains the **Slime King**. The map
uses your pet's saved shape and colour as soon as you sign in.

Stand on the down stairs at column 14, row 14 and choose **Descend**. You arrive
at the next floor's up stairs at column 3, row 3; **Ascend** returns to the
previous floor's down stairs. Floor one has no up stairs and floor five has no
down stairs. Leave or Escape closes the window. Your floor, position, HP/MP, and
each floor's remaining enemies are saved privately to your account, including across server
restarts. Older clearing saves retain their positions during migration.

Monsters detect the pet in any of their eight surrounding blocks, including
diagonals. After each accepted player step, each nearby monster tries to move
one cardinal block closer. They stop next to the pet, cannot cross trees, chests,
stairs, or other monsters, and stop pursuing when the pet leaves detection range.
Blocked player moves, opening the map, using stairs, and battles do not advance
other monsters. An exclamation mark and a message warn about nearby monsters.
Walk into a monster's tile to start a battle; adjacency alone does not start one.
Enemy attributes and positions are listed under **Monster
attributes**, and every stair and chest is reachable through the map's paths.

For initial balancing, floor-one slimes have STR/INT/CHA **3/1/2**, and goblins
have **5/3/2**. Each deeper floor adds **2/1/1**, respectively. The floor-five Slime
King has **18/10/12**. Maximum HP is the sum of attributes; maximum MP is
Intelligence. A new run starts with full resources. Current HP/MP carry between
battles and floors, and leaving, signing out, or restarting the server does not
refill them. Existing exploration saves receive full HP/MP on their first visit
after this update. Training increases the maximums without refilling current HP/MP.

### Monster battles

Encounters use the Arena's automatic battle scene, with the monster's
own appearance, name, and attributes. Monsters use **Claw Strike**, which costs **0 MP**;
pets also use their learned abilities, and damage uses the same power and luck
rolls as Arena. Initiative is the same coin toss as Arena: a fair 50/50 unless
the pet's own equipped Unfair Coin overrides it — monsters never carry coins.
The scene starts at the pet's saved HP/MP, and each monster starts at full HP/MP.

On victory, the monster stays defeated and the pet occupies its tile. Recover
**20% of maximum HP and MP, rounded up separately**, capped at their maximums.
For example, maximums of 31 HP and 7 MP restore up to 7 HP and 2 MP after a win.
The server applies this recovery once, alongside the outcome. Defeating the
Slime King marks the woodland complete; you can explore remaining paths or
choose **Start new adventure**.

**Defeat fails the adventure.** HP stays at zero and movement and stairs are
disabled. Return to the map to see the result, then choose **Start new adventure**
to reset to floor one with full HP/MP and a fresh set of monsters. Leaving or
reloading keeps the failed run; it does not restart automatically.

**Skip to result**, **Replay battle**, and **Watch last battle** only play the
saved turns. **Return to map** (or Escape from the battle window) acknowledges
the saved result and resumes exploration after a win. If that request fails,
**Continue exploring** lets you retry it. A reload before returning to the map
opens the same pending battle. Replays cannot reroll a result, grant more recovery,
or resurrect a monster.

Adventure has no entry cost, care cost, or cooldown, and does not alter Arena
wins/losses. Monster victories grant recovery; chests grant the items below.

### Treasure and inventory

Stand on a treasure chest and choose **Open chest**. Each chest awards one reward
per run: **Food 30%, Soap 30%, Ability 20%, Hourglass 15%, Unfair coin 5%**.
The two ability types have equal chances within the ability category; Copper,
Silver, and Gold Coins have equal chances within the coin category. Opened chests
stay on the map, retain their reward, and cannot be looted again. New adventures
have fresh chests. Defeat, restarting, and signing out do not remove inventory.

The map's **Your backpack** shows items, learned abilities, and coins, each with
an **Equip**/**Unequip** button. Food restores 40 stamina; soap restores 50
hygiene, capped at 100. Hourglasses finish the current lesson or shift. These
are the same items used in **Care & shop**, with a shared count; they do not
restore Adventure HP/MP or revive a failed run. The Adventure section's
**Abilities & coins** also shows permanent discoveries and the same equip
controls, since equipping is global to the pet.

Ability rewards are learned immediately and permanently, and work in Adventure,
Arena, and revenge. Duplicate drops say **already learned**, without stacking
the ability or rerolling the reward.

| Ability | MP cost | Damage |
| --- | ---: | --- |
| Claw Strike | 0 | Strength × battle luck, rounded, at least 1 |
| Firebolt | 3 | Intelligence × 1.5 × battle luck, rounded, at least 1 |
| Heavy Strike | 2 | Claw Strike damage × 1.5, rounded up |

Each turn uses the learned attack with the greatest damage that the fighter can
afford, preferring lower MP cost when damage ties. At low MP the pet falls back
to Claw Strike. Saved playback includes each ability, MP spent, and remaining
resources; replaying does not spend MP again.

### Unfair coins

A coin toss decides initiative before every monster battle, Arena fight, and
revenge attempt: a fair 50/50 by default. Equipping an Unfair Coin can change
that for the pet wearing it:

| Coin | Effect |
| --- | --- |
| Copper Coin | +1 to every attribute, for that battle's HP/MP/damage only. The toss stays a fair 50/50. |
| Silver Coin | The pet always attacks first. |
| Gold Coin | The pet always attacks second, but its first attack deals double damage. |

Coins are **reusable equipment, never consumed**: equip one (or none) from
the backpack, and it stays equipped — in Adventure, Arena, and revenge alike —
until changed. In Arena and revenge, only the **acting side's** equipped coin
applies (the attacker in a fight, the victim in revenge); the opponent's
equipped coin, if any, is ignored. Copper's bonus never persists: the pet's
real attributes, and its saved maximum HP/MP, are unchanged once the battle
ends.

The private `POST /api/adventure` accepts an empty body to resume. Its response
includes an opaque `revision`; supply that revision with every action:

- `{ "direction": "w" | "a" | "s" | "d", "revision": "…" }` moves one tile.
- `{ "action": "ascend" | "descend", "revision": "…" }` uses matching stairs.
- `{ "action": "continue", "battleId": "…", "revision": "…" }` acknowledges a battle.
- `{ "action": "restart", "revision": "…" }` starts fresh after failure or completion.
- `{ "action": "open-chest", "revision": "…" }` opens the chest under the pet.
- `{ "action": "use-item", "item": "food" | "soap" | "hourglass", "revision": "…" }` uses one backpack item.

Stale revisions return the current saved state without applying the action,
including retries after a battle or a new run. Movement is paused while a battle
awaits acknowledgement. The server saves position, enemy removal, HP/MP, recovery,
and the exact playback in one atomic update. Clients cannot choose stats, battle
outcomes, rewards, enemy positions, or floors. Chest opening and its inventory
grant commit in one database transaction; item use and its new revision do too.
These actions cannot award or consume twice when retried. Adventure battle
results stay private. Inventory changes use the existing `pet:updated` WebSocket
event so Care & shop and other open windows stay current.
