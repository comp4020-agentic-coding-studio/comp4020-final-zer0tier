# ADR 2: WebSockets carry server news; players act over HTTP

**Status:** accepted · **Context commits:** [`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f), [`eb841e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/eb841e4)

## Context

The brief leaves real-time delivery open: WebSockets, server-sent events, or
"polling fast enough", as long as a change reaches every open session within
about a second. VirtuePets has to deliver three kinds of news, on one
256 MB machine:

- **Pet and fight changes** (`pet:updated`, `battle:updated`, `feed:added`):
  rare per player, but they must arrive fast, because a turn-based fight
  between friends feels broken if the other player's move is late.
- **Walking**, up to 20 saved steps a second per moving player
  (`world:updated`), to everyone in the same room.
- **Presence**: who is online right now, which decides whether you can
  challenge someone and whether a recruited ally must be offline.

## Options

- **Polling.** The simplest server, but every open window asks again and
  again whether anything changed. To show a step within a second it must ask
  at least once a second, and walking needs 20; nearly every answer is
  "nothing new". I had polling once, for live battles: each browser re-read
  its battle every second. Replacing it with the broadcast the server already
  sent ([`eb841e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/eb841e4))
  kept each move arriving in about 0.4 s while an idle battle went from 10
  requests per 10 s to 1.
- **Server-sent events.** One-way, server to browser, which is all the news
  needs, over plain HTTP. But presence is the hard part: a live connection
  that the server can ping (`ws` heartbeats every 10 s) tells it reliably when
  a player has really gone, so a closed tab stops their walking and takes them
  out of the stands. With SSE that needs extra bookkeeping. And `ws` is a
  small, well-known dependency I already understood.
- **WebSockets both ways** (players also act over the socket). Fewer
  requests, but every action would need its own message protocol, and HTTP
  already gives each action a status code, the session cookie check, and a
  request log line.

## Decision

WebSockets, one way. Players act over HTTP, where the session is checked and
every request is logged; the server saves the change first, then broadcasts
the row as read back from the database. The socket only carries news. Each
window renders only what a broadcast says, so two windows can't disagree.
`CLAUDE.md` makes it a rule (rules 2–4), and every event has a spec that opens
real WebSockets and fails if it takes more than a second.

## Consequences

A dropped event would leave a window stale, so each window re-reads its state
on reconnecting, and a live battle also re-reads every 10 s as a backstop.
The load test ([ADR 1](0001-walking-positions-skip-disk-wait.md)) found the
cost at scale is sending every step to everyone; sending steps only to players
in the same scene would cut it, and is left for later.
