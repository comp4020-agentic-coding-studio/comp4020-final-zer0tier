// Game time runs TIME_SCALE times faster than real time. Production leaves it
// at 1; the spec runs the app at 36000 (a game hour in 0.1 s) so it can watch
// lessons and shifts finish.
const scale = Number(process.env.TIME_SCALE ?? 1);
export const TIME_SCALE = Number.isFinite(scale) && scale > 0 ? scale : 1;

// Real milliseconds a game activity of `minutes` takes.
export const realMs = (minutes: number): number => Math.round((minutes * 60_000) / TIME_SCALE);
