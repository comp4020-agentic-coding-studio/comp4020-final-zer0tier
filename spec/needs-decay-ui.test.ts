import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// The pet's needs say they drop while you're away only while the server has
// that play-test switched on; otherwise the page is as it was.
async function page(enabled: boolean) {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const needsDecay = { ...rules.needsDecay, enabled };
  const { window } = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  window.WebSocket = function () { return new window.EventTarget(); } as unknown as typeof window.WebSocket;
  window.fetch = vi.fn(async (url: string) => {
    if (url === '/api/rules') return Response.json({ ...rules, needsDecay });
    if (url === '/api/me') return Response.json(pet);
    return Response.json([]);
  }) as typeof fetch;
  window.eval(readFileSync('public/app.js', 'utf8'));
  await vi.waitFor(() => expect(window.document.getElementById('meter-stamina-value')!.textContent).toBe('100'));
  return { window, note: window.document.getElementById('needs-decay-note')! };
}

it('keeps the needs as they were while the drop-over-time play-test is off', async () => {
  const { window, note } = await page(false);
  try {
    expect((await getRules()).needsDecay.enabled).toBe(false); // the shared app runs as production does
    expect(note.hidden).toBe(true);
    expect(note.textContent).toBe('');
  } finally { window.close(); }
});

it('says how needs drop while away when the play-test is on', async () => {
  const { window, note } = await page(true);
  try {
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe("While you're away, stamina and hygiene slowly drop: 2 an hour, never below 30. Neighbours can feed and clean your pet while you're gone.");
  } finally { window.close(); }
});
