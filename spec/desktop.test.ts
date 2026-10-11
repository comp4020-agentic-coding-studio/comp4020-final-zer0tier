import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

function page() {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { runScripts: 'outside-only' });
  const { window } = dom;
  const media = new window.EventTarget() as EventTarget & { matches: boolean };
  media.matches = false;
  window.matchMedia = (() => media) as unknown as typeof window.matchMedia;
  const $ = (id: string) => window.document.getElementById(id)!;
  $('dashboard').hidden = false;
  const original = $('dashboard').innerHTML;
  window.eval(readFileSync('public/desktop.js', 'utf8'));
  const resize = (desktop: boolean) => { media.matches = desktop; media.dispatchEvent(new window.Event('change')); };
  return { dom, window, $, resize, original };
}

it('restores the exact mobile dashboard and original controls after desktop resizing', () => {
  const p = page();
  try {
    expect(p.$('dashboard').innerHTML).toBe(p.original);
    const courses = p.$('courses');
    p.resize(true);
    expect(p.window.document.querySelectorAll('.desktop-column')).toHaveLength(3);
    expect(p.$('desktop-panel-school').contains(courses)).toBe(true);
    p.$('desktop-tab-work').click();
    expect(p.$('desktop-panel-work').hidden).toBe(false);
    expect(p.$('desktop-panel-school').hidden).toBe(true);
    p.resize(false);
    expect(p.$('dashboard').innerHTML).toBe(p.original);
    expect(p.$('courses')).toBe(courses);
    p.resize(true); p.resize(false);
    expect(p.$('dashboard').innerHTML).toBe(p.original);
  } finally { p.dom.window.close(); }
});

it('supports keyboard tabs, forwards quick care to existing actions, and shows saved alerts', async () => {
  const p = page();
  try {
    p.$('items').innerHTML = '<div data-item="food"><span class="item-count">2</span><button class="chip-use">Feed</button></div>';
    const used = vi.fn();
    p.$('items').querySelector('button')!.addEventListener('click', used);
    p.resize(true);
    p.$('desktop-tab-school').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.window.document.activeElement).toBe(p.$('desktop-tab-work'));
    expect(p.$('desktop-panel-work').hidden).toBe(false);
    (p.window.document.querySelector('[data-care="food"]') as HTMLButtonElement).click();
    expect(used).toHaveBeenCalledOnce();
    p.$('items').querySelector('button')!.disabled = true;
    await vi.waitFor(() => expect((p.window.document.querySelector('[data-care="food"]') as HTMLButtonElement).disabled).toBe(true));
    p.$('theft-list').innerHTML = '<div>neighbour stole $20</div>';
    p.$('theft-notifications').hidden = false;
    await vi.waitFor(() => expect(p.$('desktop-tab-alerts').textContent).toBe('Alerts (1)'));
    expect(p.$('desktop-panel-alerts').hidden).toBe(false);
    p.$('dashboard').hidden = true;
    await vi.waitFor(() => expect(p.window.document.body.classList.contains('desktop-game')).toBe(false));
    expect(p.$('theft-notifications').parentElement?.tagName).toBe('MAIN');
  } finally { p.dom.window.close(); }
});

it('keeps the selected Arena tab when crossing the desktop breakpoint', () => {
  const p = page();
  try {
    p.$('tab-pets').setAttribute('aria-selected', 'false');
    p.$('arena-pets').hidden = true;
    p.$('tab-board').setAttribute('aria-selected', 'true');
    p.$('arena-board').hidden = false;
    p.resize(true);
    expect(p.$('tab-board').getAttribute('aria-selected')).toBe('true');
    expect(p.$('arena-board').hidden).toBe(false);
    p.$('tab-pets').click();
    p.resize(false);
    expect(p.$('tab-pets').getAttribute('aria-selected')).toBe('true');
    expect(p.$('arena-pets').hidden).toBe(false);
  } finally { p.dom.window.close(); }
});
