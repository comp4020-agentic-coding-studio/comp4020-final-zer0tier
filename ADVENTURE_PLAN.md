# Adventure feature plan

Status: all five steps implemented: exploration controls and saving; five fixed
floors with stairs, slimes/goblins, increasing attributes, a Slime King on floor
five, chest landmarks, enemy detection/pursuit, and automatic monster battles
with saved HP/MP and outcomes; atomic chest rewards, persistent inventory, item
use, and learned abilities; a coin-toss initiative with reusable, equippable
Copper/Silver/Gold coins; and an entry cost and cooldown on starting fresh.
This document preserves the owner's requirements.

Implementation defaults for step 2: monsters take one cardinal step after an
accepted player step, detect the eight surrounding cells, and stop chasing when
the pet leaves that range. Stairs require an explicit Ascend/Descend action.
Nearby enemies produce encounter warnings; walking into a monster starts battle.
Initial stats and scaling are documented in README.md and can be balanced later.

## 1. Adventure entry and exploration

- Add **Adventure** to the **Make their day** section.
- Open a mini-game where the player controls their pet using W/A/S/D.
- Each movement advances one block; each floor is a 16 × 16 block grid.
- Each map contains five floors, with a boss on floor five.
- Players explore to find abilities, treasures, and items, and may avoid enemies.
- Implementation work: adventure view, grid rendering, movement validation,
  walls and walkable paths, floor transitions, and saved exploration state.

## 2. First map and enemies

- The first map includes slimes and goblins.
- Enemies become stronger on deeper floors.
- Every floor has at least one treasure chest and several enemies.
- Floor five contains the **Slime King** boss.
- A monster notices the pet when the pet enters one of its eight surrounding
  blocks (including diagonals), then tries to approach the pet.
- Implementation work: floor layouts, reachable chests and stairs, enemy spawn
  rules, depth-based stats, detection, pursuit, and encounter triggers.

## 3. Monster battles

- Reuse the Arena fighting scene and automatic battle playback for pet-versus-
  monster encounters.
- Retain the existing baseline: HP is the sum of attributes, MP equals
  Intelligence, and Claw Strike costs zero MP.
- Implementation work: monster combatants, encounter resolution, returning to
  exploration, and preventing duplicate battles or rewards on retry/reload.
- Owner's confirmed rules: walking into the monster starts battle; HP/MP persist
  between battles; recover 20%, rounded up each time; one defeat fails the adventure.
- Implemented recovery: after a victory, restore `ceil(maxHP × 0.2)` and
  `ceil(maxMP × 0.2)`, capped at the maximums. New runs start full. Stairs, leaving,
  reloading, playback, and retries grant no extra recovery.
- Wins remove the monster and move the pet into its tile. Defeat saves a failed
  run at zero HP; **Start new adventure** explicitly resets the map to floor one.
  Defeating the Slime King marks completion and also allows a fresh run.
- The Arena scene plays the saved starting resources and turns, supports skip
  and replay, and returns to the map. A saved revision protects all actions from
  stale/concurrent retries; result, removal, recovery, and position are atomic.
- Phase defaults: no entry/care cost or cooldown, no monster money/items/stat
  rewards, and no Arena record changes. Monsters use Claw Strike and Arena's
  existing initiative/damage rules until coin effects are implemented.

## 4. Treasure and inventory

Each treasure reward is drawn from these category probabilities:

| Category | Probability |
| --- | ---: |
| Food | 30% |
| Soap | 30% |
| Ability | 20% |
| Hourglass | 15% |
| Unfair coin | 5% |

- Implemented: stand on a chest and choose Open chest. One reward per chest per
  run; the reward and opened state commit together. Retrying cannot duplicate it.
- Owner approved one item per chest, existing food/soap/hourglass effects, equal
  choices within ability/coin categories, and saving coins for phase 5.
- Food/soap/hourglasses share Care & shop counts. The backpack can use them, with
  saved revisions preventing duplicate consumption. They affect care and current
  activities, not Adventure HP/MP. Inventory persists through defeat and new runs.
- Owner approved Firebolt (3 MP, Intelligence-based damage), Heavy Strike (2 MP,
  50% stronger than Claw Strike), permanent learning, and automatically choosing
  the strongest affordable attack. Implementation: Firebolt deals 1.5 × INT ×
  battle luck, rounded; Heavy Strike deals ceil(Claw Strike damage × 1.5).
  Lower MP cost breaks damage ties. Applies to Adventure, Arena, and revenge.
- Duplicate ability drops remain in the saved chest result as already learned;
  they do not stack or reroll. Coins accumulate without applying battle effects.

## 5. Coin toss and unfair coins

- Before battle, the system automatically tosses a fair coin to determine
  initiative: **heads = acting pet attacks first; tails = opponent attacks
  first**. This replaces the old power × luck comparison everywhere it was
  used (Adventure, Arena, and revenge).

| Coin | Effect |
| --- | --- |
| Copper Coin | Before battle, add 1 to every attribute (and that fight's HP/MP), battle-only; initiative probability stays unchanged. |
| Silver Coin | The player's pet always attacks first. |
| Gold Coin | The player's pet always attacks second, but its first attack deals double damage. |

- Owner's confirmed rules: the coin toss and unfair coins apply to Adventure,
  Arena, and revenge alike, not just Adventure. Coins are reusable equipment —
  equip one (or none) per pet, never consumed. Copper's bonus is battle-only:
  it never changes the pet's real attributes or its saved maximum HP/MP. In a
  PvP fight or revenge, only the acting side's equipped coin applies (the
  attacker, or the revenge victim); the opponent's equipped coin is ignored.
- Owner's confirmed rule: in Adventure, Copper's +3 HP/+1 MP is a temporary
  shield on top of the carried HP/MP. Damage spends it first and any leftover
  disappears after the fight, so Copper never heals.
- Implemented: a new global, per-pet `equip-coin` action (`POST
  /api/pets/:id/equip-coin/:coin`, `:coin` one of the three coin IDs or
  `none`), used identically by Adventure, Arena, and revenge. Equipping
  requires owning at least one of that coin; unequipping always succeeds.

## Suggested implementation order

1. Define inventory, adventure state, monster/ability data, and unresolved rules.
2. Build the exploration view and validated single-block movement.
3. Add five-floor layouts, enemies, detection, pursuit, and stairs.
4. Connect monster encounters to automatic battles and resolve win/loss/exit.
5. Add chests, weighted rewards, inventory use, and ability learning.
6. Add coin toss initiative and the three unfair coins.
7. Balance floor difficulty and Slime King; verify saving, mobile controls,
   keyboard access, and rewards under concurrent requests.

Each implementation phase should include relevant tests, README behavior
documentation, and its own commit. Keep outcomes and saved progress server-
authoritative; new real-time events require the existing one-second tests.

## Decisions to settle before the relevant phase

- What are the boss abilities and completion rewards? Review the initial enemy
  stat curves after monster battles are playable.
- Keep the existing touch direction buttons and phone layout during later steps.

Resolved for phase 5: coins are reusable equipment (never consumed); Copper's
bonus is battle-only and never raises derived HP/MP afterward; the coin toss
and unfair coins apply to Arena and revenge as well as Adventure, with only
the acting side's (attacker's, or revenge victim's) equipped coin ever applying.

Resolved for the entry cost/cooldown: starting a fresh run (after a win, a
failure, or voluntarily abandoning one in progress) costs 40 stamina/20
hygiene and opens a 4-hour cooldown, skippable with an Hourglass from the
shared Care & shop count. Reopening the map to continue an unfinished run
stays free — the cost and cooldown only gate starting over, not Adventure
HP/MP or ongoing exploration.
