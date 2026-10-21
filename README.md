# VirtuePets

A multiplayer virtual pet game, inspired by QQ Pets. Create an account to
claim a pet. Train it, send it to work, fight, or visit other players' pets.
Every change shows up live in every open window.

## What good means

**Good means the game is interactable with the other people playing it.** A
virtual pet you raise alone is just a to-do list. QQ Pets was worth coming
back to because your pet lived beside everyone else's. So VirtuePets is good
when what you do reaches other players, what they do reaches you, and none of
it is lost. Those are the final project's three fixed requirements, read as
the point of the game, not boxes to tick:

- **Other people are really there (multi-user).** Each player has one
  account and one pet. Anyone can look at any pet in the Arena. Only its
  owner can act for it, so a stranger can't train, shop, or fight with your
  pet. A player who joins while you're playing shows up in your Arena right
  away. Visiting is how players reach each other's pets: you can play with
  (touch), feed, clean, or steal from a pet you visit, but always *as your
  own pet*. The server checks your session owns the acting pet, and records
  who did it. A touch changes nothing, so anyone may do it to any pet.
  Feeding and cleaning spend only *your* food or soap, and can only raise the
  other pet's stamina or hygiene. A visitor can help, but never use up or
  harm what someone else owns. Owners see who came by, and the server logs
  each touch and help by player.
  *Enforced:* `spec/pets.test.ts` (one pet per ID, owner-only actions,
  401/403), `spec/touch.test.ts` (touching only as your own pet, never your
  own pet, and changing nothing else), `spec/help.test.ts` (helping only as
  your own pet, from your own cupboard, exactly once), `spec/fight.test.ts`
  (new pets listed after the bot).
- **You see each other act (real-time).** Every change to a pet, and every
  fight, reaches every open window within a second — no reload needed. Your
  rival's shift ending, their level-up, the fight they just started against
  you: all of it. The Arena's **Happening now** list shows the whole room
  what everyone else is doing. Adventure is the deliberate exception: it's
  one player's own exploration, so its state is never broadcast to anyone
  else's window.
  *Enforced:* `spec/realtime.test.ts` opens real WebSockets and fails if any
  event takes longer than a second; `spec/feed.test.ts` checks what the feed
  records.
- **Nothing you did is lost (persists).** Pets, accounts, fights, and
  unfinished lessons and shifts all live in SQLite on the Fly volume. A shift
  still running when the server restarts still finishes and pays.
  *Enforced:* signing back in returns the same pet (`spec/pets.test.ts`).
  *Checked by hand:* survival across a restart, which the spec can't
  trigger. I killed the server halfway through a shift and started it again.
  The pet was still working, the shift finished and paid on time, and the
  player was still signed in.
- **Interacting is fair.** Fights follow published rules (power is
  2 × Strength + Intelligence + Charisma, with limited luck), so training
  shows in the results. The bot `0` is a fair opponent nobody can control: it
  keeps pace with the median player, so it never becomes a free win. Fights
  have stakes — the winner takes some of the loser's money — but a strong
  pet can't drain a weak one. It must wait an hour before attacking the same
  pet again, while the pet it attacked can hit back straight away.
  *Enforced:* `spec/fight.test.ts` (stronger claws win the tested matchups;
  the bot can't be signed into; spoils, the cooldown, and revenge). *Checked
  by hand:* the bot tracking the median, which the shared spec database
  can't pin down. On a fresh database with pets at 7/5/5, 6/6/5, and 5/5/5
  (Strength / Intelligence / Charisma), the bot moved to 6/5/5 and every
  window heard it.

Some of "good" can only be judged by playing, not by `spec/`: whether waiting
30 minutes for a lesson feels like anticipation or a chore, whether prices (a
$150 hourglass) make choices interesting, and whether the Arena is more fun
with a room full of people — the capstone showcase this is built for.

**What I chose not to build (yet):** chat, trading, or giving items to other
players outright. You can feed or clean their pet with your own food or
soap, but not hand it over. Recruiting other players' pets is also still to
come. Each would add interaction, but the first version proves the core loop
— train, work, fight, see others do the same — before widening it.

**What I read or looked at:**

- Clay Shirky,
  ["Situated Software"](https://gwern.net/doc/technology/2004-03-30-shirky-situatedsoftware.html)
  (2004). Software for a small group works when it shows the group to itself
  ("What does everyone else think?") and doesn't rely on people checking
  back. It pushed me to keep everything in sync and make it easy for players
  to interact: every change reaches every open window live, and the Arena
  shows who else is playing.
- The
  [Final Project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/):
  its multi-user, real-time, and persists requirements are the backbone of
  this definition.
- QQ Pets (Tencent, 2005), the game this one is modelled on: study for
  stats, work for money, care for your pet's needs, and share a world with
  other players.

## Playing

Your pet lives in **Sweet Home**, a furnished room with a television,
couch, pet house, fireplace, food bowl, bath, and storage chest. Home and town
fill the screen, with a camera that follows you and a small movement and
interaction tip in the upper-left corner. Walk with **W/A/S/D** or the
**arrow keys**, then press **Space**
near your pet or a piece of furniture to interact. The nearby object that
Space will interact with gets a thin outline matching its shape; your pet gets
a small ring at its feet. These static highlights follow your position
and disappear when you move out of range or open a window. You can also
click or tap an empty spot to walk there, or select an object directly. Clicked routes
continue smoothly around furniture and your pet, and walking keeps the same
speed across display refresh rates. Movement pauses while a window is open
or you are typing. Home and town work on desktop and phones. Menus, windows,
and controls share the sign-in screen's warm orange and cream palette,
rounded shapes, typefaces, and light or dark appearance.

Your character shares the town's illustrated style and turns to face the
direction you walk, with a steady facing direction during diagonal steps.
Alternating footsteps and arm swings animate movement, with gentle breathing
and blinking while you stand still. Character animation
pauses while a window is open or the game is in the background; reduced-motion
settings turn off these decorative animations.

The room and town have gentle environmental animation: the fireplace flickers,
the TV shows a moving landscape, bath water ripples, and the river and fountain
flow. These effects also pause while a window is open or the game is in the
background, and stay still with reduced-motion settings.

Touch your pet or interact with its rug to open a small pop-up showing its
needs, attributes, money, and current lesson or shift. Choose a care or play
interaction there and see its response, with the room still visible behind it.
Use the food bowl to feed it and the bath to clean it. The pet house opens
**Appearance**, the chest opens your **Backpack**, and the television opens
the **Journal**. The wall clock opens game help and **Sign out**. Step through
the front door to visit town.

The town shares home's warm illustrated style, with tiled roofs, timber
shopfronts, leafy gardens, a stone fountain, and a riverside footbridge.
The garden fences block movement; use the front opening or walk around the rails.
Destinations include **Shops**, **Adventure**, **Arena**, **Part-time Jobs**, and
**School**. Walk near a building to see its outline, then press **Space**,
or click or tap the building to open its activities. **Sweet Home**
returns you to your pet. Your **Backpack** holds supplies, learned abilities, and
Unfair Coins. At home's storage chest, choose **Battle skills** to equip
learned moves before heading out. The **Journal** keeps recent visitors, activity, fight
history, and saved theft reports with revenge options. Press **Escape** in
either scene to open the game menu for your pet's details, Backpack,
Journal, Appearance, help, and Sign out. Pet details open in a compact window;
head home to feed, clean, and play with your pet.

While your pet works or studies, the town map shows a compact activity bar in
the upper-right corner with its current task, percentage completed, and time
remaining. It stays accurate when you return to town and disappears when the
activity finishes or you use an Hourglass. The final minute counts down in
seconds; “finishing…” means the timer has ended and the server is confirming
the result. The indicator stays out of the home scene.

An original, gentle instrumental soundtrack plays in the background while you
are signed in, starting after a click, tap, or key press. Open the game menu
with **Escape** (or the home menu hotspot on touch screens) for **Background
music** and its **Volume** slider. These preferences are remembered on this
browser. Music continues across scenes and windows, pauses when you switch tabs,
and stops when you sign out. The recording is served locally; it needs no music
service or extra runtime synthesis.

Town uses the same movement and **Space** interaction controls as home.
Every destination and home object also works with Tab and Enter, and the
camera brings focused objects into view. Close a window with its Close
button or Escape to return to the scene. Movement keys work immediately when
focus returns to a building or home object. Walking around home and town costs
nothing; lessons, work, battles, and adventures keep their usual rules.

**Create an account** with a player ID (letters, digits, `-` or `_`, up to
32 characters) and a password of at least 8 characters. Each ID has one
account and one pet, so an ID someone else has taken is gone. A new pet
starts with Strength 5, Intelligence 5, Charisma 5, and no money. **Sign in**
with the same ID and password to come back to it. Opening or refreshing the
game page always asks for a fresh login — even in a new tab, since tabs
share a session. Your pet and progress are saved. After 5 wrong passwords
for an ID, sign-ins to it from that address wait 15 minutes.

The sign-in page keeps the player ID, password, and **Sign in** button together.
Use **Create account** below the form to register; ID and password requirements
appear only when creating an account.

Anyone can look at any pet, but only its owner can study, work, shop, steal,
or fight with it. The bot's ID, `0`, can't be signed up or signed into. A pet
from before accounts existed is claimed by the first person to sign up with
its ID.

### Pet appearance

Open **Appearance**, or select the pet house at home, to pick a color and species:
**cat, dog, hedgehog, lizard, panda, bird, dragon, or blob**. Press
**Save appearance**. New pets start as an amber (`#f59e0b`) blob until you
customize them; existing pets keep their saved species and color.
Changing appearance is free, and works while studying or working. Only the
owner can change it, and it stays saved across sign-outs and server
restarts.

The saved color and species show up at home, in Adventure and team lobbies,
in battles, and on Arena pets, the leaderboard, and the **Happening now** feed
— including older feed entries.

Every pet has a cozy illustrated look, with rounded shapes, expressive
eyes, soft shading, and recognizable animal details. The selected color
personalizes the pet while keeping its markings clear. The artwork matches
the home's warm palette and stays readable in small Arena and feed icons.
Your companion at home, and a pet you visit, are
alive. They breathe (a little faster while studying or working), blink every
few seconds, follow your pointer with their eyes, and turn toward it in 3D.
With reduced motion turned on, they stay still: no breathing, blinking, or
following. The illustrations are drawn in the browser — no extra download.
Every open window updates from the server's broadcast; picking or
saving a setting never previews an unsaved change on the pet.

### Playing with your pet

Tap or click your pet at home to touch it there and open its compact pop-up,
or interact with its rug and choose a play button. The pop-up shows the
pet's reaction alongside its live status. The same four touches work on other players'
pets while you visit them (see **Visit, play and steal** below):

| Touch | Where on the pet | Reaction |
| --- | --- | --- |
| **Pat head** | The top of the head, or between the eyes | A happy squish and hearts |
| **Tickle belly** | The belly | A giggling wiggle |
| **Stroke cheek** | Either side of the face | A lean into your hand and sparkles |
| **Shake paw** | The feet | A hop, its shadow shrinking below, and stars |

Every touch closes the pet's eyes in a happy smile and makes it blush. The
pet reacts with a short, springy animation and a line describing what it
does, which screen readers announce. A pet that's studying or working still
reacts, then gets back to its lesson or shift. Playing is just for fun: it
costs nothing and changes nothing in the game. Playing with your own pet
isn't saved, sent to the server, or shown to other players. With reduced
motion turned on, the pet doesn't move — it only smiles and blushes, and the
line still appears.

In the Journal, **Recent visitors** lists the last five players who
played with your pet, each with their latest touch and when it happened,
newest first. When someone touches your pet while you're signed in, it
reacts at home and says who did it.

### School

Visit **School** on the town map to take lessons. Every pet starts at
primary school. There are four courses:

| Course    | Raises                                         |
| --------- | ---------------------------------------------- |
| Math      | Intelligence                                   |
| PE        | Strength                                       |
| Drama     | Charisma                                       |
| Electives | a random attribute, picked again for each point |

Each lesson earns 1 credit. Lessons are worth more the further the pet
gets, but each level takes more credits to finish:

| School         | Each lesson adds | Credits to move up      |
| -------------- | ----------------- | ----------------------- |
| Primary school | +1                | 5, to middle school     |
| Middle school  | +2                | 10, to high school      |
| High school    | +3                | top level; credits keep counting |

Moving up resets the credit count.

### Stamina, hygiene and work

Every pet has **stamina** and **hygiene**, each from 0 to 100, starting
full. Studying wears a pet out; working mostly gets it dirty:

| Activity          | Takes      | Stamina | Hygiene | Earns                         |
| ----------------- | ---------- | ------- | ------- | ----------------------------- |
| Study             | 30 minutes | −20     | −10     | attribute points and a credit |
| Work, per hour    | 15 min–4 h | −10     | −20     | money (see Work below)        |

Lessons and shifts take real time. The costs come off when the pet starts;
the reward (points, the credit, or the pay) arrives when it finishes. A busy
pet can't start another lesson or shift, but you can still shop, feed it,
clean it, and upgrade its jobs.

A pet that's too tired or too dirty refuses. A shift needs at least its own
costs. Studying needs enough for the lesson *and* an hour's shift afterward
(30 stamina and 30 hygiene), so a pet can always work its way back to
health.

### Work

Open **Part-time Jobs** on the town map. There are three places to work,
each paying by one attribute. Shifts last
15 minutes, 30 minutes, 1 hour, 2 hours, or 4 hours. An hour pays the pet's
rank wage plus **$1 per point** of that attribute, so a strong pet earns
more on the construction site than at the office. Pay and costs scale with
the shift's length — a 15-minute shift is a quarter of an hour's; costs
round up, pay rounds to the nearest dollar.

| Location          | Attribute    | Rank 1 ($20/h) | Rank 2 ($40/h, needs 20) | Rank 3 ($70/h, needs 50) |
| ----------------- | ------------ | -------------- | ------------------------ | ------------------------ |
| Construction site | Strength     | Labourer     | Foreman                | Site manager           |
| Office            | Intelligence | Clerk        | Analyst                | Director               |
| Theatre           | Charisma     | Usher        | Actor                  | Star                   |

Every pet starts at rank 1 everywhere. Once its attribute reaches the next
rank's requirement, **Upgrade** moves it up for good.

### Shop

Open **Shops** on the town map to buy items with the pet's money. Use
**Feed** and **Clean** at home to care for your pet with those supplies;
the shop also keeps the item-use controls available:

| Item      | Price | Use                                               |
| --------- | ----- | ------------------------------------------------- |
| Food      | $15   | Feed: +40 stamina                                 |
| Soap      | $10   | Clean: +50 hygiene                                |
| Hourglass | $150  | Skip: finishes the current lesson or shift now    |

Stamina and hygiene cap at 100, and food or soap can't be used once that need
is already full. An **hourglass** skips the wait: the lesson or shift ends
right away and pays its full reward, as if it had run its whole time. It
only works while the pet is studying or working — the busy banner has a Skip
button for it. Open the same pet in two windows and both update together.

**Free daily supplies.** Once per UTC calendar day, **Collect 1 Food + 1
Soap** in Shops or your Backpack adds one of each to the pet's stock, free.
They're ordinary items — they keep until used, and Adventure's backpack
shares the same count. Missed days don't add up. After collecting, the
button reads **Collected today** until midnight UTC (shown in your local
time), then it wakes up again without a reload. Like theft protection, the
reset uses real UTC days, even on the accelerated test clock.

### Other pets and fights

Open **Arena** on the town map to see other pets: the bot first, then the
newest. A player who
joins while you're playing shows up in your arena right away. You can also
look up any pet by its player ID. Each shows its school, what it's doing,
its attributes, its power, and its wins and losses.

Human opponents must be **online** (signed in with a live connection) to
start a fight, including revenge. Online status updates automatically;
offline players can still receive visits. Being at home or in town does
not determine fight eligibility. The usual activity and battle restrictions
still apply. A saved login alone does not count as online.

Pet **`0` is a bot**. It always exists, so there's always someone to fight.
It keeps pace with the players: each of its attributes is the **median** of
every player's pet (rounded down, never below a new pet's 5), updated the
moment any pet's change moves the median. So the bot is always an even match
for a typical player — beating it reliably means your pet is ahead of the
pack.

Press **Fight** to open a turn-based battle in a small window. Every pet
starts out knowing only **Claw Strike**, which costs **0 MP**. Each Arena
fight starts with full **HP = Strength + Intelligence + Charisma** and
**MP = Intelligence**. These are battle resources, not stamina or hygiene,
and they reset each Arena fight. Adventure keeps its own HP/MP between
encounters — see below.

Power is 2 × Strength + Intelligence + Charisma. Each pet rolls a luck
factor between 0.8 and 1.2; Strength × luck, rounded to at least 1, is that
pet's Claw Strike damage for the battle. Before the fight, a coin toss
decides who strikes first — a fair 50/50 by default, unless the coin
provider's equipped Unfair Coin overrides it (see below). Pets alternate
turns until one reaches 0 HP. **Each player chooses an equipped skill on
their own turn**; their pet never chooses or attacks automatically.
Claw Strike stays free, while other skills spend MP. Unaffordable skills
are disabled. The surviving pet wins; going first alone no longer
guarantees victory. The winner gets a win and the loser a loss.

In Arena and revenge, the pet with the higher **Strength + Intelligence +
Charisma** supplies the coin; the initiating pet wins a tie. This comparison
uses permanent attributes before any Copper bonus. Only the provider's
equipped coin applies. In cooperative Adventure, the strongest participating
teammate supplies it; in solo Adventure, the player always supplies it.

The window animates each accepted move and shows the saved HP/MP. It waits
for the other player when it is their turn, including while they are
offline. Battles survive reconnects and server restarts. **Forfeit** or
Escape asks for confirmation before withdrawing. The training bot and
monsters choose their own responses; human pets always wait for their
players. Finished Arena fights offer **Watch battle** with a saved attack
log and replay. Replay controls never charge energy, advance a live turn,
or award money again. Motion effects respect reduced-motion settings.

**The winner takes 10% of the loser's money** (rounded down, at most $50),
whichever side attacked — an attacker who loses pays the defender. Fights
with the bot are practice: no money changes hands.

After attacking a pet, the attacker must wait **an hour** before attacking
that same pet again. The pet it attacked can hit straight back (unless it
attacked that pet itself within the last hour). If someone attacks you, a
message pops up wherever you are on the page, saying who it was, how it
went, and what money changed hands, with a **Revenge** button to fight them
straight back.

Starting a fight costs the attacker 10 stamina and 5 hygiene once. Like
studying, it needs enough left for an hour's shift afterward (20 stamina and
25 hygiene). Both pets must be available, and a pet can take part in only one
live battle at a time. The defender pays nothing. Wins, losses, spoils, and
the finished fight record are saved once the battle ends.

### Theft notifications and revenge

The theft API (`POST /api/pets/:id/steal/:opponent`) transfers $10–$30,
limited by the victim's balance. A pet can be robbed at most once per UTC
calendar day, across all players. Protection persists and resets at
midnight UTC; failed attempts don't use it up. You can't steal from yourself
or the bot.

Thefts are saved separately from the public feed. The **Journal** shows a
report count when unresolved thefts are waiting. Open it to see who stole
from you, when, and how much, with a
**Take revenge** button. They also appear live, and survive server restarts
and public-feed pruning. Each theft allows one completed revenge attempt,
using the same turn-based skill selection and combat energy as a fight.
Both participants must be available — ordinary fight cooldowns don't block
theft revenge, but the thief must be online. On a win, the
thief pays **twice the stolen amount**, and you gain **+1 Strength, +1
Intelligence, and +1 Charisma**. If the thief can't afford the full reward,
no attempt or energy is spent — try later. A loss spends the attempt and
combat energy, but costs no extra money. Revenge never removes daily theft
protection.

`GET /api/thefts` returns only your pending reports. `POST
/api/pets/:id/revenge/:theft` accepts only a theft against your own pet.
Completed attempts can't pay out twice. Signing out clears pending revenge
controls; late responses from an earlier login can't change the new login's
notifications or buttons.

### Visit, play and steal

Press **Visit** beside a pet in the Arena (or look it up by player ID) to
enter its home, whether the owner is at home, elsewhere, or offline. Walk
with the same keyboard or floor-click controls. Everyone in the same home
sees each other's character positions, direction, and walking in real time.
Players in a different home are not drawn in yours. Select the pet to see
its appearance, activity, balance, and visiting actions; **Leave home** or
the front door returns to town. Town also shows the players walking there.
Signing out or losing the live connection removes your character; reconnecting
resyncs the saved positions. Closing one of several connected tabs does not
make the player offline.

**Play with it** by tapping or clicking it where you'd like to touch it, or
with **Pat head**, **Tickle belly**, **Stroke cheek**, and **Shake paw**
under it. Unlike playing with your own pet, this is a visit: the server
saves who touched which pet and how, and tells every open window. The pet
reacts only once that news arrives — in your window, in its owner's (whose
**Recent visitors** gains you), and in anyone else visiting it too. Each
player can touch a given pet once a second. Touching costs nothing, works
while either pet is busy, and changes no money, stats, stamina, or hygiene.

**Help out** by feeding or cleaning it. The visit shows its stamina and
hygiene; **Feed** and **Clean** give it one Food or Soap **from your own
cupboard** (bought at the shop or collected as free daily supplies),
restoring +40 stamina or +50 hygiene, never past 100. It's a gift: it costs
you the item, and changes no money or stats. You can't help when you have
none to give, when that need is already full, or the bot. Helping works
while either pet is busy. Both pets update live in every window, its owner
gets a notice saying who helped, and it appears in **Happening now**.

**Steal $10–$30** takes a random whole dollar amount from that pet and adds
it to yours. The amount never exceeds its balance; a pet with less than $10
can't be robbed. Visiting and stealing are instant, cost no stamina or
hygiene, and work while either pet is busy. You can't steal from yourself or
the bot.

**Each pet can be robbed once per UTC calendar day, across all players.**
After a successful theft, everyone must wait until midnight UTC to rob that
pet again. The visit shows when its protection ends, in your local time.
You can still steal from other eligible pets. Failed attempts don't use up
the target's daily protection, and protection survives signing out and
server restarts. Both balances update live; the owner gets a notification
and the theft appears in **Happening now**.

### Leaderboard

The Arena's **Leaderboard** tab ranks the top 10 players by **most wins**
(fewer losses breaks a tie) or by **most power**; on a tie, whoever joined
first stays ahead. The bot isn't on it. It re-ranks live as pets fight and
train, and your own pet is highlighted when it makes the board.

### Happening now

Below your fights, the Arena shows the 15 newest things that happened
anywhere in the game, live: a player joining, every theft, every time
someone feeds or cleans another player's pet, every fight (who won, and any
money taken), a pet moving up a school, and a pet getting promoted at work.
Ordinary lessons and shifts stay out of it, so it isn't flooded. Entries
about your pet are highlighted.

Still to come: recruiting other players' pets.

## Running it locally

```sh
mise install
pnpm install
pnpm start        # http://localhost:8080, lessons and shifts in real time
pnpm start:test   # the same on a fast clock (a game hour takes 0.1 s)
pnpm check        # in a second terminal, against pnpm start:test
```

Data lives in SQLite at `./data/virtuepets.db` (`/data` on Fly, the attached
volume).

## How it's built

Node 24 running TypeScript directly, Express for HTTP, `ws` for WebSockets,
and the built-in `node:sqlite` for storage.

- **Accounts:** `POST /api/signup`, `/api/signin`, and `/api/signout`, and
  `GET /api/me`. Passwords are hashed with scrypt. A session is a random
  token in an HttpOnly cookie, stored only as a hash.
- **Actions** (owner only): `POST /api/pets/:id/study/:course`,
  `work/:location` (with `{"minutes": 60}`), `upgrade/:location`,
  `buy/:item`, `use/:item`, `collect-supplies`, `fight/:opponent`,
  `steal/:opponent`, `help/:pet` (with `{"item": "food"}` or `"soap"`),
  `touch/:pet` (with `{"kind": "pat"}`), and `equip-coin/:coin` (`:coin` is
  `copper-coin`, `silver-coin`, `gold-coin`, or `none` to unequip).
  `collect-supplies` adds the free daily Food and Soap, and sets the pet's
  `suppliesAvailableAt` (epoch milliseconds of the next UTC midnight, or
  `null` before the first collection). A second collection that day returns
  429. Equipping is global to the pet and reusable — never consumed — and
  applies to Adventure, Arena, and revenge alike. Equipping a coin the pet
  doesn't own, or an unknown coin, returns 409.
  `POST /api/pets/:id/equip-skills` takes `{ "abilities":
  ["claw-strike", "firebolt"] }` and saves up to four different learned
  skills, including Claw Strike. The home chest exposes these controls;
  loadout changes are refused during a live battle.
  Stealing returns `{ thief, victim, amount }`; both pets include
  `stealAvailableAt` (epoch milliseconds, or `null` before any theft). The
  server locks and checks the target before transferring money, saving
  protection and recording the feed entry in one transaction. Repeated
  thefts return 429; insufficient funds return 409; self/bot targets return
  400. The daily limit uses real UTC days, independent of `TIME_SCALE`.
  Helping returns `{ helper, pet, item, amount }` (`amount` is how much
  stamina or hygiene it actually restored); both pets change in one
  transaction and are broadcast as `pet:updated`, then a `helped` feed
  entry. An empty cupboard or a full need returns 409; yourself, the bot, or
  any item but food and soap return 400.
  Touching saves and returns `{ id, visitor, pet, kind, at }`, where `kind`
  is `pat`, `tickle`, `stroke`, or `paw` (anything else returns 400).
  Touching your own pet returns 400, a missing pet 404, and a second touch
  of the same pet within a second 429.
- **Appearance** (owner only): `POST /api/pets/:id/appearance` with both
  fields, e.g. `{"color":"#12abef","appearance":"dragon"}`. Color must match
  `/^#[0-9a-f]{6}$/i`; appearance must be `cat`, `dog`, `hedgehog`, `lizard`,
  `panda`, `bird`, `dragon`, or `blob`. Invalid fields return 400; invalid
  player IDs return 404, like on other pet routes. The response and the
  `pet:updated` broadcast carry the
  complete saved pet, including `color` and `appearance`. Clients wait for
  that broadcast before showing a change. Both columns migrate in place on
  startup.
- **Reading** (anyone): `GET /api/pets` lists pets, `GET /api/pets/:id`
  shows one, `GET /api/pets/:id/fights` its recent fights, `GET
  /api/pets/:id/touches` its five most recent visitors (each one's latest
  touch, newest first), `GET /api/feed` what's been happening across the
  game (newest first), `GET /api/leaderboard?by=wins` (or `power`) the top
  10 players, and `GET /api/rules` the schools, courses, work locations,
  items, and costs.
- **Live battles** (participants only): `GET /api/battles` lists the signed-in
  pet's active Arena/revenge sessions; `GET /api/battles/:battle` reads one
  saved session. `POST /api/battles/:battle/turn` takes
  `{ "ability": "claw-strike", "revision": 0 }`; `POST
  /api/battles/:battle/forfeit` takes `{ "revision": 0 }`. A session holds
  its persisted battle, current actor, HP/MP, selected skills, and numeric
  turn revision. Wrong-player, stale, unknown-skill, and insufficient-MP
  actions cannot advance the fight.
- **Real time:** the server broadcasts a `pet:updated` event over the
  socket after every change, a `fight:finished` event after each fight
  (with the `spoils` the winner took), a `feed:added` event for each new
  entry in Happening now (sent after the change it describes), a
  `team:updated` event whenever a team in the **Team up** window changes or
  sets off, and a `pet:touched` event, carrying the saved touch, whenever a
  visitor plays with someone else's pet. The feed keeps its newest 500
  entries in SQLite. A private `battle:updated` event sends saved
  Arena/revenge session changes only to its participants.
  `presence:updated` lists authenticated players with open connections;
  `world:updated` carries a saved home/town position. `GET /api/world`
  resyncs online players and positions. Authenticated `POST /api/world`
  accepts `{ scene, home, x, y, facing, moving, revision }` for the caller
  only; positions are saved in SQLite before broadcasting, and stale
  revisions are refused. Movement is coalesced to at most one request per
  80 ms. `spec/world-realtime.test.ts` checks movement and presence delivery
  to multiple sockets within one second, offline visits, and online fights.
- **Logs:** server stdout (also visible in `flyctl logs`) records `join`,
  `leave`, `action`, `broadcast`, `reject`, and `snapshot` events, each as
  one line of `key = value` fields. The game's single shared WebSocket room
  is `arena`. `client_in_room` counts open sockets, including separate
  tabs, after each join or leave. A connection ID ties a join to its leave.
  Socket users come from the session at connection time; sockets opened
  before sign-in keep a generated `guest_…` identity until reconnecting.
  HTTP actions use the current authenticated player, or `anonymous` when
  there's no session.
  Every mutating API request is logged before parsing its body. Its
  request ID ties the receipt to its rejection or response. Rejections
  include the HTTP status and reason — malformed JSON, authorization
  failures, and unknown endpoints all count. Broadcasts name the message
  type and how many open recipients got it, including updates from
  scheduled activities. A `snapshot` records a successful JSON API response
  sent to its one requester, such as a pet or arena refresh, a saved action
  result, or private Adventure state. Snapshots use HTTP, as they do when
  the client resyncs after reconnecting.
  An `action_result` line follows most actions, naming who did it and the
  outcome. Touch and help name the target pet and kind/item/amount. Signing
  up or in names `created` (new pet or not). A fight or revenge names the
  opponent and the winner, or whether revenge succeeded. Stealing names the
  victim and amount. A finished lesson or shift names the task and what it
  paid — logged when it ends, not when it starts. A team change
  (`team_invite`, `team_accept`, `team_leave`, `team_set-off`) names the
  team. Logs exclude passwords, session cookies, query strings, request
  bodies, and snapshot contents; values containing spaces are quoted.

  Example lines (IDs shortened):

  ```text
  event = join user = alice room = arena client_in_room = 2 connection = c_12
  event = action user = alice room = arena client_in_room = 2 request = req_7 action = /api/pets/alice/collect-supplies method = POST
  event = broadcast user = server room = arena client_in_room = 2 message = pet:updated recipients = 2
  event = reject user = alice room = arena client_in_room = 2 request = req_8 action = /api/pets/alice/use/food method = POST status = 409 reason = "No food left. Buy some at the shop."
  event = snapshot user = alice room = arena client_in_room = 2 request = req_9 action = /api/pets/alice method = GET status = 200 recipients = 1 transport = http
  event = leave user = alice room = arena client_in_room = 1 connection = c_12 code = 1000
  ```

## Adventure exploration

Leave home for the town map and choose **Adventure**. Move with W/A/S/D,
arrow keys, or the on-screen direction buttons; holding a movement key keeps
walking. You can also click or tap a reachable tile to walk there. Each step
waits for the server to confirm the position, and a battle, another window,
or a blocked move stops the route. The map takes the keyboard as soon as it
opens. **Space** acts on the tile your pet stands on: it opens an unopened
chest, or uses the stairs there (Unlock & descend, Descend, or Ascend), so
the whole adventure plays without a mouse. On a focused button, Space
presses that button instead.

The Adventure fills the whole screen with an illustrated woodland in the
same warm style as home and town. The camera follows your pet through leafy
trees, tall grass, flower patches, and stone paths. The persistent controls
are a small floor and movement tip, **Menu**, HP/MP, and the direction pad.
**Menu** opens **Backpack & team**, **Game guide**, and **End adventure**
when needed. Escape opens or closes this menu while exploring.
At the bottom left, two rings show your pet's **HP (red)** and **MP (blue)**:
the coloured arc is what's left, and the number inside reads e.g. `12/15`. The
arrow pad sits at the bottom right. **Open chest**, **Ascend**, and the
down-stair action appear only while your pet stands on a chest or stairs,
and the available object is highlighted. Battle records and replay controls
stay off the map until the run ends. Monsters have original woodland
artwork, and wooden treasure chests show their open and
closed states. Gentle grass, creature, and treasure animations pause while
the map is hidden or another window is open and respect reduced-motion
preferences.

A small upper-left tip explains movement, Space, and tall grass. Further
help lives in the **Game guide** window: how to play, the map key, where the
down stairs are, the remaining monsters' attributes, the treasure odds, and
what a new run costs. Ordinary monsters' hiding places aren't revealed; the
visible Slime King's position is listed. Open it through **Menu → Game
guide**. Close or Escape returns the keyboard to the map. A battle that
starts while it's open closes it.

Each of the five fixed floors starts with a 16 × 16 grid, four regular
enemies (slimes and goblins), and at least one marked treasure chest. Floor
five also holds the **Slime King**. The map uses your pet's saved shape and
color as soon as you sign in.

**A busy pet can't adventure.** While it's studying or working, **Explore
the woodland** is disabled, with the reason shown. The server refuses
moves, stairs, opening chests, and starting over with 409 until the lesson
or shift ends — an Hourglass can bring that forward. Viewing the map,
returning from a saved battle, and using backpack items still work. An
activity whose time is up no longer counts, even before it's been paid out.

**Find a Floor Key to unlock the next floor.** In a new run, floors one
through four have locked down stairs. Each monster victory on a locked
floor has a **5% chance** to drop that floor's key while it is missing.
The chance stays 5% each time; there is no guaranteed drop after a set
number of battles. More monsters appear in the grass while the key is
missing, so clearing the first four enemies cannot leave the exit
permanently locked. Once the key drops, no more keys or replacement
monsters appear on that floor.

Stand on the down stairs at column 14, row 14 and press Space, or choose
**Unlock & descend** when you have the key. This permanently unlocks the
gate and takes you to the next floor's up stairs, at column 3, row 3.
Later visits use **Descend** without another key. **Ascend** returns you
to the previous floor's down stairs and never needs a key. Floor one has
no up stairs; floor five has no down stairs or Floor Key.

**Every new entry starts a fresh adventure.** Returning from town or
reopening Adventure starts at floor one with full HP/MP, new monsters and
chests, and locked gates with no keys. Leaving ends your current run; it
cannot be resumed later. Your earned inventory and learned abilities stay
with your pet. Map updates during the same visit keep the current floor,
position, HP/MP, keys, and unlocked gates, including across server restarts.

**Monsters hide in tall grass.** Walking through a grass patch can start a
surprise battle with one of that floor's remaining slimes or goblins.
Ordinary monsters aren't drawn on the map, and their coordinates aren't
sent to the browser. Clear paths are safe from random encounters, and
standing still never starts one. The **Slime King** remains visible in the
final grove; walk onto its tile to challenge it.

Only a successful step into tall grass advances the encounter counter.
There are two quiet grass steps before another encounter can happen, then
a chance on each grass step, with an encounter guaranteed by the sixth
while regular monsters remain. The server saves the random seed and step
counter with the floor, so repeated requests during the same run don't
reroll them. Defeated monsters stay defeated, but fresh ordinary
monsters replenish the grass while a locked floor still needs its key.
After the key is found, or on a floor without a locked exit, clearing the
remaining regular enemies makes its grass safe. A surprise battle leaves
the pet on the grass tile it entered.

Trees still block movement, and every stair and chest is reachable.
Map refreshes use the existing `{ "action": "patrol" }` request to read
saved progress, including teammates' positions. These background refreshes
never reset the run, move monsters, or start a battle.

For initial balancing, floor-one slimes have STR/INT/CHA **3/1/2**, and
goblins have **5/3/2**. Each deeper floor adds **2/1/1**. The floor-five
Slime King has **18/10/12**. Maximum HP is the sum of attributes; maximum MP
is Intelligence. A new run starts with full resources. Current HP/MP carry
between battles and floors during one run. A server restart doesn't
refill them; entering a new adventure does. Training raises the maximums
without refilling current HP/MP.

### Teaming up

An adventure can be played alone or with up to three other players.
The first visit opens **Team up?**, where players choose a solo run or form
a team. The finished-run panel offers **Team up** for later adventures.

- **Go solo** starts a fresh woodland run. The first solo adventure is
  free; later starts use the normal cost and cooldown.
- **Invite a player by ID** makes your pet a team's leader and invites that
  player. A team holds at most **4 pets**, invitations included. Only
  players with accounts can be invited, and only the leader invites.
- An invited player sees the invitation in their own **Team up?** window
  and can **Join** or **Decline**. A pet joins one forming team at a time.
  **Leave team** takes it off, and the leader's **Disband team** ends the
  team for everyone.
- **Set off together** (leader only) needs at least one other pet to have
  joined, and every joined pet to be ready. Each pet is checked the way
  a new adventure would check it: no run in progress (end it first), no
  battle awaiting **Return to map**, not studying or working, no
  adventure cooldown, and enough stamina and hygiene. The window says what
  each pet is waiting on. Setting off charges every pet **40 stamina and 20
  hygiene**, and opens each pet's 4-hour cooldown — same as starting a new
  adventure. Invitations still pending lapse.

Every teammate then explores **one shared map**: one set of floors,
monsters, and chests, starting together at floor one. Each pet keeps its
own position, floor, HP, and MP, and the map shows teammates on the same
floor (with their positions and HP under **Your team**). Every window
refreshes the shared state about once a second, so each player sees the
others move. Grass encounter progress and remaining monsters belong to the
shared floor; only a teammate walking through grass advances that progress.
Floor Keys and unlocked gates also belong to the shared floor. A key
found by any teammate lets any teammate unlock that floor's exit, and the
gate then stays open for everyone. A shared battle rolls for one key drop,
not a separate drop for each pet.

**Teammates beside your pet join its battles.** When a pet encounters a
monster in grass or walks into the Slime King, every teammate exploring
within 1 block of that pet (diagonals included) fights alongside it — unless
that teammate is busy, already has a battle waiting, or is out of the run.
A team battle waits for each standing pet's owner to choose an equipped
skill. Pets take their turns in encounter order, then the monster strikes
whichever pet has the most HP left. The teammate with the highest raw
Strength + Intelligence + Charisma supplies the coin, with encounter order
breaking ties. That coin decides whether the pet team or monster goes
first; only its provider receives Copper's bonus or Gold's doubled first
hit. Each pet uses its own equipped skills and carried HP/MP. Every player
sees the same saved battle from their own side and returns to the map
separately. A player who forfeits withdraws only their own pet; the remaining
teammates continue taking their turns.
If another player moves before your withdrawal is saved, the battle stays
open and asks you to choose **Forfeit** again. If that move ends the battle,
its result stays open until you return to the map.

**A knocked-out pet is out; the team plays on.** A pet at 0 HP after a
battle (won or lost) has failed its run, exactly like a solo defeat, while
its teammates keep exploring. After a victory, every pet still standing
recovers 20% of its maximum HP and MP, and the monster is removed for
everyone. Grass encounters keep the pet on its grass tile; a surviving pet
that challenged the Slime King takes the king's tile after winning. A team's
run ends for each pet when it's defeated or leaves the adventure; the
rest keep exploring. Opening the map for the first time after a team sets
off joins that newly created shared run without charging again. Returning
after leaving starts a new solo run, or players can form a new team.
**Start new adventure** after that is always solo; to team up again, use
**Team up**.

**Each chest opens once for the whole team.** The first teammate to choose
**Open chest** gets its reward; for everyone else it shows as opened, by
them.

### Monster battles

Encounters use the Arena's turn-based battle scene, with the monster's own
appearance, name, and attributes. Monsters use **Claw Strike**, which costs
**0 MP**; players choose their pets' equipped skills, and damage uses the same
power and luck rolls as Arena. The **Slime King** also knows **Bump** (5
MP), which deals two-thirds of the pet's *current* HP, rounded up: a pet at
70 HP takes 47. On its own turn, the king picks whichever affordable
attack hits harder that turn. Bump wins while the pet's HP is high; Claw
Strike takes over as it falls. Its 10 MP allow at most two Bumps per
battle. The Game guide's **Monster attributes** lists Bump beside the Slime King. Pets can't
learn it. A solo player's coin always applies, even against a stronger
monster. In a team battle, the strongest participating pet supplies the
coin. Monsters never supply coins. The scene starts at the pet's saved HP/MP (plus any Copper shield),
and each monster starts at full HP/MP.

On victory, the monster stays defeated. A grass encounter keeps the pet on
the grass tile it entered; beating the Slime King moves it onto the king's
tile. Victory restores **20% of maximum HP and MP, rounded up separately**,
capped at their
maximums. For example, maximums of 31 HP and 7 MP restore up to 7 HP and 2
MP after a win. The server applies this recovery once, alongside the
outcome. Defeating the Slime King completes the woodland.

**Defeat ends the adventure.** HP stays at zero, and movement and stairs
are disabled. Completing the woodland, losing, or choosing **End
adventure** opens the result panel with battle records, the next-start
cooldown, **Start new adventure**, **Team up**, and **Return to town**.
**End adventure** asks for Yes/No confirmation first. Ending a run is free
and leaves earned inventory intact. A new run begins at floor one
with full HP/MP and fresh monsters, treasure, and locked gates.

**Every confirmation is a Yes/No window.** Whenever the game needs you to
confirm something, it opens a small window with the question and **Yes**
and **No** — never the browser's own prompt. Focus starts on **No**, so a
stray key never confirms; Escape or a click outside the window also
answers No. A battle that starts while the window is open (a teammate's
encounter, or an Arena fight) answers it No too, since the question no
longer fits the moment.

**Battle records unlock after the adventure ends.** Encounters show live
skill choices and animate the resulting turns. A live fight cannot be
skipped; replay and the attack log are unavailable during exploration.
**Return to map** appears after the fight finishes. Returning
acknowledges the saved result; if that request fails, **Continue exploring**
lets you retry it. After the run ends and any pending result is
acknowledged, the result panel lists its battles and offers replays and
attack logs. It keeps the latest **50 battles** and shows the total when a
long run exceeds that limit. Starting a new run clears that run's record.
Replays use saved turns and cannot reroll an outcome or Floor Key drop,
grant more recovery, or resurrect a monster.

**The first solo adventure is free. Later fresh starts cost 40 stamina and
20 hygiene**, and open a **4-hour cooldown**. This applies whenever the
player re-enters, including after leaving an unfinished run. Starting is
refused if the pet lacks stamina/hygiene or the cooldown is active. The
old run still ends, so a refused start cannot be used to resume it. An
Hourglass clears the wait early, from the same shared count used elsewhere.
The cooldown begins when the fresh run does and doesn't interrupt that run.
After it ends, the result panel shows a compact progress bar, the time
remaining, and **Skip wait (use Hourglass)**. Town also shows the saved
cooldown. Adventure doesn't alter Arena wins/losses. Monster victories
grant recovery and can drop a missing Floor Key; chests grant the items
below.

### Treasure and inventory

Stand on a treasure chest and press Space or choose **Open chest**. Each
chest awards one reward per run: **Food 30%, Soap 30%, Ability 20%,
Hourglass 15%, Unfair coin 5%**. The two ability types have equal chances
within the ability category; Copper, Silver, and Gold Coins have equal
chances within the coin category. Opened chests stay on the map, keep their
reward, and can't be looted again. New adventures have fresh chests.
Defeat, restarting, and signing out don't remove inventory.

Floor Keys come from monster victories, not chests. They belong to their
adventure floor rather than the pet's backpack; a new run starts with fresh
locked gates and no keys.

**Your backpack**, inside **Menu → Backpack & team**, shows items,
learned abilities, and coins. Coins have **Equip**/**Unequip** controls.
Food restores 40 stamina; soap
restores 50 hygiene, capped at 100. Hourglasses finish the current lesson
or shift. These are the same items used at home and in **Shops**, with a shared
count — they don't restore Adventure HP/MP or revive a failed run. The
Adventure section's **Abilities & coins** also shows permanent discoveries
and coin equipment. Change battle skills at the storage chest in Sweet Home.

Ability rewards are learned immediately and permanently. **Learning a skill
does not equip it**: at home's storage chest, equip up to four skills,
including the permanently available Claw Strike. That loadout works in
Adventure, Arena, and revenge and is fixed for a live battle. Duplicate drops say **already learned**,
without stacking the ability or rerolling the reward.

| Ability | MP cost | Damage |
| --- | ---: | --- |
| Claw Strike | 0 | Strength × battle luck, rounded, at least 1 |
| Firebolt | 3 | Intelligence × 1.5 × battle luck, rounded, at least 1 |
| Heavy Strike | 2 | Claw Strike damage × 1.5, rounded up |

Choose one equipped skill on each of your pet's turns. At low MP you can
still choose free Claw Strike; the game never chooses it for you.
Saved playback includes each selected ability, MP spent, and
remaining resources; replaying doesn't spend MP again.

### Unfair coins

A coin toss decides initiative before every monster battle, Arena fight,
and revenge attempt: a fair 50/50 by default, where **heads** means the
coin provider's side strikes first, and **tails** means its opponent does.
In PvP, the higher sum of Strength, Intelligence, and Charisma chooses the
provider. In cooperative monster battles, compare participating teammates.
In solo monster battles, the player is always the provider. Attribute ties
keep the initiating pet or earlier teammate; Copper's bonus is excluded
from this comparison. The battle scene shows the
result above the fighters for the whole battle, and replays show the same
saved toss. Equipping an Unfair Coin can change that for the pet wearing
it, and the scene then names the coin instead:

| Coin | Effect |
| --- | --- |
| Copper Coin | +1 to every attribute, for that battle's HP/MP/damage only. The toss stays a fair 50/50. |
| Silver Coin | The pet always attacks first. |
| Gold Coin | The pet always attacks second, but its first attack deals double damage. |

Coins are **reusable equipment, never consumed**: equip one (or none) from
the backpack, and it stays equipped — in Adventure, Arena, and revenge
alike — until changed. Only the **coin provider's** equipped coin applies;
other participants' coins are ignored. Copper's bonus never
persists: the pet's real attributes, and its saved maximum HP/MP, are
unchanged once the battle ends.

In Adventure, where HP/MP carry between battles, Copper's extra 3 HP and 1
MP are a **shield** on top of what the pet brings in: a pet at 10 / 31 HP
starts the fight at 13 / 34. Damage spends the shield first, and whatever's
left of it disappears afterward, so Copper never heals — that pet leaves
the fight with at most 10 HP (before a victory's recovery). Arena and
revenge start every fighter at full, so there the bonus simply raises
HP/MP for that fight.

The private `POST /api/adventure` accepts an empty body to read the saved
state without starting or resetting a run. Its response includes an opaque
`revision`; supply that revision with each mutating action:

- `{ "action": "enter", "entryId": "…", "revision": "…" }` enters a fresh
  adventure. Use a new entry ID for each visit and reuse it when retrying
  that entry, so a retry cannot reset or charge twice. The first map entry
  after a team sets off joins its prepared run instead. A fresh entry ends
  any earlier run and acknowledges its pending battle before checking the
  new start's cost and cooldown.
- `{ "action": "leave", "revision": "…" }` ends the caller's current run
  without ending teammates' runs.
- `{ "direction": "w" | "a" | "s" | "d", "revision": "…" }` moves one tile.
- `{ "action": "ascend" | "descend", "revision": "…" }` uses matching
  stairs. Descending first unlocks a locked exit if its Floor Key has been
  found; without the key, it returns 409 and the pet stays on the current
  floor.
- `{ "action": "continue", "battleId": "…", "revision": "…" }`
  acknowledges a finished battle.
- `{ "action": "battle-skill", "battleId": "…", "turnRevision": 0,
  "ability": "claw-strike" }` selects the caller's equipped skill on their
  current turn. The numeric turn revision is distinct from the map revision.
- `{ "action": "battle-forfeit", "battleId": "…", "turnRevision": 0 }`
  withdraws only the caller's pet, allowing remaining teammates to continue.
- The older `{ "action": "abandon", "revision": "…" }` and
  `{ "action": "restart", "revision": "…" }` actions remain supported for
  compatibility. Abandon ends a run without a pending battle; restart
  requires an ended run and applies the usual cost and cooldown.
- `{ "action": "patrol" }` is a read-only refresh of the saved state,
  including shared team progress. It needs no revision and never moves
  monsters, advances grass encounters, or starts a battle.
- `{ "action": "skip-cooldown", "revision": "…" }` spends one Hourglass to
  clear an active cooldown early; refused with 409 if there's no Hourglass
  to spend. A no-op, returning the current state, if no cooldown is
  active.
- `{ "action": "open-chest", "revision": "…" }` opens the chest under the
  pet.
- `{ "action": "use-item", "item": "food" | "soap" | "hourglass",
  "revision": "…" }` uses one backpack item.

Each response also includes `started`, `entryId`, and `awaitingEntry`
(the one-time initial entry to a newly prepared team run), plus `team`:
`null` on a solo run, or the team's `id` and every other teammate's `id`, `color`, `appearance`,
`floor`, `x`, `y`, `hp`, `maxHp`, and `status` (`exploring`, `defeated`, or
`abandoned`). In a team battle, `battle.fighter` gives the pet's place in
`battle.playback.fighters` (the pets in order, then the monster last).
`battleCount` is the run's total number of battles, and `recordLimit` is
50. `records` is empty until the run ends and its pending battle is
acknowledged, then contains the latest saved battles. During an active run,
only a pending encounter includes battle state for live skill selection and animation;
acknowledged battle playback is withheld until the run ends.

The `grass` array matches the 16 × 16 terrain grid: `g` marks tall grass
and `.` marks other tiles. Ordinary entries in `enemies` have
`hidden: true` and omit coordinates and patrol routes; the Slime King has
`hidden: false` with its visible `x` and `y`. A battle triggered by grass
includes `battle.surprise: true`. Encounter seeds and counters stay on the
server.

The current floor's `exit` is `{ keyFound, unlocked, dropRate: 0.05 }`,
or `null` on the final floor, which has no down stairs. A successful key
drop is recorded as `battle.keyDrop: { floor, name: "Floor Key" }` in the
saved battle. Both the key and the unlocked gate are shared by the team;
neither is a backpack item. Existing saved floors without exit state
migrate to unlocked exits.

The **Team up** window uses `GET /api/team` (signed in), which returns the
forming `team` the pet has joined (or `null`), its pending `invitations`,
its own `run` (`team` id or `null`, `state`: `new`, `exploring`, or
`ended`, and `awaitingEntry` for a newly prepared team run), and the team
`size` limit. Each team lists `members` (the leader first), each with
`joined` and, while forming, `waiting`: why that pet
can't set off yet, or `null`. `POST /api/team` takes one action and
answers with the same view:

- `{ "action": "invite", "player": "…" }` invites a player, forming a team
  led by the pet if it has none; 400 for a malformed ID, 404 for an
  unknown player, 409 if not the leader, already on the team, or the team
  is full.
- `{ "action": "accept", "team": 7 }` joins an invitation; 404 if it's no
  longer open, 409 while on another team.
- `{ "action": "leave", "team": 7 }` declines an invitation or leaves;
  when the leader leaves, the team disbands (`status: "disbanded"`, no
  members).
- `{ "action": "set-off" }` (leader only) starts the shared run; 409 with
  the reason if anyone isn't ready.

Each accepted action saves first, then broadcasts `team:updated` with the
team as saved. Setting off also broadcasts each member's `pet:updated`
first, for the stamina and hygiene spent.
The browser opens the shared run once whether the set-off response or its
live update arrives first; a delayed confirmation does not start another run.

Stale revisions return the current saved state without applying the
action, including retries after a battle or a new run. Movement pauses
while a battle awaits acknowledgement. The server saves position, enemy
removal, HP/MP, recovery, any Floor Key drop, and the exact playback in one
atomic update. Retrying or replaying that battle never rolls for a key
again.
Clients can't choose stats, battle outcomes, rewards, enemy positions, or
floors. Chest opening and its inventory grant commit in one database
transaction; item use and its new revision do too. These actions can't
award or consume twice when retried. Adventure battle results stay
private. Inventory changes use the existing `pet:updated` WebSocket event,
so home care, Shops, and other open windows stay current.
