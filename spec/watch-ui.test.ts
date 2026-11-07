import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { startBattle, takeBattleTurn } from '../src/combat.ts';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

// The Arena's "Live now" stands: listing live fights, watching one without
// any controls over it, and the crowd count fighters and spectators both see.
async function setup() {
  const pet = await (await signUp(freshId())).json();
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only', url: baseUrl });
  const { window } = dom, { document } = window;
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof WebSocket;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const ana = { ...pet, id: 'ana', appearance: 'cat', color: '#123456' }, ben = { ...pet, id: 'ben', appearance: 'dog' };
  const battle = startBattle([ana], ben, [30, 10], { random: () => 0 });
  const session = { id: 'live-1', kind: 'arena', attacker: 'ana', defender: 'ben', battle };
  let live: any[] = [{ id: 'live-1', attacker: ana, defender: ben, watchers: 2 }];
  const posts: string[] = [];
  let seat: ((response: Response) => void) | null = null;
  window.fetch = (async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts.push(url);
      if (url.endsWith('/watch')) return new Promise<Response>(resolve => { seat = resolve; });
      return Response.json({ left: ['live-1'] });
    }
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url === '/api/arena/live') return Response.json(live);
    if (url === '/api/pets?limit=20') return Response.json([pet, ana, ben]);
    if (url === '/api/pets/cara') return Response.json({ ...pet, id: 'cara' });
    if (url === '/api/pets/dev') return Response.json({ ...pet, id: 'dev' });
    return Response.json([]);
  }) as typeof fetch;
  const send = (event: unknown) => socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify(event) }));
  const $ = (id: string) => document.getElementById(id)!;
  window.eval(readFileSync('public/battle.js', 'utf8'));
  window.eval(readFileSync('public/app.js', 'utf8'));
  await vi.waitFor(() => expect($('dashboard').hidden).toBe(false));
  return {
    window, document, $, pet, session, battle, posts, send,
    seat: (response: Response) => seat!(response), setLive: (next: any[]) => { live = next; },
  };
}

it('lists live fights with their crowd, watches one without skills or forfeit, and leaves the stands on Leave', async () => {
  const p = await setup();
  try {
    await vi.waitFor(() => expect(p.$('arena-live').hidden).toBe(false));
    const entry = p.$('arena-live-list').firstElementChild!;
    expect(entry.textContent).toContain('ana vs ben');
    expect(entry.textContent).toContain('2 watching');
    const watch = entry.querySelector('button')!;
    expect(watch.getAttribute('aria-label')).toBe('Watch ana versus ben');
    // One press asks for one seat; the button waits for the answer.
    watch.click();
    expect(p.posts).toEqual(['/api/arena/live/live-1/watch']);
    expect(p.$('arena-live-list').querySelector('button')!.textContent).toBe('Joining…');
    p.seat(Response.json({ watching: { id: 'live-1', attacker: 'ana', defender: 'ben', watchers: 3 }, session: p.session }));
    await vi.waitFor(() => expect((p.$('battle-dialog') as HTMLDialogElement).open).toBe(true));
    expect(p.$('battle-title').textContent).toBe('Arena: ana vs ben');
    expect(p.$('battle-watchers').textContent).toBe('3 watching from the stands');
    // Neither fighter is "you" from the stands.
    expect(p.$('battle-name-0').textContent).toBe('ana');
    expect(p.$('battle-name-1').textContent).toBe('ben');
    p.$('battle-opening-skip')?.click();
    await vi.waitFor(() => expect(p.$('battle-mode').textContent).toBe('Turn 1 · Watching'));
    expect(p.$('battle-status').textContent).toBe('Waiting for ana to choose a skill…');
    expect(p.$('battle-skills').hidden).toBe(true);
    expect(p.$('battle-close').textContent).toBe('Leave');
    // A turn arrives by broadcast and plays for the spectator.
    const next = takeBattleTurn(p.battle, 'ana', 'claw-strike', p.battle.revision, () => 0);
    if ('error' in next) throw new Error(next.error);
    p.send({ type: 'battle:updated', session: { ...p.session, battle: next } });
    await vi.waitFor(() => expect(p.$('battle-mode').textContent).toMatch(/^Turn 2 · Watching$/), { timeout: 4000 });
    // The crowd count updates live.
    p.send({ type: 'battle:watchers', watchers: { battle: 'live-1', count: 4, live: true } });
    expect(p.$('battle-watchers').textContent).toBe('4 watching from the stands');
    // Leave closes without asking to forfeit, and gives up the seat.
    p.$('battle-close').click();
    expect((p.$('battle-dialog') as HTMLDialogElement).open).toBe(false);
    expect(p.document.getElementById('confirm-dialog')).toBeNull();
    expect(p.posts).toEqual(['/api/arena/live/live-1/watch', '/api/arena/live/leave']);
    expect(p.$('arena-live-list').querySelector('button')!.textContent).toBe('Watch');
  } finally { p.window.close(); }
});

it('adds a starting fight and drops a finished one live, and never offers a fighter a seat at their own fight', async () => {
  const p = await setup();
  try {
    await vi.waitFor(() => expect(p.$('arena-live-list').children).toHaveLength(1));
    p.send({ type: 'battle:watchers', watchers: { battle: 'live-2', count: 0, live: true, attacker: 'cara', defender: 'dev' } });
    await vi.waitFor(() => expect(p.$('arena-live-list').children).toHaveLength(2));
    const added = [...p.$('arena-live-list').children].find(li => li.textContent!.includes('cara vs dev'))!;
    expect(added.textContent).toContain('No one watching yet');
    p.send({ type: 'battle:watchers', watchers: { battle: 'live-1', count: 0, live: false } });
    await vi.waitFor(() => expect(p.$('arena-live-list').children).toHaveLength(1));
    p.send({ type: 'battle:watchers', watchers: { battle: 'live-2', count: 0, live: false } });
    await vi.waitFor(() => expect(p.$('arena-live').hidden).toBe(true));
    // Your own live fight is listed as yours, with no Watch button.
    p.send({ type: 'battle:watchers', watchers: { battle: 'mine', count: 1, live: true, attacker: p.pet.id, defender: 'ana' } });
    await vi.waitFor(() => expect(p.$('arena-live').hidden).toBe(false));
    const mine = p.$('arena-live-list').firstElementChild!;
    expect(mine.textContent).toContain('You vs ana');
    expect(mine.querySelector('button')).toBeNull();
  } finally { p.window.close(); }
});

it('shows the three biggest crowds first and the rest on request, keeping the pets list in reach', async () => {
  const p = await setup();
  try {
    await vi.waitFor(() => expect(p.$('arena-live-list').children).toHaveLength(1));
    for (const [id, count] of [['quiet', 0], ['busy', 9], ['middling', 4]] as const) {
      p.send({ type: 'battle:watchers', watchers: { battle: id, count, live: true, attacker: 'cara', defender: 'dev' } });
    }
    const more = p.$('arena-live-more') as HTMLButtonElement;
    await vi.waitFor(() => expect(more.hidden).toBe(false));
    const crowds = () => [...p.$('arena-live-list').children].map(li => li.querySelector('.arena-live-crowd')!.textContent);
    expect(crowds()).toEqual(['9 watching', '4 watching', '2 watching']);
    expect(more.textContent).toBe('Show all 4 live fights');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    expect(crowds()).toEqual(['9 watching', '4 watching', '2 watching', 'No one watching yet']);
    expect(more.textContent).toBe('Show fewer');
    expect(more.getAttribute('aria-expanded')).toBe('true');
  } finally { p.window.close(); }
});

it('shows a fighter how many are watching their fight', async () => {
  const p = await setup();
  try {
    await vi.waitFor(() => expect(p.$('arena-live-list').children).toHaveLength(1));
    const own = startBattle([p.pet], { ...p.pet, id: 'ana' }, [30, 10], { random: () => 0 });
    // The server sends the fight's first turn, then the news that it started.
    p.send({ type: 'battle:updated', session: { id: 'duel', kind: 'arena', attacker: p.pet.id, defender: 'ana', battle: own } });
    p.send({ type: 'battle:watchers', watchers: { battle: 'duel', count: 0, live: true, attacker: p.pet.id, defender: 'ana' } });
    await vi.waitFor(() => expect((p.$('battle-dialog') as HTMLDialogElement).open).toBe(true));
    expect(p.$('battle-watchers').hidden).toBe(true);
    p.send({ type: 'battle:watchers', watchers: { battle: 'duel', count: 2, live: true } });
    expect(p.$('battle-watchers').textContent).toBe('2 watching from the stands');
    expect(p.$('battle-close').textContent).toBe('Forfeit');
  } finally { p.window.close(); }
});
