import { busyUntilById, settle } from "./pets.ts";
import { broadcast } from "./realtime.ts";

// One timer per busy pet, so a finished lesson or shift reaches every client
// when it ends. The database's busy_until is the record; these timers are only
// reminders, rebuilt from it at boot by scheduleAll.
const timers = new Map<string, NodeJS.Timeout>();

export function schedule(id: string, busyUntil: number): void {
  clearTimeout(timers.get(id));
  const timer = setTimeout(() => {
    timers.delete(id);
    const result = settle(id);
    if (result?.finished) broadcast({ type: "pet:updated", pet: result.pet });
    // A timer can fire a hair early; try again at the recorded end.
    else if (result?.pet.busyUntil) schedule(id, result.pet.busyUntil);
  }, Math.max(0, busyUntil - Date.now()));
  timers.set(id, timer);
}

export function scheduleAll(): void {
  for (const { id, busyUntil } of busyUntilById()) schedule(id, busyUntil);
}
