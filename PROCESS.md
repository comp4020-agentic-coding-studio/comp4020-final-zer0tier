# Process overview

## From the brief to a definition of good

I started from a game I already knew was worth returning to, QQ Pets, where you
raise a pet alongside everyone else's. My first definition was that the game is
interactable with the other people playing it
([`d1846cf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/d1846cf)).
Building it sharpened that: a pat or a "like" is interaction too, but not much
of a game. Good now means **friends really play with each other in real time,
rather than just interact through some simple clicks**, which is why the
biggest features are turn-based fights with friends and walking into each
other's homes. The README marks each promise as
enforced by `spec/` or judged by hand, and I wouldn't keep a claim I hadn't
checked: survival across a restart went in only after I killed the server
mid-shift and watched the shift still pay.

## What I read, and my position

Robin Sloan's "An app can be a home-cooked meal" describes an app he built for
just his family, never meant to scale. I agree with him: software doesn't need
to be offered to thousands of strangers like an industrial restaurant. It can
be used by just friends, and then there's no need for a complex system. That
position decided the stack below: one process and one SQLite file on one small
machine, no database server, no framework, because a game for a room of friends
doesn't need to survive a million players. Where I went further than Sloan is
the game itself. Reading also convinced me that keeping people engaged in a
game is a better way for them to socialise than small, one-off clicks. So I
gave up making it a completely pet-like game: battles that once played
themselves
([`45f9a90`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/45f9a90))
became Pokémon-like fights, with monsters hiding in grass and every skill
chosen by hand
([`489051f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/489051f),
[`22068e9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/22068e9)).
The system stayed home-cooked, but the game grew, and each feature had to earn
its place by being something friends play *with* each other.

## The harness, and the stack it implies

Before any game code I wrote `CLAUDE.md`
([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)).
Every rule follows from one 256 MB Fly machine with one volume:

- **One process and one SQLite file.** `DatabaseSync` is synchronous, so a
  request reads a pet, applies a rule and writes it back with nothing
  interleaving, which made costs, refusals and two-pet fights simple to get
  right. The obvious alternative, Postgres, is a second Fly app outside the
  course setup; the cost is that this can't scale past one machine, which, as
  above, a game for a room of friends doesn't need.
- **WebSockets one way.** Players act over HTTP; the socket only carries news,
  and the database is the only source of truth. Clients never update
  optimistically, so two windows can't disagree.
- **No front-end framework or build step.** Less to fit in 256 MB, but
  `public/app.js` is now the largest file, the first thing I'd revisit.

The rule that carries the most weight is that every real-time event needs a
spec that opens real WebSockets and sees it arrive within a second. `spec/`
grew with each feature, and a change is done only when `pnpm check` is green.

## How I directed the agent

I worked with Claude Code one feature per request, in an order I set. When a
request left a real choice open, the agent asked instead of guessing, and the
answers are mine: pets recover with food and soap bought in a shop, a pet too
tired refuses work, and helping someone else's pet spends the visitor's own
food so it can't drain another player's cupboard
([`4a18fed`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/4a18fed)).
Adventure I planned first in `ADVENTURE_PLAN.md`
([`9f1732f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/9f1732f)).

For crit 10, the weak spot was visiting: at someone else's pet, the only thing
you could do was steal. So I directed the work at things two players do
together: team runs on one shared map
([`534215f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/534215f)),
touching a visited pet through the server so its owner knows someone came
([`12cdf79`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/12cdf79)),
then gifts and watching live fights. The last week followed the same test:
friends lists
([`f8c4c9b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/f8c4c9b))
and a weekly town goal where every pet fed counts for the whole town
([`9daa5be`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/9daa5be)).
Needs that drop while you're away went in **switched off**
([`0d639e8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/0d639e8)):
it changes balance for every player, so it waits for a play-test rather than
shipping on a guess.

## Corrections, and where they landed

I aimed for every fix to land in the harness rather than as a retry:

- A review found one malformed WebSocket frame crashed the server. The agent
  reproduced the crash first, and a spec now sends that frame
  ([`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f)).
- New players went missing from the Arena. A flaky test showed WSL's clock
  jumping backwards, so the Arena orders by insertion, and activities finish on
  time despite a jump, shown by simulating it against old and new code
  ([`204a74b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/204a74b)).
- Several new tests passed without testing anything: their checks sat inside
  `if` branches that never ran. Rewriting them to fail when the behaviour is
  wrong exposed two setup mistakes
  ([`bccd0d1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/bccd0d1)).
- For a recruited ally I first chose 10% of a run's money. The agent showed
  that's $0 on almost every run and asked again; I chose $2 a win, and the
  `CLAUDE.md` rule it broke was rewritten to name the exception rather than
  bent quietly
  ([`bccd0d1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/bccd0d1)).
- A review found ten problems in a week's features. For the worst two, an ally
  winning alone after its recruiter forfeited, the agent undid each fix to show
  the new spec fails, then put it back
  ([`8aafd31`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/8aafd31)).

## Testing with a room full of people

The showcase is a room playing at once, so I load-tested it on Fly, after
backing up the live database
([`8c8fee8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/8c8fee8)).
Saves were capped by SQLite waiting on the disk. The obvious fix, relaxed sync
for the whole database, could lose money in a power cut, so only walking
positions skip the wait. The measurements and the two fixes I dropped are in
[ADR 1](docs/adr/0001-walking-positions-skip-disk-wait.md).

## What the history shows, honestly

Everything up to fights went in as one commit,
[`fbda12f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/commit/fbda12f),
because I didn't commit as I went. Once I noticed, I told the agent to commit
after every task, and
[`fbda12f...7a27f8b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/compare/fbda12f...7a27f8b)
shows one focused commit per change since. The README itself grew to 17,000
words of rules before I split it: the argument stays in `README.md`, and every
rule and the API moved to `docs/GUIDE.md`.

## Next

Play-test what the spec can't judge: whether coming back to a hungrier pet is a
reason to return or a chore (switch `NEEDS_DECAY=on`), and whether 100 meals is
a week's stretch for the real player count.
