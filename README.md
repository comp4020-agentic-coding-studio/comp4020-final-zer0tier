# VirtuePets

A multiplayer virtual pet game inspired by QQ Pets. Create an account to claim
a pet, train it, send it to work, fight other players' pets, and watch every
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
  its owner can act for it, so a stranger can't train, spend or fight with
  yours. A player who joins while you're playing appears in your Arena straight
  away. *Enforced:* `spec/pets.test.ts` (one pet per ID, owner-only actions,
  401/403), `spec/fight.test.ts` (new pets listed after the bot).
- **You see each other act (real-time).** Every change to a pet, and every fight,
  reaches every open window within a second, with no reload: your rival's shift
  ending, their level-up, the fight they just started against you. *Enforced:*
  `spec/realtime.test.ts` opens real WebSockets and fails if any event takes
  longer than a second.
- **Nothing you did is lost (persists).** Pets, accounts, fights and unfinished
  lessons and shifts live in SQLite on the Fly volume, and a shift that was
  running when the server restarted still finishes and pays. *Enforced:* signing
  back in returns the same pet (`spec/pets.test.ts`). *Checked by hand:* survival
  across a restart, which the spec can't trigger. I killed the server halfway
  through a shift and started it again; the pet was still working, the shift
  finished and paid on time, and the player was still signed in.
- **Interacting is fair.** Fights are decided by published rules (power is
  2 × Strength + Intelligence + Charisma, with limited luck), so training shows
  in the results, and the bot `0` is a fair opponent nobody can control.
  *Enforced:* `spec/fight.test.ts` (a pet with 1.5× the power always wins; the
  bot can't be signed into).

Some of good can only be judged: whether waiting 30 minutes for a lesson feels
like anticipation or a chore, whether prices (a $150 hourglass) make choices
interesting, and whether the Arena is more fun with a room full of people, which
is the capstone showcase this is designed for. Those are tested by playing it
with others, not by `spec/`.

**What I chose not to build (yet):** chat, trading or gifting between pets,
recruiting other players' pets, and leaderboards. Each adds interaction, but the
first version proves the core loop (train, work, fight, see others do the same)
before widening it.

**What I read or looked at:** the
[Final Project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/)
(its multi-user, real-time and persists requirements are the backbone of this
definition), and QQ Pets (Tencent, 2005), the game this one is modelled on:
study for stats, work for money, care for your pet's needs, and share a world
with other players.

## Playing

**Create an account** with a player ID (letters, digits, `-` or `_`, up to 32
characters) and a password of at least 8 characters. Each ID has one account
and one pet, so an ID someone else has signed up with is taken. A new pet starts
with Strength 5, Intelligence 5, Charisma 5 and no money. **Sign in** with the
same ID and password to come back to it; you stay signed in on that browser for
30 days, or until you sign out. After 5 wrong passwords for an ID, sign-ins to
it from that address wait 15 minutes.

Anyone can look at any pet, but only its owner can study, work, shop or fight
with it. The bot's ID, `0`, can't be signed up or signed into. A pet from before
accounts existed is claimed by the first person to sign up with its ID.

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

Press **Fight** to attack another pet. Each pet's **power** is
2 × Strength + Intelligence + Charisma. Both sides roll their power times a
luck factor between 0.8 and 1.2, and the higher roll wins (a tie goes to the
defender). A pet with 1.5× its opponent's power always wins; close fights can go
either way. The winner gets a win and the loser a loss on their record.

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
  `use/:item` and `fight/:opponent`.
- **Reading** (anyone): `GET /api/pets` lists pets, `GET /api/pets/:id` shows
  one, `GET /api/pets/:id/fights` its recent fights, and `GET /api/rules` the
  schools, courses, work locations, items and costs.
- **Real time:** the server broadcasts a `pet:updated` event over the socket
  after every change, and a `fight:finished` event after each fight.
