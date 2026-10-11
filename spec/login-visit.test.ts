import { expect, it } from "vitest";
import { baseUrl, freshId, sessionFor, signIn, signUp } from "./helpers.ts";

it.each(["/", "/index.html", "/?welcome=1"])("visiting %s revokes the old login and allows a fresh sign-in", async (path) => {
  const id = freshId();
  await signUp(id);
  const cookie = sessionFor(id)!;
  const me = () => fetch(new URL("/api/me", baseUrl), { headers: { cookie } });
  expect((await me()).status).toBe(200);
  // Loading assets must not end an active game session.
  await fetch(new URL("/app.js", baseUrl), { headers: { cookie } });
  expect((await me()).status).toBe(200);
  const page = await fetch(new URL(path, baseUrl), { headers: { cookie } });
  expect(page.status).toBe(200);
  expect(page.headers.get("cache-control")).toBe("no-store");
  expect(page.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await me()).status).toBe(401);
  const login = await signIn(id);
  expect(login.status).toBe(200);
  expect(await login.json()).toMatchObject({ id });
  expect((await fetch(new URL("/api/me", baseUrl), {
    headers: { cookie: sessionFor(id)! },
  })).status).toBe(200);
});
