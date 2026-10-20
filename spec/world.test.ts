import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

function page() {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/',
  });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  let frameId = 0, clock = 0;
  const frames = new Map<number, FrameRequestCallback>();
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };
  vi.spyOn(window.performance, 'now').mockImplementation(() => clock);
  const advance = () => {
    for (let step = 0; step < 6; step++) {
      clock += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(clock));
    }
  };
  $('dashboard').hidden = false;
  const controls = new Map(['pet-touch', 'pet-avatar', 'courses', 'items', 'locations',
    'appearance-settings', 'adventure-open', 'theft-notifications'].map(id => [id, $(id)]));
  const lesson = window.document.createElement('button');
  lesson.textContent = 'Take a lesson';
  const study = vi.fn();
  lesson.addEventListener('click', study);
  $('courses').append(lesson);
  window.eval(readFileSync('public/world.js', 'utf8'));
  const destination = (place: string) => {
    const button = window.document.querySelector<HTMLButtonElement>(`[data-place="${place}"]`);
    expect(button, `${place} must be reachable`).not.toBeNull();
    button!.click();
  };
  const walk = (key = 'ArrowRight', target: HTMLElement = $('world-stage')) => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    advance();
    target.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }));
    advance();
  };
  const position = () => [$('world-avatar').style.left, $('world-avatar').style.top];
  return { dom, window, $, controls, lesson, study, destination, walk, position, advance };
}

it('keeps the live pet and gameplay controls while navigating between home and town', () => {
  const p = page();
  try {
    expect(p.$('world-stage').dataset.scene).toBe('home');
    expect(p.$('home-scene').hidden).toBe(false);
    expect(p.$('town-scene').hidden).toBe(true);
    expect(p.$('home-scene').contains(p.controls.get('pet-touch')!)).toBe(true);
    p.$('home-door').click();
    expect(p.$('world-stage').dataset.scene).toBe('town');
    expect(p.$('home-scene').hidden).toBe(true);
    expect(p.$('town-scene').hidden).toBe(false);
    p.$('town-home').click();
    expect(p.$('world-stage').dataset.scene).toBe('home');
    p.$('world-map').click();
    expect(p.$('world-stage').dataset.scene).toBe('town');
    p.$('world-home').click();
    expect(p.$('world-stage').dataset.scene).toBe('home');
    for (const [id, original] of p.controls) {
      expect(p.$(id)).toBe(original);
      expect(p.window.document.querySelectorAll(`#${id}`)).toHaveLength(1);
    }
  } finally { p.dom.window.close(); }
});

it('opens every destination with its existing working controls and restores focus on close', () => {
  const p = page();
  try {
    p.$('world-map').click();
    for (const [place, control] of [['shop', 'items'], ['work', 'locations'], ['school', 'courses'],
      ['arena', 'lookup'], ['backpack', 'coins'], ['journal', 'visitors'], ['appearance', 'appearance-settings']]) {
      p.destination(place);
      expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
      expect(p.$('world-dialog-title').textContent?.trim()).not.toBe('');
      expect(p.$('world-dialog').contains(p.$(control))).toBe(true);
      expect(p.$(control).closest('[hidden]')).toBeNull();
      if (place === 'school') p.lesson.click();
      p.$('world-dialog-close').click();
      expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
      expect(p.window.document.activeElement?.closest('[hidden]')).toBeNull();
    }
    expect(p.study).toHaveBeenCalledOnce();
    expect(p.$('town-scene').contains(p.controls.get('adventure-open')!)).toBe(true);
    p.$('adventure-open').focus();
    expect(p.window.document.activeElement).toBe(p.$('adventure-open'));
  } finally { p.dom.window.close(); }
});

it('uses existing care actions and follows their saved inventory and disabled state at home', async () => {
  const p = page();
  try {
    expect((p.$('home-feed') as HTMLButtonElement).disabled).toBe(true);
    expect((p.$('home-clean') as HTMLButtonElement).disabled).toBe(true);
    p.$('items').innerHTML = '<div data-item="food"><span class="item-count">2</span><button class="chip-use">Feed</button></div>' +
      '<div data-item="soap"><span class="item-count">3</span><button class="chip-use">Clean</button></div>';
    const food = p.$('items').querySelector<HTMLButtonElement>('[data-item="food"] button')!;
    const soap = p.$('items').querySelector<HTMLButtonElement>('[data-item="soap"] button')!;
    const feed = vi.fn(), clean = vi.fn();
    food.addEventListener('click', feed);
    soap.addEventListener('click', clean);
    await vi.waitFor(() => expect((p.$('home-feed') as HTMLButtonElement).disabled).toBe(false));
    expect(p.$('home-feed').textContent).toContain('2');
    expect(p.$('home-clean').textContent).toContain('3');
    p.$('home-feed').click();
    p.$('home-clean').click();
    expect(feed).toHaveBeenCalledOnce();
    expect(clean).toHaveBeenCalledOnce();
    food.disabled = true;
    p.$('items').querySelector('[data-item="food"] .item-count')!.textContent = '0';
    await vi.waitFor(() => expect((p.$('home-feed') as HTMLButtonElement).disabled).toBe(true));
    expect(p.$('home-feed').textContent).toContain('0');
    p.$('home-feed').click();
    expect(feed).toHaveBeenCalledOnce();
  } finally { p.dom.window.close(); }
});

it('moves in the world but leaves keyboard input alone in dialogs and text fields', () => {
  const p = page();
  try {
    p.$('world-stage').focus();
    const start = p.position();
    p.walk();
    expect(p.position()).not.toEqual(start);
    p.destination('shop');
    const paused = p.position();
    p.walk();
    expect(p.position()).toEqual(paused);
    p.$('world-dialog-close').click();
    const input = p.window.document.createElement('input');
    p.$('world-shell').append(input);
    input.focus();
    const typing = p.position();
    p.walk('d', input);
    expect(p.position()).toEqual(typing);
    p.walk('ArrowLeft', input);
    expect(p.position()).toEqual(typing);
    input.remove();
    p.$('world-stage').focus();
    p.walk('ArrowLeft');
    expect(p.position()).not.toEqual(typing);
  } finally { p.dom.window.close(); }
});

it('walks with the direction pad and uses the nearby doorway from the keyboard', () => {
  const p = page();
  try {
    const down = p.window.document.querySelector<HTMLButtonElement>('[data-world-direction="down"]')!;
    for (let step = 0; step < 8 && !p.$('world-interact').textContent?.includes('Leave'); step++) down.click();
    expect(p.$('world-stage').dataset.scene).toBe('home');
    expect((p.$('world-interact') as HTMLButtonElement).disabled).toBe(false);
    p.$('world-stage').focus();
    p.$('world-stage').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    expect(p.$('world-stage').dataset.scene).toBe('town');
    p.$('world-stage').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(p.$('world-stage').dataset.scene).toBe('home');
  } finally { p.dom.window.close(); }
});

it('can walk to a clear spot after stopping beside a building with the keyboard', () => {
  const p = page();
  try {
    p.$('world-map').click();
    p.walk('ArrowUp');
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    const point = () => ({
      x: parseFloat(p.$('world-avatar').style.left) * 960 / 100,
      y: parseFloat(p.$('world-avatar').style.top) * 640 / 100,
    });
    const stopped = point();
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 600, clientY: 580, bubbles: true }));
    for (let frame = 0; frame < 4; frame++) p.advance();
    expect(point().x).toBeGreaterThan(stopped.x);
    for (let frame = 0; frame < 20; frame++) p.advance();
    expect(Math.hypot(point().x - 600, point().y - 580)).toBeLessThan(7);
    expect(p.$('world-stage').dataset.scene).toBe('town');
  } finally { p.dom.window.close(); }
});

it('shows an Hourglass action error while the player is in town', async () => {
  const p = page();
  try {
    p.$('world-map').click();
    p.$('busy').hidden = false;
    p.$('skip').addEventListener('click', () => { p.$('care-error').textContent = 'No hourglasses left.'; });
    p.$('skip').click();
    await vi.waitFor(() => expect(p.$('home-care-error').textContent).toBe('No hourglasses left.'));
    expect(p.$('home-care-error').closest('[hidden]')).toBeNull();
    expect(p.$('world-stage').dataset.scene).toBe('town');
  } finally { p.dom.window.close(); }
});

it('surfaces saved theft reports and clears the open world view when the account resets', async () => {
  const p = page();
  try {
    p.$('theft-list').innerHTML = '<div>neighbour stole $20 <button>Take revenge</button></div>';
    p.$('theft-notifications').hidden = false;
    await vi.waitFor(() => expect(p.$('world-journal').textContent).toMatch(/1 report/i));
    p.destination('journal');
    expect(p.$('world-dialog').contains(p.$('theft-notifications'))).toBe(true);
    expect(p.$('theft-notifications').closest('[hidden]')).toBeNull();
    p.window.document.dispatchEvent(new p.window.CustomEvent('adventure:reset'));
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
    expect(p.$('world-stage').dataset.scene).toBe('home');
    p.$('world-map').click();
    p.destination('arena');
    p.$('dashboard').hidden = true;
    await vi.waitFor(() => expect(p.window.document.body.classList.contains('world-playing')).toBe(false));
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
    expect(p.$('world-stage').dataset.scene).toBe('home');
    p.$('dashboard').hidden = false;
    await vi.waitFor(() => expect(p.window.document.body.classList.contains('world-playing')).toBe(true));
    expect(p.$('world-stage').dataset.scene).toBe('home');
  } finally { p.dom.window.close(); }
});
