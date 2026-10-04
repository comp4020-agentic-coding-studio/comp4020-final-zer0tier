import { expect, it } from "vitest";
import { finish, freshId, getPet, getRules, post, workHour, signUp } from "./helpers.ts";

async function newPet(): Promise<string> {
  const id = freshId();
  await signUp(id);
  return id;
}

const act = async (id: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await post(`/api/pets/${id}/${path}`, body);
  return { status: res.status, body: await res.json() };
};

// Real milliseconds `minutes` of game time take on the app's clock.
const realMs = async (minutes: number): Promise<number> => (minutes * 60_000) / (await getRules()).timeScale;

it("publishes the shift lengths and the 30-minute lesson", async () => {
  const { work, study } = await getRules();
  expect(work.shiftMinutes).toEqual([15, 30, 60, 120, 240]);
  expect(study.minutes).toBe(30);
});

it("a lesson takes 30 minutes, and its points and credit arrive when it ends", async () => {
  const id = await newPet();
  const startedAt = Date.now();
  const { body } = await act(id, "study/math");
  expect(body).toMatchObject({ activity: "studying", task: "Math", intelligence: 5, credits: 0 });
  expect(body.reward).toMatchObject({ intelligence: 1, credits: 1 });
  expect(body.busyUntil - startedAt).toBeGreaterThanOrEqual((await realMs(30)) - 50);
  expect(body.busyUntil - startedAt).toBeLessThanOrEqual((await realMs(30)) + 200);
  expect(body.busyUntil - body.busySince).toBe(Math.round(await realMs(30)));
  expect(await finish(id)).toMatchObject({
    activity: "idle", task: null, busySince: null, busyUntil: null, reward: null, intelligence: 6, credits: 1,
  });
});

it("a shift's costs and pay scale with its length, and the pay arrives when it ends", async () => {
  const id = await newPet();
  const short = await act(id, "work/office", { minutes: 15 });
  expect(short.body).toMatchObject({ activity: "working", task: "Office", money: 0, stamina: 97, hygiene: 95 });
  expect((await finish(id)).money).toBe(6); // a quarter of the $25 hour, rounded

  const long = await act(id, "work/office", { minutes: 240 });
  expect(long.body).toMatchObject({ money: 6, stamina: 57, hygiene: 15 });
  expect((await finish(id)).money).toBe(6 + 100);
});

it("refuses a shift length that isn't on offer", async () => {
  const id = await newPet();
  for (const minutes of [45, 0, "60", undefined]) {
    expect((await post(`/api/pets/${id}/work/theatre`, { minutes })).status).toBe(400);
  }
  expect((await getPet(id)).activity).toBe("idle");
});

it("a busy pet can't start another lesson or shift, but can still shop and eat", async () => {
  const id = await newPet();
  await workHour(id);
  expect((await act(id, "work/construction", { minutes: 240 })).status).toBe(200);

  const study = await act(id, "study/pe");
  expect(study.status).toBe(409);
  expect(study.body.error).toMatch(/busy working at the construction site/i);
  expect((await act(id, "work/office", { minutes: 15 })).status).toBe(409);

  expect((await act(id, "buy/food")).status).toBe(200);
  // 90 after the first hour, 40 for the 4-hour shift, then +40 from the food.
  expect((await act(id, "use/food")).body).toMatchObject({ activity: "working", food: 0, stamina: 90 });
  expect((await finish(id)).money).toBe(10 + 100);
});

// Works two hours (for $50) and buys an hourglass, leaving $10.
async function withHourglass(): Promise<string> {
  const id = await newPet();
  await workHour(id);
  await workHour(id);
  expect((await act(id, "buy/hourglass")).body).toMatchObject({ money: 10, hourglass: 1 });
  return id;
}

it("an hourglass ($40) finishes a shift on the spot, with its full pay", async () => {
  const id = await withHourglass();
  // Two hours' work leaves hygiene 60: enough for a 2-hour shift (−40).
  expect((await act(id, "work/construction", { minutes: 120 })).body.activity).toBe("working");
  const { status, body } = await act(id, "use/hourglass");
  expect(status).toBe(200);
  expect(body).toMatchObject({ activity: "idle", busyUntil: null, reward: null, hourglass: 0, money: 10 + 50 });
  expect((await act(id, "work/office", { minutes: 15 })).status).toBe(200); // free to start something new
});

it("an hourglass finishes a lesson, with its points and credit", async () => {
  const id = await withHourglass();
  await act(id, "study/math");
  expect((await act(id, "use/hourglass")).body).toMatchObject({ activity: "idle", intelligence: 6, credits: 1 });
});

it("refuses an hourglass when the pet isn't busy, or has none, and keeps it", async () => {
  const id = await withHourglass();
  const idle = await act(id, "use/hourglass");
  expect(idle.status).toBe(409);
  expect(idle.body.error).toMatch(/nothing to skip/i);
  expect((await getPet(id)).hourglass).toBe(1);

  const other = await newPet();
  await act(other, "study/pe");
  const none = await act(other, "use/hourglass");
  expect(none.status).toBe(409);
  expect(none.body.error).toMatch(/no hourglass/i);
});
