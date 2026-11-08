# ADR 1: Save walking positions without waiting for the disk

**Status:** accepted · **Context commits:** [`8c8fee8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/8c8fee8), [`be1ba6f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/be1ba6f)

## Context

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

## Decision

Character positions use their own SQLite connection with
`synchronous = NORMAL`; pets, money and fights stay on the default full sync.

## Consequences

A power cut can lose the last moment of where a character was walking, and
nothing else. Scene-scoped broadcasting, the remaining cost at 50 players, is
left for later.
