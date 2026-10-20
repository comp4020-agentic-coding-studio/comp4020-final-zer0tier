import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { baseUrl, freshId, getRules, signUp } from "./helpers.ts";

it("appearance controls wait for broadcasts, which update every pet view including older feed pets", async () => {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const older = { ...pet, id: "older-player", color: "#123456", appearance: "bird" };
  const dom = new JSDOM(readFileSync("public/index.html", "utf8"), { url: baseUrl, runScripts: "outside-only" });
  const { window } = dom;
  const { document } = window;
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof window.WebSocket;
  let finishPost: (response: Response) => void = () => {};
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") return new Promise<Response>((resolve) => { finishPost = resolve; });
    if (url === "/api/rules") return Response.json(rules);
    if (url === "/api/me") return Response.json(pet);
    if (url === "/api/pets?limit=20") return Response.json([pet]);
    if (url.endsWith("/fights")) return Response.json([]);
    if (url.startsWith("/api/feed?")) return Response.json([
      { id: 2, kind: "joined", pet: pet.id, at: new Date().toISOString() },
      { id: 1, kind: "joined", pet: older.id, at: new Date().toISOString() },
    ]);
    if (url === `/api/pets/${older.id}`) return Response.json(older);
    if (url.startsWith("/api/leaderboard?")) return Response.json([pet]);
    throw new Error(`Unexpected request: ${url}`);
  });
  window.fetch = requests as typeof fetch;
  const send = (row: typeof pet) => socket.dispatchEvent(new window.MessageEvent("message", {
    data: JSON.stringify({ type: "pet:updated", pet: row }),
  }));
  const avatar = () => document.getElementById("pet-avatar")!;
  const color = document.getElementById("pet-color") as HTMLInputElement;
  const shape = document.getElementById("pet-appearance") as HTMLSelectElement;
  const save = document.getElementById("appearance-save") as HTMLButtonElement;
  try {
    window.eval(readFileSync("public/app.js", "utf8"));
    await vi.waitFor(() => expect(document.querySelectorAll("#feed .pet")).toHaveLength(2));
    document.getElementById("tab-board")!.click();
    await vi.waitFor(() => expect(document.querySelectorAll("#board .pet")).toHaveLength(1));
    expect([...shape.options].map((option) => option.value)).toEqual([
      "cat", "dog", "hedgehog", "lizard", "panda", "bird", "dragon", "blob",
    ]);
    expect(avatar().getAttribute("data-appearance")).toBe("blob");
    expect(document.querySelector("#feed li:last-child .pet")?.getAttribute("data-appearance")).toBe("bird");

    color.value = "#abcdef";
    shape.value = "hedgehog";
    color.dispatchEvent(new window.Event("change", { bubbles: true }));
    shape.dispatchEvent(new window.Event("change", { bubbles: true }));
    // Unrelated updates must not erase an unsaved form draft.
    send({ ...pet, stamina: 90 });
    expect(color.value).toBe("#abcdef");
    expect(shape.value).toBe("hedgehog");
    expect(avatar().getAttribute("data-appearance")).toBe("blob");
    save.click();
    expect(requests).toHaveBeenCalledWith(`/api/pets/${pet.id}/appearance`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ color: "#abcdef", appearance: "hedgehog" }),
    }));
    expect(avatar().getAttribute("data-appearance")).toBe("blob");
    const changed = { ...pet, color: "#abcdef", appearance: "hedgehog" };
    finishPost(Response.json(changed));
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(avatar().getAttribute("data-appearance")).toBe("blob");
    expect(document.getElementById("appearance-status")!.textContent).toBe("Waiting for live update…");

    send(changed);
    for (const selector of ["#pet-avatar", "#board .pet", "#feed li:first-child .pet"]) {
      const svg = document.querySelector(selector) as SVGElement;
      expect(svg.dataset.appearance).toBe("hedgehog");
      expect(svg.style.getPropertyValue("--pet-color")).toBe("#abcdef");
      expect(svg.querySelector("use")!.getAttribute("href")).toBe("#pet-hedgehog");
    }
    expect(document.getElementById("appearance-status")!.textContent).toBe("Appearance saved.");

    // Each new animal remains a draft until its saved row reaches every view.
    for (const appearance of ["lizard", "panda"]) {
      const before = avatar().getAttribute("data-appearance");
      shape.value = appearance;
      shape.dispatchEvent(new window.Event("change", { bubbles: true }));
      save.click();
      expect(requests).toHaveBeenLastCalledWith(`/api/pets/${pet.id}/appearance`, expect.objectContaining({
        method: "POST", body: JSON.stringify({ color: "#abcdef", appearance }),
      }));
      const saved = { ...changed, appearance };
      finishPost(Response.json(saved));
      await vi.waitFor(() => expect(save.disabled).toBe(false));
      expect(avatar().getAttribute("data-appearance")).toBe(before);
      send(saved);
      for (const selector of ["#pet-avatar", "#board .pet", "#feed li:first-child .pet"]) {
        const svg = document.querySelector(selector) as SVGElement;
        expect(svg.dataset.appearance).toBe(appearance);
        expect(svg.style.getPropertyValue("--pet-color")).toBe("#abcdef");
        expect(svg.querySelector("use")!.getAttribute("href")).toBe(`#pet-${appearance}`);
      }
      expect(document.getElementById("appearance-status")!.textContent).toBe("Appearance saved.");
    }

    // This player wasn't in the initial arena list; its feed icon came from GET.
    expect(requests).toHaveBeenCalledWith(`/api/pets/${older.id}`);
    send({ ...older, color: "#987654", appearance: "cat" });
    for (const selector of ["#rivals .pet", "#feed li:last-child .pet"]) {
      const svg = document.querySelector(selector) as SVGElement;
      expect(svg.dataset.appearance).toBe("cat");
      expect(svg.style.getPropertyValue("--pet-color")).toBe("#987654");
    }

    shape.value = "dog";
    save.click();
    finishPost(Response.json({ error: "Couldn't save appearance." }, { status: 400 }));
    await vi.waitFor(() => expect(document.getElementById("appearance-error")!.textContent).toBe("Couldn't save appearance."));
    expect(avatar().getAttribute("data-appearance")).toBe("panda");
  } finally {
    window.close();
  }
});
