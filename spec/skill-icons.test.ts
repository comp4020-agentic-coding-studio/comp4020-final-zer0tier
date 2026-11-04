import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { ABILITIES, MONSTER_ABILITIES, startBattle, takeBattleTurn } from '../src/combat.ts';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

const sheet = readFileSync('public/scenes/skill-icons.svg', 'utf8');
const symbol = (id: string) => sheet.match(new RegExp(`<symbol id="skill-${id}"[^>]*>([\\s\\S]*?)</symbol>`))?.[1];
const iconHref = (node: Element | null | undefined) => node?.querySelector('use')?.getAttribute('href');

it('gives every pet skill and monster move its own distinct icon, served from the icon sheet', async () => {
  const ids = [...ABILITIES, ...MONSTER_ABILITIES].map(skill => skill.id);
  expect(ids.length).toBeGreaterThanOrEqual(36);
  const artwork = new Set<string>();
  for (const id of ids) {
    const art = symbol(id);
    expect(art, `${id} has an icon`).toBeTruthy();
    // Strip the shared badge frame so identical drawings would collide.
    artwork.add(art!.replace(/<desc>[\s\S]*?<\/desc>/, '').replace(/url\(#si-\w+\)|stroke="#[0-9a-f]{6}" stroke-width="1.5"|fill="#[0-9a-f]{6}" stroke="none"/g, ''));
  }
  expect(artwork.size).toBe(ids.length);
  const response = await fetch(`${baseUrl}/scenes/skill-icons.svg`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('image/svg+xml');
});

it('shows each skill’s icon in the home skill book, equipped summary, and saved loadouts', async () => {
  const pet = { ...await (await signUp(freshId())).json(), abilities: ['claw-strike', 'firebolt', 'gym-pump'],
    equippedAbilities: ['claw-strike', 'firebolt'], skillLoadouts: { arena: ['claw-strike', 'gym-pump'] } };
  const rules = await getRules();
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only', url: baseUrl });
  const { window } = dom, { document } = window;
  window.WebSocket = function () { return new window.EventTarget(); } as unknown as typeof WebSocket;
  window.fetch = (async (url: string) => url === '/api/rules' ? Response.json(rules) : url === '/api/me' ? Response.json(pet) : Response.json([])) as typeof fetch;
  try {
    window.eval(readFileSync('public/app.js', 'utf8'));
    await vi.waitFor(() => expect(document.querySelector('[data-equip-skill="firebolt"]')).not.toBeNull());
    const rows = [...document.querySelectorAll('.home-skill')];
    expect(rows.length).toBeGreaterThan(30);
    for (const row of rows) {
      const id = row.querySelector<HTMLElement>('[data-equip-skill]')!.dataset.equipSkill;
      const icon = row.querySelector(':scope > svg.skill-icon')!;
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(iconHref(icon)).toBe(`/scenes/skill-icons.svg#skill-${id}`);
    }
    expect(document.querySelector('[data-equip-skill="heavy-breath-slam"]')!.closest('.home-skill')!.getAttribute('data-learned')).toBe('false');
    const equipped = document.getElementById('home-equipped-skills')!;
    expect(equipped.textContent).toBe('Equipped 2/4: Claw Strike · Firebolt');
    expect([...equipped.querySelectorAll('svg')].map(iconHref)).toEqual(['claw-strike', 'firebolt'].map(id => `/scenes/skill-icons.svg#skill-${id}`));
    const arena = document.querySelector('[data-loadout="arena"] p')!;
    expect(arena.textContent).toBe('Claw Strike · Gym Pump');
    expect(iconHref(arena.querySelectorAll('svg')[1])).toBe('/scenes/skill-icons.svg#skill-gym-pump');
    expect(document.querySelector('[data-loadout="adventure"] p')!.textContent).toBe('No setup saved yet.');
    expect(document.getElementById('learned-abilities')!.querySelectorAll('svg')).toHaveLength(3);
  } finally { window.close(); }
});

it('shows skill icons on battle choices and the banner of the skill being used', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
  const pet = { id: 'pet', strength: 5, intelligence: 6, charisma: 20, equippedAbilities: ['coffee-break', 'service-smile'] as const };
  const show = (battle: unknown) => window.document.dispatchEvent(new window.CustomEvent('battle:show', {
    detail: { key: 'icons', battle, viewer: 'pet', manual: true, result: '' } }));
  try {
    window.eval(readFileSync('public/battle.js', 'utf8'));
    const battle = startBattle([pet], { id: 'rival', strength: 4, intelligence: 4, charisma: 14 }, [36, 26], { random: () => 0 });
    show(battle);
    const choices = [...window.document.querySelectorAll<HTMLElement>('.battle-skill')];
    expect(choices.map(button => button.dataset.skill)).toEqual(['claw-strike', 'coffee-break', 'service-smile']);
    for (const button of choices) {
      expect(button.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
      expect(iconHref(button)).toBe(`/scenes/skill-icons.svg#skill-${button.dataset.skill}`);
    }
    // The accessible name is the skill's text, not the decorative icon.
    expect(choices[2].textContent!.startsWith('Service Smile')).toBe(true);
    const after = takeBattleTurn(battle, 'pet', 'coffee-break', battle.revision, () => 0);
    if ('error' in after) throw new Error(after.error);
    show(after);
    expect(window.document.getElementById('battle-ability-name')!.textContent).toBe('Coffee Break');
    expect(iconHref(window.document.querySelector('.battle-ability'))).toBe('/scenes/skill-icons.svg#skill-coffee-break');
  } finally { window.close(); }
});
