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
  const advance = (steps = 6, milliseconds = 16) => {
    for (let step = 0; step < steps; step++) {
      clock += milliseconds;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(clock));
    }
  };
  $('dashboard').hidden = false;
  $('signout').hidden = false;
  const controls = new Map(['pet-touch', 'pet-avatar', 'courses', 'items', 'locations',
    'appearance-settings', 'adventure-open', 'theft-notifications', 'pet-name',
    'meter-stamina', 'busy', 'signout'].map(id => [id, $(id)]));
  const lesson = window.document.createElement('button');
  lesson.textContent = 'Take a lesson';
  const study = vi.fn();
  lesson.addEventListener('click', study);
  $('courses').append(lesson);
  const play = [...window.document.querySelectorAll<HTMLButtonElement>('[data-touch]')].map(button => {
    const react = vi.fn();
    button.addEventListener('click', react);
    return { button, react };
  });
  window.eval(readFileSync('public/world.js', 'utf8'));
  const openMenu = () => {
    $('world-stage').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(($('world-dialog') as HTMLDialogElement).open).toBe(true);
    expect($('world-dialog').dataset.place).toBe('menu');
  };
  const destination = (place: string) => {
    const visibleButton = () => [...window.document.querySelectorAll<HTMLButtonElement>(`[data-place="${place}"]`)]
      .find(button => !button.closest('[hidden], dialog:not([open])'));
    if (!visibleButton()) openMenu();
    const button = visibleButton();
    expect(button, `${place} must be reachable`).toBeDefined();
    button!.click();
  };
  const homeAction = (action: string) => {
    const button = window.document.querySelector<HTMLButtonElement>(`[data-home-action="${action}"]`);
    expect(button, `${action} must be reachable at home`).not.toBeNull();
    expect(button!.closest('[hidden]')).toBeNull();
    button!.click();
  };
  const walk = (key = 'ArrowRight', target: HTMLElement = $('world-stage')) => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    advance();
    target.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true }));
    advance();
  };
  const position = () => {
    const translation = $('world-avatar').style.transform.match(/translate3d\(([-\d.e+]+)px,\s*([-\d.e+]+)px,/i);
    if (!translation) throw new Error('The character must have a rendered position');
    const scale = Math.max(window.innerWidth / 960, window.innerHeight / 640);
    return { x: Number(translation[1]) / scale, y: Number(translation[2]) / scale };
  };
  return { dom, window, $, controls, lesson, study, play, destination, homeAction, openMenu, walk, position, advance };
}

it('keeps the live pet and gameplay controls while navigating between home and town', () => {
  const p = page();
  try {
    expect(p.$('world-stage').dataset.scene).toBe('home');
    expect(p.$('home-scene').hidden).toBe(false);
    expect(p.$('town-scene').hidden).toBe(true);
    expect(p.window.document.body.classList.contains('world-home')).toBe(true);
    expect(p.$('home-controls-tip').closest('[hidden]')).toBeNull();
    expect(p.$('home-controls-tip').textContent).toMatch(/W\s*\/\s*A\s*\/\s*S\s*\/\s*D.*move/is);
    expect(p.$('home-controls-tip').textContent).toMatch(/Space\s+bar.*interact/is);
    for (const selector of ['.world-heading', '.world-companion', '.scene-caption', '.world-controls', '.world-nav']) {
      expect(p.window.document.querySelector(selector)!.hasAttribute('hidden'), selector).toBe(true);
    }
    expect(p.$('home-feedback').hidden).toBe(true);
    expect(p.$('home-scene').contains(p.controls.get('pet-touch')!)).toBe(true);
    p.$('home-door').click();
    expect(p.$('world-stage').dataset.scene).toBe('town');
    expect(p.$('home-scene').hidden).toBe(true);
    expect(p.$('town-scene').hidden).toBe(false);
    expect(p.window.document.body.classList.contains('world-home')).toBe(false);
    expect(p.$('home-controls-tip').closest('[hidden]')).toBeNull();
    expect(p.$('world-stage').getAttribute('aria-describedby')).toBe('home-controls-tip');
    for (const selector of ['.world-heading', '.world-companion', '.scene-caption', '.world-controls', '.world-nav']) {
      expect(p.window.document.querySelector(selector)!.hasAttribute('hidden'), selector).toBe(true);
    }
    p.$('town-home').click();
    expect(p.$('world-stage').dataset.scene).toBe('home');
    p.$('home-door').click();
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
    p.$('home-door').click();
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

it('opens pet care and account controls through home objects without replacing their live controls', () => {
  const p = page();
  try {
    const signOut = vi.fn();
    const pat = vi.fn();
    p.$('signout').addEventListener('click', signOut);
    p.window.document.querySelector('[data-touch="pat"]')!.addEventListener('click', pat);
    expect(p.$('pet-name').closest('[hidden]')).not.toBeNull();
    for (const [action, place, control] of [['pet', 'pet', 'pet-name'], ['bed', 'appearance', 'appearance-settings'],
      ['chest', 'backpack', 'coins'], ['tv', 'journal', 'visitors'], ['menu', 'menu', 'signout']]) {
      p.homeAction(action);
      expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
      expect(p.$('world-dialog').dataset.place).toBe(place);
      expect(p.$('world-dialog').contains(p.$(control))).toBe(true);
      expect(p.$(control).closest('[hidden]')).toBeNull();
      if (action === 'pet') {
        expect(p.$('home-feed').closest('[hidden]')).toBeNull();
        expect(p.$('home-clean').closest('[hidden]')).toBeNull();
        expect(p.$('home-scene').contains(p.$('pet-touch'))).toBe(true);
        p.window.document.querySelector<HTMLButtonElement>('[data-touch="pat"]')!.click();
      }
      if (action === 'menu') {
        expect(p.$('world-dialog').querySelector('a[href="/readme/"]')).not.toBeNull();
        p.$('signout').click();
      }
      p.$('world-dialog-close').click();
      expect(p.window.document.activeElement?.closest('[hidden]')).toBeNull();
    }
    expect(pat).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
    p.$('home-door').click();
    expect(p.$('pet-name').closest('[hidden]')).not.toBeNull();
    expect(p.$('world-panel-menu').contains(p.$('signout'))).toBe(true);
    expect(p.$('signout').closest('dialog:not([open])')).not.toBeNull();
    p.openMenu();
    expect(p.$('signout').closest('[hidden]')).toBeNull();
    p.destination('pet');
    expect(p.$('world-dialog').dataset.place).toBe('pet');
    expect(p.$('pet-name').closest('[hidden]')).toBeNull();
    expect(p.$('home-feed').closest('[hidden]')).not.toBeNull();
    expect(p.$('home-clean').closest('[hidden]')).not.toBeNull();
    expect(p.$('world-play').closest('[hidden]')).not.toBeNull();
    expect(p.$('town-care-hint').closest('[hidden]')).toBeNull();
    p.$('world-dialog-close').click();
    expect(p.$('pet-name').closest('dialog:not([open])')).not.toBeNull();
    p.$('town-home').click();
    p.homeAction('pet');
    for (const [id, original] of p.controls) {
      expect(p.$(id)).toBe(original);
      expect(p.window.document.querySelectorAll(`#${id}`)).toHaveLength(1);
    }
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
    p.homeAction('feed');
    p.homeAction('clean');
    expect(feed).toHaveBeenCalledOnce();
    expect(clean).toHaveBeenCalledOnce();
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
    p.homeAction('pet');
    p.$('home-feed').click();
    p.$('home-clean').click();
    expect(feed).toHaveBeenCalledTimes(2);
    expect(clean).toHaveBeenCalledTimes(2);
    food.disabled = true;
    p.$('items').querySelector('[data-item="food"] .item-count')!.textContent = '0';
    await vi.waitFor(() => expect((p.$('home-feed') as HTMLButtonElement).disabled).toBe(true));
    expect(p.$('home-feed').textContent).toContain('0');
    p.$('home-feed').click();
    expect(feed).toHaveBeenCalledTimes(2);
  } finally { p.dom.window.close(); }
});

it('shows the last pet interaction while preserving each action and resets it with the account', async () => {
  const p = page();
  try {
    p.homeAction('pet');
    expect(p.$('home-interaction-label').textContent).toBe('Choose an interaction');
    const selected = () => [...p.$('world-dialog').querySelectorAll('[data-selected]')];
    expect(selected()).toHaveLength(0);
    for (const { button, react } of p.play) {
      button.click();
      expect(react).toHaveBeenCalledOnce();
      expect(selected()).toEqual([button]);
      expect(p.$('home-interaction-label').textContent).toBe(`Last interaction: ${button.textContent}`);
    }
    p.$('items').innerHTML = '<div data-item="food"><span class="item-count">2</span><button class="chip-use">Feed</button></div>' +
      '<div data-item="soap"><span class="item-count">3</span><button class="chip-use">Clean</button></div>';
    for (const [id, kind, label] of [['home-feed', 'food', 'Feed'], ['home-clean', 'soap', 'Clean']]) {
      const source = p.$('items').querySelector<HTMLButtonElement>(`[data-item="${kind}"] button`)!;
      const perform = vi.fn();
      source.addEventListener('click', perform);
      const button = p.$(id) as HTMLButtonElement;
      await vi.waitFor(() => expect(button.disabled).toBe(false));
      button.click();
      expect(perform).toHaveBeenCalledOnce();
      expect(selected()).toEqual([button]);
      expect(p.$('home-interaction-label').textContent).toBe(`Last interaction: ${label}`);
    }
    p.window.document.dispatchEvent(new p.window.CustomEvent('adventure:reset'));
    p.homeAction('pet');
    expect(selected()).toHaveLength(0);
    expect(p.$('home-interaction-label').textContent).toBe('Choose an interaction');
  } finally { p.dom.window.close(); }
});

it('keeps pet care feedback inside the popup and waits for saved care before reporting success', async () => {
  const p = page();
  try {
    p.$('pet-reaction').textContent = 'Your pet leans into your hand.';
    await vi.waitFor(() => expect(p.$('home-feedback').hidden).toBe(false));
    p.homeAction('pet');
    expect(p.$('home-feedback').hidden).toBe(true);
    p.$('items').innerHTML = '<div data-item="food"><span class="item-count">2</span><button class="chip-use">Feed</button></div>';
    await vi.waitFor(() => expect((p.$('home-feed') as HTMLButtonElement).disabled).toBe(false));
    p.$('home-feed').click();
    expect(p.$('pet-reaction').textContent).not.toContain('tasty snack');
    expect(p.$('items').querySelector('.item-count')!.textContent).toBe('2');
    p.$('items').querySelector('.item-count')!.textContent = '1';
    await vi.waitFor(() => expect(p.$('pet-reaction').textContent).toBe('Your pet enjoyed a tasty snack.'));
    expect(p.$('home-feedback').hidden).toBe(true);
    expect(p.$('pet-reaction').closest('[hidden]')).toBeNull();
    p.$('care-error').textContent = 'Your pet is busy. Please wait.';
    await vi.waitFor(() => expect(p.$('pet-reaction').textContent).toBe('Your pet is busy. Please wait.'));
    expect(p.$('home-feedback').hidden).toBe(true);
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('world-dialog').dataset.place).toBe('pet');
  } finally { p.dom.window.close(); }
});

it('moves in the world but leaves keyboard input alone in dialogs and text fields', () => {
  const p = page();
  try {
    p.$('world-stage').focus();
    const start = p.position();
    p.walk();
    expect(p.position()).not.toEqual(start);
    for (const action of ['feed', 'clean', 'couch', 'fire']) {
      const hotspot = p.window.document.querySelector<HTMLButtonElement>(`[data-home-action="${action}"]`)!;
      hotspot.focus();
      p.homeAction(action);
      expect(p.window.document.activeElement, `walking focus after ${action}`).toBe(p.$('world-stage'));
      const beforeWalk = p.position();
      p.walk('d', p.window.document.activeElement as HTMLElement);
      expect(p.position(), `walking resumes after ${action}`).not.toEqual(beforeWalk);
    }
    p.homeAction('pet');
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
    p.$('world-stage').focus();
    input.remove();
    p.walk('ArrowLeft');
    expect(p.position()).not.toEqual(typing);
  } finally { p.dom.window.close(); }
});

it('resumes walking from focused scene objects while preserving their native activation keys', () => {
  const p = page();
  try {
    const stage = p.$('world-stage');
    p.$('home-door').click();
    // Adventure returns focus to its entrance when its dialog closes.
    for (const id of ['adventure-open', 'chest', 'pet-touch']) {
      if (id === 'chest') p.$('town-home').click();
      const object = id === 'chest' ? p.window.document.querySelector<HTMLButtonElement>('[data-home-action="chest"]')! : p.$(id);
      object.focus();
      const start = p.position();
      for (const key of [' ', 'Enter']) {
        const event = new p.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        object.dispatchEvent(event);
        expect(event.defaultPrevented, `${id} keeps native ${key} activation`).toBe(false);
        p.advance();
        expect(p.position()).toEqual(start);
        expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
      }
      p.walk('d', object);
      expect(p.window.document.activeElement, `${id} restores walking focus`).toBe(stage);
      expect(p.position().x - start.x).toBeCloseTo(190 * .096, 6);
    }
    const input = p.window.document.createElement('input');
    stage.append(input);
    input.focus();
    const start = p.position();
    for (const key of ['d', 'ArrowLeft', ' ', 'Enter']) {
      const event = new p.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      p.advance();
      input.dispatchEvent(new p.window.KeyboardEvent('keyup', { key, bubbles: true }));
      expect(event.defaultPrevented, `${key} remains available to the field`).toBe(false);
      expect(p.position()).toEqual(start);
      expect(p.window.document.activeElement).toBe(input);
    }
  } finally { p.dom.window.close(); }
});

it('keeps walking when a delayed Team up close event arrives after movement resumes', async () => {
  const p = page();
  try {
    p.window.eval(readFileSync('public/adventure.js', 'utf8'));
    p.$('home-door').click();
    const stage = p.$('world-stage'), entrance = p.$('adventure-open');
    const team = p.$('team-dialog') as HTMLDialogElement;
    entrance.focus();
    team.showModal();
    p.$('team-close').focus();
    await Promise.resolve();
    // Native dialog closure restores focus before its queued close event.
    team.open = false;
    entrance.focus();
    const start = p.position();
    entrance.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(p.window.document.activeElement).toBe(stage);
    team.dispatchEvent(new p.window.Event('close'));
    expect(p.window.document.activeElement).toBe(stage);
    p.advance(3);
    expect(p.position().x).toBeCloseTo(start.x - 190 * .048, 6);
    expect(p.position().y).toBeCloseTo(start.y, 6);
    expect(p.$('world-avatar').dataset.walking).toBe('true');
  } finally { p.dom.window.close(); }
});

it('restores focus stranded by Team up closure without taking focus from an open Adventure', () => {
  const p = page();
  try {
    p.window.eval(readFileSync('public/adventure.js', 'utf8'));
    p.$('home-door').click();
    const team = p.$('team-dialog') as HTMLDialogElement;
    const close = p.$('team-close'), entrance = p.$('adventure-open');
    for (const stranded of ['closed dialog', 'document body']) {
      team.showModal();
      close.focus();
      team.open = false;
      if (stranded === 'document body') close.blur();
      expect(p.window.document.activeElement).toBe(stranded === 'closed dialog' ? close : p.window.document.body);
      team.dispatchEvent(new p.window.Event('close'));
      expect(p.window.document.activeElement, stranded).toBe(entrance);
    }
    const adventure = p.$('adventure-dialog') as HTMLDialogElement;
    adventure.showModal();
    p.$('adventure-grid').focus();
    team.dispatchEvent(new p.window.Event('close'));
    expect(p.window.document.activeElement).toBe(p.$('adventure-grid'));
  } finally { p.dom.window.close(); }
});

it('uses the same movement and Space interaction controls at home and in town', () => {
  const p = page();
  try {
    p.$('world-stage').focus();
    p.walk('w');
    p.$('world-stage').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('world-dialog').dataset.place).toBe('pet');
    p.$('world-dialog-close').click();
    expect(p.window.document.activeElement).toBe(p.$('world-stage'));
    for (let step = 0; step < 5 && !p.$('world-interact').textContent?.includes('Leave'); step++) p.walk('s');
    expect(p.$('world-stage').dataset.scene).toBe('home');
    expect((p.$('world-interact') as HTMLButtonElement).disabled).toBe(false);
    p.$('world-stage').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(p.$('world-stage').dataset.scene).toBe('town');
    const start = p.position();
    p.walk('a');
    expect(p.position()).not.toEqual(start);
    p.$('world-stage').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(p.$('world-stage').dataset.scene).toBe('home');
  } finally { p.dom.window.close(); }
});

it('highlights the reachable home object that Space will open and clears it outside interaction range', async () => {
  const p = page();
  try {
    const highlighted = () => [...p.window.document.querySelectorAll('.is-interactable')];
    const pet = p.window.document.querySelector('[data-home-action="pet"]')!;
    const chest = p.window.document.querySelector('[data-home-action="chest"]')!;
    const stage = p.$('world-stage');
    const outline = p.$('home-interaction-outline');
    expect(highlighted()).toEqual([]);
    expect(outline.hasAttribute('hidden')).toBe(true);
    stage.focus();
    p.walk('w');
    expect(highlighted()).toEqual([pet]);
    expect(outline.hasAttribute('hidden')).toBe(true);
    expect(p.$('world-interact').textContent).toContain('Spend time with your pet');
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(p.$('world-dialog').dataset.place).toBe('pet');
    await vi.waitFor(() => expect(highlighted()).toEqual([]));
    p.$('world-dialog-close').click();
    await vi.waitFor(() => expect(highlighted()).toEqual([pet]));
    p.walk('s');
    expect(highlighted()).toEqual([]);
    expect((p.$('world-interact') as HTMLButtonElement).disabled).toBe(true);

    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 400, clientY: 540, bubbles: true }));
    p.advance(100);
    expect(highlighted()).toEqual([chest]);
    expect(outline.hasAttribute('hidden')).toBe(false);
    expect([...outline.querySelectorAll('use')].map(stroke => stroke.getAttribute('href')))
      .toEqual(['/scenes/home-highlights.svg#chest', '/scenes/home-highlights.svg#chest']);
    expect(p.$('world-interact').textContent).toContain('Open your backpack');
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(p.$('world-dialog').dataset.place).toBe('backpack');
    await vi.waitFor(() => expect(highlighted()).toEqual([]));
    expect(outline.hasAttribute('hidden')).toBe(true);
    p.$('world-dialog-close').click();
    await vi.waitFor(() => expect(outline.hasAttribute('hidden')).toBe(false));
    p.$('home-door').click();
    expect(outline.hasAttribute('hidden')).toBe(true);
  } finally { p.dom.window.close(); }
});

it('highlights only the active scene and follows a nearby Adventure entrance being enabled or disabled', async () => {
  const p = page();
  try {
    const highlighted = () => [...p.window.document.querySelectorAll('.is-interactable')];
    const townOutline = p.$('town-interaction-outline');
    const outlineTarget = () => [...townOutline.querySelectorAll('use')].map(stroke => stroke.getAttribute('href'));
    expect(townOutline.hasAttribute('hidden')).toBe(true);
    p.walk('w');
    expect(highlighted()).toEqual([p.window.document.querySelector('[data-home-action="pet"]')]);
    p.$('home-door').click();
    expect(highlighted()).toEqual([p.$('town-home')]);
    expect(highlighted()[0].closest('[hidden]')).toBeNull();
    expect(townOutline.hasAttribute('hidden')).toBe(false);
    expect(outlineTarget()).toEqual(['/scenes/town-highlights.svg#home', '/scenes/town-highlights.svg#home']);
    p.$('town-home').click();
    expect(highlighted()).toEqual([]);
    expect(townOutline.hasAttribute('hidden')).toBe(true);
    p.$('home-door').click();
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 760, clientY: 200, bubbles: true }));
    p.advance(500);
    const entrance = p.$('adventure-open') as HTMLButtonElement;
    expect(highlighted()).toEqual([entrance]);
    expect(townOutline.hasAttribute('hidden')).toBe(false);
    expect(outlineTarget()).toEqual(['/scenes/town-highlights.svg#adventure', '/scenes/town-highlights.svg#adventure']);
    p.openMenu();
    await vi.waitFor(() => expect(highlighted()).toEqual([]));
    expect(townOutline.hasAttribute('hidden')).toBe(true);
    const paused = p.position();
    p.walk('s');
    expect(p.position()).toEqual(paused);
    p.$('world-dialog-close').click();
    await vi.waitFor(() => expect(highlighted()).toEqual([entrance]));
    expect(townOutline.hasAttribute('hidden')).toBe(false);
    expect(p.window.document.activeElement).toBe(stage);
    const enter = vi.fn();
    entrance.addEventListener('click', enter);
    entrance.disabled = true;
    await vi.waitFor(() => expect(highlighted()).toEqual([]));
    expect(townOutline.hasAttribute('hidden')).toBe(true);
    expect((p.$('world-interact') as HTMLButtonElement).disabled).toBe(true);
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(enter).not.toHaveBeenCalled();
    entrance.disabled = false;
    await vi.waitFor(() => expect(highlighted()).toEqual([entrance]));
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect(enter).toHaveBeenCalledOnce();
  } finally { p.dom.window.close(); }
});

it('suspends the nearby highlight for other dialogs and resets it when the player signs out', async () => {
  const p = page();
  try {
    const highlighted = () => [...p.window.document.querySelectorAll('.is-interactable')];
    const pet = p.window.document.querySelector('[data-home-action="pet"]')!;
    p.walk('w');
    expect(highlighted()).toEqual([pet]);
    const confirmation = p.window.document.createElement('dialog');
    p.window.document.body.append(confirmation);
    confirmation.showModal();
    await vi.waitFor(() => expect(highlighted()).toEqual([]));
    confirmation.close();
    await vi.waitFor(() => expect(highlighted()).toEqual([pet]));
    p.$('dashboard').hidden = true;
    await vi.waitFor(() => expect(highlighted()).toEqual([]));
    p.$('dashboard').hidden = false;
    await vi.waitFor(() => expect(p.window.document.body.classList.contains('world-playing')).toBe(true));
    expect(highlighted()).toEqual([]);
    p.walk('w');
    expect(highlighted()).toEqual([pet]);
  } finally { p.dom.window.close(); }
});

it.each([30, 60, 120])('walks at a consistent speed from the first frame at %i Hz', (refreshRate) => {
  const p = page();
  try {
    for (const scene of ['home', 'town']) {
      if (scene === 'town') p.$('home-door').click();
      const stage = p.$('world-stage');
      stage.focus();
      const start = p.position();
      stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
      p.advance(1, 1000 / refreshRate);
      expect(p.position().x - start.x).toBeCloseTo(190 / refreshRate, 6);
      p.advance(refreshRate - 1, 1000 / refreshRate);
      expect(p.position().x - start.x).toBeCloseTo(190, 6);
      expect(p.position().y).toBeCloseTo(start.y, 6);
      stage.dispatchEvent(new p.window.KeyboardEvent('keyup', { key: 'd', bubbles: true }));
      p.advance(1, 1000 / refreshRate);
      expect(p.position().x - start.x).toBeCloseTo(190, 6);
    }
  } finally { p.dom.window.close(); }
});

it.each([
  ['w', 'up', 0, -1],
  ['s', 'down', 0, 1],
  ['a', 'left', -1, 0],
  ['d', 'right', 1, 0],
] as const)('faces the direction of %s movement and returns to idle after releasing the key', (key, facing, dx, dy) => {
  const p = page();
  try {
    p.$('home-door').click();
    const stage = p.$('world-stage'), avatar = p.$('world-avatar');
    const start = p.position();
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true }));
    p.advance(3);
    expect(p.position().x - start.x).toBeCloseTo(dx * 190 * .048, 6);
    expect(p.position().y - start.y).toBeCloseTo(dy * 190 * .048, 6);
    expect(avatar.dataset.facing).toBe(facing);
    expect(avatar.dataset.walking).toBe('true');
    stage.dispatchEvent(new p.window.KeyboardEvent('keyup', { key, bubbles: true }));
    const stopped = p.position();
    p.advance(30);
    expect(p.position()).toEqual(stopped);
    expect(avatar.dataset.walking).toBe('false');
    expect(avatar.dataset.facing).toBe(facing);
  } finally { p.dom.window.close(); }
});

it.each([
  ['30 Hz', [1000 / 30], 30],
  ['60 Hz', [1000 / 60], 60],
  ['120 Hz', [1000 / 120], 120],
  ['uneven frames', [16.2, 17.1, 16.6, 16.8], 60],
] as const)('keeps diagonal walking animation steady across coordinate boundaries at %s', (_, durations, frames) => {
  const p = page();
  try {
    p.$('home-door').click();
    const stage = p.$('world-stage'), avatar = p.$('world-avatar');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 600, clientY: 580, bubbles: true }));
    p.advance(100);
    expect(p.position().x).toBeCloseTo(600, 6);
    expect(p.position().y).toBeCloseTo(580, 6);
    for (const key of ['w', 'd']) stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true }));
    let elapsed = 0;
    for (let frame = 0; frame < frames; frame++) {
      const milliseconds = durations[frame % durations.length];
      elapsed += milliseconds;
      p.advance(1, milliseconds);
      expect(avatar.dataset.facing, `frame ${frame} must not switch poses on a straight diagonal`).toBe('up');
      expect(avatar.dataset.walking).toBe('true');
    }
    const travel = 190 * elapsed / 1000 / Math.SQRT2;
    expect(p.position().x).toBeCloseTo(600 + travel, 6);
    expect(p.position().y).toBeCloseTo(580 - travel, 6);
    expect(p.position().y).toBeLessThan(512);
  } finally { p.dom.window.close(); }
});

it('faces the unblocked direction when diagonal walking slides along a wall', () => {
  const p = page();
  try {
    p.$('home-door').click();
    const stage = p.$('world-stage'), avatar = p.$('world-avatar');
    for (const key of ['w', 'd']) stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true }));
    p.advance(3);
    expect(avatar.dataset.facing).toBe('up');
    p.advance(17);
    const beside = p.position();
    expect(beside.x).toBeGreaterThan(520);
    expect(beside.y).toBeGreaterThanOrEqual(566);
    expect(beside.y).toBeLessThan(570);
    expect(avatar.dataset.facing).toBe('right');
    expect(avatar.dataset.walking).toBe('true');
    p.advance(35);
    expect(p.position().x).toBeGreaterThan(572);
    expect(p.position().y).toBeLessThan(beside.y);
    expect(avatar.dataset.facing).toBe('up');
    expect(avatar.dataset.walking).toBe('true');
  } finally { p.dom.window.close(); }
});

it.each(['game menu', 'another dialog', 'window blur', 'hidden page'])(
  'pauses character and scenery animation for %s and cancels movement until new input',
  async (reason) => {
    const p = page();
    try {
      p.$('home-door').click();
      const stage = p.$('world-stage'), avatar = p.$('world-avatar');
      const environment = p.$('world-shell');
      const dialog = p.window.document.createElement('dialog');
      p.window.document.body.append(dialog);
      let hidden = false;
      Object.defineProperty(p.window.document, 'hidden', { configurable: true, get: () => hidden });
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
      const pause = () => {
        if (reason === 'game menu') p.openMenu();
        if (reason === 'another dialog') dialog.showModal();
        if (reason === 'window blur') p.window.dispatchEvent(new p.window.Event('blur'));
        if (reason === 'hidden page') {
          hidden = true;
          p.window.document.dispatchEvent(new p.window.Event('visibilitychange'));
        }
      };
      const resume = () => {
        if (reason === 'game menu') p.$('world-dialog-close').click();
        if (reason === 'another dialog') dialog.close();
        if (reason === 'window blur') p.window.dispatchEvent(new p.window.Event('focus'));
        if (reason === 'hidden page') {
          hidden = false;
          p.window.document.dispatchEvent(new p.window.Event('visibilitychange'));
        }
      };
      for (const input of ['held key', 'clicked route']) {
        stage.focus();
        if (input === 'held key') {
          stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
        } else {
          stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 700, clientY: 580, bubbles: true }));
        }
        const start = p.position();
        p.advance(6);
        expect(p.position(), input).not.toEqual(start);
        expect(avatar.dataset.walking, input).toBe('true');
        pause();
        await vi.waitFor(() => expect(avatar.dataset.paused, input).toBe('true'));
        expect(environment.dataset.paused, `${input} also pauses the scenery`).toBe('true');
        const stopped = p.position();
        p.advance(30);
        expect(p.position(), `${input} stays still while paused`).toEqual(stopped);
        expect(avatar.dataset.walking, input).toBe('false');
        resume();
        await vi.waitFor(() => expect(avatar.dataset.paused, input).toBe('false'));
        expect(environment.dataset.paused, `${input} restores the scenery`).toBe('false');
        p.advance(30);
        expect(p.position(), `${input} must not resume automatically`).toEqual(stopped);
        expect(avatar.dataset.walking, input).toBe('false');
      }
      const stopped = p.position();
      p.walk('a');
      expect(p.position().x).toBeLessThan(stopped.x);
      expect(avatar.dataset.facing).toBe('left');
      expect(avatar.dataset.walking).toBe('false');
    } finally { p.dom.window.close(); }
  },
);

it('fills desktop and phone viewports in both scenes while preserving the character position on resize', () => {
  const p = page();
  try {
    const stage = p.$('world-stage');
    for (const scene of ['home', 'town']) {
      if (scene === 'town') p.$('home-door').click();
      const start = p.position();
      p.walk('d');
      const before = p.position();
      expect(before.x).toBeCloseTo(start.x + 190 * .096, 6);
      for (const [width, height] of [[1600, 900], [375, 812], [812, 375]]) {
        Object.defineProperty(p.window, 'innerWidth', { configurable: true, value: width });
        Object.defineProperty(p.window, 'innerHeight', { configurable: true, value: height });
        p.window.dispatchEvent(new p.window.Event('resize'));
        expect(p.position().x).toBeCloseTo(before.x, 6);
        expect(p.position().y).toBeCloseTo(before.y, 6);
        const sceneWidth = parseFloat(stage.style.getPropertyValue('--scene-width'));
        const sceneHeight = parseFloat(stage.style.getPropertyValue('--scene-height'));
        const scale = Math.max(width / 960, height / 640);
        expect(sceneWidth).toBeCloseTo(960 * scale, 6);
        expect(sceneHeight).toBeCloseTo(640 * scale, 6);
        const camera = stage.style.transform.match(/translate3d\(([-\d.e+]+)px,\s*([-\d.e+]+)px,/i);
        expect(camera, `${scene} camera at ${width}×${height}`).not.toBeNull();
        const x = Number(camera![1]), y = Number(camera![2]);
        expect(x).toBeLessThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(0);
        expect(x + sceneWidth).toBeGreaterThanOrEqual(width - .000001);
        expect(y + sceneHeight).toBeGreaterThanOrEqual(height - .000001);
      }
      p.walk('a');
      expect(p.position().x).toBeCloseTo(start.x, 6);
      expect(p.position().y).toBeCloseTo(start.y, 6);
    }
  } finally { p.dom.window.close(); }
});

it('walks continuously across clicked route waypoints and stops at the destination', () => {
  const p = page();
  try {
    p.$('home-door').click();
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 700, clientY: 580, bubbles: true }));
    for (let frame = 0; frame < 50; frame++) {
      const previous = p.position();
      p.advance(1);
      const current = p.position();
      expect(Math.hypot(current.x - previous.x, current.y - previous.y), `route frame ${frame}`).toBeGreaterThan(0);
      if (frame > 1) expect(current.x - previous.x).toBeCloseTo(190 * .016, 6);
    }
    // Five pixels reach the path; the remaining travel continues east.
    expect(p.position().x).toBeCloseTo(480 + 190 * .8 - 5, 6);
    expect(p.position().y).toBeCloseTo(580, 6);
    p.advance(40);
    expect(p.position().x).toBeCloseTo(700, 6);
    expect(p.position().y).toBeCloseTo(580, 6);
    expect(p.$('world-avatar').dataset.walking).toBe('false');
    const arrived = p.position();
    p.advance();
    expect(p.position()).toEqual(arrived);
  } finally { p.dom.window.close(); }
});

it('stops at a building while allowing the character to walk around its edge', () => {
  const p = page();
  try {
    p.$('home-door').click();
    const stage = p.$('world-stage');
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    p.advance(30);
    const stopped = p.position();
    expect(stopped.x).toBeCloseTo(480, 6);
    expect(stopped.y).toBeGreaterThanOrEqual(566);
    expect(stopped.y).toBeLessThan(570);
    p.advance(30);
    expect(p.position()).toEqual(stopped);
    expect(p.$('world-avatar').dataset.walking).toBe('false');
    expect(p.$('world-avatar').dataset.facing).toBe('up');
    stage.dispatchEvent(new p.window.KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    p.advance(35);
    expect(p.$('world-avatar').dataset.walking).toBe('true');
    expect(p.$('world-avatar').dataset.facing).toBe('right');
    stage.dispatchEvent(new p.window.KeyboardEvent('keyup', { key: 'd', bubbles: true }));
    const beside = p.position();
    expect(beside.x).toBeGreaterThan(580);
    expect(beside.y).toBeCloseTo(stopped.y, 6);
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    p.advance();
    stage.dispatchEvent(new p.window.KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    expect(p.position().y).toBeLessThan(beside.y - 15);
  } finally { p.dom.window.close(); }
});

it.each([
  ['back rail', 240, 'w'],
  ['left front rail', 180, 's'],
  ['right front rail', 300, 's'],
] as const)('stops held movement at the farm %s', (_, x, key) => {
  const p = page();
  try {
    p.$('home-door').click();
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: x, clientY: 540, bubbles: true }));
    p.advance(300);
    expect(p.position().x).toBeCloseTo(x, 6);
    expect(p.position().y).toBeCloseTo(540, 6);
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true }));
    p.advance(30);
    const stopped = p.position();
    if (key === 'w') {
      expect(stopped.y).toBeGreaterThanOrEqual(520);
      expect(stopped.y).toBeLessThan(524);
    } else {
      expect(stopped.y).toBeLessThanOrEqual(577);
      expect(stopped.y).toBeGreaterThan(573);
    }
    p.advance(30);
    expect(p.position()).toEqual(stopped);
    expect(p.$('world-avatar').dataset.walking).toBe('false');
  } finally { p.dom.window.close(); }
});

it('routes through the farm gate and around its rails while keeping the shops reachable', () => {
  const p = page();
  try {
    p.$('home-door').click();
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    const click = (x: number, y: number) => stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
    click(240, 600);
    p.advance(300);
    expect(p.position().x).toBeCloseTo(240, 6);
    expect(p.position().y).toBeCloseTo(600, 6);
    click(240, 500);
    p.advance(30);
    expect(p.$('world-message').textContent).toMatch(/occupied/i);
    expect(p.position().x).toBeCloseTo(240, 6);
    expect(p.position().y).toBeCloseTo(600, 6);
    click(240, 460);
    let usedGate = false, roundedBackRail = false;
    for (let frame = 0; frame < 300; frame++) {
      const previous = p.position();
      p.advance(1);
      const current = p.position();
      if (previous.y >= 577 && current.y < 577) {
        expect(current.x).toBeGreaterThanOrEqual(220);
        expect(current.x).toBeLessThanOrEqual(261);
        usedGate = true;
      }
      if (previous.y >= 520 && current.y < 520) {
        expect(current.x <= 141 || current.x >= 337).toBe(true);
        roundedBackRail = true;
      }
    }
    expect(usedGate).toBe(true);
    expect(roundedBackRail).toBe(true);
    expect(p.position().x).toBeCloseTo(240, 6);
    expect(p.position().y).toBeCloseTo(460, 6);
    click(200, 380);
    p.advance(100);
    expect(p.position().x).toBeCloseTo(200, 6);
    expect(p.position().y).toBeCloseTo(380, 6);
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('world-dialog').dataset.place).toBe('shop');
  } finally { p.dom.window.close(); }
});

it('stops the character before the home pet and keeps Space interaction available', () => {
  const p = page();
  try {
    const stage = p.$('world-stage');
    stage.focus();
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    p.advance(60);
    const stopped = p.position();
    expect(stopped.x).toBeCloseTo(480, 6);
    expect(stopped.y).toBeGreaterThanOrEqual(438);
    expect(stopped.y).toBeLessThan(442);
    p.advance(60);
    expect(p.position()).toEqual(stopped);
    stage.dispatchEvent(new p.window.KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    p.advance();
    stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(true);
    expect(p.$('world-dialog').dataset.place).toBe('pet');
  } finally { p.dom.window.close(); }
});

it.each([16, 40])('lets the character walk around the pet and interact from its other sides with %i ms frames', (milliseconds) => {
  const p = page();
  try {
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    for (const approach of [
      { x: 480, y: 260, key: 's', side: 'above' },
      { x: 400, y: 360, key: 'd', side: 'left' },
      { x: 560, y: 360, key: 'a', side: 'right' },
    ]) {
      stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: approach.x, clientY: approach.y, bubbles: true }));
      p.advance(250, milliseconds);
      expect(p.position().x, `${approach.side} approach`).toBeCloseTo(approach.x, 6);
      expect(p.position().y, `${approach.side} approach`).toBeCloseTo(approach.y, 6);
      stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: approach.key, bubbles: true }));
      p.advance(30, milliseconds);
      const stopped = p.position();
      if (approach.side === 'above') expect(stopped.y).toBeLessThanOrEqual(295);
      if (approach.side === 'left') expect(stopped.x).toBeLessThanOrEqual(419);
      if (approach.side === 'right') expect(stopped.x).toBeGreaterThanOrEqual(541);
      p.advance(30, milliseconds);
      expect(p.position(), `${approach.side} collision`).toEqual(stopped);
      stage.dispatchEvent(new p.window.KeyboardEvent('keyup', { key: approach.key, bubbles: true }));
      p.advance(6, milliseconds);
      stage.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      expect((p.$('world-dialog') as HTMLDialogElement).open, `${approach.side} interaction`).toBe(true);
      expect(p.$('world-dialog').dataset.place).toBe('pet');
      p.$('world-dialog-close').click();
    }
  } finally { p.dom.window.close(); }
});

it('routes floor clicks around the pet without entering its occupied space', () => {
  const p = page();
  try {
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 480, clientY: 260, bubbles: true }));
    let wentAround = false;
    for (let frame = 0; frame < 200; frame++) {
      p.advance(1);
      const { x, y } = p.position();
      expect(x > 419 && x < 541 && y > 295 && y < 438, `pet overlap at frame ${frame}`).toBe(false);
      if (Math.abs(x - 480) > 61) wentAround = true;
    }
    expect(wentAround).toBe(true);
    expect(p.position().x).toBeCloseTo(480, 6);
    expect(p.position().y).toBeCloseTo(260, 6);
    expect(p.$('world-avatar').dataset.walking).toBe('false');
  } finally { p.dom.window.close(); }
});

it('announces pet reactions and failed care at home while the pet panel is closed', async () => {
  const p = page();
  try {
    p.$('pet-reaction').textContent = 'Your pet leans into your hand.';
    await vi.waitFor(() => expect(p.$('home-feedback').textContent).toBe('Your pet leans into your hand.'));
    expect(p.$('home-feedback').hidden).toBe(false);
    p.$('items').innerHTML = '<div data-item="food"><span class="item-count">1</span><button class="chip-use">Feed</button></div>';
    p.$('items').querySelector('button')!.addEventListener('click', () => {
      p.$('care-error').textContent = 'Your pet is busy. Please wait.';
    });
    p.homeAction('feed');
    await vi.waitFor(() => expect(p.$('home-feedback').textContent).toBe('Your pet is busy. Please wait.'));
    expect(p.$('home-feedback').closest('[hidden]')).toBeNull();
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
    expect(p.$('world-stage').dataset.scene).toBe('home');
  } finally { p.dom.window.close(); }
});

it('can walk to a clear spot after stopping beside a building with the keyboard', () => {
  const p = page();
  try {
    p.$('home-door').click();
    p.walk('ArrowUp');
    const stage = p.$('world-stage');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new p.window.DOMRect(0, 0, 960, 640));
    const stopped = p.position();
    stage.dispatchEvent(new p.window.MouseEvent('click', { clientX: 600, clientY: 580, bubbles: true }));
    for (let frame = 0; frame < 4; frame++) p.advance();
    expect(p.position().x).toBeGreaterThan(stopped.x);
    for (let frame = 0; frame < 20; frame++) p.advance();
    expect(Math.hypot(p.position().x - 600, p.position().y - 580)).toBeLessThan(7);
    expect(p.$('world-stage').dataset.scene).toBe('town');
  } finally { p.dom.window.close(); }
});

it('shows an Hourglass action error while the player is in town', async () => {
  const p = page();
  try {
    p.$('home-door').click();
    p.$('busy').hidden = false;
    p.destination('pet');
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
    p.homeAction('tv');
    expect(p.$('world-dialog').contains(p.$('theft-notifications'))).toBe(true);
    expect(p.$('theft-notifications').closest('[hidden]')).toBeNull();
    p.window.document.dispatchEvent(new p.window.CustomEvent('adventure:reset'));
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
    expect(p.$('world-stage').dataset.scene).toBe('home');
    p.$('home-door').click();
    p.destination('arena');
    p.$('dashboard').hidden = true;
    await vi.waitFor(() => expect(p.window.document.body.classList.contains('world-playing')).toBe(false));
    expect(p.window.document.body.classList.contains('world-home')).toBe(false);
    expect((p.$('world-dialog') as HTMLDialogElement).open).toBe(false);
    expect(p.$('world-stage').dataset.scene).toBe('home');
    p.$('dashboard').hidden = false;
    await vi.waitFor(() => expect(p.window.document.body.classList.contains('world-playing')).toBe(true));
    expect(p.window.document.body.classList.contains('world-home')).toBe(true);
    expect(p.window.document.activeElement).toBe(p.$('world-stage'));
    expect(p.$('world-stage').dataset.scene).toBe('home');
  } finally { p.dom.window.close(); }
});
