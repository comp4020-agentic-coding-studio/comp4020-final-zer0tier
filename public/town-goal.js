// The town's weekly goal: every Food a pet eats, served by its owner or a
// visitor, is one meal toward a target the whole town shares. A small bar on
// the town map shows how close the town is; the fountain opens the details,
// and once the goal is reached everyone who served a meal can collect a small
// reward.
//
// The shared total arrives as town:goal broadcasts; each player's own meals
// and claim come from GET /api/town-goal. Nothing changes until the server
// says so: a claim shows only once it's saved.
const goalEl = (id) => document.getElementById(id);
let goalOwner = null; // the signed-in pet's ID, from app.js
let goal = null; // the shared total, as saved
let goalMine = null; // this player's meals and claim, as saved
let goalLoads = 0;
let goalClaiming = false;

const mealsText = (n) => `${n} ${n === 1 ? 'meal' : 'meals'}`;
const daysLeft = (endsAt) => {
  const ms = Math.max(0, endsAt - Date.now());
  const days = Math.floor(ms / 86_400_000), hours = Math.ceil((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `in ${days} ${days === 1 ? 'day' : 'days'}${hours && days < 3 ? `, ${hours} h` : ''}`;
  return hours <= 1 ? 'within the hour' : `in ${hours} h`;
};
const rewardText = (reward) => `$${reward.money} and ${reward.food} Food`;

function goalRender() {
  const bar = goalEl('town-goal-bar');
  bar.hidden = !goal || !goalOwner;
  if (!goal) return;
  const shown = Math.min(goal.meals, goal.target);
  const fill = goal.target ? shown / goal.target : 0, percent = Math.floor(fill * 100);
  // The map's bar: one short line and a thin bar, out of the way.
  goalEl('town-goal-bar-label').textContent = goal.reached
    ? `Town goal reached · ${mealsText(goal.meals)}`
    : `Town goal · ${goal.meals} / ${goal.target} meals`;
  bar.dataset.reached = String(goal.reached);
  goalEl('town-goal').dataset.reached = String(goal.reached);
  bar.dataset.claimable = String(Boolean(goalMine?.canClaim));
  bar.setAttribute('aria-label', `${goalEl('town-goal-bar-label').textContent}${goalMine?.canClaim ? '. Your reward is ready to collect.' : ''} Open the town goal.`);
  for (const [progress, fillEl] of [['town-goal-bar-progress', 'town-goal-bar-fill'], ['town-goal-progress', 'town-goal-fill']]) {
    goalEl(progress).setAttribute('aria-valuenow', String(percent));
    goalEl(progress).setAttribute('aria-valuetext', `${goal.meals} of ${goal.target} meals`);
    goalEl(fillEl).style.setProperty('--fill', String(fill));
  }
  // The fountain's window: the whole story.
  goalEl('town-goal-target').textContent = `Feed ${goal.target} pets as a town this week`;
  goalEl('town-goal-count').textContent = goal.reached
    ? `Goal reached! The town served ${mealsText(goal.meals)}.`
    : `${mealsText(goal.meals)} served · ${goal.target - goal.meals} to go`;
  goalEl('town-goal-mine').textContent = goalMine ? String(goalMine.meals) : '—';
  goalEl('town-goal-helpers').textContent = String(goal.helpers);
  goalEl('town-goal-ends').textContent = daysLeft(goal.endsAt);
  goalEl('town-goal-reward').textContent = !goalMine || goalMine.meals === 0
    ? `Every Food you give a pet counts, yours or a neighbour's. Serve one meal this week and you'll share the reward: ${rewardText(goal.reward)}.`
    : goalMine.claimed ? `You collected this week's reward: ${rewardText(goal.reward)}. Thanks for helping!`
    : goal.reached ? `You helped! Collect your share: ${rewardText(goal.reward)}.`
    : `You're helping! When the town reaches ${goal.target}, you'll share the reward: ${rewardText(goal.reward)}.`;
  const claim = goalEl('town-goal-claim');
  const ready = Boolean(goalMine?.canClaim);
  claim.hidden = !ready && !goalClaiming;
  claim.textContent = goalClaiming ? 'Collecting…' : `Collect ${rewardText(goal.reward)}`;
  claim.setAttribute('aria-busy', String(goalClaiming));
  claim.disabled = !ready && !goalClaiming;
}

// The shared total: newer weeks always win, and within a week the count only grows.
// A read that started before a later broadcast still brings our own share,
// but never winds the town's total back.
function goalReceive(next) {
  if (!next || typeof next.meals !== 'number') return false;
  if (goal && next.week < goal.week) return false;
  const { mine, ...shared } = next;
  const sameWeek = goal?.week === shared.week;
  if (mine) goalMine = mine;
  else if (!sameWeek && goal) goalMine = { meals: 0, claimed: false, canClaim: false };
  if (sameWeek && shared.meals < goal.meals) return Boolean(mine);
  goal = shared;
  return true;
}

async function goalLoad() {
  if (!goalOwner) return;
  const owner = goalOwner, request = ++goalLoads;
  try {
    const res = await fetch('/api/town-goal', { cache: 'no-store' });
    if (!res.ok) return;
    const saved = await res.json();
    if (request !== goalLoads || goalOwner !== owner) return;
    goalReceive(saved);
    goalRender();
  } catch {
    // The next broadcast or reconnect fills it in.
  }
}

goalEl('town-goal-claim').addEventListener('click', async () => {
  if (!goalOwner || goalClaiming || !goalMine?.canClaim) return;
  const owner = goalOwner;
  goalClaiming = true;
  goalEl('town-goal-error').textContent = '';
  goalEl('town-goal-news').textContent = '';
  goalRender();
  try {
    const res = await fetch('/api/town-goal/claim', { method: 'POST' });
    if (goalOwner !== owner) return;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      goalEl('town-goal-error').textContent = body.error ?? "Couldn't collect the reward. Try again.";
      goalLoad(); // the saved claim decides what the button says
      return;
    }
    goalLoads++; // a load in flight predates this claim
    goalReceive(body);
    goalEl('town-goal-news').textContent = `Collected ${rewardText(body.reward)}. It's in your backpack.`;
  } catch {
    if (goalOwner === owner) goalEl('town-goal-error').textContent = "Couldn't reach the server. Try again.";
  } finally {
    if (goalOwner === owner) {
      goalClaiming = false;
      goalRender();
      // Keep the keyboard in the window once the button goes.
      if (goalEl('town-goal-claim').hidden && (document.activeElement === document.body || document.activeElement === goalEl('town-goal-claim'))) {
        goalEl('town-goal-news').focus({ preventScroll: true });
      }
    }
  }
});

// --- Broadcasts and app.js lifecycle -----------------------------------------

// Every player hears the total; only a change to our own share (we served a
// meal, or the goal was just reached while we'd helped) needs a fresh read,
// so a busy town doesn't send every window back to the server for each meal.
let goalFed = false; // we just ate or gave Food, so the next total includes our meal
document.addEventListener('town:goal', ({ detail }) => {
  if (!goalOwner) return;
  const wasReached = goal?.reached ?? false;
  if (!goalReceive(detail)) return;
  const justReached = goal.reached && !wasReached && (goalMine?.meals ?? 0) > 0;
  if (goalFed || justReached) { goalFed = false; goalLoad(); }
  goalRender();
});
// Our pet's own Food went down by one: we fed it, at home or in the woodland,
// or gave it to a neighbour's pet.
let goalFood = null;
document.addEventListener('adventure:pet', ({ detail }) => {
  if (detail.id === goalOwner && goalFood !== null && detail.food < goalFood) goalFed = true;
  goalFood = detail.food;
});
document.addEventListener('adventure:pet', ({ detail }) => {
  if (goalOwner === detail.id) return;
  goalOwner = detail.id;
  goalFed = false;
  goalMine = null;
  goalClaiming = false;
  for (const id of ['town-goal-error', 'town-goal-news']) goalEl(id).textContent = '';
  goalRender();
  goalLoad();
});
document.addEventListener('realtime:resync', goalLoad);
document.addEventListener('adventure:reset', () => {
  goalOwner = null;
  goalFood = null;
  goalFed = false;
  goal = null;
  goalMine = null;
  goalLoads++;
  goalClaiming = false;
  for (const id of ['town-goal-error', 'town-goal-news']) goalEl(id).textContent = '';
  goalRender();
});
// The week rolls over at Monday 00:00 UTC even if nobody feeds a pet then:
// check once a minute, and read the new week's empty goal when it arrives.
setInterval(() => {
  if (!goal || document.hidden) return;
  if (Date.now() >= goal.endsAt) return void goalLoad();
  goalEl('town-goal-ends').textContent = daysLeft(goal.endsAt);
}, 60_000);
goalRender();
