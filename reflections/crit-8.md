# Crit 8: It's alive!

## What was the breakthrough that moved the work forward?

The breakthrough was treating my own play-testing as part of the harness. The
spec was green the whole time, yet when I played the game I found that a
15-minute shift finished instantly and that a new pet I signed up in another window
never appeared in my Arena. Neither was caught by a test, because the tests were checking what I
had asked for, not what a player would notice. Once I reported what I saw rather
than asking for a retry, each problem led somewhere real: the fast test clock
leaking into my game server, timestamps that broke when WSL's clock jumped
backwards, and an Arena that only loaded once. Each fix came with a new test or a
rule in CLAUDE.md, so the same mistake can't quietly come back.

## What did this work change about who I want to be as a software developer?

I want to be the developer who decides what good means and then holds the work
to it, rather than the one who types every line. Directing an agent made the
decisions visible: how a tired pet should recover, what an hourglass should
cost, whether a bot should be playable. Those were mine to make, and the
quality of the game came more from those choices and from checking the results
than from the code itself. I also learned to commit as I go; my first commit
holds a whole day of work, and that's the one part of this week's record I
can't explain step by step.
