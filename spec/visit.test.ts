import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { baseUrl, freshId, getRules, signUp } from "./helpers.ts";

async function page() {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const opponent = { ...pet, id: "neighbour", money: 75, appearance: "cat", color: "#123456" };
  const poor = { ...opponent, id: "poor", money: 9 };
  const bot = { ...opponent, id: rules.botId };
  const dom = new JSDOM(readFileSync("public/index.html", "utf8"), { url: baseUrl, runScripts: "outside-only" });
  const { window } = dom;
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof window.WebSocket;
  let finishPost: (response: Response) => void = () => {};
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") return new Promise<Response>((resolve) => { finishPost = resolve; });
    if (url === "/api/rules") return Response.json(rules);
    if (url === "/api/me") return Response.json(pet);
    if (url === "/api/pets?limit=20") return Response.json([pet, opponent, poor, bot]);
    if (url.endsWith("/fights") || url.startsWith("/api/feed?")) return Response.json([]);
    const found = [opponent, poor, bot].find((p) => url === `/api/pets/${p.id}`);
    if (found) return Response.json(found);
    throw new Error(`Unexpected request: ${url}`);
  });
  window.fetch = requests as typeof fetch;
  const send = (event: unknown) => socket.dispatchEvent(new window.MessageEvent("message", { data: JSON.stringify(event) }));
  const $ = (id: string) => window.document.getElementById(id)!;
  window.eval(readFileSync("public/app.js", "utf8"));
  await vi.waitFor(() => expect(window.document.querySelectorAll(".visit-btn")).toHaveLength(3));
  const visit = async (id: string) => {
    (window.document.querySelector(`.visit-btn[data-pet="${id}"]`) as HTMLButtonElement).click();
    await vi.waitFor(() => expect($("steal-hint").textContent).not.toBe("Loading pet…"));
  };
  return { dom, window, $, pet, opponent, requests, send, visit, finish: (res: Response) => finishPost(res) };
}

it("visits the saved pet, prevents duplicate requests and shows broadcast money and protection", async () => {
  const p = await page();
  const { $, pet, opponent } = p;
  const steal = $("steal") as HTMLButtonElement;
  try {
    await p.visit(opponent.id);
    expect($("visit").hidden).toBe(false);
    expect(p.window.document.activeElement).toBe($("visit-heading"));
    expect($("visit-avatar").getAttribute("data-appearance")).toBe("cat");
    expect($("visit-money").textContent).toBe("$75 saved");
    expect(steal.disabled).toBe(false);
    steal.click();
    steal.click();
    expect(steal.disabled).toBe(true);
    expect(steal.textContent).toBe("Stealing…");
    expect(p.requests.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(p.requests).toHaveBeenCalledWith(`/api/pets/${pet.id}/steal/${opponent.id}`, { method: "POST" });
    const protectedPet = { ...opponent, money: 55, stealAvailableAt: Date.now() + 86_400_000 };
    p.send({ type: "pet:updated", pet: { ...pet, money: 20 } });
    p.send({ type: "pet:updated", pet: protectedPet });
    p.finish(Response.json({ amount: 20 }));
    await vi.waitFor(() => expect($("steal-news").textContent).toBe("You stole $20 from neighbour!"));
    expect($("stat-money").textContent).toBe("20");
    expect($("visit-money").textContent).toBe("$55 saved");
    expect(steal.disabled).toBe(true);
    expect($("steal-hint").textContent).toMatch(/Already robbed today/);
    p.send({ type: "feed:added", entry: { id: 1, kind: "stole", pet: pet.id, other: opponent.id, amount: 20, at: new Date().toISOString() } });
    expect($("feed").textContent).toContain("You stole $20 from neighbour.");
    $("visit-close").click();
    expect($("visit").hidden).toBe(true);
    expect((p.window.document.activeElement as HTMLElement).dataset.pet).toBe(opponent.id);
  } finally {
    p.dom.window.close();
  }
});

it("explains poor and bot targets, handles a competing theft and notifies the victim", async () => {
  const p = await page();
  const { $, pet, opponent } = p;
  const steal = $("steal") as HTMLButtonElement;
  try {
    await p.visit("poor");
    expect(steal.disabled).toBe(true);
    expect($("steal-hint").textContent).toContain("at least $10");
    await p.visit("0");
    expect(steal.disabled).toBe(true);
    expect($("steal-hint").textContent).toContain("bot doesn't take part");
    await p.visit(opponent.id);
    steal.click();
    p.send({ type: "pet:updated", pet: { ...opponent, money: 60, stealAvailableAt: Date.now() + 60_000 } });
    p.finish(Response.json({ error: "Someone already stole from this pet today." }, { status: 429 }));
    await vi.waitFor(() => expect($("steal-error").textContent).toContain("already stole"));
    expect(steal.disabled).toBe(true);
    expect($("steal-news").textContent).toBe("");
    p.send({ type: "feed:added", entry: { id: 2, kind: "stole", pet: opponent.id, other: pet.id, amount: 10, at: new Date().toISOString() } });
    expect($("notice").textContent).toContain("neighbour stole $10 from your pet");
    expect($("feed").textContent).toContain("neighbour stole $10 from you.");
  } finally {
    p.dom.window.close();
  }
});

it("re-enables stealing when daily protection expires without needing a reload", async () => {
  const p = await page();
  try {
    await p.visit(p.opponent.id);
    const now = Date.now();
    const clock = vi.spyOn(p.window.Date, "now").mockReturnValue(now);
    p.send({ type: "pet:updated", pet: { ...p.opponent, stealAvailableAt: now + 1000 } });
    expect((p.$("steal") as HTMLButtonElement).disabled).toBe(true);
    clock.mockReturnValue(now + 1000);
    await vi.waitFor(() => expect((p.$("steal") as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });
    clock.mockRestore();
  } finally {
    p.dom.window.close();
  }
});
