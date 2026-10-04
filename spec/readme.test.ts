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
