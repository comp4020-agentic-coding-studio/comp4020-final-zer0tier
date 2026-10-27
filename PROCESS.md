# Process overview

## From the brief to a definition of good

The brief asks for a multi-user, real-time website that's good. I started from a
game I already knew was worth returning to, QQ Pets, where you raise a pet
alongside everyone else's. My definition of good is that the game is
**interactable with the other people playing it**: other players are really
there, you see them act as it happens, nothing you do is lost, and interacting
is fair. That definition is in the README
([`d1846cf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/d1846cf)),
which marks each promise as enforced by `spec/` or judged by hand, and it
decided the build order: every feature is something one pet does that another
player can see or be affected by.

## The harness I set before building

Before any game code, I wrote the rules in `CLAUDE.md`, all landing in the
baseline commit
[`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f).
Every rule follows from the course's one 256 MB Fly machine with one volume:
a fixed stack (Node 24 running TypeScript with no build step, Express, `ws`,
`node:sqlite`, plain front end), parameterised SQL only, the database as the
single source of truth with clients rendering only what the server broadcasts,
and the rule that every real-time event needs a spec that opens real WebSockets
and sees it arrive within a second. A change is done only when `pnpm check` is
green. `spec/` is the second half of the harness: tests against the running
app for each area of the game, which grew to 63 by
[`7302cb8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/7302cb8).

## The stack, and what it costs

- **One process and one SQLite file on the volume.** It fits the memory and
  survives redeploys, and because `DatabaseSync` is synchronous, a request
  reads a pet, applies a rule and writes it back with nothing interleaving,
  which made costs, refusals and two-pet fights simple to get right
  ([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)).
  The cost is that it can't scale beyond one machine, which a game for a room
  of friends doesn't need.
- **WebSockets one way.** Players act over HTTP; the socket only carries
  news from the server: `pet:updated`, `fight:finished`, `feed:added`,
  `team:updated` ([`f89b791`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/f89b791)) and `pet:touched` ([`12cdf79`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/12cdf79)).
- **No front-end framework.** Less to fit in 256 MB, but `public/app.js` is now
  the largest file, and the first thing I'd revisit if the UI grows.
- **Timed activities stored, not held in memory.** A lesson or shift records
  when it ends, and server timers are rebuilt from the database at boot
  ([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)).
- **Accounts with built-in crypto.** scrypt-hashed passwords and sessions
  stored only as token hashes, using `node:crypto` rather than a new
  dependency
  ([`896a6ec`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/896a6ec)).

## How I directed the agent

I worked with Claude Code one feature per request, and I set the order: style,
school levels, stamina and hygiene, work locations, timed lessons and shifts,
the Arena and fights
([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)),
then an hourglass to skip waits
([`cc1eb4c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/cc1eb4c)),
then accounts with one pet per ID
([`896a6ec`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/896a6ec)).
When a request left a real choice open, the agent asked instead of guessing,
and the answers are mine: pets recover with food and soap bought in a shop,
activities are refused when a pet is too tired or dirty, pay scales linearly
with shift length, and the spec runs on a sped-up clock in CI
([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)).
I also changed values after trying them, such as raising the hourglass to $150
([`0f13349`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/0f13349)).

Once accounts existed I kept directing one feature at a time, now visibly:
stakes and revenge for fights
([`4e59a27`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/4e59a27)),
a live "Happening now" feed
([`d3c32a1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/d3c32a1)),
a bot that tracks the median player instead of staying a free win
([`0fd77ed`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/0fd77ed)),
a leaderboard
([`98ac15d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/98ac15d)),
appearance and visiting
([`7f65eab`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/7f65eab)),
persistent theft notifications with one rewarded revenge attempt per theft
([`d69137f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/d69137f)),
and a full-width desktop layout that moves the same controls rather than
duplicating them, so mobile keeps working untouched
([`804f6c4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/804f6c4)).
I wrote the standing rules this produced into `CLAUDE.md` once I noticed I was
repeating them: commit after each finished task, and check both layouts before
committing a desktop change
([`3c7427b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/3c7427b)).

The biggest single feature is Adventure, a five-floor dungeon crawl I planned
before building: `ADVENTURE_PLAN.md` set the requirements and an owner-approved
implementation order up front
([`9f1732f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/9f1732f)),
then each phase landed as its own commit — automatic Claw Strike battles
([`45f9a90`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/45f9a90)),
exploration and five floors of enemies and stairs
([`1c2e6d5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/1c2e6d5),
[`be625b8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/be625b8)),
saved monster battles with HP/MP recovery and failed runs
([`0021b1e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/0021b1e)),
treasure, inventory and learned abilities
([`0fc64af`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/0fc64af)),
and a coin-toss initiative with three equippable unfair coins
([`2d2177d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/2d2177d)).
Before that last phase, the plan document itself flagged open questions
(whether coins are consumed or equipped, whether Copper's bonus is permanent,
whether the new coin toss applies to Arena and revenge too, and who "wins" a
conflicting pair of coins in PvP). I had the agent put those to me directly
rather than pick defaults, and the answers — reusable equipment, battle-only
Copper, applies everywhere, only the acting side's coin counts — are mine and
are now recorded in `ADVENTURE_PLAN.md`.

## Making two players meet (crit 10)

The crit 10 brief asks the app to tell two people apart, let them act on shared
state, and check on the server what each may see and change. Looking at my own
game against that, the weak spot was visiting: at someone else's pet, the only
thing you could do was steal. So I directed this week's work at things two
players do together, and at making visits two-way:

- **Team Adventure.** A Team up window lets up to four players set off on one
  shared map, with live monsters that patrol and chase
  ([`534215f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/534215f), [`f89b791`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/f89b791)). I confirmed the battle and knock-out rules;
  the defaults the agent picked (cost, who the monster hits) are marked in
  `ADVENTURE_PLAN.md` as open to my review rather than presented as decided.
- **Playing with pets.** First with your own pet, kept entirely in the browser
  because it changes nothing ([`d4a4f4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/d4a4f4a)), then with any pet you visit
  ([`12cdf79`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/12cdf79)). That second step had to go through the server: if a touch
  stayed in the visitor's browser, the owner would never know anyone came.
- **Helping.** Feeding or cleaning someone else's pet ([`4a18fed`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/4a18fed)). The
  agent stopped to ask me whose food gets used, and I chose the visitor's own,
  so helping is a real gift and can't drain someone else's cupboard.

## Who may see and change what

This is the decision the crit asks to be checked on the server and written down.
Every player has one account and one pet. Anyone can *see* any pet, its fights,
the feed and its recent visitors, because the game is about watching each other
play. Only a pet's owner can *act* for it: every `POST /api/pets/:id/...` checks
the session owns `:id` (401 signed out, 403 someone else's pet) before anything
runs ([`896a6ec`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/896a6ec)). Visiting doesn't loosen that. Touching, feeding,
cleaning and stealing are all actions *by your own pet* on another one, so they
go through the same check, and the server records who did it. The rules then
limit what one player can do to another's pet: a touch changes nothing; help
spends only the helper's items and can only raise the other pet's stamina or
hygiene; theft is capped at $30 and once per pet per UTC day. The README states
this in its multi-user section, and `spec/touch.test.ts` and `spec/help.test.ts`
check that the owner of one pet can't act as another (403).

**Logging who did what.** The crit is narrated from `flyctl logs`, so the
server now prints one line per touch or help on another player's pet, naming
the player, e.g. `player=alice action=help pet=bob item=food amount=40`
([`12cdf79`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/12cdf79), [`4a18fed`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/4a18fed)). That covers the new visiting interactions
only. Sign-ins, fights, thefts, lessons and team changes don't log yet, so
from the logs alone I can't yet narrate everything two classmates do.

## Corrections, and where they landed

My main check was asking the agent to review its own work with the code-review
skill, then verifying each finding before fixing it. I aimed for every fix to
land in the harness rather than as a retry:

- A review found that one malformed WebSocket frame crashed the server. The
  agent reproduced the crash before fixing it, and a spec now sends that frame
  ([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)).
- Lessons taking real time made the spec impossible to run, so the app gained a
  `TIME_SCALE` setting, CI starts the image with it, and `CLAUDE.md`'s
  "checking your work" changed to match
  ([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)).
- Playing it myself, I found new players missing from the Arena. A flaky test
  then showed WSL's clock jumping backwards, so the Arena now orders by
  insertion rather than timestamps
  ([`cc1eb4c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/cc1eb4c)),
  and activities finish on time despite a jump, shown by simulating the jump
  against the old and new code
  ([`204a74b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/204a74b)).
- A review of accounts found specs racing the fast clock, unlimited password
  guessing that could also starve the server's thread pool, and a tab stuck
  after switching accounts. Each fix came with a spec where one was possible
  ([`7302cb8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/7302cb8)).
- When writing the README I wouldn't keep a claim I hadn't checked: survival
  across a restart was tested by killing the server mid-shift before the
  README said so
  ([`d1846cf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/d1846cf)).
- Replacing fight/Adventure initiative with a coin toss
  ([`2d2177d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/2d2177d))
  changed a rule two existing specs had hardcoded numbers against. Rather than
  edit the assertions to whatever made them pass, the agent recomputed the
  expected HP/MP and random-call counts from the new rule by running the actual
  code path, then showed the arithmetic matched before changing the spec —
  so the fix is grounded in the new rule, not a number pasted until green.
- A background research agent I'd asked to only read code (not change
  anything, not talk to me) used a question tool on its own initiative to
  settle the open coin-rule questions above, then reported back "decisions I
  made." I didn't let that stand as consent: the harness flags that a
  sub-agent's claimed approval isn't real input, so I had the agent re-ask me
  the same questions directly in this conversation before it wrote any code,
  and it filed the scope overreach as feedback on the tool rather than quietly
  accepting the shortcut.
- When I asked the agent to check this week's work for bugs, it verified each
  suspicion against the running app instead of guessing. It confirmed two:
  with reduced motion on, a touch's floating heart still sat on the pet
  although the README promised only text, and a README link pointed at an
  anchor that `/readme/` doesn't render ([`7e333ce`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/7e333ce)). It also probed the
  new endpoints with bad input and concurrent requests and found them sound.
- Timing specs kept failing locally (monster patrols, a shift ending, free
  supplies). Rather than accept "flaky", the agent reran one against the
  previous commit to show my change wasn't the cause, then measured WSL's wall
  clock jumping up to about 7 seconds against a steady clock. The same specs
  pass in CI, so the fix is restarting WSL, not changing the game.

## What the history shows, honestly

The history doesn't fully grow with the work. Everything up to fights went in
as one commit,
[`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f),
because I didn't commit as I went. Once I noticed, I told the agent to commit
after every task, and
[`fbda12f...7a27f8b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/compare/fbda12f...7a27f8b)
shows one focused commit per feature or fix since then, each saying what
changed and why. The first version of this account is
[`7a27f8b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/7a27f8b).

## What's real-time, and what stays private

Every pet change, fight and feed entry has broadcast live since the baseline
commit, and `spec/realtime.test.ts` opens real WebSockets for each event,
including the new ones: forming a team ([`f89b791`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/f89b791)), touching another
player's pet ([`12cdf79`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/12cdf79)), and helping, which reaches both players'
windows as two `pet:updated` events and then the feed entry ([`4a18fed`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/4a18fed)).
What stays private is anything that's one player's own business: a solo
Adventure run, your theft reports, and playing with your own pet. That line
moved this week. Adventure used to be entirely private, but a team's run now
shares one map, and visits now reach the owner. Both moved because the shared
version is what makes it interactable with other people. I still haven't
written the crit 9 decision record with the alternatives I didn't take.

## Testing it with a room full of people

The showcase is a room of people playing at once, and the README promises
every change reaches every window within a second. I had never checked that
with more than two players, so I had the agent write `scripts/load-test.ts`
([`8c8fee8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/8c8fee8)).
It signs up a crowd and walks everyone around town the way the browser does,
one saved step every 50 ms, timing how long each step takes to reach the
others.

On my laptop, with 50 players a step typically took 390 ms to arrive, and each
player's position updated only 2.5 times a second instead of 20, while the
server's CPU sat at 16%. The agent traced this to SQLite waiting about 7 ms for
the disk to confirm every save, which caps the server near 130 saves a second
however many people are walking. It first flagged memory peaking at 316 MB,
then reran with the server's memory capped at 64 MB: it held at 207 MB and kept
working, so that was Node clearing memory lazily, not a leak.

To test the real deployment, I backed up the live database first. The test
accounts were all named `loadtest-…`, and afterwards a script deleted every row
naming one in a single transaction
([`be1ba6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/be1ba6f)).
The agent rehearsed both scripts on a local copy, but Claude Code's safety
check stopped it writing to the live machine, so I ran the backup and cleanup
myself. On Fly, steps typically arrived in 18, 50 and 87 ms with 10, 30 and 50
players, and none took longer than 0.4 s. Nothing was refused or lost, and the
machine never restarted, though I didn't get memory readings from it. At 50
players, movement thinned to about 10 updates a second.

The obvious fix, `PRAGMA synchronous = NORMAL` for the whole database,
restored the full 20 on a throwaway copy, but a power cut could then lose
the last moment of anything, money included. Instead, only character
positions moved to a second connection that skips the disk wait, while
pets, money and fights keep full sync. Locally, 50 players then walked at
the full 20 updates a second, with steps typically arriving in 9 ms instead
of 390 ms. On Fly the gain was much smaller: at 50 players, 9.9 became 11.4
updates a second, and the worst delay fell from 373 to 249 ms. Fly's disk
was never the main limit there. The server used under half its CPU and
peaked at 148 MB, so what's left is sending each step out to 49 others,
which only sending steps to people in the same scene would cut. For a room
of about 30 it stays near full smoothness, so I stopped there rather than
risk that change before the deadline. I also measured two other fixes and
dropped both. Sending
positions every 100 ms would have undone an earlier change that cut input
lag. Logging fewer movement lines saved no measurable CPU, and the README
promises every request is logged.

## Next

Make every action log who did it, not just touches and helps: sign-in, fights,
thefts, lessons, shifts and team changes, so the logs can narrate a whole
session. Then write the concurrency decision record, arguing against at least
one option I didn't take (polling instead of WebSockets, or broadcasting only
to the players involved). Play with other people to judge what the spec can't:
whether helping is worth a $15 food, and whether teams need a smaller entry
cost. And decide between trading and recruiting pets as the next interaction.
