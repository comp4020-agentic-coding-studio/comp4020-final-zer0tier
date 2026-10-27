import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createWorld } from '../src/adventure-world.ts';
import type { AdventureBattle } from '../src/adventure.ts';
import { coinEffect, forfeitBattle, simulateBattle, simulateTeamBattle, startBattle, takeBattleTurn } from '../src/combat.ts';
import { ABILITIES } from '../src/combat.ts';
import { COINS } from '../src/treasure.ts';
import { baseUrl, freshId, getPet, getRules, must, signUp } from './helpers.ts';

function map(floor = 1) {
  const saved = createWorld()[floor - 1];
  const enemies = saved.enemies.map(enemy => {
    const { x, y, route: _route, leg: _leg, ...monster } = enemy;
    return { ...monster, ...(enemy.kind === 'slime-king' ? { x, y } : {}), hidden: enemy.kind !== 'slime-king', alerted: false };
  });
  return { ...saved, enemies, exit: floor < 5 ? { keyFound: false, unlocked: true, dropRate: 0.05 } : null, floor, floorCount: 5, size: 16, x: 2, y: 2, encounters: [], revision: 'saved-map', battle: null, completed: false, failed: false, hp: 15, mp: 5, maxHp: 15, maxMp: 5,
    entryId: null as string | null, awaitingEntry: false, records: [] as AdventureBattle[], battleCount: 0, recordLimit: 50,
    cooldownUntil: null as number | null, timeScale: 1, restartCost: { stamina: 40, hygiene: 20 }, cooldownMinutes: 240,
    inventory: { stamina: 30, hygiene: 40,
      items: [{ id: 'food', name: 'Food', effect: 'restore', restores: 'stamina', amount: 40, quantity: 0, usable: false }],
      abilities: ABILITIES.map(a => ({ ...a, learned: a.id === 'claw-strike' })),
      coins: COINS.map(c => ({ ...c, quantity: 0 })),
    },
  };
}

function page({ automaticEntry = true } = {}) {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  // Movement/art fixtures start at a deliberately chosen map position. Handle
  // their entry handshake here; lifecycle tests opt out and inspect every HTTP
  // action explicitly, including refused and delayed entries.
  if (automaticEntry) {
    let fetcher: typeof fetch, latest: any, entryId: string | null = null;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      set(value: typeof fetch) { fetcher = value; },
      get() {
        return async (url: string, options?: RequestInit) => {
          if (url !== '/api/adventure') return fetcher(url, options);
          const body = options?.body ? JSON.parse(options.body as string) : {};
          if (body.action === 'enter') {
            entryId = body.entryId;
            return Response.json({ ...latest, entryId, awaitingEntry: false });
          }
          if (body.action === 'leave') {
            return Response.json({ ...latest, entryId, abandoned: true,
              battle: latest.battle ? { ...latest.battle, pending: false } : null });
          }
          const response = await fetcher(url, options);
          if (!response.ok) return response;
          latest = await response.json();
          return Response.json({ ...latest, entryId: latest.entryId ?? entryId }, { status: response.status });
        };
      },
    });
  }
  const $ = (id: string) => window.document.getElementById(id)!;
  return { dom, window, $ };
}

function battleProgress(won = true) {
  const playback = simulateBattle(
    { id: 'explorer', strength: 5, intelligence: 5, charisma: 5, appearance: 'dragon' },
    { id: 'monster:f1-enemy-0', name: 'Slime', monster: 'slime', strength: 3, intelligence: 1, charisma: 2 },
    won ? [20, 8] : [10, 30], { hp: [won ? 9 : 1, 6], mp: [1, 1] },
  );
  return { ...map(), x: won ? 5 : 4, hp: won ? 9 : 0, mp: won ? 2 : 1, failed: !won, revision: 'battle-map',
    enemies: map().enemies.filter(e => !won || e.id !== 'f1-enemy-0'),
    battle: { id: 'saved-battle', enemyId: 'f1-enemy-0', enemyName: 'Slime', floor: 1, won, pending: true,
      recovery: { hp: won ? 3 : 0, mp: won ? 1 : 0 }, playback },
  };
}

it.each(['dragon', 'hedgehog', 'lizard', 'panda'])('uses the signed-in %s in Adventure without waiting for a later pet update', async (appearance) => {
  const pet = { ...await (await signUp(freshId())).json(), appearance, color: '#123456' };
  const rules = await getRules();
  const { dom, window, $ } = page();
  window.WebSocket = function () { return new window.EventTarget(); } as unknown as typeof window.WebSocket;
  window.fetch = (async (url: string) => {
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json({ error: 'Sign in first.' }, { status: 401 });
    if (url === '/api/signin') return Response.json(pet);
    if (url === '/api/adventure') return Response.json(map());
    return Response.json([]);
  }) as typeof fetch;
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    await vi.waitFor(() => expect($('courses').children.length).toBeGreaterThan(0));
    $('login').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($('dashboard').hidden).toBe(false));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    expect($('adventure-grid').querySelector('.adventure-player use')?.getAttribute('href')).toBe(`#pet-${appearance}`);
    expect(($('adventure-grid').querySelector('.adventure-player') as HTMLElement).style.getPropertyValue('--pet-color')).toBe('#123456');
  } finally { dom.window.close(); }
});

it('disables Explore the woodland, with the reason, while the signed-in pet is working', async () => {
  const id = freshId(); await signUp(id);
  await must(`/api/pets/${id}/work/office`, { minutes: 240 });
  const pet = await getPet(id);
  const rules = await getRules();
  const { dom, window, $ } = page();
  window.WebSocket = function () { return new window.EventTarget(); } as unknown as typeof window.WebSocket;
  const requests = vi.fn(async (url: string) => {
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json({ error: 'Sign in first.' }, { status: 401 });
    if (url === '/api/signin') return Response.json(pet);
    return Response.json([]);
  });
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    await vi.waitFor(() => expect($('courses').children.length).toBeGreaterThan(0));
    $('login').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect($('dashboard').hidden).toBe(false));
    expect(($('adventure-open') as HTMLButtonElement).disabled).toBe(true);
    expect($('adventure-hint').textContent).toBe("Working at the Office. Wait until it's done.");
    expect($('adventure-open').getAttribute('aria-describedby')).toBe('adventure-hint');
    $('adventure-open').click();
    expect(($('adventure-dialog') as HTMLDialogElement).open).toBe(false);
    expect(requests.mock.calls.some(([url]) => url === '/api/adventure')).toBe(false);
  } finally { dom.window.close(); }
});

it('locks exploring on an open map while a live update says the pet is busy, and unlocks when it is idle again', async () => {
  const { dom, window, $ } = page();
  window.confirm = () => true;
  const requests = vi.fn(async () => Response.json({ ...map(), x: 11, y: 3 }));
  window.fetch = requests as unknown as typeof fetch;
  const update = (activity: string, task: string | null) => window.document.dispatchEvent(new window.CustomEvent('adventure:pet', {
    detail: { id: 'explorer', activity, task, stamina: 30, hygiene: 40, food: 0, coins: {} },
  }));
  const controls = () => [...$('adventure-dialog').querySelectorAll<HTMLButtonElement>('[data-direction]'),
    $('adventure-open-chest') as HTMLButtonElement, $('adventure-abandon') as HTMLButtonElement];
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('adventure-open-chest') as HTMLButtonElement).disabled).toBe(false));
    update('studying', 'Math');
    for (const button of controls()) expect(button.disabled).toBe(true);
    expect($('adventure-notice').textContent).toBe("Your pet is busy studying Math. Explore once it's done.");
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(requests).toHaveBeenCalledTimes(1);
    update('idle', null);
    for (const button of controls()) expect(button.disabled).toBe(false);
    expect($('adventure-notice').textContent).toContain('treasure chest');
  } finally { dom.window.close(); }
});

it('refreshes the open map without revealing hidden monsters or replacing the scene, and stops asking once it closes', async () => {
  const { dom, window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: false });
  const start = map();
  const bodies: unknown[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    return Response.json(start);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    const scene = $('adventure-map-scene'), terrain = $('adventure-terrain'), tile = terrain.firstElementChild, player = $('adventure-player');
    expect(terrain.querySelectorAll('.adventure-grass').length).toBeGreaterThan(0);
    expect($('adventure-grid').querySelectorAll('.adventure-marker-slime, .adventure-marker-goblin')).toHaveLength(0);
    expect($('adventure-enemies').firstElementChild!.textContent).toContain('Hidden in tall grass');
    expect($('adventure-enemies').textContent).not.toMatch(/column|row|undefined|NaN/);
    expect($('adventure-grid').getAttribute('aria-label')).toMatch(/tall grass/i);
    $('adventure-grid').focus();
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(1), { timeout: 2500 });
    expect(bodies[1]).toEqual({ action: 'patrol' });
    expect($('adventure-map-scene')).toBe(scene);
    expect($('adventure-terrain')).toBe(terrain);
    expect(terrain.firstElementChild).toBe(tile);
    expect($('adventure-player')).toBe(player);
    expect($('adventure-grid').querySelectorAll('.adventure-marker-slime, .adventure-marker-goblin')).toHaveLength(0);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    ($('adventure-dialog') as HTMLDialogElement).close();
    const asked = bodies.length;
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(bodies).toHaveLength(asked);
  } finally { dom.window.close(); }
});

it('opens a surprise battle only after the server saves a step into tall grass', async () => {
  const { dom, window, $ } = page();
  const start = map(), fought = battleProgress();
  const attacked = { ...fought, x: start.x + 1, y: start.y, battle: { ...fought.battle, surprise: true } };
  let finishMove: (response: Response) => void = () => { throw new Error('No movement request was sent.'); };
  window.fetch = vi.fn(async (_url: string, options: RequestInit) =>
    JSON.parse(options.body as string).direction ? new Promise<Response>(resolve => { finishMove = resolve; }) : Response.json(start)) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    const player = $('adventure-player'), before = player.style.transform;
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(($('battle-dialog') as HTMLDialogElement | null)?.open).not.toBe(true);
    expect(player.style.transform).toBe(before);
    finishMove(Response.json(attacked));
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement | null)?.open).toBe(true));
    expect($('battle-title').textContent).toContain('Slime');
    expect($('battle-title').textContent).toMatch(/grass|surprise/i);
    expect($('adventure-player')).toBe(player);
    expect(player.style.transform).not.toBe(before);
    expect(($('adventure-continue') as HTMLButtonElement).hidden).toBe(false);
  } finally { dom.window.close(); }
});

it('clears the previous floor on account reset and ignores its late movement response', async () => {
  const { dom, window, $ } = page();
  const finishes: ((response: Response) => void)[] = [];
  window.fetch = vi.fn(() => new Promise<Response>(resolve => finishes.push(resolve))) as typeof fetch;
  const scenes = vi.fn();
  window.document.addEventListener('battle:show', scenes);
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    const grove = map(5);
    finishes[0](Response.json({ ...grove, enemies: grove.enemies.map(e => ({ ...e,
      ...(e.kind === 'slime-king' ? { type: 'water', weakness: ['grass'] } : {}),
      moves: e.kind === 'slime-king'
        ? [{ id: 'bump', name: 'Bump', mpCost: 5, description: 'Two-thirds of the target’s current HP, rounded up.' }] : [] })) }));
    await vi.waitFor(() => expect($('adventure-title').textContent).toBe('Slime King’s grove'));
    expect($('adventure-enemies').lastElementChild!.textContent).toMatch(/^Slime King · Water type, weak to Grass · .* · Bump \(5 MP\): Two-thirds of the target’s current HP, rounded up\.$/);
    // A saved map from before types still lists its monsters without a type.
    expect($('adventure-enemies').firstElementChild!.textContent).not.toMatch(/type|undefined/);
    expect($('adventure-grid').querySelector('[data-enemy="slime-king"] use')?.getAttribute('href')).toBe('#monster-slime-king');
    expect($('adventure-grid').querySelectorAll('.adventure-marker-slime, .adventure-marker-goblin')).toHaveLength(0);
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(finishes).toHaveLength(2);
    window.document.dispatchEvent(new window.CustomEvent('adventure:reset'));
    $('adventure-open').click();
    expect($('adventure-grid').children).toHaveLength(0);
    expect($('adventure-enemies').children).toHaveLength(0);
    expect($('adventure-title').textContent).not.toContain('Slime King');
    expect($('adventure-floor').textContent).not.toContain('5');
    finishes[1](Response.json(battleProgress(false)));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect($('adventure-grid').getAttribute('aria-busy')).toBe('true');
    expect($('adventure-grid').children).toHaveLength(0);
    expect(scenes).not.toHaveBeenCalled();
    finishes[2](Response.json(map()));
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    expect($('adventure-title').textContent).toBe('Woodland clearing');
    expect($('adventure-enemies').children).toHaveLength(4);
    expect($('adventure-status').textContent).toBe('Column 3 · Row 3');
  } finally { dom.window.close(); }
});

it('keeps the saved pet position on delayed or refused moves, then moves the same actor after a successful response', async () => {
  const { dom, window, $ } = page();
  const requests: { body: unknown; finish: (response: Response) => void }[] = [];
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    requests[0].finish(Response.json(map()));
    await vi.waitFor(() => expect($('adventure-player')).not.toBeNull());
    const player = $('adventure-player'), scene = $('adventure-map-scene'), terrain = $('adventure-terrain');
    const avatar = player.firstElementChild, before = player.style.transform;
    $('adventure-grid').focus();
    $('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(requests[1].body).toEqual({ direction: 'd', revision: 'saved-map' });
    expect(player.style.transform).toBe(before);
    requests[1].finish(Response.json({ error: 'The map changed. Try again.' }, { status: 409 }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('The map changed. Try again.'));
    expect(player.style.transform).toBe(before);
    expect($('adventure-player')).toBe(player);
    $('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    requests[2].finish(Response.json({ ...map(), x: 3, revision: 'moved-map' }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 4 · Row 3'));
    expect($('adventure-player')).toBe(player);
    expect(player.firstElementChild).toBe(avatar);
    expect($('adventure-map-scene')).toBe(scene);
    expect($('adventure-terrain')).toBe(terrain);
    expect(player.style.transform).toBe('translate3d(192px, 128px, 0)');
    expect(window.document.activeElement?.id).toBe('adventure-grid');
  } finally { dom.window.close(); }
});

it('routes taps one saved step at a time and cancels the remaining walk when tall grass starts a battle', async () => {
  const { dom, window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: false });
  const saved = map(), requests: { body: any; finish: (response: Response) => void }[] = [];
  saved.grass = saved.tiles.map((row, y) => [...row].map((_tile, x) => y === 2 && x >= 3 && x <= 5 ? 'g' : '.').join(''));
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  const battles = vi.fn();
  window.document.addEventListener('battle:show', battles);
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    requests[0].finish(Response.json(saved));
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    const player = $('adventure-player'), before = player.style.transform;
    const target = $('adventure-terrain').querySelector<HTMLElement>('[data-x="5"][data-y="2"]')!;
    target.click();
    expect(requests[1].body).toEqual({ direction: 'd', revision: 'saved-map' });
    expect(player.style.transform).toBe(before);
    expect(requests).toHaveLength(2);
    requests[1].finish(Response.json({ ...saved, x: 3, revision: 'first-step' }));
    await vi.waitFor(() => expect(requests.length).toBe(3));
    expect(requests[2].body).toEqual({ direction: 'd', revision: 'first-step' });
    expect(player.style.transform).toBe('translate3d(192px, 128px, 0)');
    const surprise = battleProgress();
    requests[2].finish(Response.json({ ...surprise, grass: saved.grass, x: 4, y: 2, battle: { ...surprise.battle, surprise: true } }));
    await vi.waitFor(() => expect(battles).toHaveBeenCalledOnce());
    expect($('adventure-player')).toBe(player);
    expect(player.style.transform).toBe('translate3d(256px, 128px, 0)');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(requests.filter(request => request.body.direction)).toHaveLength(2);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
  } finally { dom.window.close(); }
});

it('ignores a cancelled route response after reopening so it cannot interrupt a new tap route', async () => {
  const { dom, window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: false });
  const saved = map(), requests: { body: any; finish: (response: Response) => void }[] = [];
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  const tap = (x: number) => $('adventure-terrain').querySelector<HTMLElement>(`[data-x="${x}"][data-y="2"]`)!.click();
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    requests[0].finish(Response.json(saved));
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    tap(5);
    expect(requests[1].body).toEqual({ direction: 'd', revision: 'saved-map' });
    ($('adventure-dialog') as HTMLDialogElement).close();
    $('adventure-open').click();
    // The server already saved the old step; only its response is delayed.
    requests[2].finish(Response.json({ ...saved, x: 3, revision: 'reopened-map' }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 4 · Row 3'));
    tap(6);
    expect(requests[3].body).toEqual({ direction: 'd', revision: 'reopened-map' });
    requests[1].finish(Response.json({ ...saved, x: 3, revision: 'old-step' }));
    // The old continuation must not consume the new path while its move waits.
    await new Promise(resolve => setTimeout(resolve, 230));
    expect($('adventure-grid').getAttribute('aria-busy')).toBe('true');
    requests[3].finish(Response.json({ ...saved, x: 4, revision: 'new-step-1' }));
    await vi.waitFor(() => expect(requests.length).toBe(5));
    expect(requests[4].body).toEqual({ direction: 'd', revision: 'new-step-1' });
    requests[4].finish(Response.json({ ...saved, x: 5, revision: 'new-step-2' }));
    await vi.waitFor(() => expect(requests.length).toBe(6));
    expect(requests[5].body).toEqual({ direction: 'd', revision: 'new-step-2' });
    requests[5].finish(Response.json({ ...saved, x: 6, revision: 'arrived' }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 7 · Row 3'));
    expect(window.document.activeElement?.id).toBe('adventure-grid');
  } finally { dom.window.close(); }
});

it('plays a live monster battle once and returns carried resources without exposing its record during the run', async () => {
  const { dom, window, $ } = page();
  let saved: any = battleProgress();
  const requests = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.action === 'continue') saved = { ...saved, revision: 'continued-map', battle: { ...saved.battle, pending: false, playback: null } };
    return Response.json(saved);
  });
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    expect($('battle-name-1').textContent).toBe('Slime');
    expect($('battle-avatar-1').querySelector('use')?.getAttribute('href')).toBe('#monster-slime');
    expect($('battle-hp-text-0').textContent).toBe('9 / 15');
    expect($('battle-mp-text-0').textContent).toBe('1 / 5');
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(requests).toHaveBeenCalledTimes(1);
    $('battle-skip').click();
    expect($('battle-status').textContent).toContain('Recovered 3 HP and 1 MP');
    expect($('battle-hp-text-0').textContent).toBe('9 / 15');
    expect($('battle-mp-text-0').textContent).toBe('2 / 5');
    expect($('battle-replay').hidden).toBe(true);
    expect($('battle-log').closest('details')!.hidden).toBe(true);
    expect($('battle-log').children).toHaveLength(0);
    expect(requests).toHaveBeenCalledTimes(1);
    $('battle-close').click();
    await vi.waitFor(() => expect($('adventure-continue').hidden).toBe(true));
    expect(requests).toHaveBeenCalledTimes(2);
    expect(JSON.parse(requests.mock.calls[1][1].body as string)).toEqual({ action: 'continue', battleId: 'saved-battle', revision: 'battle-map' });
    expect($('adventure-resources').textContent).toBe('HP 9 / 15 · MP 2 / 5');
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    expect($('adventure-battle-summary').hidden).toBe(true);
    expect($('adventure-replay').hidden).toBe(true);
    expect($('adventure-records').hidden).toBe(true);
    expect(requests).toHaveBeenCalledTimes(2);
  } finally { dom.window.close(); }
});

it('shows a saved Floor Key drop in live playback and retains it after returning without exposing replay', async () => {
  const { dom, window, $ } = page();
  const fought = battleProgress();
  let saved: any = { ...fought, exit: { keyFound: true, unlocked: false, dropRate: 0.05 },
    battle: { ...fought.battle, keyDrop: { floor: 1, name: 'Floor Key' } } };
  const bodies: unknown[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    if (body.action === 'continue') saved = { ...saved, revision: 'key-kept', battle: { ...saved.battle, pending: false, playback: null } };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    $('battle-skip').click();
    const result = $('battle-status').textContent;
    expect(result).toContain('Floor Key');
    expect(result).toMatch(/floor 1/i);
    expect($('adventure-floor-key').textContent).toContain('Floor Key');
    expect($('battle-replay').hidden).toBe(true);
    expect(bodies).toHaveLength(1);
    $('battle-close').click();
    await vi.waitFor(() => expect($('adventure-continue').hidden).toBe(true));
    expect(bodies).toEqual([{}, { action: 'continue', battleId: 'saved-battle', revision: 'battle-map' }]);
    expect($('adventure-replay').hidden).toBe(true);
    expect($('adventure-records').hidden).toBe(true);
    expect(bodies).toHaveLength(2);
    expect($('adventure-floor-key').textContent).toContain('Floor Key');
  } finally { dom.window.close(); }
});

it('ends the battle scene at the HP/MP the pet carries back, without a spent Copper shield', async () => {
  const { dom, window, $ } = page();
  const saved = battleProgress();
  const playback = saved.battle.playback;
  // As if a Copper shield's leftover HP and unused MP vanished after the fight.
  saved.battle = { ...saved.battle, after: { hp: playback.turns.at(-1)!.hp[0] - 2, mp: 0 } } as typeof saved.battle;
  window.fetch = (async () => Response.json(saved)) as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    $('battle-skip').click();
    expect($('battle-hp-text-0').textContent).toBe(`${playback.turns.at(-1)!.hp[0] - 2} / 15`);
    expect($('battle-mp-text-0').textContent).toBe('0 / 5');
  } finally { dom.window.close(); }
});

it('shows a failed run with disabled movement and starts a fresh adventure only when requested', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  const failed = battleProgress(false);
  let saved: ReturnType<typeof battleProgress> | ReturnType<typeof map> = failed;
  let entrances = 0;
  const requests = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.action === 'continue') saved = { ...saved, battle: { ...failed.battle, pending: false } };
    if (body.action === 'enter') saved = { ...(entrances++ ? map() : saved), entryId: body.entryId };
    return Response.json(saved);
  });
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.eval(readFileSync('public/confirm.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    $('battle-skip').click();
    expect($('battle-status').textContent).toContain('Adventure failed');
    $('battle-close').click();
    // The ended-run card leaves the decision to the player without a prompt.
    await vi.waitFor(() => expect($('adventure-battle-summary').hidden).toBe(false));
    expect(($('confirm-dialog') as HTMLDialogElement | null)?.open).not.toBe(true);
    expect($('adventure-battle-summary').hidden).toBe(false);
    expect(requests).toHaveBeenCalledTimes(3);
    expect(($('adventure-restart') as HTMLButtonElement).disabled).toBe(false);
    expect($('adventure-failure').hidden).toBe(false);
    for (const button of $('adventure-dialog').querySelectorAll<HTMLButtonElement>('[data-direction]')) expect(button.disabled).toBe(true);
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(requests).toHaveBeenCalledTimes(3);
    $('adventure-restart').click();
    await vi.waitFor(() => expect($('adventure-failure').hidden).toBe(true));
    expect($('adventure-restart').hidden).toBe(true);
    expect($('adventure-resources').textContent).toBe('HP 15 / 15 · MP 5 / 5');
    expect($('adventure-battle-summary').hidden).toBe(true);
    expect($('adventure-grid').querySelectorAll('.adventure-marker-slime')).toHaveLength(0);
  } finally { dom.window.close(); }
});

it('starts a fresh entry before showing an old run, ends it explicitly, and uses a new entry ID next visit', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  const oldBattle = battleProgress();
  let saved: any = { ...oldBattle, ...map(4), started: true, x: 12, y: 11,
    revision: 'old-progress', entryId: 'previous-entry', battle: oldBattle.battle };
  const requests: { body: any; finish: (response: Response) => void }[] = [];
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  const finishRead = (index: number) => requests[index].finish(Response.json(saved));
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.eval(readFileSync('public/confirm.js', 'utf8'));
    const dialog = $('adventure-dialog') as HTMLDialogElement;
    $('adventure-open').click();
    finishRead(0);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const first = requests[1].body;
    expect(first).toMatchObject({ action: 'enter', revision: 'old-progress' });
    expect(typeof first.entryId).toBe('string');
    expect(first.entryId).not.toBe('previous-entry');
    expect($('adventure-grid').children).toHaveLength(0);
    expect(($('battle-dialog') as HTMLDialogElement | null)?.open).not.toBe(true);
    dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(requests).toHaveLength(2);
    saved = { ...map(), started: true, entryId: first.entryId, revision: 'fresh-entry' };
    finishRead(1);
    await vi.waitFor(() => expect($('adventure-player')).not.toBeNull());
    expect($('adventure-floor').textContent).toContain('1 / 5');
    expect($('adventure-player').style.transform).toBe('translate3d(128px, 128px, 0)');
    expect($('adventure-battle-summary').hidden).toBe(true);
    expect($('adventure-records').hidden).toBe(true);
    expect($('adventure-pack-toggle').textContent).toBe('Menu');
    expect($('adventure-pack-panel').hidden).toBe(true);
    for (const id of ['adventure-guide-open', 'adventure-close', 'adventure-backpack-title']) {
      expect($('adventure-pack-panel').contains($(id))).toBe(true);
    }

    $('adventure-pack-toggle').click();
    $('adventure-close').click();
    await vi.waitFor(() => expect(($('confirm-dialog') as HTMLDialogElement | null)?.open).toBe(true));
    $('confirm-no').click();
    expect(requests).toHaveLength(2);
    $('adventure-close').click();
    $('confirm-yes').click();
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].body).toEqual({ action: 'leave', revision: 'fresh-entry' });
    saved = { ...saved, abandoned: true, revision: 'ended-entry' };
    finishRead(2);
    await vi.waitFor(() => expect($('adventure-battle-summary').hidden).toBe(false));
    expect(dialog.open).toBe(true);
    expect($('adventure-pack-panel').hidden).toBe(true);
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-direction]')) expect(button.disabled).toBe(true);
    $('adventure-return-town').click();
    expect(dialog.open).toBe(false);
    $('adventure-open').click();
    finishRead(3);
    await vi.waitFor(() => expect(requests).toHaveLength(5));
    expect(requests[4].body).toMatchObject({ action: 'enter', revision: 'ended-entry' });
    expect(requests[4].body.entryId).not.toBe(first.entryId);
    saved = { ...map(), started: true, entryId: requests[4].body.entryId, revision: 'second-entry' };
    finishRead(4);
    await vi.waitFor(() => expect($('adventure-battle-summary').hidden).toBe(true));
    expect($('adventure-player')).not.toBeNull();
    expect($('adventure-battle-summary').hidden).toBe(true);
  } finally { dom.window.close(); }
});

it('keeps active cooldown progress in the menu, follows its saved deadline, and clears it on logout', async () => {
  const { dom, window, $ } = page();
  const started = 1_800_000_000_000;
  let now = started + 120_000;
  const clock = vi.spyOn(window.Date, 'now').mockImplementation(() => now);
  let saved = { ...map(), timeScale: 60, cooldownUntil: started + 240_000 };
  const requests = vi.fn(async (_url: string, options: RequestInit) => {
    if (JSON.parse(options.body as string).direction === 'd') saved = { ...saved, x: 3, revision: 'walked' };
    return Response.json(saved);
  });
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-cooldown-panel').hidden).toBe(false));
    const progress = $('adventure-cooldown-progress');
    expect(progress.getAttribute('role')).toBe('progressbar');
    expect(progress.getAttribute('aria-labelledby')).toBe('adventure-cooldown-label');
    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuemax')).toBe('100');
    expect(progress.getAttribute('aria-valuenow')).toBe('50');
    expect(progress.getAttribute('aria-valuetext')).toBe('50% complete. If you abandon this run, the next adventure opens in 2 h.');
    expect($('adventure-cooldown-percent').textContent).toBe('50%');
    expect($('adventure-pack-panel').contains($('adventure-cooldown-panel'))).toBe(true);
    expect($('adventure-pack-panel').hidden).toBe(true);
    expect(Number($('adventure-cooldown-fill').style.getPropertyValue('--fill'))).toBe(0.5);
    expect($('adventure-skip-cooldown').hidden).toBe(true);
    expect(($('adventure-dialog').querySelector('[data-direction="d"]') as HTMLButtonElement).disabled).toBe(false);
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 4 · Row 3'));
    expect(requests).toHaveBeenCalledTimes(2);

    ($('adventure-dialog') as HTMLDialogElement).close();
    now += 60_000;
    $('adventure-open').click();
    await vi.waitFor(() => expect(progress.getAttribute('aria-valuenow')).toBe('75'));
    expect($('adventure-cooldown-percent').textContent).toBe('75%');
    expect($('adventure-cooldown').textContent).toBe('If you abandon this run, the next adventure opens in 1 h.');
    expect(Number($('adventure-cooldown-fill').style.getPropertyValue('--fill'))).toBe(0.75);

    window.document.dispatchEvent(new window.CustomEvent('adventure:reset'));
    expect(($('adventure-dialog') as HTMLDialogElement).open).toBe(false);
    expect($('adventure-cooldown-panel').hidden).toBe(true);
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
    expect(Number($('adventure-cooldown-fill').style.getPropertyValue('--fill'))).toBe(0);
  } finally { clock.mockRestore(); dom.window.close(); }
});

it('counts down the final cooldown seconds and unlocks a new run without replacing map tiles or moving keyboard focus', async () => {
  const { dom, window, $ } = page();
  let now = 1_800_000_000_000;
  const clock = vi.spyOn(window.Date, 'now').mockImplementation(() => now);
  let tick: () => void = () => { throw new Error('The cooldown clock was not registered.'); };
  const interval = vi.spyOn(window, 'setInterval').mockImplementation(callback => {
    tick = callback as () => void;
    return 1;
  });
  const saved = { ...map(), abandoned: true, timeScale: 60, cooldownUntil: now + 750 };
  const requests = vi.fn(async () => Response.json(saved));
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-cooldown-panel').hidden).toBe(false));
    const grid = $('adventure-grid'), tile = grid.firstElementChild;
    grid.focus();
    expect($('adventure-cooldown').textContent).toBe('Your pet needs to rest. Next adventure in 45 s.');
    expect($('adventure-restart').hidden).toBe(true);
    expect($('adventure-cooldown-progress').getAttribute('aria-valuenow')).toBe('99');

    // A local clock behind the server must never produce a negative bar.
    now -= 240_000;
    tick();
    expect($('adventure-cooldown-progress').getAttribute('aria-valuenow')).toBe('0');
    expect(Number($('adventure-cooldown-fill').style.getPropertyValue('--fill'))).toBe(0);

    now = saved.cooldownUntil - 250;
    tick();
    expect($('adventure-cooldown').textContent).toBe('Your pet needs to rest. Next adventure in 15 s.');
    expect($('adventure-cooldown-progress').getAttribute('aria-valuetext')).toBe('99% complete. Your pet needs to rest. Next adventure in 15 s.');
    expect(grid.firstElementChild).toBe(tile);
    expect(window.document.activeElement).toBe(grid);

    now += 250;
    tick();
    expect($('adventure-cooldown-panel').hidden).toBe(true);
    expect($('adventure-cooldown').hidden).toBe(true);
    expect($('adventure-skip-cooldown').hidden).toBe(true);
    expect($('adventure-restart').hidden).toBe(false);
    expect(($('adventure-restart') as HTMLButtonElement).disabled).toBe(false);
    expect($('adventure-team-up').hidden).toBe(false);
    expect(grid.firstElementChild).toBe(tile);
    expect(window.document.activeElement).toBe(grid);
    expect(requests).toHaveBeenCalledTimes(1);
  } finally { interval.mockRestore(); clock.mockRestore(); dom.window.close(); }
});

it('explains the locked stairs and 5% monster drop chance without sending an unusable Space action', async () => {
  const { dom, window, $ } = page();
  const saved = { ...map(), x: 13, y: 13, exit: { keyFound: false, unlocked: false, dropRate: 0.05 } };
  const requests = vi.fn(async () => Response.json(saved));
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    const descend = $('adventure-descend') as HTMLButtonElement;
    const stairs = $('adventure-terrain').querySelector<HTMLElement>('.adventure-marker-down')!;
    expect(descend.disabled).toBe(true);
    expect(stairs.title).toMatch(/\blocked\b/i);
    expect(stairs.classList.contains('is-interactable')).toBe(false);
    expect($('adventure-notice').textContent).toMatch(/locked/i);
    expect($('adventure-notice').textContent).toContain('5%');
    expect($('adventure-stair-hint').textContent).toContain('5%');
    $('adventure-pack-toggle').click();
    expect($('adventure-floor-key').textContent).toMatch(/Floor Key/i);
    expect($('adventure-floor-key').textContent).toContain('5%');
    $('adventure-grid').focus();
    expect($('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))).toBe(false);
    descend.click();
    expect(requests).toHaveBeenCalledTimes(1);
    expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 1 / 5');
    expect(window.document.activeElement?.id).toBe('adventure-grid');
  } finally { dom.window.close(); }
});

it('uses a found key only after the server accepts descent, retaining it through a refused stale request', async () => {
  const { dom, window, $ } = page();
  const saved = { ...map(), x: 13, y: 13, exit: { keyFound: true, unlocked: false, dropRate: 0.05 } };
  const requests: { body: unknown; finish: (response: Response) => void }[] = [];
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  const space = () => $('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    requests[0].finish(Response.json(saved));
    const descend = $('adventure-descend') as HTMLButtonElement;
    await vi.waitFor(() => expect(descend.disabled).toBe(false));
    expect(descend.textContent).toBe('Unlock & descend');
    expect($('adventure-terrain').querySelector('.adventure-marker-down')?.classList.contains('is-interactable')).toBe(true);
    const keyStatus = $('adventure-floor-key').textContent;
    space();
    expect(requests[1].body).toEqual({ action: 'descend', revision: 'saved-map' });
    expect(descend.disabled).toBe(true);
    expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 1 / 5');
    expect($('adventure-floor-key').textContent).toBe(keyStatus);
    requests[1].finish(Response.json({ error: 'The map changed. Try again.' }, { status: 409 }));
    await vi.waitFor(() => expect(descend.disabled).toBe(false));
    expect($('adventure-status').textContent).toBe('The map changed. Try again.');
    expect(descend.textContent).toBe('Unlock & descend');
    expect($('adventure-floor-key').textContent).toBe(keyStatus);
    space();
    expect(requests[2].body).toEqual({ action: 'descend', revision: 'saved-map' });
    const next = { ...map(2), revision: 'opened-next-floor', exit: { keyFound: false, unlocked: false, dropRate: 0.05 } };
    requests[2].finish(Response.json(next));
    await vi.waitFor(() => expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 2 / 5'));
    expect($('adventure-floor-key').textContent).not.toBe(keyStatus);
    expect(($('adventure-ascend') as HTMLButtonElement).disabled).toBe(false);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    // Returning to the previous floor uses the saved, permanently open exit.
    space();
    expect(requests[3].body).toEqual({ action: 'ascend', revision: 'opened-next-floor' });
    requests[3].finish(Response.json({ ...saved, revision: 'back-up', exit: { ...saved.exit, keyFound: false, unlocked: true } }));
    await vi.waitFor(() => expect(descend.disabled).toBe(false));
    expect(descend.textContent).toBe('↓ Descend');
    expect($('adventure-terrain').querySelector<HTMLElement>('.adventure-marker-down')!.title).not.toMatch(/\blocked\b/i);
  } finally { dom.window.close(); }
});

it('shares a teammate’s key discovery and unlocked stairs through saved map refreshes without rebuilding the scene', async () => {
  const { dom, window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: false });
  let saved = { ...map(), x: 13, y: 13, exit: { keyFound: false, unlocked: false, dropRate: 0.05 },
    team: { id: 7, members: [{ id: 'pal', color: '#654321', appearance: 'panda', floor: 1, x: 3, y: 2, hp: 15, maxHp: 15, status: 'exploring' }] } };
  const bodies: unknown[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    bodies.push(JSON.parse(options.body as string));
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    const terrain = $('adventure-terrain'), stairs = terrain.querySelector<HTMLElement>('.adventure-marker-down')!;
    const descend = $('adventure-descend') as HTMLButtonElement;
    expect(descend.disabled).toBe(true);
    saved = { ...saved, revision: 'teammate-found-key', exit: { ...saved.exit, keyFound: true } };
    await vi.waitFor(() => expect(descend.disabled).toBe(false), { timeout: 2500 });
    expect(descend.textContent).toBe('Unlock & descend');
    expect($('adventure-floor-key').textContent).toContain('Floor Key');
    expect(stairs.classList.contains('is-interactable')).toBe(true);
    expect($('adventure-terrain')).toBe(terrain);
    expect(terrain.querySelector('.adventure-marker-down')).toBe(stairs);
    saved = { ...saved, revision: 'teammate-unlocked-exit', exit: { ...saved.exit, keyFound: false, unlocked: true } };
    await vi.waitFor(() => expect(descend.textContent).toBe('↓ Descend'), { timeout: 2500 });
    expect(stairs.title).not.toMatch(/\blocked\b/i);
    expect($('adventure-terrain')).toBe(terrain);
    expect(bodies.slice(1).every(body => JSON.stringify(body) === JSON.stringify({ action: 'patrol' }))).toBe(true);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
  } finally { dom.window.close(); }
});

it('keeps keyboard movement focused on the map when using stairs disables the selected button', async () => {
  const { dom, window, $ } = page();
  const requests: { body: unknown; finish: (response: Response) => void }[] = [];
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    requests[0].finish(Response.json({ ...map(), x: 13, y: 13 }));
    const descend = $('adventure-descend') as HTMLButtonElement;
    await vi.waitFor(() => expect(descend.disabled).toBe(false));
    const firstTerrain = $('adventure-terrain'), firstTile = firstTerrain.firstElementChild;
    expect(firstTerrain.querySelector('.adventure-marker-down')?.classList.contains('is-interactable')).toBe(true);
    descend.focus(); descend.click();
    expect(descend.disabled).toBe(true);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    expect(requests[1].body).toEqual({ action: 'descend', revision: 'saved-map' });
    requests[1].finish(Response.json(map(2)));
    await vi.waitFor(() => expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 2 / 5'));
    expect($('adventure-terrain').contains(firstTile)).toBe(false);
    expect($('adventure-terrain').querySelector('.adventure-marker-up')?.classList.contains('is-interactable')).toBe(true);
    window.document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(requests[2].body).toEqual({ direction: 'd', revision: 'saved-map' });
    requests[2].finish(Response.json({ ...map(2), x: 3 }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 4 · Row 3'));
  } finally { dom.window.close(); }
});

it('opens the map with focus on it, and Space opens the chest or takes the stairs the pet stands on', async () => {
  const { dom, window, $ } = page();
  let saved: ReturnType<typeof map> = { ...map(), x: 11, y: 3 };
  const bodies: any[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    if (body.action === 'open-chest') saved = { ...saved, revision: 'opened', chests: saved.chests.map(c => ({ ...c, reward: { category: 'food', id: 'food', name: 'Food', quantity: 1 } })) };
    if (body.direction === 'd') saved = { ...saved, revision: 'at-stairs', x: 13, y: 13 };
    if (body.action === 'descend') saved = { ...map(2), revision: 'floor-2' };
    if (body.action === 'ascend') saved = { ...map(1), revision: 'floor-1', x: 13, y: 13 };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  const space = (target: Element = window.document.activeElement!) =>
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('adventure-open-chest') as HTMLButtonElement).disabled).toBe(false));
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    expect($('adventure-notice').textContent).toBe('You found a treasure chest. Press Space or choose Open chest to collect its reward.');
    expect(space()).toBe(false); // the page doesn't scroll
    await vi.waitFor(() => expect($('adventure-open-chest').textContent).toBe('Chest opened'));
    expect(bodies.at(-1)).toEqual({ action: 'open-chest', revision: 'saved-map' });
    // An opened chest, or a plain path, has nothing to act on.
    const asked = bodies.length;
    space();
    expect(bodies).toHaveLength(asked);
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 14 · Row 14'));
    expect($('adventure-notice').textContent).toBe('Exit unlocked. Press Space or choose Descend to explore deeper.');
    space();
    await vi.waitFor(() => expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 2 / 5'));
    expect(bodies.at(-1)).toEqual({ action: 'descend', revision: 'at-stairs' });
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    space();
    await vi.waitFor(() => expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 1 / 5'));
    expect(bodies.at(-1)).toEqual({ action: 'ascend', revision: 'floor-2' });
    // On a focused button, Space presses that button instead (here, Leave).
    $('adventure-close').focus();
    expect(space()).toBe(true);
    expect(bodies.at(-1)).toEqual({ action: 'ascend', revision: 'floor-2' });
  } finally { dom.window.close(); }
});

it('after defeat keeps the Hourglass and new-adventure choices on the end card without automatic questions', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  const failed = battleProgress(false), cooldownUntil = Date.now() + 4 * 60 * 60 * 1000;
  const withGlass = (quantity: number) => ({ ...failed.inventory, items: [{ id: 'hourglass', name: 'Hourglass', effect: 'skip', quantity, usable: false }] });
  let saved: any = { ...failed, cooldownUntil, inventory: withGlass(1) };
  let entrances = 0;
  const bodies: any[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    if (body.action === 'continue') saved = { ...saved, revision: 'returned', battle: { ...saved.battle, pending: false } };
    if (body.action === 'skip-cooldown') saved = { ...saved, revision: 'rested', cooldownUntil: null, inventory: withGlass(0) };
    if (body.action === 'enter') saved = { ...(entrances++ ? { ...map(), revision: 'fresh' } : saved), entryId: body.entryId };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.eval(readFileSync('public/confirm.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    $('battle-close').click();
    await vi.waitFor(() => expect($('adventure-battle-summary').hidden).toBe(false));
    expect(($('confirm-dialog') as HTMLDialogElement | null)?.open).not.toBe(true);
    expect($('adventure-cooldown-panel').hidden).toBe(false);
    expect($('adventure-battle-summary').contains($('adventure-cooldown-panel'))).toBe(true);
    $('adventure-skip-cooldown').click();
    await vi.waitFor(() => expect($('adventure-cooldown-panel').hidden).toBe(true));
    expect(bodies.at(-1)).toEqual({ action: 'skip-cooldown', revision: 'returned' });
    expect(($('confirm-dialog') as HTMLDialogElement | null)?.open).not.toBe(true);
    $('adventure-restart').click();
    await vi.waitFor(() => expect($('adventure-failure').hidden).toBe(true));
    expect(bodies.at(-1)).toMatchObject({ action: 'enter', revision: 'rested', entryId: expect.any(String) });
    expect(window.document.activeElement?.id).toBe('adventure-grid');
  } finally { dom.window.close(); }
});

it('a shared battle received while ending is being confirmed cancels that question before the new fight', async () => {
  const { dom, window, $ } = page();
  const start = map(), fought = battleProgress();
  const attacked = { ...fought, x: start.x, battle: { ...fought.battle, surprise: true } };
  const bodies: any[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    return Response.json(body.action === 'patrol' ? attacked : start);
  }) as unknown as typeof fetch;
  Object.defineProperty(window.document, 'hidden', { value: false });
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.eval(readFileSync('public/confirm.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    $('adventure-pack-toggle').click();
    $('adventure-close').click();
    await vi.waitFor(() => expect(($('confirm-dialog') as HTMLDialogElement | null)?.open).toBe(true));
    // A teammate's encounter reaches this map: the battle opens and the question is gone.
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement | null)?.open).toBe(true), { timeout: 2500 });
    expect(($('confirm-dialog') as HTMLDialogElement).open).toBe(false);
    expect(bodies.some(body => body.action === 'leave')).toBe(false);
  } finally { dom.window.close(); }
});

it('asks nothing after a defeat while the pet rests with no Hourglass to spend', async () => {
  const { dom, window, $ } = page();
  let saved: any = { ...battleProgress(false), cooldownUntil: Date.now() + 60 * 60 * 1000 };
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    if (JSON.parse(options.body as string).action === 'continue') saved = { ...saved, battle: { ...saved.battle, pending: false } };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.eval(readFileSync('public/confirm.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    $('battle-close').click();
    await vi.waitFor(() => expect($('adventure-cooldown').hidden).toBe(false));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect($('confirm-dialog')).toBeNull();
    expect(($('adventure-skip-cooldown') as HTMLButtonElement).disabled).toBe(true);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    expect($('adventure-cooldown').textContent).toBe('Your pet needs to rest. Next adventure in 1 h.');
  } finally { dom.window.close(); }
});

it('opens chests and uses backpack items only after the server saves them, retaining keyboard focus and clearing on logout', async () => {
  const { dom, window, $ } = page();
  const requests: { body: any; finish: (response: Response) => void }[] = [];
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    const before = { ...map(), x: 11, y: 3 };
    requests[0].finish(Response.json(before));
    const open = $('adventure-open-chest') as HTMLButtonElement;
    await vi.waitFor(() => expect(open.disabled).toBe(false));
    const chest = $('adventure-terrain').querySelector('.adventure-marker-chest')!;
    expect(chest.classList.contains('is-interactable')).toBe(true);
    expect(chest.classList.contains('adventure-chest-opened')).toBe(false);
    open.focus(); open.click(); open.click();
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toEqual({ action: 'open-chest', revision: 'saved-map' });
    expect($('adventure-items').textContent).toContain('Food × 0');
    expect($('adventure-treasure').textContent).toBe('');
    expect(chest.classList.contains('adventure-chest-opened')).toBe(false);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    const saved = { ...before, revision: 'opened-map', chests: before.chests.map(c => ({ ...c, reward: { category: 'food', id: 'food', name: 'Food', quantity: 1 } })),
      inventory: { ...before.inventory, items: before.inventory.items.map(item => ({ ...item, quantity: 1, usable: true })) } };
    requests[1].finish(Response.json(saved));
    await vi.waitFor(() => expect($('adventure-items').textContent).toContain('Food × 1'));
    expect(open.textContent).toBe('Chest opened'); expect(open.disabled).toBe(true);
    expect($('adventure-treasure').textContent).toContain('Found 1 Food');
    expect($('adventure-terrain').querySelector('.adventure-marker-chest')).toBe(chest);
    expect(chest.classList.contains('adventure-chest-opened')).toBe(true);
    expect(chest.classList.contains('is-interactable')).toBe(false);
    const use = $('adventure-items').querySelector('button')!;
    use.focus(); use.click();
    expect(requests[2].body).toEqual({ action: 'use-item', item: 'food', revision: 'opened-map' });
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    requests[2].finish(Response.json({ ...saved, revision: 'used-map', inventory: { ...before.inventory, stamina: 70 } }));
    await vi.waitFor(() => expect($('adventure-care').textContent).toContain('Stamina 70'));
    expect($('adventure-items').textContent).toContain('Food × 0');
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    expect(requests[3].body).toEqual({ direction: 'w', revision: 'used-map' });
    window.document.dispatchEvent(new window.CustomEvent('adventure:reset'));
    requests[3].finish(Response.json(saved));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect($('adventure-treasure').textContent).toBe('');
    expect($('adventure-items').children).toHaveLength(0);
  } finally { dom.window.close(); }
});

it('refreshes backpack discoveries from live pet updates and keeps focus when another window consumes the selected item', async () => {
  const { dom, window, $ } = page();
  const state = map();
  state.inventory.items[0] = { ...state.inventory.items[0], quantity: 1, usable: true };
  window.fetch = (async () => Response.json(state)) as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-items').children).toHaveLength(1));
    $('adventure-backpack-title').click();
    $('adventure-items').querySelector('button')!.focus();
    window.document.dispatchEvent(new window.CustomEvent('adventure:pet', { detail: {
      id: 'explorer', stamina: 70, hygiene: 40, food: 0, activity: 'idle',
      abilities: ['claw-strike', 'firebolt'], coins: { 'copper-coin': 0, 'silver-coin': 1, 'gold-coin': 0 },
    } }));
    expect($('adventure-items').querySelector('button')!.disabled).toBe(true);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    expect($('adventure-abilities').textContent).toContain('Firebolt');
    expect($('adventure-coins').textContent).toContain('Silver Coin × 1');
  } finally { dom.window.close(); }
});

it('re-enables a coin button instead of leaving it stuck disabled when equip-coin fails', async () => {
  const { dom, window, $ } = page();
  const state = map();
  let resolveEquip: (response: Response) => void;
  window.fetch = vi.fn((url: string) => url.includes('/equip-coin/')
    ? new Promise<Response>(resolve => { resolveEquip = resolve; })
    : Promise.resolve(Response.json(state))) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-coins').children).toHaveLength(3));
    window.document.dispatchEvent(new window.CustomEvent('adventure:pet', { detail: {
      id: 'explorer', coins: { 'copper-coin': 0, 'silver-coin': 1, 'gold-coin': 0 },
    } }));
    const row = [...$('adventure-coins').children].find(li => li.textContent?.includes('Silver Coin')) as HTMLElement;
    const button = row.querySelector('button')!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(button.disabled).toBe(true);
    resolveEquip!(Response.json({ error: "You don't have that coin to equip." }, { status: 409 }));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  } finally { dom.window.close(); }
});

it('offers the Team up window before a first adventure, then opens the shared map with teammates once the team sets off', async () => {
  const { dom, window, $ } = page();
  const me = { id: 'explorer', color: '#123456', appearance: 'cat', joined: true, waiting: null };
  const mate = { id: 'pal', color: '#654321', appearance: 'panda', joined: false, waiting: null };
  let lobby: any = { team: null, invitations: [], run: { team: null, state: 'new' }, size: 4 };
  const fresh = { ...map(), started: false, team: null as unknown };
  // Teammates set off from the same tile.
  const shared = { ...map(), started: true, team: { id: 7, members: [{ id: 'pal', color: '#654321', appearance: 'panda', floor: 1, x: 2, y: 2, hp: 15, maxHp: 15, status: 'exploring' }] } };
  let onMap = fresh;
  const bodies: any[] = [];
  window.fetch = vi.fn(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(options.body as string) : undefined;
    if (url === '/api/team') {
      if (body) bodies.push(body);
      if (body?.action === 'invite') lobby = { ...lobby, team: { id: 7, leader: 'explorer', status: 'forming', members: [me, mate] } };
      if (body?.action === 'set-off') { lobby = { ...lobby, team: null, run: { team: 7, state: 'exploring' } }; onMap = shared; }
      return Response.json(lobby);
    }
    return Response.json(onMap);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.document.dispatchEvent(new window.CustomEvent('adventure:pet', { detail: { id: 'explorer', color: '#123456', appearance: 'cat', activity: 'idle', coins: {} } }));
    $('adventure-open').click();
    const teamUp = $('team-dialog') as HTMLDialogElement;
    await vi.waitFor(() => expect(teamUp.open).toBe(true));
    expect(($('adventure-dialog') as HTMLDialogElement).open).toBe(false);
    expect($('team-help').textContent).toContain('40 stamina and 20 hygiene');
    expect($('team-members').textContent).toBe('explorer (you)');
    expect($('team-solo').hidden).toBe(false);
    expect(window.document.activeElement?.id).toBe('team-invite-id');
    ($('team-invite-id') as HTMLInputElement).value = 'pal';
    $('team-invite').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect($('team-members').textContent).toContain('pal'));
    expect(bodies).toEqual([{ action: 'invite', player: 'pal' }]);
    expect([...$('team-members').children].map(row => row.textContent)).toEqual(['explorer (you)Leader · Ready', 'palInvited']);
    expect(($('team-set-off') as HTMLButtonElement).disabled).toBe(true);
    expect($('team-members').querySelector('li:last-child use')?.getAttribute('href')).toBe('#pet-panda');
    expect($('team-solo').hidden).toBe(true);
    expect($('team-leave').textContent).toBe('Disband team');
    // The invited player joins: a broadcast refreshes the window from the server.
    lobby = { ...lobby, team: { ...lobby.team, members: [me, { ...mate, joined: true }] } };
    window.document.dispatchEvent(new window.CustomEvent('team:updated', { detail: lobby.team }));
    await vi.waitFor(() => expect(($('team-set-off') as HTMLButtonElement).disabled).toBe(false));
    expect($('team-status').textContent).toBe('Everyone is ready. Set off together!');
    $('team-set-off').click();
    await vi.waitFor(() => expect(($('adventure-dialog') as HTMLDialogElement).open).toBe(true));
    expect(teamUp.open).toBe(false);
    expect(bodies.at(-1)).toEqual({ action: 'set-off' });
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    // Sharing the pet's tile: a badge counts both pets, and the map says who.
    const start = $('adventure-player');
    expect(start.classList.contains('adventure-shared')).toBe(true);
    expect(start.dataset.shared).toBe('2');
    expect($('adventure-grid').getAttribute('aria-label')).toContain('Your pet is at column 3, row 3, with pal.');
    expect($('adventure-team').hidden).toBe(false);
    expect($('adventure-team-list').textContent).toBe('pal · floor 1, column 3, row 3 · HP 15 / 15');
    // Once the teammate walks on, it stands on its own tile.
    onMap = { ...shared, team: { ...shared.team, members: [{ ...shared.team.members[0], x: 3 }] } };
    Object.defineProperty(window.document, 'hidden', { value: false });
    await vi.waitFor(() => expect($('adventure-grid').querySelector<HTMLElement>('.adventure-teammate[data-player="pal"]')?.style.transform).toContain('192px'), { timeout: 2500 });
    const teammate = $('adventure-grid').querySelector('.adventure-teammate[data-player="pal"]')!;
    expect(teammate.querySelector('use')?.getAttribute('href')).toBe('#pet-panda');
    expect($('adventure-player')).toBe(start);
    expect(start.classList.contains('adventure-shared')).toBe(false);
    expect($('adventure-grid').getAttribute('aria-label')).toContain('1 teammate here');
  } finally { dom.window.close(); }
});

it('keeps the first Adventure uncluttered and opens reference information only from the menu', async () => {
  const { dom, window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: true }); // no patrol steps
  const lobby = { team: null, invitations: [], run: { team: null, state: 'new' }, size: 4 };
  let saved: any = { ...map(), started: false, hp: 9, maxHp: 15, mp: 2, maxMp: 5 };
  const bodies: any[] = [];
  window.fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/team') return Response.json(lobby);
    const body = options?.body ? JSON.parse(options.body as string) : {};
    bodies.push(body);
    if (body.direction) saved = { ...saved, started: true, x: saved.x + 1, revision: 'moved' };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    const adventure = $('adventure-dialog') as HTMLDialogElement, guide = $('adventure-guide') as HTMLDialogElement;
    // A first visit asks how to set off before anything else.
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('team-dialog') as HTMLDialogElement).open).toBe(true));
    expect(guide.open).toBe(false);
    $('team-solo').click();
    await vi.waitFor(() => expect($('adventure-player')).not.toBeNull());
    expect(adventure.open).toBe(true);
    expect(guide.open).toBe(false);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    $('adventure-pack-toggle').click();
    $('adventure-guide-open').click();
    expect(guide.open).toBe(true);
    expect(window.document.activeElement?.id).toBe('adventure-guide-close');
    // Monster stats, treasure odds and run costs live in the guide, not on the map.
    for (const id of ['adventure-enemies', 'adventure-restart-cost', 'adventure-stair-hint']) {
      expect(guide.contains($(id))).toBe(true);
      expect(adventure.contains($(id))).toBe(false);
    }
    expect($('adventure-enemies').children).toHaveLength(4);
    expect(guide.textContent).toContain('Food 30%');
    expect($('adventure-restart-cost').textContent).toBe('A new run costs 40 stamina and 20 hygiene. The next one opens 4 hours later.');
    expect(adventure.textContent).not.toMatch(/Slime ·|Food 30%|Monster attributes|chases you/);
    // HP and MP are rings: the arc's share is what's left.
    const ring = (kind: string) => $(`adventure-${kind}-ring`);
    expect(ring('hp').style.getPropertyValue('--gauge')).toBe('0.6');
    expect(ring('hp').getAttribute('aria-valuetext')).toBe('9 of 15');
    expect($('adventure-hp-text').textContent).toBe('9/15');
    expect(ring('mp').style.getPropertyValue('--gauge')).toBe('0.4');
    expect($('adventure-mp-text').textContent).toBe('2/5');
    expect($('adventure-resources').textContent).toBe('HP 9 / 15 · MP 2 / 5');
    // Keys pressed in the guide never move the pet behind it.
    guide.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(bodies.some(body => body.direction)).toBe(false);
    $('adventure-guide-close').click();
    expect(guide.open).toBe(false);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    adventure.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 4 · Row 3'));
    // Another visit also leaves the guide closed.
    ($('adventure-dialog') as HTMLDialogElement).close();
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-terrain')?.children).toHaveLength(256));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(guide.open).toBe(false);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    // Game guide opens it any time, and a battle starting closes it.
    $('adventure-guide-open').click();
    expect(guide.open).toBe(true);
    window.document.dispatchEvent(new window.CustomEvent('battle:show', { detail: {
      key: 'adventure:guide-test', battle: battleProgress().battle.playback, viewer: 'explorer', title: 'Floor 1 · Slime', result: '', won: true, replay: true,
    } }));
    expect(guide.open).toBe(false);
  } finally { dom.window.close(); }
});

it('shows a team battle from the viewer\'s own side, with teammates as extra cards', async () => {
  const { dom, window, $ } = page();
  const playback = simulateTeamBattle(
    [{ id: 'pal', strength: 6, intelligence: 1, charisma: 1 }, { id: 'explorer', strength: 4, intelligence: 1, charisma: 1, appearance: 'cat' }],
    { id: 'monster:f1-enemy-0', name: 'Slime', monster: 'slime', strength: 3, intelligence: 1, charisma: 2 },
    [7, 5, 4], { hp: [8, 6, 6], mp: [1, 1, 1], ...coinEffect(null, () => 0) },
  );
  const saved = { ...map(), started: true, revision: 'team-battle', battle: {
    id: 'shared-battle', enemyId: 'f1-enemy-0', enemyName: 'Slime', floor: 1, won: true, pending: true, fighter: 1,
    recovery: { hp: 0, mp: 0 }, after: { hp: 6, mp: 1 }, playback,
  } };
  window.fetch = (async () => Response.json(saved)) as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    expect($('battle-name-0').textContent).toBe('explorer (you)');
    expect($('battle-name-1').textContent).toBe('Slime');
    expect($('battle-name-2').textContent).toBe('pal');
    expect($('battle-allies').hidden).toBe(false);
    expect($('battle-hp-text-0').textContent).toBe('6 / 6');
    expect($('battle-hp-text-2').textContent).toBe('8 / 8');
    expect($('battle-initiative').textContent).toBe("Coin toss: Heads. pal's team attacks first.");
    $('battle-skip').click();
    expect($('battle-status').textContent).toMatch(/^Victory! Your team defeated Slime on floor 1/);
    expect($('battle-hp-text-1').textContent).toBe('0 / 6');
    expect($('battle-log').closest('details')!.hidden).toBe(true);
    expect($('battle-log').children).toHaveLength(0);
  } finally { dom.window.close(); }
});

it('reveals saved battle records only after ending the adventure and replays them without posting another action', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  const fought = battleProgress();
  const record = { ...fought.battle, pending: false };
  let saved: any = { ...map(), started: true, revision: 'before-entry' };
  const bodies: any[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    if (body.action === 'enter') saved = { ...map(), started: true, entryId: body.entryId, revision: 'entered' };
    if (body.direction) saved = { ...saved, ...fought, entryId: saved.entryId };
    if (body.action === 'continue') saved = { ...saved, revision: 'acknowledged',
      battle: { ...record, playback: null }, records: [], battleCount: 1 };
    if (body.action === 'leave') saved = { ...saved, revision: 'ended', abandoned: true,
      battle: record, records: [record], battleCount: 1 };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.eval(readFileSync('public/confirm.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-player')).not.toBeNull());
    $('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    $('battle-skip').click();
    expect($('battle-replay').hidden).toBe(true);
    expect($('battle-log').children).toHaveLength(0);
    $('battle-close').click();
    await vi.waitFor(() => expect(bodies.at(-1).action).toBe('continue'));
    await vi.waitFor(() => expect($('adventure-continue').hidden).toBe(true));
    expect($('adventure-battle-summary').hidden).toBe(true);
    expect($('adventure-records').children).toHaveLength(0);
    $('adventure-replay').click();
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(false);

    $('adventure-pack-toggle').click();
    $('adventure-close').click();
    await vi.waitFor(() => expect(($('confirm-dialog') as HTMLDialogElement | null)?.open).toBe(true));
    $('confirm-yes').click();
    await vi.waitFor(() => expect($('adventure-battle-summary').hidden).toBe(false));
    expect($('adventure-replay').hidden).toBe(false);
    expect($('adventure-records').hidden).toBe(true);
    $('adventure-replay').click();
    expect($('adventure-records').hidden).toBe(false);
    const button = $('adventure-records').querySelector<HTMLButtonElement>('[data-record-id="saved-battle"]')!;
    expect(button.closest('li')!.textContent).toContain('Slime');
    const beforeReplay = bodies.length;
    button.click();
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true);
    $('battle-skip').click();
    expect($('battle-replay').hidden).toBe(false);
    expect($('battle-log').closest('details')!.hidden).toBe(false);
    expect($('battle-log').children).toHaveLength(record.playback.turns.length);
    $('battle-replay').click();
    $('battle-skip').click();
    $('battle-close').click();
    expect(bodies).toHaveLength(beforeReplay);
    expect($('adventure-battle-summary').hidden).toBe(false);
    expect($('adventure-records').hidden).toBe(false);
  } finally { dom.window.close(); }
});

it('refetches an ended run when a fresh entry is refused and never resumes the old floor or its pending battle', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  const fought = battleProgress();
  const record = { ...fought.battle, pending: false };
  const old = { ...map(4), started: true, entryId: 'old-entry', revision: 'old',
    battle: fought.battle, x: 12, y: 11 };
  const ended = { ...old, revision: 'ended', abandoned: true, battle: record,
    records: [record], battleCount: 1, cooldownUntil: Date.now() + 60_000 };
  const bodies: any[] = [];
  let refused = false;
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    if (body.action === 'enter') {
      refused = true;
      return Response.json({ error: 'Your pet needs to rest before another adventure.' }, { status: 409 });
    }
    return Response.json(refused ? ended : old);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-battle-summary').hidden).toBe(false));
    expect(bodies.map(body => body.action)).toEqual([undefined, 'enter', undefined]);
    expect(($('battle-dialog') as HTMLDialogElement | null)?.open).not.toBe(true);
    expect($('adventure-records').hidden).toBe(true);
    for (const button of $('adventure-dialog').querySelectorAll<HTMLButtonElement>('[data-direction]')) expect(button.disabled).toBe(true);
    $('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(bodies).toHaveLength(3);
    expect($('adventure-skip-cooldown').hidden).toBe(false);
  } finally { dom.window.close(); }
});

it('allows another account to enter while an old entry is delayed and ignores the old completion', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  const requests: { body: any; finish: (response: Response) => void }[] = [];
  window.fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>(finish => {
    requests.push({ body: JSON.parse(options.body as string), finish });
  })) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    requests[0].finish(Response.json({ ...map(4), started: true, revision: 'old-account' }));
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body.action).toBe('enter');
    window.document.dispatchEvent(new window.CustomEvent('adventure:reset'));
    $('adventure-open').click();
    expect(requests).toHaveLength(3);
    requests[2].finish(Response.json({ ...map(), started: true, revision: 'new-account' }));
    await vi.waitFor(() => expect(requests).toHaveLength(4));
    expect(requests[3].body).toMatchObject({ action: 'enter', revision: 'new-account' });
    requests[1].finish(Response.json({ ...map(4), started: true, entryId: requests[1].body.entryId }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect($('adventure-grid').children).toHaveLength(0);
    expect($('adventure-grid').getAttribute('aria-busy')).toBe('true');
    $('adventure-open').click();
    expect(requests).toHaveLength(4);
    requests[3].finish(Response.json({ ...map(), started: true, entryId: requests[3].body.entryId }));
    await vi.waitFor(() => expect($('adventure-player')).not.toBeNull());
    expect($('adventure-floor').textContent).toContain('1 / 5');
    expect($('adventure-grid').getAttribute('aria-busy')).toBe('false');
  } finally { dom.window.close(); }
});

it('freezes an old window when another window starts a different entry without ending or joining that new run', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  Object.defineProperty(window.document, 'hidden', { value: false });
  let saved: any = { ...map(), started: true };
  saved.inventory.items[0] = { ...saved.inventory.items[0], quantity: 1, usable: true };
  const bodies: any[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    if (body.action === 'enter') saved = { ...saved, entryId: body.entryId, revision: 'accepted-entry' };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-player')).not.toBeNull());
    const accepted = saved.entryId;
    saved = { ...map(), started: true, entryId: 'another-window-entry', revision: 'newer-run' };
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe(
      'This adventure was restarted in another window. Return to town and enter again.',
    ), { timeout: 2500 });
    expect($('adventure-status').classList.contains('visually-hidden')).toBe(false);
    expect($('adventure-dialog').classList.contains('adventure-entering')).toBe(true);
    expect($('adventure-grid').getAttribute('aria-busy')).toBe('false');
    for (const button of $('adventure-dialog').querySelectorAll<HTMLButtonElement>('[data-direction]')) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    $('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    $('adventure-terrain').querySelector<HTMLElement>('[data-x="3"][data-y="2"]')!.click();
    expect(bodies.filter(body => body.action === 'enter')).toEqual([
      { action: 'enter', revision: 'saved-map', entryId: accepted },
    ]);
    expect(bodies.some(body => body.direction)).toBe(false);
    $('adventure-pack-toggle').click();
    const food = $('adventure-items').querySelector<HTMLButtonElement>('[data-use-item="food"]')!;
    expect(food.disabled).toBe(true);
    food.click();
    expect(bodies.some(body => body.action === 'use-item')).toBe(false);
    $('adventure-close').click();
    expect(($('adventure-dialog') as HTMLDialogElement).open).toBe(false);
    expect(bodies.some(body => body.action === 'leave')).toBe(false);
    const count = bodies.length;
    await new Promise(resolve => setTimeout(resolve, 1050));
    expect(bodies).toHaveLength(count);
  } finally { dom.window.close(); }
});

it('recovers a saved entry after its response is lost without sending a second entry or leaving movement locked', async () => {
  const { dom, window, $ } = page({ automaticEntry: false });
  let saved: any = { ...map(4), started: true, entryId: 'previous-entry', revision: 'old-progress' };
  const bodies: any[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    if (body.action === 'enter') {
      saved = { ...map(), started: true, entryId: body.entryId, revision: 'saved-entry' };
      throw new TypeError('Connection lost after saving entry.');
    }
    if (body.direction === 'd') saved = { ...saved, x: 3, revision: 'first-step' };
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-player')).not.toBeNull());
    expect(bodies.map(body => body.action)).toEqual([undefined, 'enter', undefined]);
    expect($('adventure-floor').textContent).toContain('1 / 5');
    expect($('adventure-dialog').classList.contains('adventure-entering')).toBe(false);
    expect($('adventure-grid').getAttribute('aria-busy')).toBe('false');
    expect(($('adventure-dialog').querySelector('[data-direction="d"]') as HTMLButtonElement).disabled).toBe(false);
    $('adventure-grid').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await vi.waitFor(() => expect($('adventure-player').style.transform).toBe('translate3d(192px, 128px, 0)'));
    expect(bodies.at(-1)).toEqual({ direction: 'd', revision: 'saved-entry' });
    expect(bodies.filter(body => body.action === 'enter')).toHaveLength(1);
  } finally { dom.window.close(); }
});

it('posts a manual adventure skill only after selection and dismisses an obsolete battle when another window starts a new run', async () => {
  const { window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: false });
  const explorer = { id: 'explorer', strength: 5, intelligence: 5, charisma: 5, equippedCoin: 'silver-coin' as const,
    equippedAbilities: ['claw-strike', 'firebolt'] as const };
  // Enough HP that Firebolt's super-effective hit on a Grass slime leaves the battle running.
  const monster = { id: 'monster:f1-enemy-0', name: 'Slime', monster: 'slime' as const, strength: 10, intelligence: 1, charisma: 20 };
  const playback = startBattle([explorer], monster, [20, 33]);
  let saved: any = { ...map(), battle: { id: 'manual-grass', enemyId: 'f1-enemy-0', enemyName: 'Slime',
    floor: 1, won: false, pending: true, playback, recovery: { hp: 0, mp: 0 } } };
  const bodies: any[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string); bodies.push(body);
    if (body.action === 'battle-skill') {
      const next = takeBattleTurn(saved.battle.playback, 'explorer', body.ability, body.turnRevision);
      if ('error' in next) return Response.json(next, { status: next.status });
      saved = { ...saved, revision: 'played-turn', battle: { ...saved.battle, playback: next } };
    }
    return Response.json(saved);
  }) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(window.document.querySelector('[data-skill="firebolt"]')).not.toBeNull());
    expect(bodies.some(body => body.action === 'battle-skill')).toBe(false);
    expect($('battle-skip').hidden).toBe(true);
    window.document.querySelector<HTMLButtonElement>('[data-skill="firebolt"]')!.click();
    await vi.waitFor(() => expect(bodies.some(body => body.action === 'battle-skill')).toBe(true));
    expect(bodies.find(body => body.action === 'battle-skill')).toMatchObject({ battleId: 'manual-grass', ability: 'firebolt', turnRevision: 0 });
    expect(saved.battle.playback.turns[0].ability).toBe('firebolt');
    expect($('battle-log').children).toHaveLength(0);
    saved = { ...map(), revision: 'other-run', entryId: 'started-elsewhere' };
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(false), { timeout: 2500 });
    expect($('adventure-status').textContent).toContain('restarted in another window');
    expect(bodies.filter(body => body.action === 'battle-skill')).toHaveLength(1);
    expect(bodies.some(body => body.action === 'continue')).toBe(false);
  } finally { window.close(); }
});

it.each(['active', 'finished'])('keeps a stale forfeit visible when a teammate leaves the battle %s, then allows the next action', async (outcome) => {
  const { window, $ } = page();
  const pal = { id: 'pal', strength: 10, intelligence: 10, charisma: 10 };
  const explorer = { ...pal, id: 'explorer' };
  const monster = { id: 'monster:slime', name: 'Slime', monster: 'slime' as const,
    strength: outcome === 'active' ? 50 : 1, intelligence: 1, charisma: 1 };
  const playback = startBattle([pal, explorer], monster, [40, 40, 4], { random: () => 0, hp: [40, 40, outcome === 'active' ? 160 : 10] });
  let saved: any = { ...map(), started: true, abandoned: false, battle: {
    id: 'forfeit-race', floor: 1, enemyId: 'slime', enemyName: 'Slime', fighter: 1,
    pending: true, won: false, playback, recovery: { hp: 0, mp: 0 },
  } };
  const bodies: any[] = [];
  window.fetch = (async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    let next = saved.battle.playback;
    if (body.action === 'battle-forfeit') {
      if (bodies.filter(sent => sent.action === 'battle-forfeit').length === 1) {
        // This move reaches the server before the viewer's Forfeit request.
        // A stale revision returns the newer state without withdrawing them.
        expect(body.turnRevision).toBe(playback.revision);
        next = takeBattleTurn(next, pal.id, 'claw-strike', next.revision);
      } else {
        expect(body.turnRevision).toBe(next.revision);
        next = forfeitBattle(next, explorer.id, body.turnRevision);
        saved = { ...saved, abandoned: true, hp: 0, battle: { ...saved.battle, pending: false } };
      }
    } else if (body.action === 'battle-skill') {
      next = takeBattleTurn(next, explorer.id, body.ability, body.turnRevision);
    } else if (body.action === 'continue') {
      saved = { ...saved, battle: { ...saved.battle, pending: false } };
    }
    if ('error' in next) throw new Error(next.error);
    saved = { ...saved, revision: `map-${bodies.length}`, battle: { ...saved.battle,
      playback: next, won: next.status === 'finished' && next.winner !== monster.id } };
    return Response.json(saved);
  }) as typeof fetch;
  try {
    for (const script of ['confirm', 'battle', 'adventure']) window.eval(readFileSync(`public/${script}.js`, 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('battle-close')?.textContent).toBe('Forfeit'));
    $('battle-close').click();
    $('confirm-yes').click();
    await vi.waitFor(() => expect(saved.battle.playback.status).toBe(outcome));
    expect(saved.abandoned).toBe(false);
    if (outcome === 'active') {
      await vi.waitFor(() => expect($('battle-error').textContent).toContain('Choose Forfeit again'));
      expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true);
      const skill = () => window.document.querySelector<HTMLButtonElement>('[data-skill="claw-strike"]')!;
      await vi.waitFor(() => expect(skill().disabled).toBe(false));
      skill().click();
      await vi.waitFor(() => expect(bodies.some(body => body.action === 'battle-skill')).toBe(true));
      await vi.waitFor(() => expect(($('battle-close') as HTMLButtonElement).disabled).toBe(false));
      $('battle-close').click();
      $('confirm-yes').click();
      await vi.waitFor(() => expect(saved.abandoned).toBe(true));
      await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(false));
      expect(saved.battle).toMatchObject({ pending: false, playback: { status: 'active', actor: 0 } });
    } else {
      await vi.waitFor(() => expect($('battle-close').textContent).toBe('Return to map'));
      expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true);
      expect($('battle-status').textContent).toContain('Victory!');
      expect(bodies.some(body => body.action === 'continue')).toBe(false);
      $('battle-close').click();
      await vi.waitFor(() => expect(saved.battle.pending).toBe(false));
      await vi.waitFor(() => expect(($('adventure-dialog').querySelector('[data-direction="d"]') as HTMLButtonElement).disabled).toBe(false));
    }
  } finally { window.close(); }
});

it.each(['broadcast', 'response'])('enters a shared run once when the set-off %s arrives first', async (first) => {
  const { window, $ } = page({ automaticEntry: false });
  const members = ['explorer', 'pal'].map(id => ({ id, color: '#123456', appearance: 'cat', joined: true, waiting: null }));
  const team = { id: 7, leader: 'explorer', status: 'forming', members };
  let lobby: any = { team, invitations: [], size: 4, run: { team: null, state: 'new' } };
  let saved: any = { ...map(), started: false, abandoned: false, team: null };
  const bodies: any[] = [];
  let finishSetOff: (response: Response) => void;
  const broadcast = () => window.document.dispatchEvent(new window.CustomEvent('team:updated', {
    detail: { ...team, status: 'exploring' },
  }));
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(options.body as string) : {};
    if (url === '/api/team') {
      if (body.action === 'set-off') {
        lobby = { ...lobby, team: null, run: { team: team.id, state: 'exploring', awaitingEntry: true } };
        saved = { ...saved, started: true, awaitingEntry: true, cooldownUntil: Date.now() + 14_400_000,
          team: { id: team.id, members: [{ ...members[1], x: 2, y: 2, floor: 1, hp: 15, maxHp: 15, status: 'exploring' }] } };
        return new Promise<Response>(resolve => { finishSetOff = resolve; });
      }
      return Response.json(lobby);
    }
    bodies.push(body);
    if (body.action === 'enter') {
      if (!saved.awaitingEntry) {
        saved = { ...saved, abandoned: true };
        return Response.json({ error: 'Rest before another adventure.' }, { status: 429 });
      }
      saved = { ...saved, awaitingEntry: false, entryId: body.entryId, revision: 'joined-team' };
    }
    return Response.json(saved);
  });
  window.fetch = requests as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    window.document.dispatchEvent(new window.CustomEvent('adventure:pet', { detail: { ...members[0], activity: 'idle', coins: {} } }));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('team-dialog') as HTMLDialogElement).open).toBe(true));
    $('team-set-off').click();
    await vi.waitFor(() => expect(saved.awaitingEntry).toBe(true));
    const response = Response.json(lobby);
    if (first === 'broadcast') broadcast();
    else finishSetOff!(response);
    await vi.waitFor(() => expect(bodies.filter(body => body.action === 'enter')).toHaveLength(1));
    await vi.waitFor(() => expect($('adventure-grid').getAttribute('aria-busy')).toBe('false'));
    const entryId = saved.entryId;
    if (first === 'broadcast') finishSetOff!(response);
    else broadcast();
    // Drain the delayed response and its map requests before checking the run.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(bodies.filter(body => body.action === 'enter')).toHaveLength(1);
    expect(saved).toMatchObject({ entryId, abandoned: false, awaitingEntry: false, team: { id: team.id } });
    expect(($('adventure-dialog') as HTMLDialogElement).open).toBe(true);
    expect(($('adventure-dialog').querySelector('[data-direction="d"]') as HTMLButtonElement).disabled).toBe(false);
    expect($('adventure-status').textContent).not.toContain('Rest before another adventure');
  } finally { window.close(); }
});
