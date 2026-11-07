// The guestbook. Visiting a pet, you can leave its owner one of a few fixed,
// friendly phrases; there's nothing to type, so nothing to moderate. Owners
// read their newest notes in the Journal and can clear them.
//
// Like touches, a note is saved first: it appears (in the visitor's window
// and the owner's Journal) only when the server's pet:noted broadcast arrives.
const $ = (id) => document.getElementById(id);
let current = null; // the signed-in pet, from app.js
let visited = null; // the pet open in the visit panel, from app.js
let rules = null; // the phrase list and limits, from /api/rules
let notes = new Map(); // the signed-in pet's guestbook, by note ID
let noteLoads = 0;
let sending = null; // the phrase a note request is waiting on
let clearing = false;
let cooling = 0; // timer that re-enables phrases after the server's gap

const phraseText = (id) => rules?.guestbook.phrases.find((phrase) => phrase.id === id)?.text ?? 'a note';
const kept = () => rules?.guestbook.kept ?? 10;

async function loadRules() {
  for (let delay = 500; !rules; delay = Math.min(delay * 2, 10000)) {
    try {
      const res = await fetch('/api/rules');
      if (res.ok) { rules = await res.json(); break; }
    } catch {
      // offline or waking up; try again
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  renderPhrases();
  renderNotes();
}
loadRules();

// --- Leaving a note while visiting ------------------------------------------

function renderPhrases() {
  const container = $('note-phrases');
  if (!rules || !visited || !current) { container.replaceChildren(); return; }
  const bot = visited.id === rules.botId;
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.phrase : null;
  container.replaceChildren(...rules.guestbook.phrases.map((phrase) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip-btn chip-buy';
    button.dataset.phrase = phrase.id;
    button.textContent = sending === phrase.id ? 'Sending…' : phrase.text;
    button.setAttribute('aria-label', `Leave ${visited.id} the note: ${phrase.text}`);
    // The pressed phrase stays focusable while it sends; the rest wait.
    button.disabled = bot || Boolean(cooling) || (sending !== null && sending !== phrase.id);
    button.setAttribute('aria-disabled', String(sending === phrase.id));
    button.addEventListener('click', () => leaveNote(phrase.id));
    return button;
  }));
  if (focused) container.querySelector(`[data-phrase="${focused}"]`)?.focus({ preventScroll: true });
  $('note-hint').textContent = bot ? "The bot doesn't keep a guestbook."
    : cooling ? 'Note sent. You can leave another in a few seconds.'
    : `Pick a note for ${visited.id}'s owner. They'll find it in their Journal.`;
}

async function leaveNote(phrase) {
  if (!current || !visited || sending || cooling) return;
  const owner = current.id, target = visited.id;
  const still = () => current?.id === owner && visited?.id === target;
  sending = phrase;
  $('note-error').textContent = '';
  $('note-news').textContent = '';
  renderPhrases();
  let sent = false;
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/note/${encodeURIComponent(target)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phrase }),
    });
    if (!still()) return;
    if (res.status === 401 || res.status === 403) { $('note-error').textContent = 'Your session has changed. Reload the page and sign in again.'; return; }
    const body = await res.json();
    if (!res.ok) { $('note-error').textContent = body.error ?? `Couldn't reach ${target}. Try again.`; return; }
    sent = true;
    // The confirmation waits for the saved note's broadcast, like a touch's reaction.
  } catch {
    if (still()) $('note-error').textContent = `Couldn't reach ${target}. Try again.`;
  } finally {
    sending = null;
    if (sent) {
      clearTimeout(cooling);
      cooling = setTimeout(() => { cooling = 0; renderPhrases(); }, rules?.guestbook.cooldownMs ?? 10000);
    }
    renderPhrases();
  }
}

// --- The owner's guestbook in the Journal -----------------------------------

function renderNotes() {
  const list = [...notes.values()].sort((a, b) => b.id - a.id).slice(0, kept());
  notes = new Map(list.map((note) => [note.id, note]));
  $('guestbook-notes').replaceChildren(...list.map((note) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    const who = document.createElement('b');
    who.textContent = note.visitor;
    const said = document.createElement('q');
    said.textContent = phraseText(note.phrase);
    text.append(who, ' wrote ', said);
    const time = document.createElement('time');
    const at = new Date(note.at);
    time.dateTime = note.at;
    time.textContent = at.toDateString() === new Date().toDateString()
      ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
    li.append(text, time);
    return li;
  }));
  $('guestbook-empty').hidden = list.length > 0;
  const clear = $('guestbook-clear');
  clear.hidden = list.length === 0;
  clear.disabled = clearing;
  clear.textContent = clearing ? 'Clearing…' : 'Clear';
}

async function loadNotes() {
  if (!current) return;
  const owner = current.id;
  const request = ++noteLoads;
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/notes`, { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.json();
    if (request !== noteLoads || current?.id !== owner) return;
    // The saved list replaces ours: a clear in another window must not be undone.
    notes = new Map(list.map((note) => [note.id, note]));
    renderNotes();
  } catch {
    // Broadcasts still add notes, and reconnecting loads them again.
  }
}

$('guestbook-clear').addEventListener('click', async () => {
  if (!current || clearing || notes.size === 0) return;
  const owner = current.id;
  const yes = await new Promise((answer) => document.dispatchEvent(new CustomEvent('confirm:ask', {
    detail: { title: 'Clear your guestbook?', message: `All ${notes.size} ${notes.size === 1 ? 'note' : 'notes'} will be gone for good.`, answer },
  })));
  if (!yes || current?.id !== owner) return;
  clearing = true;
  $('guestbook-error').textContent = '';
  renderNotes();
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/notes/clear`, { method: 'POST' });
    if (current?.id !== owner) return;
    if (!res.ok) $('guestbook-error').textContent = (await res.json().catch(() => ({}))).error ?? "Couldn't clear your guestbook. Try again.";
    // The list empties when notes:cleared arrives, in every window.
  } catch {
    if (current?.id === owner) $('guestbook-error').textContent = "Couldn't clear your guestbook. Try again.";
  } finally {
    clearing = false;
    renderNotes();
  }
});

// --- Broadcasts and app.js lifecycle -----------------------------------------

document.addEventListener('pet:noted', ({ detail: note }) => {
  if (!note) return;
  if (current && note.pet === current.id) {
    notes.set(note.id, note);
    renderNotes();
    $('notice').textContent = `${note.visitor} left you a note: “${phraseText(note.phrase)}”`;
  }
  if (current && visited && note.visitor === current.id && note.pet === visited.id) {
    $('note-news').textContent = `You left ${visited.id} a note: “${phraseText(note.phrase)}”`;
  }
});
document.addEventListener('notes:cleared', ({ detail: pet }) => {
  if (!current || pet !== current.id) return;
  noteLoads++; // a load in flight predates the clear
  notes = new Map();
  renderNotes();
});

document.addEventListener('adventure:pet', ({ detail }) => {
  const switched = current?.id !== detail.id;
  current = detail;
  if (switched) {
    notes = new Map();
    $('guestbook-error').textContent = '';
    renderNotes();
    loadNotes();
  }
  renderPhrases();
});
document.addEventListener('realtime:resync', loadNotes);
document.addEventListener('visit:pet', ({ detail }) => {
  if (visited?.id !== detail?.id) {
    $('note-news').textContent = '';
    $('note-error').textContent = '';
  }
  visited = detail;
  renderPhrases();
});
document.addEventListener('adventure:reset', () => {
  current = null;
  visited = null;
  noteLoads++;
  notes = new Map();
  sending = null;
  clearing = false;
  clearTimeout(cooling);
  cooling = 0;
  for (const id of ['note-news', 'note-error', 'guestbook-error']) $(id).textContent = '';
  renderNotes();
  renderPhrases();
});
