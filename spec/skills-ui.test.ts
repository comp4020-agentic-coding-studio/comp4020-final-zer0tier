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
