import { inject } from "vitest";

export const baseUrl = inject("baseUrl");

// Specs run against a long-lived app, so every test claims a pet nobody has.
export const freshId = (): string => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const PASSWORD = "correct horse battery";

// Each signed-up pet's session cookie, so a test acts as that pet's owner.
const sessions = new Map<string, string>();

export const sessionFor = (id: string): string | undefined => sessions.get(id);

// POSTs as the owner of the pet in the path (/api/pets/:id/...), if the test
// signed it up; `as` overrides that (null: no session at all).
export async function post(path: string, body?: unknown, as?: string | null): Promise<Response> {
  const owner = as === undefined ? path.match(/^\/api\/pets\/([^/]+)\//)?.[1] : as;
  const cookie = owner ? sessions.get(owner) : undefined;
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Signs up (or in) and keeps the session cookie for later requests.
async function authenticate(path: string, id: string, password: string): Promise<Response> {
  const res = await post(path, { id, password }, null);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("session="));
  if (res.ok && cookie) sessions.set(id, cookie.split(";")[0]);
  return res;
}

export const signUp = (id: string, password = PASSWORD): Promise<Response> => authenticate("/api/signup", id, password);
export const signIn = (id: string, password = PASSWORD): Promise<Response> => authenticate("/api/signin", id, password);

export const getPet = async (id: string): Promise<any> => (await fetch(new URL(`/api/pets/${id}`, baseUrl))).json();

let rules: Promise<any> | undefined;
export const getRules = (): Promise<any> => (rules ??= fetch(new URL("/api/rules", baseUrl)).then((r) => r.json()));

export async function must(path: string, body?: unknown): Promise<any> {
  const res = await post(path, body);
  if (!res.ok) throw new Error(`${path} refused: ${(await res.json()).error}`);
  return res.json();
}

// Waits out the pet's lesson or shift and returns the pet once it's idle. The
// app has to run on a fast clock for this (TIME_SCALE, e.g. pnpm start:test).
export async function finish(id: string): Promise<any> {
  const { timeScale } = await getRules();
  if (timeScale < 3600) {
    throw new Error(`the app's TIME_SCALE is ${timeScale}; start it with pnpm start:test so activities finish quickly`);
  }
  for (let pet = await getPet(id), tries = 0; ; pet = await getPet(id), tries++) {
    if (pet.activity === "idle") return pet;
    if (tries > 300) throw new Error(`pet ${id} is still ${pet.activity}`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(5, Math.min(50, pet.busyUntil - Date.now()))));
  }
}

// Works an hour at `location` and waits for the shift to end.
export async function workHour(id: string, location = "construction"): Promise<any> {
  await must(`/api/pets/${id}/work/${location}`, { minutes: 60 });
  return finish(id);
}

// Plays the pet back into shape to study, the way a player would: use what's
// in the cupboard, buy what's missing, and work a shift when broke.
export async function readyToStudy(id: string): Promise<void> {
  const { study, items } = await getRules();
  for (let pet = await finish(id); ; ) {
    const low = items.find((item: any) => item.effect === "restore" && pet[item.restores] < study.needs[item.restores]);
    if (!low) return;
    if (pet[low.id] > 0) pet = await must(`/api/pets/${id}/use/${low.id}`);
    else if (pet.money >= low.price) pet = await must(`/api/pets/${id}/buy/${low.id}`);
    else pet = await workHour(id);
  }
}

// Studies `course` `times` times, looking after the pet in between, and
// returns the pet after the last lesson has finished.
export async function studyTimes(id: string, course: string, times: number): Promise<any> {
  let pet;
  for (let i = 0; i < times; i++) {
    await readyToStudy(id);
    await must(`/api/pets/${id}/study/${course}`);
    pet = await finish(id);
  }
  return pet;
}

// Works (and looks after the pet) until it can afford an hourglass, buys one,
// and leaves the pet fit to study or work. Returns the pet after all that.
export async function buyHourglass(id: string): Promise<any> {
  const { items } = await getRules();
  const { price } = items.find((item: any) => item.id === "hourglass");
  for (let pet = await getPet(id); pet.money < price; pet = await getPet(id)) {
    await readyToStudy(id);
    await workHour(id);
  }
  await must(`/api/pets/${id}/buy/hourglass`);
  await readyToStudy(id);
  return getPet(id);
}
