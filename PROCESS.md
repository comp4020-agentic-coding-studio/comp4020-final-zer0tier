# Process overview

## From the brief to VirtuePets

The brief asks for a multi-user, real-time website that's good. I started from a
game I already knew was worth coming back to: QQ Pets, where you raise a pet
beside everyone else's. My definition of good (in [README.md](README.md)) is
that the game is **interactable with the other people playing it**: other
players are really there, you see them act as it happens, nothing you do is
lost, and interacting is fair. That definition decided what to build first.
Every feature is something one pet does that another player can see or be
affected by: studying, working, shopping, then fights in a shared Arena, then
accounts so each person has exactly one pet that only they control.

I built it with Claude Code as the agent, one feature per request, and I set
the order: style first, then school levels, stamina and hygiene, work
locations, timed lessons and shifts, the Arena and fights, an hourglass to
skip waits, and accounts. When a request left a real choice open, the agent
asked rather than guessed, and those answers are mine: recovery comes from
food and soap bought in a shop (not rest or regeneration), activities are
refused when the pet is too tired or dirty, pay scales linearly with shift
length, the test clock is sped up in CI, and the hourglass costs $150.

## Stack, and why

The stack was fixed in [CLAUDE.md](CLAUDE.md) before any code: Node 24 running
TypeScript directly, Express 5, `ws` for WebSockets, `node:sqlite` as the only
datastore, and plain HTML/CSS/JS with no framework. The course gives one Fly
machine with 256 MB and one volume, and every choice follows from that:

- **One process, one SQLite file on the volume.** It fits the memory, survives
  restarts and redeploys, and because `DatabaseSync` is synchronous in a single
  process, reading a pet, changing it and writing it back can't interleave with
  another request. That made game rules (costs, refusals, fights between two
  pets) simple to get right. The cost is that it can't scale past one machine,
  which a game for a room of friends never needs.
- **WebSockets for server-to-client only.** Players act over HTTP; the socket
  only carries `pet:updated` and `fight:finished`. Clients never update
  themselves optimistically; they render what the server broadcasts, so every
  window agrees with the database.
- **No build step or frontend framework.** Less to break and less to fit in
  256 MB. The cost is hand-written DOM code in `public/app.js`, which is now
  the largest file and the first thing I'd reconsider if the UI grows.
- **Timed activities on a stored clock.** A lesson or shift records when it
  ends in the database, and a timer finishes it on time; timers are rebuilt
  from the database at boot, so the in-memory timer is never the only copy. I
  checked this by killing the server mid-shift: the shift still finished and
  paid.
- **Accounts with built-in crypto.** scrypt-hashed passwords and session tokens
  stored only as hashes, using `node:crypto` rather than adding a dependency.

## The harness: rules, checks and corrections

CLAUDE.md holds the rules every change must meet: parameterised SQL only, the
database as the source of truth, and every real-time event tested with real
WebSockets within one second. `spec/` holds the checks: 63 tests that run
against the running app, covering accounts and ownership, school, care, work,
time, fights and real-time delivery. A change was done only when `pnpm check`
was green, and every task since [`cc1eb4c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/cc1eb4c)
ends in its own commit.

My main correction loop was asking the agent to review its own work with the
code-review skill, then checking each finding before fixing it. When I tested
the game myself, I found problems the tests hadn't: 15-minute shifts finishing
instantly, and new players missing from the Arena. Where I could, the fix
landed in the harness rather than as a retry:

- A review found that one malformed WebSocket frame crashed the server; I had
  the agent reproduce it before fixing, and a spec now sends that frame.
- Lessons that take real time made the spec untestable, so the app gained a
  `TIME_SCALE` setting and CLAUDE.md's "checking your work" section changed to
  run the spec on a fast clock (CI runs the image the same way).
- The instant shifts turned out to be my local server running on that fast
  clock, so tests now run on a separate server and database, and shifts gained
  a progress bar.
- A flaky Arena test led to finding that WSL's clock jumps backwards; ordering
  moved off timestamps in [`cc1eb4c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/cc1eb4c),
  and in [`204a74b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/204a74b)
  timers finish activities on time despite a jump, shown by simulating the
  jump against the old and new code.
- Reviewing accounts in [`7302cb8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/7302cb8)
  found tests racing the fast clock, unlimited password guessing, and a tab
  stuck after switching accounts; each fix came with a test where one was
  possible.

## What the history shows, honestly

The history doesn't fully grow with the work. Everything up to fights went in
as one commit, [`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f),
because I didn't commit as I went. Once I noticed, I told the agent to commit
after every task, and the range
[`fbda12f...d1846cf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/compare/fbda12f...d1846cf)
shows that: one focused commit per feature or fix, each describing what changed
and why. The first README definition of good is
[`d1846cf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/d1846cf).

## Next

Before the next crit: read and cite writing on the small web and games for a
handful of friends, and revise the definition of good against it; play it with
other people to judge the parts the spec can't check (pacing, prices, whether
the Arena is more fun with a room full of people); and decide whether trading
or recruiting pets is the next interaction worth building.
