import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { baseUrl, freshId, getRules, signUp } from "./helpers.ts";

it("shows saved thefts on login, prevents duplicate clicks, and waits for broadcasts to update rewards", async () => {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync("public/index.html", "utf8"), { url: baseUrl, runScripts: "outside-only" });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof window.WebSocket;
  let pending = [{ id: 1, thief: "sneaky", victim: pet.id, amount: 20, stolenAt: new Date().toISOString() }];
  let finish: (response: Response) => void = () => {};
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/revenge/")) return new Promise<Response>((resolve) => { finish = resolve; });
    if (url === "/api/thefts") return Response.json(pending);
    if (url === "/api/me") return Response.json(pet);
    if (url === "/api/rules") return Response.json(rules);
    if (url === "/api/signout") return new Response(null, { status: 204 });
    if (url.startsWith("/api/")) return Response.json([]);
    throw new Error(`Unexpected request ${url} ${options?.method}`);
  });
  window.fetch = requests as typeof fetch;
  try {
    window.eval(readFileSync("public/app.js", "utf8"));
    await vi.waitFor(() => expect($("theft-notifications").hidden).toBe(false));
    expect($("theft-list").textContent).toContain("sneaky stole $20");
    expect($("theft-list").textContent).toContain("$40");
    const button = $("theft-list").querySelector("button")!;
    button.click(); button.click();
    expect(requests.mock.calls.filter(([url]) => url.includes("/revenge/"))).toHaveLength(1);
    expect(button.disabled).toBe(true);
    finish(Response.json({ error: "The thief needs $40 to pay the full reward. Try again later." }, { status: 409 }));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect($("theft-error").textContent).toContain("needs $40");
    expect($("theft-list").querySelector("button")).not.toBeNull();
    button.click();
    pending = [];
    finish(Response.json({ won: true, reward: 40 }));
    await vi.waitFor(() => expect($("theft-status").textContent).toContain("Revenge succeeded"));
    await vi.waitFor(() => expect($("theft-list").querySelector("button")).toBeNull());
    expect($("stat-money").textContent).toBe(String(pet.money));
    socket.dispatchEvent(new window.MessageEvent("message", { data: JSON.stringify({ type: "pet:updated",
      pet: { ...pet, money: pet.money + 40, strength: 6, intelligence: 6, charisma: 6 } }) }));
    expect($("stat-money").textContent).toBe(String(pet.money + 40));
    expect($("stat-strength").textContent).toBe("6");
    $("signout").click();
    await vi.waitFor(() => expect($("theft-notifications").hidden).toBe(true));
    expect($("theft-list").textContent).toBe("");
  } finally { window.close(); }
});

it('isolates pending revenge requests across sign-out and a new login', async () => {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  window.WebSocket = function () { return new window.EventTarget(); } as unknown as typeof window.WebSocket;
  const finishes: ((response: Response) => void)[] = [];
  window.fetch = (async (url: string) => {
    if (url.includes('/revenge/')) return new Promise<Response>((resolve) => finishes.push(resolve));
    if (url === '/api/thefts') return Response.json([{ id: 1, thief: 'sneaky', victim: pet.id, amount: 20, stolenAt: new Date().toISOString() }]);
    if (url === '/api/me' || url === '/api/signin') return Response.json(pet);
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/signout') return new Response(null, { status: 204 });
    return Response.json([]);
  }) as typeof fetch;
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    await vi.waitFor(() => expect($('theft-list').querySelector('button')).not.toBeNull());
    $('theft-list').querySelector('button')!.click();
    expect(finishes).toHaveLength(1);
    $('signout').click();
    await vi.waitFor(() => expect($('login').hidden).toBe(false));
    $('login').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($('theft-list').querySelector('button')).not.toBeNull());
    const next = $('theft-list').querySelector('button')!;
    expect(next.disabled).toBe(false);
    next.click();
    expect(finishes).toHaveLength(2);
    finishes[0](Response.json({ won: true, reward: 40 }));
    // Let the old request's continuation and finally block finish.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(next.disabled).toBe(true);
    expect($('theft-status').textContent).toBe('Taking revenge…');
    finishes[1](Response.json({ error: 'The thief cannot pay yet.' }, { status: 409 }));
    await vi.waitFor(() => expect(next.disabled).toBe(false));
    expect($('theft-error').textContent).toBe('The thief cannot pay yet.');
  } finally { window.close(); }
});
