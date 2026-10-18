// Enhance wide screens by moving the existing controls, preserving their state
// and event listeners. Every node returns to its exact mobile position on exit.
const desktopQuery = window.matchMedia('(min-width: 1120px)');
const dashboard = document.getElementById('dashboard');
let teardown = null;

function mountDesktop() {
  const $ = (id) => document.getElementById(id);
  const anchors = [];
  const cleanups = [];
  function move(node, target) {
    if (!node) return;
    const anchor = document.createComment('mobile position');
    node.before(anchor);
    anchors.push([node, anchor]);
    target.append(node);
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function region(label, className) {
    const node = element('section', `desktop-column ${className}`);
    node.setAttribute('aria-label', label);
    dashboard.append(node);
    return node;
  }
  function tabs(container, label, entries, initial = entries[0].name) {
    container.setAttribute('role', 'tablist');
    container.setAttribute('aria-label', label);
    function select(name) {
      for (const entry of entries) {
        const selected = entry.name === name;
        entry.button.setAttribute('aria-selected', String(selected));
        entry.button.tabIndex = selected ? 0 : -1;
        entry.panel.hidden = !selected;
      }
    }
    for (const entry of entries) {
      entry.button.type = 'button';
      entry.button.setAttribute('role', 'tab');
      entry.button.setAttribute('aria-controls', entry.panel.id);
      entry.panel.setAttribute('role', 'tabpanel');
      entry.panel.setAttribute('aria-labelledby', entry.button.id);
      entry.panel.tabIndex = 0;
      const click = () => select(entry.name);
      entry.button.addEventListener('click', click);
      cleanups.push(() => {
        entry.button.removeEventListener('click', click);
        entry.button.removeAttribute('tabindex');
        entry.panel.removeAttribute('tabindex');
      });
    }
    const keydown = (event) => {
      const index = entries.findIndex((entry) => entry.button === event.target);
      if (index < 0) return;
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % entries.length;
      if (event.key === 'ArrowLeft') next = (index + entries.length - 1) % entries.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = entries.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      entries[next].button.click();
      entries[next].button.focus();
    };
    container.addEventListener('keydown', keydown);
    cleanups.push(() => container.removeEventListener('keydown', keydown));
    select(initial);
    return select;
  }

  const pet = region('Your pet and care', 'desktop-pet');
  pet.append(element('p', 'desktop-eyebrow', 'YOUR COMPANION'));
  move(dashboard.querySelector('.pet-hero'), pet);
  move(dashboard.querySelector('.play'), pet);
  move(dashboard.querySelector('.stats'), pet);
  const quick = element('section', 'desktop-quick-care');
  quick.setAttribute('aria-label', 'Quick care');
  quick.append(element('h3', 'section-label', 'Quick care'));
  const quickButtons = element('div', 'desktop-care-buttons');
  quick.append(quickButtons);
  pet.append(quick);
  const careError = element('p', 'error');
  careError.setAttribute('role', 'alert');
  quick.append(careError);
  for (const [id, label] of [['food', 'Feed'], ['soap', 'Clean']]) {
    const button = element('button', 'chip-btn chip-buy', label);
    button.type = 'button';
    button.disabled = true;
    button.addEventListener('click', () => $('items').querySelector(`[data-item="${id}"] .chip-use`)?.click());
    button.dataset.care = id;
    quickButtons.append(button);
  }
  quick.append(element('p', 'help', 'Use supplies here. Restock in the Shop tab.'));
  const syncCare = () => {
    for (const button of quickButtons.children) {
      const source = $('items').querySelector(`[data-item="${button.dataset.care}"]`);
      const use = source?.querySelector('.chip-use');
      button.disabled = !use || use.disabled;
      button.textContent = `${button.dataset.care === 'food' ? 'Feed' : 'Clean'} · ${source?.querySelector('.item-count')?.textContent || '0'} left`;
    }
    careError.textContent = $('care-error').textContent;
  };
  const careObserver = new MutationObserver(syncCare);
  careObserver.observe($('items'), { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'], characterData: true });
  careObserver.observe($('care-error'), { subtree: true, childList: true, characterData: true });
  cleanups.push(() => careObserver.disconnect());
  syncCare();
  if ($('appearance-settings')) {
    const details = element('details', 'desktop-appearance');
    details.append(element('summary', '', 'Customize appearance'));
    pet.append(details);
    move($('appearance-settings'), details);
  }

  const activities = region('Pet activities', 'desktop-activities');
  const heading = element('div', 'desktop-heading');
  heading.append(element('p', 'desktop-eyebrow', 'MAKE THEIR DAY'), element('h2', '', 'A little progress, every day'));
  activities.append(heading);
  move($('busy'), activities);
  move($('notice'), activities);
  const activityTabs = element('div', 'tabs desktop-tabs');
  activities.append(activityTabs);
  const activityEntries = ['school', 'work', 'shop', 'adventure'].map((name) => {
    const button = element('button', '', name[0].toUpperCase() + name.slice(1));
    button.id = `desktop-tab-${name}`;
    activityTabs.append(button);
    const panel = element('div', 'desktop-panel');
    panel.id = `desktop-panel-${name}`;
    activities.append(panel);
    return { name, button, panel };
  });
  move(dashboard.querySelector('.school'), activityEntries[0].panel);
  move($('study-heading').closest('section'), activityEntries[0].panel);
  move($('work-heading').closest('section'), activityEntries[1].panel);
  move($('care-heading').closest('section'), activityEntries[2].panel);
  move($('adventure-heading').closest('section'), activityEntries[3].panel);
  tabs(activityTabs, 'Activities', activityEntries);

  const social = region('Other players and notifications', 'desktop-social');
  move($('arena-heading').closest('section'), social);
  const arena = $('arena-heading').closest('section');
  const arenaTabs = arena.querySelector('.arena-tabs');
  const entries = ['pets', 'board'].map((name) => ({ name, button: $(`tab-${name}`), panel: $(`arena-${name}`) }));
  let mobileArenaTab = $('tab-board').getAttribute('aria-selected') === 'true' ? 'board' : 'pets';
  for (const [name, label] of [['events', 'Activity'], ['alerts', 'Alerts']]) {
    const button = element('button', '', label);
    button.id = `desktop-tab-${name}`;
    arenaTabs.append(button);
    const panel = element('div', 'desktop-social-panel');
    panel.id = `desktop-panel-${name}`;
    arena.append(panel);
    entries.push({ name, button, panel });
  }
  const events = entries[2].panel;
  for (const node of [$('fight-log').previousElementSibling, $('fight-log'), $('feed-heading'), $('feed')]) move(node, events);
  const alerts = entries[3].panel;
  const emptyAlerts = element('p', 'help', 'All quiet. Saved theft reports and revenge options appear here.');
  alerts.append(emptyAlerts);
  move($('theft-notifications'), alerts);
  const selectSocial = tabs(arenaTabs, 'Arena', entries, mobileArenaTab);
  for (const { name, button } of entries.slice(0, 2)) {
    const remember = () => { mobileArenaTab = name; };
    button.addEventListener('click', remember);
    cleanups.push(() => button.removeEventListener('click', remember));
  }
  let previousReports = '';
  const syncAlerts = () => {
    const notification = $('theft-notifications');
    const count = $('theft-list').children.length;
    const signature = $('theft-list').textContent;
    entries[3].button.textContent = count ? `Alerts (${count})` : 'Alerts';
    entries[3].button.classList.toggle('has-alerts', count > 0);
    emptyAlerts.hidden = !notification.hidden;
    // Bring fresh reports into view without hiding a control being used.
    if (count && signature !== previousReports && !social.contains(document.activeElement)) selectSocial('alerts');
    previousReports = signature;
  };
  const alertObserver = new MutationObserver(syncAlerts);
  alertObserver.observe($('theft-notifications'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  cleanups.push(() => alertObserver.disconnect());
  syncAlerts();
  document.body.classList.add('desktop-game');

  return () => {
    cleanups.forEach((cleanup) => cleanup());
    // Restore moved children before removing the newly created containers.
    for (const [node, anchor] of anchors.reverse()) anchor.replaceWith(node);
    entries.slice(2).forEach(({ button, panel }) => { button.remove(); panel.remove(); });
    for (const name of ['pets', 'board']) {
      $(`tab-${name}`).setAttribute('aria-selected', String(name === mobileArenaTab));
      $(`arena-${name}`).hidden = name !== mobileArenaTab;
    }
    // Use the existing handler too: a hidden leaderboard may need fresh data.
    $(`tab-${mobileArenaTab}`).click();
    activityEntries.forEach(({ panel }) => { panel.hidden = false; });
    pet.remove(); activities.remove(); social.remove();
    document.body.classList.remove('desktop-game');
  };
}

function syncDesktop() {
  const enabled = desktopQuery.matches && !dashboard.hidden;
  if (enabled && !teardown) teardown = mountDesktop();
  if (!enabled && teardown) { teardown(); teardown = null; }
}
desktopQuery.addEventListener('change', syncDesktop);
new MutationObserver(syncDesktop).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
syncDesktop();
