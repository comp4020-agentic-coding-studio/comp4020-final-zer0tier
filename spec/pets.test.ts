import { expect, it } from "vitest";
import { PASSWORD, baseUrl, finish, freshId, post, sessionFor, signIn, signUp } from "./helpers.ts";

const me = (cookie?: string): Promise<Response> =>
  fetch(new URL("/api/me", baseUrl), { headers: cookie ? { cookie } : {} });

it("signing up creates a pet with base stats and starts a session", async () => {
  const id = freshId();
  const res = await signUp(id);
  expect(res.status).toBe(201);
  expect(res.headers.getSetCookie()[0]).toMatch(/^session=[^;]+;.*HttpOnly.*SameSite=Lax/i);
  expect(await res.json()).toEqual({
    id,
    strength: 5,
    intelligence: 5,
    charisma: 5,
    money: 0,
    activity: "idle",
    school: "primary",
    credits: 0,
    stamina: 100,
    hygiene: 100,
    food: 0,
    soap: 0,
    hourglass: 0,
    jobs: { construction: 0, office: 0, theatre: 0 },
    task: null,
    busySince: null,
    busyUntil: null,
    reward: null,
    wins: 0,
    losses: 0,
  });
  expect(await (await me(sessionFor(id))).json()).toMatchObject({ id });
});

it("each ID has one account and one pet: signing up again with it is refused", async () => {
  const id = freshId();
  await signUp(id);
  const again = await signUp(id, "another password");
  expect(again.status).toBe(409);
  expect((await again.json()).error).toMatch(/taken/i);
});

it("signing in brings back the same pet", async () => {
  const id = freshId();
  await signUp(id);
  await post(`/api/pets/${id}/study/math`);
  await finish(id);

  const res = await signIn(id);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id, intelligence: 6 });
});

it("refuses a wrong password or an unknown ID, without saying which", async () => {
  const id = freshId();
  await signUp(id);
  const wrong = await signIn(id, "not the password");
  const unknown = await signIn(freshId());
  expect([wrong.status, unknown.status]).toEqual([401, 401]);
  expect((await wrong.json()).error).toBe((await unknown.json()).error);
});

it("after 5 wrong passwords for an ID, its sign-ins wait 15 minutes, even with the right password", async () => {
  const id = freshId();
  await signUp(id);
  for (let i = 0; i < 5; i++) expect((await signIn(id, "guess number " + i)).status).toBe(401);
  const locked = await signIn(id);
  expect(locked.status).toBe(429);
  expect((await locked.json()).error).toMatch(/15 minutes/);

  const other = freshId(); // other IDs are unaffected
  await signUp(other);
  expect((await signIn(other)).status).toBe(200);
});

it("nobody can sign up or sign in as the bot", async () => {
  expect((await signUp("0")).status).toBe(409);
  expect((await signIn("0")).status).toBe(401);
});

it.each([["", "empty"], ["a".repeat(33), "too long"], ["x'; DROP TABLE pets;--", "SQL"]])(
  "rejects the ID %j (%s)",
  async (id) => {
    expect((await signUp(id)).status).toBe(400);
    expect((await signIn(id)).status).toBe(400);
  },
);

it("rejects a password shorter than 8 characters", async () => {
  expect((await signUp(freshId(), "short")).status).toBe(400);
});

it("only a pet's owner can act for it", async () => {
  const id = freshId();
  const other = freshId();
  await signUp(id);
  await signUp(other);
  expect((await post(`/api/pets/${id}/study/math`, undefined, null)).status).toBe(401);
  const stranger = await post(`/api/pets/${id}/study/math`, undefined, other);
  expect(stranger.status).toBe(403);
  expect((await post(`/api/pets/${id}/study/math`)).status).toBe(200);
});

it("signing out ends the session", async () => {
  const id = freshId();
  await signUp(id);
  const cookie = sessionFor(id)!;
  expect((await me(cookie)).status).toBe(200);
  const out = await fetch(new URL("/api/signout", baseUrl), { method: "POST", headers: { cookie } });
  expect(out.status).toBe(204);
  expect((await me(cookie)).status).toBe(401);
  expect((await post(`/api/pets/${id}/study/math`)).status).toBe(401);
  expect((await signIn(id, PASSWORD)).status).toBe(200);
});

it("404s when looking up a pet that doesn't exist", async () => {
  expect((await fetch(new URL(`/api/pets/${freshId()}`, baseUrl))).status).toBe(404);
});
