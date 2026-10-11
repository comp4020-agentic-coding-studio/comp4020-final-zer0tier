# Crit 9: All at once

## What was the breakthrough that moved the work forward?

The breakthrough was looking outside QQ Pets for what would make the game
worth returning to beyond raising stats. I took inspiration from modern
mobile RPGs, which led directly to Adventure: a five-floor dungeon the pet
explores instead of just training through repeated clicks. Pokémon gave me
the next idea on top of that — rather than one generic auto-battle, I wanted
dedicated battle scenes and a small set of distinct abilities (Claw Strike,
Firebolt, Heavy Strike) that a pet learns and chooses between, plus items and
coins that change how a fight plays out. Combining those two influences is
what turned "click a button, wait, repeat" into something that felt like it
had actual play in it, and made the game more interactive and entertaining
rather than a to-do list with a pet attached.

## What did this work change about who I want to be as a software developer?

Building Adventure significantly improved how I think about designing a
game that's actually enjoyable, not just technically complete — pacing
exploration against battles, and giving the player choices (which ability,
which coin) that matter, rather than one correct action. At the same time,
it reminded me how important it is to understand the fundamentals myself
before developing with AI. The agent can implement a rule quickly, but it
can't decide on its own whether that rule is fun or matches what I actually
meant — I still had to specify exactly how abilities and coins should
behave, and catch and correct the places where the AI's assumptions didn't
match. AI still needs a human to correct it; it's a multiplier on the work,
not a replacement for knowing what I'm asking for.
