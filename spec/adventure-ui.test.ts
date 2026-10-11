import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createWorld } from '../src/adventure-world.ts';
import { simulateBattle } from '../src/combat.ts';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

function map(floor = 1) {
  return { ...createWorld()[floor - 1], floor, floorCount: 5, size: 16, x: 2, y: 2, encounters: [], revision: 'saved-map', battle: null, completed: false, failed: false, hp: 15, mp: 5, maxHp: 15, maxMp: 5 };
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

it('clears the previous floor on account reset and ignores its late movement response', async () => {
  const { dom, window, $ } = page();
  const finishes: ((response: Response) => void)[] = [];
  window.fetch = vi.fn(() => new Promise<Response>(resolve => finishes.push(resolve))) as typeof fetch;
  const scenes = vi.fn();
  window.document.addEventListener('battle:show', scenes);
  try {
    window.eval(readFileSync('public/adventure.js', 'utf8'));
    $('adventure-open').click();
    finishes[0](Response.json(map(5)));
    await vi.waitFor(() => expect($('adventure-title').textContent).toBe('Slime King’s grove'));
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
