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

**Good means friends can really play with each other in real time, rather than
just interact through some simple clicks.** A virtual pet you raise alone is
just a to-do list, and a "like" button on someone else's pet isn't much better.
Keeping people engaged in a game together is a better way to socialise, so
VirtuePets grew from a pet game into Pokémon-like play with friends, live:

- **Pokémon-like fights in the Adventure.** Up to four friends set off on one
  shared woodland map and fight its monsters together, turn by turn. Each
  player picks their own pet's skill every turn.
  *Enforced:* `spec/team.test.ts`, `spec/combat-turns.test.ts` (every human
  turn waits for its owner's choice).
- **Fighting each other in the Arena.** Challenge an online player and both of
  you choose skills turn by turn, while anyone else can watch from the stands.
  *Enforced:* `spec/manual-battles.test.ts`, `spec/watch.test.ts` (each turn
  reaches both fighters and the audience within a second, and nobody else).
- **Visiting other people's houses.** Walk into a friend's home, whether
  they're in or not, and see each other move there live. Play with their pet,
  feed it, give it a gift, or leave a note, always as your own pet: a visitor
  can help, but never use up or harm what someone else owns. *Enforced:*
  `spec/world-realtime.test.ts`, `spec/touch.test.ts`, `spec/help.test.ts`.

Every change reaches every open window within a second (`spec/realtime.test.ts`),
and nothing is lost: pets and fights live in SQLite on the Fly volume.
*Checked by hand:* I killed the server mid-shift; it still finished and paid.

Some of "good" can only be judged by playing, not by `spec/`: whether a
turn-based fight with a friend is more fun than one against the bot, and
whether the Arena feels alive with a room full of people — the capstone
showcase this is built for.

**What I chose not to build (yet):** chat and trading. Both are more clicks
between people rather than playing together, and both would need moderating.
Guestbook notes use fixed phrases instead, and a gift moves only your own
things, so it can never be a lopsided trade.

**What I read or looked at:**

- Robin Sloan,
  ["An app can be a home-cooked meal"](https://www.robinsloan.com/notes/home-cooked-app/)
  (2020). He built a messaging app for just his family, never meant to scale.
  It convinced me software doesn't need to serve thousands of strangers like an
  industrial restaurant: VirtuePets is for a room of friends, so it runs on one
  small machine with one database file.
- Daniel Cook et al.,
  ["Kind Games: Designing for Prosocial Multiplayer"](https://lostgarden.com/2023/07/08/kind-games-designing-for-prosocial-multiplayer/)
  (2023). Shallow gifting is "a low social energy transactional exchange",
  while friends who play together keep coming back: why VirtuePets became
  Pokémon-like play rather than a pet you click.
- Clay Shirky,
  ["Situated Software"](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
  (2004). Software for a small group works when it shows the group to itself.
  It pushed me to keep everything in sync: every change reaches every open
  window live, and the Arena shows who else is playing.
- QQ Pets (Tencent, 2005), the game this one is modelled on, and the
  [Final Project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).

Music by Kevin MacLeod (CC BY 4.0): see [CREDITS.md](CREDITS.md) for every outside asset and its licence.
