import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { baseUrl, freshId, getRules, must, post, sessionFor, signUp, workHour } from "./helpers.ts";

// The town goal against the running app. Other specs feed pets too, so these
// check what each meal adds, never the town's exact total.
async function players(count: number) {
  const ids = Array.from({ length: count }, () => freshId());
  for (const id of ids) await signUp(id);
  return ids;
}
const read = async (as?: string): Promise<any> => (await fetch(new URL("/api/town-goal", baseUrl), {
  headers: as ? { cookie: sessionFor(as)! } : {},
})).json();
// One Food from the free supplies, and a shift so the pet is hungry enough to eat it.
async function hungryWithFood(id: string) {
  await must(`/api/pets/${id}/collect-supplies`);
  await workHour(id);
}
async function open(owner?: string): Promise<WebSocket> {
  const socket = new WebSocket(new URL("/ws", baseUrl).href.replace(/^http/, "ws"), owner ? { headers: { cookie: sessionFor(owner)! } } : {});
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return socket;
}
function next(socket: WebSocket, matches: (event: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no matching event within 1s")), 1000);
    const listener = (data: Buffer) => {
      const event = JSON.parse(String(data));
      if (!matches(event)) return;
      clearTimeout(timer); socket.off("message", listener); resolve(event);
    };
    socket.on("message", listener);
  });
}

it("publishes this week's goal: 100 meals, a $25 and 1 Food reward, weeks from Monday UTC", async () => {
  const { townGoal } = await getRules();
  expect(townGoal).toEqual({ meals: 100, reward: { money: 25, food: 1 }, resetTimezone: "UTC" });
  const shared = await read();
  expect(shared).toMatchObject({ target: 100, reward: { money: 25, food: 1 } });
  expect(new Date(shared.week).getUTCDay()).toBe(1);
  expect(shared.endsAt - shared.week).toBe(7 * 24 * 60 * 60 * 1000);
  // Signed out, nobody's own share is shown.
  expect(shared).not.toHaveProperty("mine");
  const [me] = await players(1);
  expect((await read(me)).mine).toEqual({ meals: 0, claimed: false, canClaim: false });
});

it("counts feeding your own pet and feeding a neighbour's as your meals, but not soap", async () => {
  const [owner, visitor] = await players(2);
  await hungryWithFood(owner);
  await hungryWithFood(visitor);
  const before = (await read()).meals;
  await must(`/api/pets/${owner}/use/food`);
  expect((await read(owner)).mine.meals).toBe(1);
  await must(`/api/pets/${owner}/use/soap`);
  expect((await read(owner)).mine.meals).toBe(1);
  // A refused feeding (the pet is full again) counts for nothing.
  expect((await post(`/api/pets/${visitor}/help/${owner}`, { item: "food" })).status).toBe(409);
  expect((await read(visitor)).mine.meals).toBe(0);
  // After another shift it's hungry, and the neighbour's Food is the neighbour's meal.
  await workHour(owner);
  expect((await post(`/api/pets/${visitor}/help/${owner}`, { item: "food" })).status).toBe(200);
  expect((await read(visitor)).mine.meals).toBe(1);
  expect((await read(owner)).mine.meals).toBe(1);
  expect((await read()).meals).toBeGreaterThanOrEqual(before + 2);
});

it("refuses collecting without a session, without having helped, or before the town reaches the goal", async () => {
  const [me] = await players(1);
  expect((await post("/api/town-goal/claim", undefined, null)).status).toBe(401);
  const refused = await post("/api/town-goal/claim", undefined, me);
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toMatch(/Serve a meal this week|meals this week/);
});

it("town:goal reaches every open window within 1s of a meal, with the total as saved", async () => {
  const [feeder, watcher] = await players(2);
  await hungryWithFood(feeder);
  const sockets = [await open(feeder), await open(watcher), await open()];
  try {
    const arriving = sockets.map(socket => next(socket, event => event.type === "town:goal"));
    await must(`/api/pets/${feeder}/use/food`);
    const events = await Promise.all(arriving);
    const saved = await read();
    for (const event of events) {
      expect(event.goal).toMatchObject({ week: saved.week, target: 100, reward: { money: 25, food: 1 } });
      expect(event.goal.meals).toBeLessThanOrEqual(saved.meals);
      expect(event.goal).not.toHaveProperty("mine");
    }
    expect((await read(feeder)).mine.meals).toBe(1);
  } finally { sockets.forEach(socket => socket.close()); }
});
