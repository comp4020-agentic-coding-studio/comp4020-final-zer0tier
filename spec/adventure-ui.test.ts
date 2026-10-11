import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createWorld } from '../src/adventure-world.ts';
import { baseUrl, freshId, getRules, signUp } from './helpers.ts';

function map(floor = 1) {
  return { ...createWorld()[floor - 1], floor, floorCount: 5, size: 16, x: 2, y: 2, encounters: [] };
}

function page() {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: baseUrl, runScripts: 'outside-only' });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const $ = (id: string) => window.document.getElementById(id)!;
  return { dom, window, $ };
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
    finishes[1](Response.json({ ...map(5), x: 3 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect($('adventure-grid').getAttribute('aria-busy')).toBe('true');
    expect($('adventure-grid').children).toHaveLength(0);
    finishes[2](Response.json(map()));
    await vi.waitFor(() => expect($('adventure-grid').children).toHaveLength(256));
    expect($('adventure-title').textContent).toBe('Woodland clearing');
    expect($('adventure-enemies').children).toHaveLength(4);
    expect($('adventure-status').textContent).toBe('Column 3 · Row 3');
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
    expect(requests[1].body).toEqual({ action: 'descend' });
    requests[1].finish(Response.json(map(2)));
    await vi.waitFor(() => expect($('adventure-floor').textContent).toBe('ADVENTURE · FLOOR 2 / 5'));
    window.document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    expect(requests[2].body).toEqual({ direction: 'd' });
    requests[2].finish(Response.json({ ...map(2), x: 3 }));
    await vi.waitFor(() => expect($('adventure-status').textContent).toBe('Column 4 · Row 3'));
  } finally { dom.window.close(); }
});
