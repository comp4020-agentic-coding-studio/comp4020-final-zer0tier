import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { baseUrl, freshId, getPet, getRules, post, signUp } from "./helpers.ts";

const nextUtcMidnight = (now: number) => {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime();
};

it("collects one free Food and one free Soap once per UTC day, into the normal stock", async () => {
  const id = freshId();
  await signUp(id);
  const before = Date.now();
  const res = await post(`/api/pets/${id}/collect-supplies`);
  expect(res.status).toBe(200);
  const pet = await res.json();
  expect(pet).toMatchObject({ food: 1, soap: 1, hourglass: 0, money: 0 });
  expect([nextUtcMidnight(before), nextUtcMidnight(Date.now())]).toContain(pet.suppliesAvailableAt);
  const again = await post(`/api/pets/${id}/collect-supplies`);
  expect(again.status).toBe(429);
  expect((await again.json()).error).toMatch(/already collected today/i);
  expect(await getPet(id)).toEqual(pet);
  // They're ordinary items: using one spends the shared count.
  expect((await post(`/api/pets/${id}/use/food`)).status).toBe(409); // stamina already full
  expect((await getRules()).freeSupplies).toEqual({ food: 1, soap: 1, resetTimezone: "UTC" });
});

it("grants exactly one collection to concurrent requests, and only to the signed-in owner", async () => {
  const id = freshId(), other = freshId();
  await signUp(id); await signUp(other);
  expect((await post(`/api/pets/${id}/collect-supplies`, undefined, null)).status).toBe(401);
  expect((await post(`/api/pets/${id}/collect-supplies`, undefined, other)).status).toBe(403);
  expect((await post(`/api/pets/no*such/collect-supplies`)).status).toBe(404);
  const statuses = await Promise.all(Array.from({ length: 6 }, async () => (await post(`/api/pets/${id}/collect-supplies`)).status));
  expect(statuses.filter((status) => status === 200)).toHaveLength(1);
  expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  expect(await getPet(id)).toMatchObject({ food: 1, soap: 1 });
  expect(await getPet(other)).toMatchObject({ food: 0, soap: 0, suppliesAvailableAt: null });
});

it("shows the free supplies button, posts once, and renders only what the broadcast says", async () => {
  const id = freshId();
  const pet = await (await signUp(id)).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync("public/index.html", "utf8"), { url: baseUrl, runScripts: "outside-only" });
  const { window } = dom;
  const $ = (name: string) => window.document.getElementById(name)!;
  const sockets: EventTarget[] = [];
  window.WebSocket = function () { const ws = new window.EventTarget(); sockets.push(ws); return ws; } as unknown as typeof window.WebSocket;
  const actions: string[] = [];
  window.fetch = (async (url: string) => {
    if (url === "/api/rules") return Response.json(rules);
    if (url === "/api/me") return Response.json(pet);
    if (url.endsWith("/collect-supplies")) { actions.push(url); return Response.json({ ...pet, food: 1, soap: 1 }); }
    return Response.json([]);
  }) as typeof fetch;
  const broadcast = (update: object) => sockets.forEach((ws) => ws.dispatchEvent(Object.assign(new window.Event("message"), {
    data: JSON.stringify({ type: "pet:updated", pet: { ...pet, ...update } }),
  })));
  try {
    window.eval(readFileSync("public/app.js", "utf8"));
    const button = $("collect-supplies") as HTMLButtonElement;
    await vi.waitFor(() => expect(button.textContent).toBe("Collect 1 Food + 1 Soap"));
    expect(button.disabled).toBe(false);
    expect($("free-supplies-text").textContent).toBe("Free once a day: 1 Food and 1 Soap for your stock.");
    button.click();
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(actions).toEqual([`/api/pets/${id}/collect-supplies`]));
    // Nothing optimistic: the count changes when the broadcast arrives.
    expect($("items").querySelector('[data-item="food"] .item-count')!.textContent).toBe("0");
    const tomorrow = nextUtcMidnight(Date.now());
    broadcast({ food: 1, soap: 1, suppliesAvailableAt: tomorrow });
    await vi.waitFor(() => expect(button.textContent).toBe("Collected today"));
    expect(button.disabled).toBe(true);
    expect($("items").querySelector('[data-item="food"] .item-count')!.textContent).toBe("1");
    expect($("free-supplies-text").textContent).toMatch(/^More at midnight UTC \(.+ your time\)\.$/);
    // Once midnight passes, the button wakes up again on its own.
    broadcast({ food: 1, soap: 1, suppliesAvailableAt: Date.now() + 1500 });
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    await vi.waitFor(() => expect(button.disabled).toBe(false), { timeout: 4000 });
    expect(button.textContent).toBe("Collect 1 Food + 1 Soap");
  } finally {
    window.close();
  }
});
