import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { freshId, getRules, signUp, baseUrl } from './helpers.ts';

it('equips learned skills from the home chest, waits for the server, and disables changes in town', async () => {
  let pet = { ...await (await signUp(freshId())).json(), abilities: ['claw-strike', 'firebolt'], equippedAbilities: ['claw-strike'] };
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only', url: baseUrl });
  const { window } = dom, { document } = window;
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof WebSocket;
  let resolveSave: (response: Response) => void = () => {};
  const requests = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me') return Response.json(pet);
    if (url.endsWith('/equip-skills')) return new Promise<Response>(resolve => { resolveSave = resolve; });
    return Response.json([]);
  });
  window.fetch = requests as typeof fetch;
  const skill = (id: string) => document.querySelector<HTMLButtonElement>(`[data-equip-skill="${id}"]`)!;
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    await vi.waitFor(() => expect(skill('firebolt')).not.toBeNull());
    expect(skill('claw-strike').disabled).toBe(true);
    expect(skill('heavy-breath-slam').disabled).toBe(true);
    expect(skill('heavy-strike')).toBeNull(); // unobtainable legacy moves only appear when already owned
    expect(skill('heavy-breath-slam').closest('.home-skill')!.textContent).toContain('Mover Lv.1');
    expect(skill('firebolt').getAttribute('aria-pressed')).toBe('false');
    skill('firebolt').click();
    expect(requests).toHaveBeenCalledWith(`/api/pets/${pet.id}/equip-skills`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ abilities: ['claw-strike', 'firebolt'] }),
    }));
    expect(skill('firebolt').disabled).toBe(true);
    expect(skill('firebolt').getAttribute('aria-pressed')).toBe('false');
    pet = { ...pet, equippedAbilities: ['claw-strike', 'firebolt'] };
    resolveSave(Response.json(pet));
    await vi.waitFor(() => expect(skill('firebolt').getAttribute('aria-pressed')).toBe('true'));
    expect(skill('firebolt').textContent).toBe('Unequip');
    expect(document.getElementById('home-skills-status')!.textContent).toBe('Battle skills saved.');
    document.dispatchEvent(new window.CustomEvent('world:scene', { detail: { home: false } }));
    expect(skill('firebolt').disabled).toBe(true);
    expect(document.getElementById('home-skills-hint')!.textContent).toContain('storage chest at home');
    document.dispatchEvent(new window.CustomEvent('world:scene', { detail: { home: true } }));
    expect(skill('firebolt').disabled).toBe(false);
    skill('firebolt').click();
    resolveSave(Response.json({ error: 'Finish your battle first.' }, { status: 409 }));
    await vi.waitFor(() => expect(document.getElementById('home-skills-error')!.textContent).toBe('Finish your battle first.'));
    expect(skill('firebolt').getAttribute('aria-pressed')).toBe('true');
    skill('firebolt').click();
    const saved = { ...pet, equippedAbilities: ['claw-strike'] };
    // A later coin change may arrive while the skill response is in flight.
    // That older response must not replace a newer broadcast of this pet.
    socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify({
      type: 'pet:updated', pet: { ...saved, equippedCoin: 'silver-coin', coins: { ...pet.coins, 'silver-coin': 1 } },
    }) }));
    resolveSave(Response.json(saved));
    await vi.waitFor(() => expect(document.getElementById('home-skills-status')!.textContent).toBe('Battle skills saved.'));
    expect(skill('firebolt').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-coin="silver-coin"] .coin-equip')!.getAttribute('aria-pressed')).toBe('true');
  } finally { window.close(); }
});

async function loadoutWindow() {
  let pet = { ...await (await signUp(freshId())).json(),
    abilities: ['claw-strike', 'firebolt', 'hardhat-guard'], equippedAbilities: ['claw-strike', 'firebolt'], skillLoadouts: {} };
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only', url: baseUrl });
  const { window } = dom, { document } = window;
  const socket = new window.EventTarget();
  window.WebSocket = function () { return socket; } as unknown as typeof WebSocket;
  const pending: { resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const requests = vi.fn(async (url: string) => {
    if (url === '/api/rules') return Response.json(rules);
    if (url === '/api/me' || url === '/api/signin') return Response.json(pet);
    if (url.includes('/skill-loadouts/')) return new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }));
    return Response.json([]);
  });
  window.fetch = requests as typeof fetch;
  const button = (slot: string, action: string) => document.querySelector<HTMLButtonElement>(`[data-loadout="${slot}"] [data-loadout-action="${action}"]`)!;
  const preview = (slot: string) => document.querySelector(`[data-loadout="${slot}"] p`)!.textContent;
  const update = (next: any) => {
    pet = next;
    socket.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify({ type: 'pet:updated', pet }) }));
  };
  window.eval(readFileSync('public/app.js', 'utf8'));
  await vi.waitFor(() => expect(button('adventure', 'save')).not.toBeNull());
  return { window, document, button, preview, requests, pending, update, pet };
}

it('previews saved loadouts and waits for saved state when saving, updating, and switching', async () => {
  const ui = await loadoutWindow();
  const { window, document, button, preview, requests, pending } = ui;
  let pet = ui.pet;
  try {
    expect(button('adventure', 'equip').disabled).toBe(true);
    button('adventure', 'save').focus();
    button('adventure', 'save').click();
    expect(requests).toHaveBeenCalledWith(`/api/pets/${pet.id}/skill-loadouts/adventure/save`, expect.objectContaining({
      body: JSON.stringify({ abilities: ['claw-strike', 'firebolt'] }),
    }));
    expect(preview('adventure')).toBe('No setup saved yet.');
    expect(button('support', 'save').disabled).toBe(true);
    expect(document.querySelector('[data-equip-skill="firebolt"]')!.hasAttribute('disabled')).toBe(true);
    pet = { ...pet, skillLoadouts: { adventure: ['claw-strike', 'firebolt'] } };
    pending.shift()!.resolve(Response.json(pet));
    await vi.waitFor(() => expect(preview('adventure')).toBe('Claw Strike · Firebolt'));
    expect(button('adventure', 'equip').textContent).toBe('Equipped');
    expect(button('adventure', 'save').disabled).toBe(true);
    expect(document.getElementById('home-skills-status')!.textContent).toBe('Adventure loadout saved.');

    pet = { ...pet, equippedAbilities: ['claw-strike', 'hardhat-guard'] };
    ui.update(pet);
    expect(preview('adventure')).toBe('Claw Strike · Firebolt');
    expect(button('adventure', 'equip').disabled).toBe(false);
    button('support', 'save').click();
    pet = { ...pet, skillLoadouts: { ...pet.skillLoadouts, support: ['claw-strike', 'hardhat-guard'] } };
    pending.shift()!.resolve(Response.json(pet));
    await vi.waitFor(() => expect(preview('support')).toContain('Hardhat Guard'));
    button('adventure', 'equip').click();
    expect(document.getElementById('home-equipped-skills')!.textContent).toContain('Hardhat Guard');
    const equipped = { ...pet, equippedAbilities: ['claw-strike', 'firebolt'] };
    // A newer broadcast must win over an older HTTP response.
    pet = { ...equipped, skillLoadouts: { ...pet.skillLoadouts, arena: ['claw-strike'] } };
    ui.update(pet);
    pending.shift()!.resolve(Response.json(equipped));
    await vi.waitFor(() => expect(document.getElementById('home-skills-status')!.textContent).toBe('Adventure loadout equipped.'));
    expect(preview('arena')).toBe('Claw Strike');
    expect(document.getElementById('home-equipped-skills')!.textContent).toBe('Equipped 2/4: Claw Strike · Firebolt');
    expect(button('adventure', 'equip').disabled).toBe(true);

    button('support', 'save').click();
    pet = { ...pet, skillLoadouts: { ...pet.skillLoadouts, support: ['claw-strike', 'firebolt'] } };
    pending.shift()!.resolve(Response.json(pet));
    await vi.waitFor(() => expect(preview('support')).toBe('Claw Strike · Firebolt'));
    expect(preview('arena')).toBe('Claw Strike');
  } finally { window.close(); }
});

it('keeps loadouts intact on errors and disables their controls away from home', async () => {
  const { window, document, button, preview, pending } = await loadoutWindow();
  try {
    button('arena', 'save').click();
    pending.shift()!.resolve(Response.json({ error: 'Finish your battle first.' }, { status: 409 }));
    await vi.waitFor(() => expect(document.getElementById('home-skills-error')!.textContent).toBe('Finish your battle first.'));
    expect(preview('arena')).toBe('No setup saved yet.');
    expect(button('arena', 'save').disabled).toBe(false);
    button('arena', 'save').click();
    pending.shift()!.reject(new Error('Connection lost.'));
    await vi.waitFor(() => expect(document.getElementById('home-skills-error')!.textContent).toBe('Connection lost.'));
    expect(button('arena', 'save').disabled).toBe(false);
    document.dispatchEvent(new window.CustomEvent('world:scene', { detail: { home: false } }));
    expect(button('arena', 'save').disabled).toBe(true);
    document.dispatchEvent(new window.CustomEvent('world:scene', { detail: { home: true } }));
    expect(button('arena', 'save').disabled).toBe(false);
  } finally { window.close(); }
});

it('ignores a prior login’s late loadout response without unlocking a new save', async () => {
  const { window, document, button, preview, pending, pet } = await loadoutWindow();
  try {
    button('arena', 'save').click();
    const old = pending.shift()!;
    document.getElementById('signout')!.click();
    await vi.waitFor(() => expect(document.getElementById('dashboard')!.hidden).toBe(true));
    (document.getElementById('player-id') as HTMLInputElement).value = pet.id;
    (document.getElementById('password') as HTMLInputElement).value = 'correct horse battery';
    document.getElementById('login')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('dashboard')!.hidden).toBe(false));
    button('support', 'save').click();
    old.resolve(Response.json({ ...pet, skillLoadouts: { arena: ['claw-strike', 'firebolt'] } }));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(preview('arena')).toBe('No setup saved yet.');
    expect(document.getElementById('home-skills-status')!.textContent).toBe('Saving Support loadout…');
    expect(button('adventure', 'save').disabled).toBe(true);
    pending.shift()!.resolve(Response.json({ ...pet, skillLoadouts: { support: ['claw-strike', 'firebolt'] } }));
    await vi.waitFor(() => expect(preview('support')).toBe('Claw Strike · Firebolt'));
    expect(button('adventure', 'save').disabled).toBe(false);
  } finally { window.close(); }
});
