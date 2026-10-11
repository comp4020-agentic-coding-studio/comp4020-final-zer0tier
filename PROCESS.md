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
  `pet:updated` and `fight:finished`.
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

## What's real-time, and what isn't yet decided

Every pet change, fight and feed entry has broadcast live since the baseline
commit; that hasn't changed as the game has grown; `spec/realtime.test.ts` now
covers each new event (appearance, revenge, equipping a coin) the same way.
Adventure is the one exception by design: it's one player exploring, so its
state is private and never goes out over the socket. That split — what's
shared live and what stays per-player — is itself the kind of concurrency
decision crit 9 asks for, but I haven't yet written it up as a decision record
with the alternatives I didn't take, which is this week's remaining work.

## Next

Write the crit 9 architecture decision record on concurrent use, arguing
against at least one option I didn't pick. Read and cite writing on the small
web and games for a handful of friends, and revise the definition of good
against it; play with other people to judge what the spec can't (pacing,
prices, whether the Arena is better with a full room, whether Adventure needs
an entry cost); and decide whether trading or recruiting pets is the next
interaction to build.
