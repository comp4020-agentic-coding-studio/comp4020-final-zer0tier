import { announce } from "./feed.ts";
import { matchBot } from "./pets.ts";
import { broadcast } from "./realtime.ts";

// What follows from any change, once it's saved and broadcast: the bot keeps
// pace with the players, and the feed tells everyone what happened.
export function followUp(): void {
  const bot = matchBot();
  if (bot) broadcast({ type: "pet:updated", pet: bot });
  announce();
}
