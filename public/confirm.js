// The game's one way to ask before acting: a small window with Yes and No.
// Any script asks by dispatching `confirm:ask` with a title, a message, and
// an `answer` callback that receives true (Yes) or false (No). Escape, a
// click outside the window, and a new question all answer No. Focus starts on
// No, so a stray key never confirms, and returns to wherever it was before.
let confirmDialog = null, question = null, askedFrom = null;

function buildConfirmDialog() {
  confirmDialog = document.createElement('dialog');
  confirmDialog.id = 'confirm-dialog';
  confirmDialog.setAttribute('aria-labelledby', 'confirm-title');
  confirmDialog.setAttribute('aria-describedby', 'confirm-message');
  confirmDialog.innerHTML = `
    <h2 id="confirm-title"></h2>
    <p id="confirm-message"></p>
    <div class="confirm-actions">
      <button type="button" id="confirm-no" class="chip-btn chip-buy">No</button>
      <button type="button" id="confirm-yes" class="chip-btn chip-use">Yes</button>
    </div>`;
  document.body.append(confirmDialog);
  confirmDialog.querySelector('#confirm-yes').addEventListener('click', () => answerQuestion(true));
  confirmDialog.querySelector('#confirm-no').addEventListener('click', () => answerQuestion(false));
  // Escape closes the window; a question asked meanwhile has reopened it.
  confirmDialog.addEventListener('close', () => { if (!confirmDialog.open) answerQuestion(false); });
  // A click on the backdrop lands on the dialog itself, outside its content.
  confirmDialog.addEventListener('click', event => {
    const box = confirmDialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (event.target === confirmDialog && outside && (box.width || box.height)) answerQuestion(false);
  });
}

function answerQuestion(yes) {
  if (!question) return;
  const { answer } = question, back = askedFrom;
  question = null; askedFrom = null;
  if (confirmDialog.open) confirmDialog.close();
  if (back?.isConnected) back.focus({ preventScroll: true });
  answer(yes);
}

document.addEventListener('confirm:ask', ({ detail }) => {
  if (typeof detail?.answer !== 'function') return;
  if (!confirmDialog) buildConfirmDialog();
  if (question) answerQuestion(false);
  question = detail; askedFrom = document.activeElement;
  confirmDialog.querySelector('#confirm-title').textContent = detail.title || 'Are you sure?';
  confirmDialog.querySelector('#confirm-message').textContent = detail.message || '';
  confirmDialog.querySelector('#confirm-message').hidden = !detail.message;
  confirmDialog.showModal();
  confirmDialog.querySelector('#confirm-no').focus({ preventScroll: true });
});
// Signing out answers any open question No.
document.addEventListener('adventure:reset', () => answerQuestion(false));
