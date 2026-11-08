// Friends: players you starred. The list shows who is online right now (from
// presence:updated; online status is never saved), visits a friend's home in
// one press, and feeds the Team up window's Invite a friend list. Starring is
// private: only you see your list, and the starred player isn't told.
//
// Star buttons appear wherever a player is shown: in the Arena, while
// visiting, and in this list. Any button with data-star="<player>" is one;
// this file keeps every one of them pressed or not to match the saved list.
//
// Like notes, a change is saved first: the list changes only when the
// server's friends:updated broadcast (or a fresh load) says so.
const friendsEl = (id) => document.getElementById(id);
const FRIENDS_SHAPES = ['cat', 'dog', 'hedgehog', 'lizard', 'panda', 'bird', 'dragon', 'blob'];
let friendsOwner = null; // the signed-in pet's ID, from app.js
let friendsList = []; // as saved, alphabetical
let friendsOnline = new Set(); // players with an open connection right now
let friendsLoads = 0;
let friendsPending = null; // the player a star or unstar request is waiting on
let friendsAwait = null; // { id, starred, news } to confirm once the saved list shows it

const friendsHas = (id) => friendsList.some((friend) => friend.id === id);
// Online friends first, so the ones you can play with now are on top.
const friendsSorted = () => [...friendsList].sort((a, b) =>
  Number(friendsOnline.has(b.id)) - Number(friendsOnline.has(a.id)) || a.id.localeCompare(b.id));

function friendsAvatar(friend) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const shape = FRIENDS_SHAPES.includes(friend.appearance) ? friend.appearance : 'blob';
  svg.setAttribute('class', 'pet pet-small');
  svg.setAttribute('viewBox', '0 0 120 110');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--pet-color', /^#[0-9a-f]{6}$/i.test(friend.color) ? friend.color : '#f59e0b');
  svg.innerHTML = '<g class="pet-body"><use /></g>';
  svg.querySelector('use').setAttribute('href', `#pet-${shape}`);
  return svg;
}

function friendsRow(friend) {
  const online = friendsOnline.has(friend.id);
  const li = document.createElement('li');
  li.className = 'friend';
  const who = document.createElement('span');
  who.className = 'friend-who';
  const name = document.createElement('b');
  name.textContent = friend.id;
  const status = document.createElement('span');
  status.className = 'friend-status';
  status.dataset.online = String(online);
  status.textContent = online ? 'Online' : 'Offline';
  who.append(name, status);
  const visit = document.createElement('button');
  visit.type = 'button';
  visit.className = 'chip-btn chip-buy';
  visit.dataset.friendVisit = friend.id;
  visit.textContent = 'Visit';
  visit.setAttribute('aria-label', `Visit ${friend.id}'s home`);
  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'star-btn';
  star.dataset.star = friend.id;
  star.dataset.starError = 'friends-error';
  star.setAttribute('aria-label', `Star ${friend.id} as a friend`);
  star.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-star" /></svg>';
  li.append(friendsAvatar(friend), who, visit, star);
  return li;
}

// Presses (or releases) every star button on the page to match the saved list.
function friendsPaintStars() {
  for (const button of document.querySelectorAll('[data-star]')) {
    const id = button.dataset.star;
    if (!id) continue;
    const starred = friendsHas(id);
    button.setAttribute('aria-pressed', String(starred));
    button.title = starred ? `${id} is a friend. Press to unstar.` : `Star ${id} as a friend`;
    // The pressed button stays focusable while it saves; the rest wait.
    button.disabled = !friendsOwner || (friendsPending !== null && friendsPending !== id);
    button.setAttribute('aria-busy', String(friendsPending === id));
  }
}

function friendsRender() {
  const list = friendsEl('friends-list');
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focus = focused && (focused.dataset.friendVisit ? `[data-friend-visit="${focused.dataset.friendVisit}"]` : `[data-star="${focused.dataset.star}"]`);
  const sorted = friendsSorted();
  list.replaceChildren(...sorted.map(friendsRow));
  const online = sorted.filter((friend) => friendsOnline.has(friend.id)).length;
  friendsEl('friends-empty').hidden = sorted.length > 0;
  friendsEl('friends-count').textContent = sorted.length ? `${online} of ${sorted.length} online` : '';
  const menu = friendsEl('world-friends');
  if (menu) menu.textContent = online ? `Friends · ${online} online` : 'Friends';
  const add = friendsEl('friend-add');
  add.querySelector('button').disabled = !friendsOwner || friendsPending !== null;
  add.setAttribute('aria-busy', String(friendsPending !== null));
  friendsPaintStars();
  // Keep the keyboard where it was; an unstarred friend's row is gone, so
  // its focus moves to the box for starring someone else.
  if (focused) (list.querySelector(focus) ?? friendsEl('friend-add-id')).focus({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('friends:changed', { detail: { friends: friendsList, online: [...friendsOnline] } }));
}

function friendsApply(list) {
  friendsList = list;
  if (friendsAwait && friendsHas(friendsAwait.id) === friendsAwait.starred) {
    if (friendsAwait.news) {
      friendsEl('friends-news').textContent = friendsAwait.starred
        ? `${friendsAwait.id} is now a friend.` : `${friendsAwait.id} is no longer a friend.`;
    }
    friendsAwait = null;
  }
  friendsRender();
}

async function friendsLoad() {
  if (!friendsOwner) return;
  const owner = friendsOwner, request = ++friendsLoads;
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/friends`, { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.json();
    if (request !== friendsLoads || friendsOwner !== owner || !Array.isArray(list)) return;
    friendsApply(list);
  } catch {
    // Broadcasts still change the list, and reconnecting loads it again.
  }
}

// Stars or unstars `id`, whichever it isn't. Errors go to the line beside the
// control that asked; the list itself waits for the saved broadcast.
async function friendsToggle(id, errorId = 'friends-error', news = false) {
  if (!friendsOwner || friendsPending) return false;
  const owner = friendsOwner, starred = friendsHas(id);
  const error = friendsEl(errorId) ?? friendsEl('friends-error');
  friendsPending = id;
  error.textContent = '';
  friendsEl('friends-news').textContent = '';
  friendsRender();
  try {
    const res = await fetch(`/api/pets/${encodeURIComponent(owner)}/${starred ? 'unstar' : 'star'}/${encodeURIComponent(id)}`, { method: 'POST' });
    if (friendsOwner !== owner) return false;
    if (res.status === 401 || res.status === 403) { error.textContent = 'Your session has changed. Reload the page and sign in again.'; return false; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { error.textContent = body.error ?? `Couldn't ${starred ? 'unstar' : 'star'} ${id}. Try again.`; return false; }
    friendsAwait = { id, starred: !starred, news };
    // The broadcast usually lands before this answer; confirm now if it did.
    if (friendsHas(id) !== starred) friendsApply(friendsList);
    return true;
  } catch {
    if (friendsOwner === owner) error.textContent = "Couldn't reach the server. Try again.";
    return false;
  } finally {
    if (friendsOwner === owner) {
      friendsPending = null;
      friendsRender();
    }
  }
}

document.addEventListener('click', (event) => {
  const star = event.target.closest?.('[data-star]');
  if (star?.dataset.star && !star.disabled) {
    friendsToggle(star.dataset.star, star.dataset.starError, Boolean(star.closest('#friends')));
    return;
  }
  const visit = event.target.closest?.('[data-friend-visit]');
  if (visit) {
    friendsEl('friends-error').textContent = '';
    document.dispatchEvent(new CustomEvent('friends:visit', { detail: visit.dataset.friendVisit }));
  }
});

friendsEl('friend-add').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = friendsEl('friend-add-id');
  const id = input.value.trim();
  friendsEl('friends-error').textContent = '';
  friendsEl('friends-news').textContent = '';
  if (!id || !friendsOwner) return;
  if (id === friendsOwner) { friendsEl('friends-error').textContent = "That's you. Star other players to keep them close."; return; }
  if (friendsHas(id)) { friendsEl('friends-news').textContent = `${id} is already a friend.`; return; }
  if (await friendsToggle(id, 'friends-error', true)) input.value = '';
});

// --- Broadcasts and app.js lifecycle -----------------------------------------

document.addEventListener('friends:updated', ({ detail }) => {
  if (!detail || detail.player !== friendsOwner || !Array.isArray(detail.friends)) return;
  friendsLoads++; // a load in flight predates this change
  friendsApply(detail.friends);
});
document.addEventListener('presence:updated', ({ detail }) => {
  friendsOnline = new Set(Array.isArray(detail) ? detail : []);
  friendsRender();
});
// app.js redrew some star buttons (an Arena row, the visit panel).
document.addEventListener('stars:rendered', friendsPaintStars);
document.addEventListener('adventure:pet', ({ detail }) => {
  if (friendsOwner === detail.id) return;
  friendsOwner = detail.id;
  friendsList = [];
  friendsPending = null;
  friendsAwait = null;
  for (const id of ['friends-error', 'friends-news']) friendsEl(id).textContent = '';
  friendsRender();
  friendsLoad();
});
document.addEventListener('realtime:resync', friendsLoad);
document.addEventListener('adventure:reset', () => {
  friendsOwner = null;
  friendsList = [];
  friendsLoads++;
  friendsPending = null;
  friendsAwait = null;
  friendsEl('friend-add-id').value = '';
  for (const id of ['friends-error', 'friends-news']) friendsEl(id).textContent = '';
  friendsRender();
});
friendsRender();
