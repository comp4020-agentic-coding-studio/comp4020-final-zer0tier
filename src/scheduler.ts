import { followUp } from "./followups.ts";
import { busyUntilById, settle } from "./pets.ts";
import { broadcast } from "./realtime.ts";

// One timer per busy pet, so a finished lesson or shift reaches every client
// when it ends. The database's busy_until is the record; these timers are only
// reminders, rebuilt from it at boot by scheduleAll.
const timers = new Map<string, NodeJS.Timeout>();
// A timer's error would stop the whole server, so a database that another
// process briefly holds only delays the finish announcement.
const RETRY_MS = 1000;

export function schedule(id: string, busyUntil: number): void {
  clearTimeout(timers.get(id));
  const timer = setTimeout(() => {
    timers.delete(id);
    // The timer has waited out the activity, whatever the wall clock now says.
    let result: ReturnType<typeof settle>;
    try {
      result = settle(id, busyUntil);
    } catch (error) {
      console.error('could not settle a finished activity; retrying', error);
      timers.set(id, setTimeout(() => schedule(id, busyUntil), RETRY_MS));
      return;
    }
    if (result?.finished) {
      broadcast({ type: "pet:updated", pet: result.pet });
      // The finish is saved; the next accepted action repeats this follow-up.
      try { followUp(); } catch (error) { console.error('could not follow up a finished activity', error); }
    }
    // A newer activity is running (an hourglass skipped the old one, then a
    // new one began): wait for that one instead.
    else if (result?.pet.busyUntil) schedule(id, result.pet.busyUntil);
  }, Math.max(0, busyUntil - Date.now()));
  timers.set(id, timer);
}

export function scheduleAll(): void {
  for (const { id, busyUntil } of busyUntilById()) schedule(id, busyUntil);
}
