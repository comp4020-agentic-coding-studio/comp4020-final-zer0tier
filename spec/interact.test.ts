import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

// Touching the pet is only for fun: it plays a reaction in this window and
// never asks the server for anything.
function page() {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  const $ = (id: string) => window.document.getElementById(id)!;
  const requests = vi.fn();
  window.fetch = requests as unknown as typeof fetch;
  window.eval(readFileSync('public/interact.js', 'utf8'));
  const signIn = (pet: object) => window.document.dispatchEvent(new window.CustomEvent('adventure:pet', { detail: pet }));
  // Clicks the 120 × 110 drawing at (x, y), drawn 240 × 220 pixels at (100, 50).
  const touchAt = (x: number, y: number) => {
    $('pet-avatar').getBoundingClientRect = () => ({ left: 100, top: 50, width: 240, height: 220 }) as DOMRect;
    $('pet-avatar').dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 100 + x * 2, clientY: 50 + y * 2 }));
  };
  return { dom, window, $, requests, signIn, touchAt };
}
// Words that only that touch's lines use.
const SAYS = { pat: /head|pats|leans into your hand/, tickle: /giggles|laughing|wriggles/, stroke: /nuzzles|purrs|blinks/, paw: /paw|high-fives|holds your hand/ };

it('reacts to a pat, tickle, stroke, or paw shake where the pet is touched, without a server request', () => {
  const { dom, $, requests, signIn, touchAt } = page();
  try {
    touchAt(60, 25); // before sign-in there is no pet to react
    expect($('pet-reaction').textContent).toBe('');
    expect($('pet-touch').dataset.reaction).toBe('');
    signIn({ id: 'rex', activity: 'idle' });
    const cases: [number, number, keyof typeof SAYS][] = [
      [60, 25, 'pat'], // top of the head
      [60, 52, 'pat'], // between the eyes
      [60, 78, 'tickle'], // belly
      [22, 58, 'stroke'], // left cheek
      [98, 58, 'stroke'], // right cheek
      [45, 96, 'paw'], // feet
      [20, 82, 'paw'], // a lower corner
    ];
    for (const [x, y, kind] of cases) {
      touchAt(x, y);
      expect($('pet-touch').dataset.reaction, `(${x}, ${y})`).toBe(kind);
      expect($('pet-reaction').textContent).toMatch(/^rex /);
      expect($('pet-reaction').textContent).toMatch(SAYS[kind]);
    }
    // Each touch floats one decorative effect, hidden from screen readers.
    expect($('pet-touch').querySelectorAll('.pet-effect')).toHaveLength(cases.length);
    expect($('pet-touch').querySelector('.pet-effects')!.getAttribute('aria-hidden')).toBe('true');
    expect(requests).not.toHaveBeenCalled();
  } finally { dom.window.close(); }
});

it('offers every touch as a keyboard-reachable button, announces the reaction, and varies the lines', () => {
  const { dom, window, $, requests, signIn } = page();
  try {
    signIn({ id: 'rex', activity: 'idle' });
    expect($('pet-reaction').getAttribute('role')).toBe('status');
    const buttons = [...window.document.querySelectorAll<HTMLButtonElement>('[data-touch]')];
    expect(buttons.map(b => [b.textContent, b.type])).toEqual([
      ['Pat head', 'button'], ['Tickle belly', 'button'], ['Stroke cheek', 'button'], ['Shake paw', 'button'],
    ]);
    for (const button of buttons) {
      button.focus();
      button.click();
      expect($('pet-touch').dataset.reaction).toBe(button.dataset.touch);
      expect($('pet-reaction').textContent).toMatch(SAYS[button.dataset.touch as keyof typeof SAYS]);
      expect(window.document.activeElement).toBe(button);
    }
    const pats = new Set<string>();
    for (let i = 0; i < 12; i++) { buttons[0].click(); pats.add($('pet-reaction').textContent!); }
    expect(pats.size).toBeGreaterThan(1);
    expect(requests).not.toHaveBeenCalled();
  } finally { dom.window.close(); }
});

it('a busy pet still reacts, but goes back to its lesson or shift; signing out clears the reaction', () => {
  const { dom, $, signIn, touchAt, window } = page();
  try {
    signIn({ id: 'rex', activity: 'studying' });
    touchAt(60, 25);
    expect($('pet-reaction').textContent).toBe('rex gives a quick happy wiggle, then gets back to studying.');
    signIn({ id: 'rex', activity: 'working' });
    touchAt(60, 78);
    expect($('pet-reaction').textContent).toBe('rex smiles at you between tasks, then gets back to work.');
    expect($('pet-touch').dataset.reaction).toBe('tickle');
    // Signing out (or switching pet) forgets the last pet and its reaction.
    window.document.dispatchEvent(new window.CustomEvent('adventure:reset'));
    expect($('pet-reaction').textContent).toBe('');
    expect($('pet-touch').dataset.reaction).toBe('');
    expect($('pet-touch').querySelectorAll('.pet-effect')).toHaveLength(0);
    touchAt(60, 25);
    expect($('pet-reaction').textContent).toBe('');
    signIn({ id: 'ace', activity: 'idle' });
    window.document.querySelector<HTMLButtonElement>('[data-touch="paw"]')!.click();
    expect($('pet-reaction').textContent).toMatch(/^ace /);
  } finally { dom.window.close(); }
});
