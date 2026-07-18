const socket = io();

const state = {
  isHost: false,
  problem: '',
  code: '',
  myId: null,
  votingSolutions: [],
  cardIndex: 0,
  scores: {},
};

socket.on('connect', () => {
  state.myId = socket.id;
  console.log('[client] connected, myId:', state.myId);
});

// ── Screens ──────────────────────────────────────────────────────
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function setErr(id, msg) {
  document.getElementById(id).textContent = msg || '';
}

// ── Home ─────────────────────────────────────────────────────────
document.getElementById('btn-run').addEventListener('click', () => show('screen-create'));
document.getElementById('btn-join').addEventListener('click', () => show('screen-join'));
document.getElementById('btn-back-create').addEventListener('click', () => show('screen-home'));
document.getElementById('btn-back-join').addEventListener('click', () => show('screen-home'));

// ── Create ───────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  const problem = document.getElementById('create-problem').value.trim();
  const name = document.getElementById('create-name').value.trim();
  const cap = parseInt(document.getElementById('create-cap').value) || 8;
  setErr('create-error', '');

  if (!problem) return setErr('create-error', 'Enter a problem.');
  if (!name) return setErr('create-error', 'Enter your name.');

  socket.emit('create-session', { problem, name, cap }, res => {
    if (res.error) return setErr('create-error', res.error);
    state.isHost = true;
    state.problem = res.problem;
    state.code = res.code;
    enterStep1(res.count, res.cap);
  });
});

// ── Join ─────────────────────────────────────────────────────────
document.getElementById('btn-join-submit').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  setErr('join-error', '');

  if (!name) return setErr('join-error', 'Enter your name.');
  if (!code) return setErr('join-error', 'Enter a session code.');

  socket.emit('join-session', { code, name }, res => {
    if (res.error) return setErr('join-error', res.error);
    state.isHost = false;
    state.problem = res.problem;
    state.code = code;
    enterStep1(res.count, res.cap);
  });
});

// ── Step 1 setup ─────────────────────────────────────────────────
function enterStep1(count, cap) {
  document.getElementById('s1-problem').textContent = state.problem;
  document.getElementById('s1-form-area').style.display = '';
  document.getElementById('s1-waiting').style.display = 'none';
  document.getElementById('solution-text').value = '';
  setErr('s1-error', '');

  if (state.isHost) {
    document.getElementById('host-header').style.display = '';
    document.getElementById('s1-code').textContent = state.code;
    updateCount(count, cap);
    document.getElementById('host-panel').style.display = '';
    document.getElementById('btn-continue').disabled = true;
    document.getElementById('s1-solutions-list').innerHTML = '';
    document.getElementById('s1-no-solutions').style.display = '';
    document.getElementById('btn-combine').style.display = 'none';
    setErr('combine-error', '');
  } else {
    document.getElementById('host-header').style.display = 'none';
    document.getElementById('host-panel').style.display = 'none';
  }

  show('screen-step1');
}

function updateCount(count, cap) {
  document.getElementById('s1-count').textContent = count;
  document.getElementById('s1-cap').textContent = cap;
}

// ── Submit solution ───────────────────────────────────────────────
document.getElementById('btn-submit-solution').addEventListener('click', () => {
  const text = document.getElementById('solution-text').value.trim();
  setErr('s1-error', '');
  if (!text) return setErr('s1-error', 'Enter a solution first.');

  socket.emit('submit-solution', { text }, res => {
    if (res.error) return setErr('s1-error', res.error);
    document.getElementById('s1-form-area').style.display = 'none';
    if (!state.isHost) {
      document.getElementById('s1-waiting').style.display = '';
    }
  });
});

// ── Host: render solutions ────────────────────────────────────────
function renderSolutions(solutions) {
  const list = document.getElementById('s1-solutions-list');
  list.innerHTML = '';
  document.getElementById('s1-no-solutions').style.display = solutions.length ? 'none' : '';

  solutions.forEach(sol => {
    const item = document.createElement('div');
    item.className = 'solution-item';
    item.dataset.id = sol.id;

    const isCombined = sol.author === 'combined';
    item.innerHTML = `
      <div class="solution-checkbox">✓</div>
      <div class="solution-body">
        ${isCombined ? '<span class="combined-tag">Combined</span><br>' : ''}
        <div class="solution-text">${esc(sol.text)}</div>
        ${!isCombined ? `<div class="solution-author">by ${esc(sol.author)}</div>` : ''}
      </div>
    `;

    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      const anySelected = list.querySelectorAll('.solution-item.selected').length > 0;
      document.getElementById('btn-combine').style.display = anySelected ? '' : 'none';
    });

    list.appendChild(item);
  });

  document.getElementById('btn-continue').disabled = solutions.length === 0;
  document.getElementById('btn-combine').style.display = 'none';
  setErr('combine-error', '');
}

// ── Host: combine ─────────────────────────────────────────────────
document.getElementById('btn-combine').addEventListener('click', () => {
  const list = document.getElementById('s1-solutions-list');
  const selected = [...list.querySelectorAll('.solution-item.selected')].map(el => el.dataset.id);
  setErr('combine-error', '');
  if (selected.length < 1) return setErr('combine-error', 'Select at least one solution.');

  socket.emit('host-combine', { ids: selected }, res => {
    if (res.error) return setErr('combine-error', res.error);
  });
});

// ── Host: continue to voting ──────────────────────────────────────
document.getElementById('btn-continue').addEventListener('click', () => {
  socket.emit('start-voting', {}, res => {
    if (res.error) alert(res.error);
  });
});

// ── Step 2: swipe voting ──────────────────────────────────────────
function enterVoting(solutions) {
  state.votingSolutions = solutions;
  state.cardIndex = 0;
  state.scores = {};
  showCard();
  show('screen-step2');
}

function showCard() {
  const sols = state.votingSolutions;
  const i = state.cardIndex;
  if (i >= sols.length) return;

  const sol = sols[i];
  document.getElementById('card-counter').textContent = `${i + 1} of ${sols.length}`;
  document.getElementById('card-progress').textContent = `Card ${i + 1} of ${sols.length}`;
  document.getElementById('card-text').textContent = sol.text;

  const ind = document.getElementById('score-indicator');
  ind.textContent = 'Swipe to score';
  ind.className = 'score-indicator';

  // Reset card position
  const card = document.getElementById('swipe-card');
  card.style.transition = 'transform 0.3s ease';
  card.style.transform = '';
  setTimeout(() => { card.style.transition = ''; }, 300);

  // Reset threshold ring and vote bubble
  const ringEl = document.getElementById('threshold-ring');
  if (ringEl) ringEl.classList.remove('near', 'past');
  const bub = document.getElementById('vote-bubble');
  if (bub) { bub.className = 'vote-bubble'; bub.textContent = ''; }
}

function scoreColor(score) {
  if (score <= 33) return 'low';
  if (score <= 66) return 'mid';
  return 'high';
}

function swipeAngleToScore(dx, dy) {
  const angle = Math.atan2(-dy, dx);
  return Math.max(0, Math.min(100, Math.round(50 + Math.cos(angle) * 50)));
}

function flashScore(score, done) {
  const flash = document.getElementById('score-flash');
  const num = document.getElementById('score-flash-number');
  num.textContent = score;
  flash.classList.add('visible');
  setTimeout(() => {
    flash.classList.remove('visible');
    done();
  }, 600);
}

function commitScore(score) {
  const sol = state.votingSolutions[state.cardIndex];
  state.scores[sol.id] = score;
  state.cardIndex++;

  flashScore(score, () => {
    if (state.cardIndex >= state.votingSolutions.length) {
      // All cards scored — show waiting immediately so user isn't frozen on the last card.
      // Set a provisional count; voting-progress will overwrite with the real number.
      document.getElementById('votes-done').textContent = '1';
      document.getElementById('votes-total').textContent = '?';
      document.getElementById('vote-progress-bar').style.width = '0%';
      show('screen-waiting');

      socket.emit('submit-scores', { scores: state.scores }, res => {
        if (res.error) return alert(res.error);
        // voting-progress and show-results events handle all further navigation.
      });
    } else {
      showCard();
    }
  });
}

// Per-user edit toggle (does not affect other participants)
let editBeforeSubmit = false;

// Swipe gesture
(function initSwipe() {
  // Arc radius = 185px, bubble radius = 55px, movement factor = 0.8×
  // Bubble outer edge crosses arc when: drag × 0.8 + 55 ≥ 185 → drag ≥ 162.5
  const THRESHOLD = 163;

  const card   = document.getElementById('swipe-card');
  const ring   = document.getElementById('threshold-ring');
  const bubble = document.getElementById('vote-bubble');

  let startX = 0, startY = 0, dragging = false;
  let bubbleOriginX = 0, bubbleOriginY = 0;

  function resetRing() { ring.classList.remove('near', 'past'); }

  function hideBubble() {
    bubble.className = 'vote-bubble';
    bubble.textContent = '';
    bubble.style.left = '';
    bubble.style.top  = '';
    bubble.style.transform = '';
  }

  function onStart(x, y) {
    startX = x; startY = y; dragging = true;

    // Place bubble at card centre (viewport coords)
    const r = card.getBoundingClientRect();
    bubbleOriginX = r.left + r.width  / 2 - 55; // 55 = bubble radius
    bubbleOriginY = r.top  + r.height / 2 - 55;
    bubble.style.left = bubbleOriginX + 'px';
    bubble.style.top  = bubbleOriginY + 'px';
    bubble.style.transform = '';
    bubble.className = 'vote-bubble visible';

    // Fade card behind bubble; no transition on transform so drag is instant
    card.classList.add('dragging');
    card.style.transition = 'none';

    ring.classList.remove('past');
    ring.classList.add('near');
  }

  function onMove(x, y) {
    if (!dragging) return;
    const dx = x - startX;
    const dy = y - startY;
    const mag = Math.sqrt(dx * dx + dy * dy);

    // Move card (invisible but keeps layout; also used for snap-back)
    card.style.transform = `translate(${dx * 0.8}px, ${dy * 0.8}px)`;

    // Move bubble in sync
    bubble.style.transform = `translate(${dx * 0.8}px, ${dy * 0.8}px)`;

    if (mag > 8) {
      const score = swipeAngleToScore(dx, dy);
      const col   = scoreColor(score);

      bubble.textContent = score;
      bubble.className   = 'vote-bubble visible ' + col;

      const ind = document.getElementById('score-indicator');
      ind.textContent = score;
      ind.className   = 'score-indicator ' + col;
    }

    if (mag >= THRESHOLD) {
      ring.classList.add('past');
      ring.classList.remove('near');
    } else {
      ring.classList.remove('past');
      ring.classList.add('near');
    }
  }

  function onEnd(x, y) {
    if (!dragging) return;
    dragging = false;
    resetRing();
    hideBubble();

    card.classList.remove('dragging');

    const dx  = x - startX;
    const dy  = y - startY;
    const mag = Math.sqrt(dx * dx + dy * dy);

    if (mag >= THRESHOLD) {
      const score = swipeAngleToScore(dx, dy);
      if (editBeforeSubmit) {
        showVoteEditModal(score);
      } else {
        commitScore(score);
      }
    } else {
      // Spring snap-back
      card.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      card.style.transform  = '';
      setTimeout(() => { card.style.transition = ''; }, 400);
      setTimeout(() => {
        const ind = document.getElementById('score-indicator');
        ind.textContent = 'Swipe to score';
        ind.className   = 'score-indicator';
      }, 180);
    }
  }

  // Touch
  card.addEventListener('touchstart', e => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
  }, { passive: false });

  card.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    onEnd(t.clientX, t.clientY);
  });

  // Mouse
  card.addEventListener('mousedown', e => onStart(e.clientX, e.clientY));
  document.addEventListener('mousemove', e => { if (dragging) onMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', e => { if (dragging) onEnd(e.clientX, e.clientY); });
})();

// Edit-vote toggle
document.getElementById('btn-edit-toggle').addEventListener('click', () => {
  editBeforeSubmit = !editBeforeSubmit;
  const btn = document.getElementById('btn-edit-toggle');
  btn.textContent = `Edit vote before submitting: ${editBeforeSubmit ? 'ON' : 'OFF'}`;
  btn.style.opacity = editBeforeSubmit ? '1' : '0.6';
});

// Vote edit modal
let pendingEditScore = 0;

function showVoteEditModal(score) {
  pendingEditScore = score;
  document.getElementById('vote-edit-score').textContent = score;
  document.getElementById('vote-edit-modal').style.display = 'flex';
}

function closeVoteEditModal() {
  document.getElementById('vote-edit-modal').style.display = 'none';
}

document.getElementById('vote-minus').addEventListener('click', () => {
  pendingEditScore = Math.max(0, pendingEditScore - 1);
  document.getElementById('vote-edit-score').textContent = pendingEditScore;
});

document.getElementById('vote-plus').addEventListener('click', () => {
  pendingEditScore = Math.min(100, pendingEditScore + 1);
  document.getElementById('vote-edit-score').textContent = pendingEditScore;
});

document.getElementById('vote-confirm').addEventListener('click', () => {
  closeVoteEditModal();
  commitScore(pendingEditScore);
});

document.getElementById('vote-cancel').addEventListener('click', () => {
  closeVoteEditModal();
  // Reset card so user can re-swipe
  const card = document.getElementById('swipe-card');
  card.style.transition = 'transform 0.3s ease';
  card.style.transform = '';
  setTimeout(() => { card.style.transition = ''; }, 300);
  const ind = document.getElementById('score-indicator');
  ind.textContent = 'Swipe to score';
  ind.className = 'score-indicator';
});

// Manual voting button toggle
document.getElementById('btn-show-manual').addEventListener('click', () => {
  const box = document.getElementById('score-buttons');
  const btn = document.getElementById('btn-show-manual');
  const visible = box.style.display !== 'none';
  box.style.display = visible ? 'none' : 'flex';
  btn.textContent = visible ? 'Show manual voting buttons' : 'Hide manual buttons';
});

// Fallback score buttons
document.querySelectorAll('.score-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    commitScore(parseInt(btn.dataset.score));
  });
});

// ── Socket events ─────────────────────────────────────────────────
socket.on('participant-update', ({ count, cap }) => {
  console.log('[client] participant-update — count:', count, 'cap:', cap, 'isHost:', state.isHost);
  if (state.isHost) updateCount(count, cap);
});

socket.on('solutions-update', ({ solutions }) => {
  console.log('[client] solutions-update received — count:', solutions.length, 'isHost:', state.isHost);
  // Use DOM check as primary guard so the host panel always updates
  // regardless of whether state.isHost was set before the event fires
  const hostPanel = document.getElementById('host-panel');
  if (hostPanel && hostPanel.style.display !== 'none') {
    renderSolutions(solutions);
  }
});

socket.on('voting-started', ({ solutions }) => {
  enterVoting(solutions);
});

socket.on('voting-progress', ({ done, total, scoredIds }) => {
  const myId = state.myId || socket.id;
  const iHaveVoted = scoredIds.includes(myId);

  console.log('[client] voting-progress — myId:', myId, 'scoredIds:', scoredIds, 'done:', done, '/', total, 'iHaveVoted:', iHaveVoted);

  document.getElementById('votes-done').textContent = done;
  document.getElementById('votes-total').textContent = total;
  document.getElementById('vote-progress-bar').style.width = `${(done / total) * 100}%`;

  // Only move this user to the waiting screen if THEY have finished voting.
  // Users who are still swiping must stay on screen-step2.
  if (iHaveVoted && document.getElementById('screen-step2').classList.contains('active')) {
    show('screen-waiting');
  }
});

socket.on('show-results', ({ results }) => {
  showResults(results);
});

// ── Results ───────────────────────────────────────────────────────
function showResults(results) {
  document.getElementById('results-problem').textContent = state.problem;

  const top = results[0];
  document.getElementById('winner-text').textContent = top.text;
  document.getElementById('winner-score').textContent = top.avg;

  const list = document.getElementById('results-list');
  list.innerHTML = '';
  results.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'result-item';
    el.innerHTML = `
      <div class="result-rank">${i + 1}</div>
      <div class="result-text">${esc(r.text)}</div>
      <div class="result-avg">${r.avg}</div>
    `;
    list.appendChild(el);
  });

  show('screen-results');
}

// ── PWA service worker ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}
