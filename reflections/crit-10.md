# Crit 10: Fly by instruments

## What was the breakthrough that moved the work forward?

The breakthrough was the idea of how to do real-time interaction: one player
doing something to another player's pet, and both of them seeing it at the
same moment. The way that works is that the action goes to the server first.
When you pat, feed or clean someone's pet on a visit, the server checks it's
really you, saves it, logs who did it, and broadcasts it to every window. Only
then does the pet react, in your window and in the owner's at the same time,
so neither screen can show something that didn't happen. The owner gets a
notice saying who helped, and their Recent visitors list keeps who came by.
The same pattern runs through this week's features: playing with pets,
helping with food and soap, and Adventure teams sharing one map with monsters
that move live for everyone on it.

## What did this work change about who I want to be as a software developer?

It changed my mind about how I might make multiplayer games in the future. I'd
now start from the shared state: decide what lives on the server, what every
player sees, what stays private to one player, and what each player is allowed
to do to someone else's things. In this game that meant a visitor can only
spend their own food and soap, and can only add to another pet, never take
from it. Getting those decisions right first is what makes a multiplayer game
fair, and it also makes the real-time part simpler, because every window just
shows what the server says rather than guessing.
