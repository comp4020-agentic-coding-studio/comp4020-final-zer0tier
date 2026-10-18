import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createWorld } from '../src/adventure-world.ts';
import { coinEffect, simulateBattle, simulateTeamBattle } from '../src/combat.ts';
import { ABILITIES } from '../src/combat.ts';
import { COINS } from '../src/treasure.ts';
import { baseUrl, freshId, getPet, getRules, must, signUp } from './helpers.ts';

function map(floor = 1) {
  return { ...createWorld()[floor - 1], floor, floorCount: 5, size: 16, x: 2, y: 2, encounters: [], revision: 'saved-map', battle: null, completed: false, failed: false, hp: 15, mp: 5, maxHp: 15, maxMp: 5,
    cooldownUntil: null as number | null, timeScale: 1, restartCost: { stamina: 40, hygiene: 20 }, cooldownMinutes: 240,
    inventory: { stamina: 30, hygiene: 40,
      items: [{ id: 'food', name: 'Food', effect: 'restore', restores: 'stamina', amount: 40, quantity: 0, usable: false }],
      abilities: ABILITIES.map(a => ({ ...a, learned: a.id === 'claw-strike' })),
      coins: COINS.map(c => ({ ...c, quantity: 0 })),
    },
  };
}

function page() {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
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

it('uses the signed-in pet appearance in Adventure without waiting for a later pet update', async () => {
  const pet = { ...await (await signUp(freshId())).json(), appearance: 'dragon', color: '#123456' };
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
    await vi.waitFor(() => expect($('adventure-grid').children).toHaveLength(256));
    expect($('adventure-grid').querySelector('.adventure-player use')?.getAttribute('href')).toBe('#pet-dragon');
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

it('moves monsters on the open map in real time, keeping focus, and stops asking once the map closes', async () => {
  const { dom, window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: false });
  const start = map();
  const walked = { ...start, enemies: start.enemies.map((e, i) => i === 0 ? { ...e, x: 5, alerted: true } : e) };
  const bodies: unknown[] = [];
  window.fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    bodies.push(body);
    return Response.json(body.action === 'patrol' ? walked : start);
  }) as unknown as typeof fetch;
  const cell = (x: number, y: number) => $('adventure-grid').children[y * 16 + x];
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-grid').children).toHaveLength(256));
    expect(cell(6, 2).classList.contains('adventure-marker-slime')).toBe(true);
    $('adventure-grid').focus();
    await vi.waitFor(() => expect(cell(5, 2).classList.contains('adventure-marker-slime')).toBe(true), { timeout: 2500 });
    expect(bodies[1]).toEqual({ action: 'patrol' });
    expect($('adventure-grid').children).toHaveLength(256);
    expect(cell(5, 2).classList.contains('adventure-alerted')).toBe(true);
    expect(cell(6, 2).classList.contains('adventure-marker-slime')).toBe(false);
    expect($('adventure-enemies').firstElementChild!.textContent).toContain('column 6, row 3');
    expect($('adventure-notice').textContent).toBe('Slime spotted you! Move more than 3 blocks away to lose it.');
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    $('adventure-close').click();
    const asked = bodies.length;
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(bodies).toHaveLength(asked);
  } finally { dom.window.close(); }
});

it('opens the battle scene when a monster attacks the pet on its step, naming the attacker', async () => {
  const { dom, window, $ } = page();
  Object.defineProperty(window.document, 'hidden', { value: false });
  const start = map(), fought = battleProgress();
  const attacked = { ...fought, x: start.x, battle: { ...fought.battle, attacked: true } };
  window.fetch = vi.fn(async (_url: string, options: RequestInit) =>
    Response.json(JSON.parse(options.body as string).action === 'patrol' ? attacked : start)) as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-grid').children).toHaveLength(256));
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement | null)?.open).toBe(true), { timeout: 2500 });
    expect($('battle-title').textContent).toBe('Floor 1 · Slime attacks!');
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
    finishes[0](Response.json({ ...grove, enemies: grove.enemies.map(e => ({ ...e, moves: e.kind === 'slime-king'
      ? [{ id: 'bump', name: 'Bump', mpCost: 5, description: 'Two-thirds of the target’s current HP, rounded up.' }] : [] })) }));
    await vi.waitFor(() => expect($('adventure-title').textContent).toBe('Slime King’s grove'));
    expect($('adventure-enemies').lastElementChild!.textContent).toMatch(/^Slime King · .* · Bump \(5 MP\): Two-thirds of the target’s current HP, rounded up\.$/);
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
    await vi.waitFor(() => expect($('adventure-grid').children).toHaveLength(256));
    expect($('adventure-title').textContent).toBe('Woodland clearing');
    expect($('adventure-enemies').children).toHaveLength(4);
    expect($('adventure-status').textContent).toBe('Column 3 · Row 3');
  } finally { dom.window.close(); }
});

it('reuses automatic monster playback with carried resources and returns to the map without repeating recovery on replay', async () => {
  const { dom, window, $ } = page();
  let saved = battleProgress();
  const requests = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.action === 'continue') saved = { ...saved, revision: 'continued-map', battle: { ...saved.battle, pending: false } };
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
    $('battle-replay').click();
    expect($('battle-hp-text-0').textContent).toBe('9 / 15');
    expect($('battle-mp-text-0').textContent).toBe('1 / 5');
    expect(requests).toHaveBeenCalledTimes(1);
    $('battle-close').click();
    await vi.waitFor(() => expect($('adventure-continue').hidden).toBe(true));
    expect(requests).toHaveBeenCalledTimes(2);
    expect(JSON.parse(requests.mock.calls[1][1].body as string)).toEqual({ action: 'continue', battleId: 'saved-battle', revision: 'battle-map' });
    expect($('adventure-resources').textContent).toBe('HP 9 / 15 · MP 2 / 5');
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    $('adventure-replay').click();
    expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true);
    $('battle-skip').click(); $('battle-close').click();
    expect(requests).toHaveBeenCalledTimes(2);
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
  const { dom, window, $ } = page();
  const failed = battleProgress(false);
  let saved: ReturnType<typeof battleProgress> | ReturnType<typeof map> = failed;
  const requests = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.action === 'continue') saved = { ...failed, battle: { ...failed.battle, pending: false } };
    if (body.action === 'restart') saved = map();
    return Response.json(saved);
  });
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    await vi.waitFor(() => expect(($('battle-dialog') as HTMLDialogElement).open).toBe(true));
    $('battle-skip').click();
    expect($('battle-status').textContent).toContain('Adventure failed');
    $('battle-close').click();
    await vi.waitFor(() => expect(($('adventure-restart') as HTMLButtonElement).disabled).toBe(false));
    expect($('adventure-failure').hidden).toBe(false);
    expect(window.document.activeElement?.id).toBe('adventure-restart');
    for (const button of $('adventure-dialog').querySelectorAll<HTMLButtonElement>('[data-direction]')) expect(button.disabled).toBe(true);
    $('adventure-dialog').dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(requests).toHaveBeenCalledTimes(2);
    $('adventure-restart').click();
    await vi.waitFor(() => expect($('adventure-failure').hidden).toBe(true));
    expect($('adventure-restart').hidden).toBe(true);
    expect($('adventure-resources').textContent).toBe('HP 15 / 15 · MP 5 / 5');
    expect($('adventure-battle-summary').hidden).toBe(true);
    expect($('adventure-grid').querySelectorAll('.adventure-marker-slime')).toHaveLength(2);
  } finally { dom.window.close(); }
});

it('ends the mini-game at once on Abandon run: the map closes, and reopening offers only a new adventure', async () => {
  const { dom, window, $ } = page();
  const confirms: string[] = [];
  let answer = false;
  window.confirm = (message?: string) => { confirms.push(String(message)); return answer; };
  let state: ReturnType<typeof map> & { abandoned?: boolean } = map();
  const cooldownUntil = Date.now() + 4 * 60 * 60 * 1000;
  const requests = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.action === 'abandon') state = { ...state, revision: `abandoned-${requests.mock.calls.length}`, abandoned: true };
    if (body.action === 'restart') state = { ...map(), revision: 'restarted-map', cooldownUntil };
    return Response.json(state);
  });
  window.fetch = requests as unknown as typeof fetch;
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    const dialog = $('adventure-dialog') as HTMLDialogElement;
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-grid').children).toHaveLength(256));
    expect($('adventure-abandon').hidden).toBe(false);
    expect($('adventure-restart').hidden).toBe(true);
    $('adventure-abandon').click(); // cancelled
    expect(requests).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(true);
    answer = true;
    $('adventure-abandon').click();
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(confirms.at(-1)).toBe('Abandon this adventure? It ends now, and starting a new one costs 40 stamina and 20 hygiene.');
    expect(JSON.parse(requests.mock.calls[1][1].body as string)).toEqual({ action: 'abandon', revision: 'saved-map' });
    expect(window.document.activeElement?.id).toBe('adventure-open');
    // Reopening shows the ended run: no more exploring, only a (paid) new adventure.
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-failure').hidden).toBe(false));
    expect($('adventure-failure').textContent).toBe('Adventure abandoned. Start a new adventure to try again.');
    expect($('adventure-abandon').hidden).toBe(true);
    expect($('adventure-restart').hidden).toBe(false);
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-direction]')) expect(button.disabled).toBe(true);
    dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(requests).toHaveBeenCalledTimes(3);
    $('adventure-restart').click();
    await vi.waitFor(() => expect($('adventure-failure').hidden).toBe(true));
    // The fresh run plays normally under the cooldown, and abandoning it stays free.
    expect($('adventure-cooldown').textContent).toBe('If you abandon this run, the next adventure opens in 4 h.');
    expect($('adventure-skip-cooldown').hidden).toBe(true);
    expect($('adventure-abandon').hidden).toBe(false);
    $('adventure-abandon').click();
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    $('adventure-open').click();
    await vi.waitFor(() => expect($('adventure-failure').hidden).toBe(false));
    expect($('adventure-cooldown').textContent).toBe('Your pet needs to rest. Next adventure in 4 h.');
    expect($('adventure-skip-cooldown').hidden).toBe(false);
    expect($('adventure-restart').hidden).toBe(true);
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
    descend.focus(); descend.click();
    expect(descend.disabled).toBe(true);
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    expect(requests[1].body).toEqual({ action: 'descend', revision: 'saved-map' });
    requests[1].finish(Response.json(map(2)));
    await vi.waitFor(() => expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 2 / 5'));
    window.document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(requests[2].body).toEqual({ direction: 'd', revision: 'saved-map' });
    requests[2].finish(Response.json({ ...map(2), x: 3 }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 4 · Row 3'));
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
    open.focus(); open.click(); open.click();
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toEqual({ action: 'open-chest', revision: 'saved-map' });
    expect($('adventure-items').textContent).toContain('Food × 0');
    expect($('adventure-treasure').textContent).toBe('');
    expect(window.document.activeElement?.id).toBe('adventure-grid');
    const saved = { ...before, revision: 'opened-map', chests: before.chests.map(c => ({ ...c, reward: { category: 'food', id: 'food', name: 'Food', quantity: 1 } })),
      inventory: { ...before.inventory, items: before.inventory.items.map(item => ({ ...item, quantity: 1, usable: true })) } };
    requests[1].finish(Response.json(saved));
    await vi.waitFor(() => expect($('adventure-items').textContent).toContain('Food × 1'));
    expect(open.textContent).toBe('Chest opened'); expect(open.disabled).toBe(true);
    expect($('adventure-treasure').textContent).toContain('Found 1 Food');
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
  const mate = { id: 'pal', color: '#654321', appearance: 'dog', joined: false, waiting: null };
  let lobby: any = { team: null, invitations: [], run: { team: null, state: 'new' }, size: 4 };
  const fresh = { ...map(), started: false, team: null as unknown };
  // Teammates set off from the same tile.
  const shared = { ...map(), started: true, team: { id: 7, members: [{ id: 'pal', color: '#654321', appearance: 'dog', floor: 1, x: 2, y: 2, hp: 15, maxHp: 15, status: 'exploring' }] } };
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
    await vi.waitFor(() => expect($('adventure-grid').children).toHaveLength(256));
    // Sharing the pet's tile: a badge counts both pets, and the map says who.
    const start = $('adventure-grid').children[2 * 16 + 2] as HTMLElement;
    expect(start.classList.contains('adventure-shared')).toBe(true);
    expect(start.dataset.shared).toBe('2');
    expect($('adventure-grid').getAttribute('aria-label')).toContain('Your pet is at column 3, row 3, with pal.');
    expect($('adventure-team').hidden).toBe(false);
    expect($('adventure-team-list').textContent).toBe('pal · floor 1, column 3, row 3 · HP 15 / 15');
    // Once the teammate walks on, it stands on its own tile.
    onMap = { ...shared, team: { ...shared.team, members: [{ ...shared.team.members[0], x: 3 }] } };
    Object.defineProperty(window.document, 'hidden', { value: false });
    await vi.waitFor(() => expect($('adventure-grid').children[2 * 16 + 3].classList.contains('adventure-teammate')).toBe(true), { timeout: 2500 });
    const cell = $('adventure-grid').children[2 * 16 + 3];
    expect(cell.querySelector('use')?.getAttribute('href')).toBe('#pet-dog');
    expect($('adventure-grid').children[2 * 16 + 2].classList.contains('adventure-shared')).toBe(false);
    expect($('adventure-grid').getAttribute('aria-label')).toContain('1 teammate here');
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
    expect($('battle-log').textContent).toContain('pal used Claw Strike');
  } finally { dom.window.close(); }
});
