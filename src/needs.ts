// Needs that drop over time: while its owner is away, a pet slowly gets
// hungry and grubby, so there's a reason to come back, and something for
// visitors to put right by feeding and cleaning it. It's gentle by design:
// each need drops at most 2 points an hour and stops at a floor that still
// covers an hour's shift or a fight, so a neglected pet can always earn its
// way back. It never pushes a need that is already lower (say after a long
// shift) any further down.
//
// This is a balance change under play-test, so it's off unless NEEDS_DECAY is
// "on". Off, needs only change when the pet studies, works, fights, or is fed
// and cleaned, as before.
//
// Nothing runs in the background. Each pet keeps needs_at, the moment from
// which it starts getting hungrier; whenever the game brings the pet up to date
// it works out what was lost since then, applies it, and moves needs_at on.
// While the owner is online, or the pet is studying or working (which already
// costs it), nothing is lost. Decay follows real time, never the fast test
// clock, like the daily limits.
export const NEEDS_DECAY = {
  enabled: process.env.NEEDS_DECAY === "on",
  perHour: { stamina: 2, hygiene: 2 },
  floor: { stamina: 30, hygiene: 30 },
} as const;

const HOUR_MS = 60 * 60 * 1000;

type Decaying = {
  stamina: number;
  hygiene: number;
  needsAt: number | null;
  busySince: number | null;
  busyUntil: number | null;
};

// Away time between `from` and `to` that counts, leaving out any part spent
// studying or working.
function idleMs(pet: Decaying, from: number, to: number): number {
  let ms = Math.max(0, to - from);
  if (pet.busySince !== null && pet.busyUntil !== null) {
    const overlap = Math.min(to, pet.busyUntil) - Math.max(from, pet.busySince);
    if (overlap > 0) ms -= overlap;
  }
  return ms;
}

// How much one need falls over `ms` of away time, never below its floor and
// never at all if it's already there or lower.
function fallen(value: number, perHour: number, floor: number, ms: number): number {
  if (value <= floor) return value;
  return Math.max(floor, value - Math.floor((perHour * ms) / HOUR_MS));
}

// Brings `pet`'s needs up to `now`, in place. `away` says whether its owner is
// away (offline); time while they're here costs nothing, and needs_at simply
// moves on. Only whole points are taken. Away time too short for a whole point
// stays owed (needs_at doesn't move), so a player who checks in often still
// loses the same amount as one who stays away, never less.
export function decay(pet: Decaying, now: number, away: boolean): void {
  const from = pet.needsAt ?? now;
  if (!NEEDS_DECAY.enabled || !away || now <= from) {
    pet.needsAt = Math.max(from, now);
    return;
  }
  const ms = idleMs(pet, from, now);
  pet.stamina = fallen(pet.stamina, NEEDS_DECAY.perHour.stamina, NEEDS_DECAY.floor.stamina, ms);
  pet.hygiene = fallen(pet.hygiene, NEEDS_DECAY.perHour.hygiene, NEEDS_DECAY.floor.hygiene, ms);
  // Carry the part of a point still owed: needs_at moves on only by the idle
  // time the whole points used, so checking in often loses no more and no less.
  // Busy time in between has already been left out, so it's skipped too.
  const pointMs = HOUR_MS / Math.max(NEEDS_DECAY.perHour.stamina, NEEDS_DECAY.perHour.hygiene);
  const owed = ms % pointMs;
  pet.needsAt = now - owed;
}
