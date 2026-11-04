import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { startBattle, takeBattleTurn } from '../src/combat.ts';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// A live Arena battle shows each saved turn from its battle:updated broadcast.
// The browser only re-reads the battle as a slow backstop, not every second.
it('shows broadcast turns at once and only re-reads a live battle every 10 seconds or on returning to the tab', async () => {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only', url: baseUrl });
  const { window } = dom, { document } = window;
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof WebSocket;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const intervals = vi.spyOn(window, 'setInterval');
  const battleReads: string[] = [];
  window.fetch = (async (url: string) => {
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url.startsWith('/api/battles')) { battleReads.push(url); return Response.json([]); }
    return Response.json([]);
  }) as typeof fetch;
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const broadcast = (event: unknown) => socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(event) }));
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/app.js', 'utf8'));
    await vi.waitFor(() => expect(document.getElementById('dashboard')!.hidden).toBe(false));
    const rival = { id: 'rival', strength: 4, intelligence: 4, charisma: 4 };
    const battle = startBattle([{ ...pet, equippedCoin: 'silver-coin' }], rival, [30, 10], { random: () => 0 });
    const session = { id: 'live-1', kind: 'arena', attacker: pet.id, defender: 'rival', battle };
    // app.js also runs a local one-second clock for activity timers; only the
    // battle re-read started by this battle matters here.
    const before = intervals.mock.calls.length;
    broadcast({ type: 'battle:updated', session });
    await vi.waitFor(() => expect((document.getElementById('battle-dialog') as HTMLDialogElement | null)?.open).toBe(true));
    expect(intervals.mock.calls.slice(before).map(([, delay]) => delay)).toEqual([10000]);
    // A later saved turn arrives by broadcast and shows without any re-read.
    const reads = battleReads.length;
    const next = takeBattleTurn(battle, battle.fighters[battle.actor!].id, 'claw-strike', battle.revision, () => 0);
    if ('error' in next) throw new Error(next.error);
    broadcast({ type: 'battle:updated', session: { ...session, battle: next } });
    // battle.js animates the turn on short timers, then shows the next choice.
    await vi.waitFor(() => expect(document.getElementById('battle-mode')!.textContent)
      .toMatch(new RegExp(`^Turn ${next.turns.length + 1} `)), { timeout: 4000 });
    expect(battleReads.length).toBe(reads);
    // Coming back to a hidden tab catches up straight away.
    hidden = true; document.dispatchEvent(new window.Event('visibilitychange'));
    expect(battleReads.length).toBe(reads);
    hidden = false; document.dispatchEvent(new window.Event('visibilitychange'));
    await vi.waitFor(() => expect(battleReads.length).toBeGreaterThan(reads));
    expect(battleReads.at(-1)).toMatch(/^\/api\/battles/);
  } finally { window.close(); }
});
