import { expect, it } from "vitest";
import { baseUrl } from "./helpers.ts";

// invariants.test.ts checks the headings arrive; this checks they arrive as HTML.
it("serves README.md rendered as HTML at /readme/", async () => {
  const res = await fetch(new URL("/readme/", baseUrl));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/text\/html/);
  const html = await res.text();
  expect(html).toMatch(/<h1[^>]*>VirtuePets<\/h1>/);
  expect(html).not.toContain("# VirtuePets");
});

// The README argues what good means and links to the full guide; the guide
// carries every rule, control and the API, served at /guide/ with its headings.
it("serves docs/GUIDE.md rendered at /guide/, linked both ways with /readme/", async () => {
  const readme = await (await fetch(new URL("/readme/", baseUrl))).text();
  expect(readme).toContain('href="/guide/"');
  // The credits link must work from /readme/, not only on GitHub.
  expect(readme).toContain('href="https://github.com/comp4020-agentic-coding-studio/comp4020-final-zer0tier/blob/main/CREDITS.md"');
  expect(readme).not.toContain('href="CREDITS.md"');
  const res = await fetch(new URL("/guide/", baseUrl));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/text\/html/);
  const guide = await res.text();
  expect(guide).toMatch(/<h1[^>]*>VirtuePets player and developer guide<\/h1>/);
  expect(guide).toContain('href="/readme/"');
  for (const heading of ["Playing", "Town goal", "Friends", "How it&#39;s built", "Adventure exploration"]) {
    expect(guide).toMatch(new RegExp(`<h[23][^>]*>${heading}</h[23]>`));
  }
});
