# Adventure feature plan

Status: requested and broken down; not implemented. This document preserves the
owner's requirements for future implementation. Open decisions below are not
approved mechanics.

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

## 4. Treasure and inventory

Each treasure reward is drawn from these category probabilities:

| Category | Probability |
| --- | ---: |
| Food | 30% |
| Soap | 30% |
| Ability | 20% |
| Hourglass | 15% |
| Unfair coin | 5% |

- Implementation work: persistent inventory, atomic chest opening and reward
  grants, reward display, and item usage.
- Abilities found during exploration need definitions, learning rules, and
  integration with automatic combat.
- Category probabilities total 100%; probabilities within a category are not
  specified yet.

## 5. Coin toss and unfair coins

- Before battle, the system automatically tosses a coin to determine initiative:
  **heads = player attacks first; tails = opponent attacks first**.
- Normal toss fairness is the proposed default; confirm if another weighting is
  intended.

| Coin | Requested effect |
| --- | --- |
| Copper Coin | Before battle, add 1 to every attribute; initiative probability stays unchanged. |
| Silver Coin | The player's pet always attacks first. |
| Gold Coin | The player's pet always attacks second, but its first attack deals double damage. |

- Implementation work: coin selection/use, server-resolved initiative, first-
  attack damage modifier, and coin/toss presentation in the battle scene.
- Coin selection, consumption, bonus duration, and conflicting PvP effects need
  explicit rules before implementation.

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

- Are layouts fixed or generated? How does the player descend, leave, or resume?
- Do monsters move once per player step, or in real time? Can they move diagonally?
  How long do they pursue after the pet leaves detection range?
- Does entering an enemy's block trigger battle, or does adjacency trigger it?
- What happens on defeat, and does HP/MP persist between encounters or floors?
- Are adventures limited by energy, entry cost, cooldown, or daily attempts?
- What are the floor stat curves, enemy counts, boss abilities, and completion rewards?
- Which abilities can drop, what are their MP costs, and how does automatic combat
  choose between learned abilities and Claw Strike?
- What do food, soap, and hourglasses do, and how many items does a chest award?
- Are coins consumable or equipped? Is Copper's attribute bonus battle-only or
  permanent, and does it also increase derived HP/MP?
- How are the three coin types distributed within the 5% coin reward category?
- Does the new initiative system apply to Arena and revenge as well as Adventure?
  In PvP, who is the "player" for the toss, and which coin wins if effects conflict?
- What touch controls should mobile Adventure use? Preserve existing phone layout.
