// All WebSocket clients share the same public arena.
export const ROOM = "arena";

type LogValue = string | number | boolean;
type LogEvent = "join" | "leave" | "action" | "broadcast" | "reject" | "snapshot" | "action_result";

// Quote whitespace and control characters so one event always stays on one
// line. Callers supply metadata only, never cookies, passwords or state bodies.
function valueText(value: LogValue): string {
  if (typeof value !== "string") return String(value);
  const bounded = value.length > 512 ? `${value.slice(0, 512)}…` : value;
  return /^[A-Za-z0-9_./:@-]+$/.test(bounded) ? bounded : JSON.stringify(bounded);
}

export function logEvent(event: LogEvent, fields: Record<string, LogValue>): void {
  console.log(Object.entries({ event, ...fields }).map(([key, value]) => `${key} = ${valueText(value)}`).join(" "));
}
