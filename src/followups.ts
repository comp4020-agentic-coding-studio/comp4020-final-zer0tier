import { announce } from "./feed.ts";
import { matchBot } from "./pets.ts";
import { broadcast } from "./realtime.ts";
import { townGoalNews } from "./town-goal.ts";

// What follows from any change, once it's saved and broadcast: the bot keeps
// pace with the players, the town goal's bar moves if a meal was served, and
// the feed tells everyone what happened.
export function followUp(): void {
  const bot = matchBot();
  if (bot) broadcast({ type: "pet:updated", pet: bot });
  const goal = townGoalNews();
  if (goal) broadcast({ type: "town:goal", goal });
  announce();
}
