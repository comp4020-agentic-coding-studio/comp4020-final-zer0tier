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

## Next

Read and cite writing on the small web and games for a handful of friends, and
revise the definition of good against it; play with other people to judge what
the spec can't (pacing, prices, whether the Arena is better with a full room);
and decide whether trading or recruiting pets is the next interaction to build.
