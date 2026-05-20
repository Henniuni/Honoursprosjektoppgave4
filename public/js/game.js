'use strict';
const socket = io();

const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
const RES_LABELS = { wood:'Wood', brick:'Brick', sheep:'Sheep', wheat:'Wheat', ore:'Ore' };
const RES_ICONS  = { wood:'🌲', brick:'🧱', sheep:'🐑', wheat:'🌾', ore:'⛰' };
const RES_COLORS = { wood:'#4a7c2f', brick:'#b5451b', sheep:'#7cbb4a', wheat:'#d4a017', ore:'#607080' };
const DEV_LABELS = { knight:'Knight', vp:'Victory Point', roadBuilding:'Road Building', yearOfPlenty:'Year of Plenty', monopoly:'Monopoly' };
const DEV_ICONS  = { knight:'⚔', vp:'⭐', roadBuilding:'🛤', yearOfPlenty:'✨', monopoly:'💰' };

let board = null;
let state = null;
let myIdx = null;
let roomId = null;
let uiMode = 'idle'; // idle | placeSettlement | placeRoad | placeCity | moveRobber | stealFrom | discard | yearOfPlenty | monopoly

// Recover room from storage or URL param
roomId = new URLSearchParams(window.location.search).get('room') ||
         localStorage.getItem('catanRoom') || '';

document.getElementById('room-label').textContent = roomId ? `Room: ${roomId}` : '';

// ── Music ─────────────────────────────────────────────────────────────────────
const musicBtn = document.getElementById('music-btn');
musicBtn.addEventListener('click', () => {
  const on = CatanMusic.toggle();
  musicBtn.textContent = on ? '♪ Music' : '♪ Muted';
  musicBtn.style.opacity = on ? '' : '0.45';
});
// Auto-start on first user interaction anywhere on the page
document.addEventListener('click', () => {
  CatanMusic.start();
  musicBtn.textContent = '♪ Music';
}, { once: true });

// ── Init board ────────────────────────────────────────────────────────────────

board = new CatanBoard(document.getElementById('board-svg'));

board.onVertexClick = (vertexId) => {
  if (uiMode === 'placeSettlement' || uiMode === 'placeCity') {
    socket.emit(uiMode === 'placeCity' ? 'upgradeCity' : 'placeSettlement', { vertexId });
    setUIMode('idle');
  }
};

board.onEdgeClick = (edgeId) => {
  if (uiMode === 'placeRoad') {
    socket.emit('placeRoad', { edgeId });
    setUIMode('idle');
  }
};

board.onTileClick = (tileIdx) => {
  if (uiMode === 'moveRobber') {
    socket.emit('moveRobber', { tileIdx });
    setUIMode('idle');
  }
};

// ── Socket ────────────────────────────────────────────────────────────────────

socket.on('connect', () => {
  // sessionStorage is per-tab — avoids two same-browser tabs getting the same player
  const name = sessionStorage.getItem('catanName') || localStorage.getItem('catanName') || 'Player';
  if (roomId) socket.emit('joinRoom', { roomId, name });
});

socket.on('error', msg => showToast(msg, true));

socket.on('gameState', newState => {
  if (newState.status === 'lobby') {
    window.location.href = '/';
    return;
  }

  detectStealEvent(state, newState);

  // Auto-set UI mode based on phase change
  const isMeTurn = newState.playerIdx !== null && newState.currentPlayer === newState.playerIdx;
  if (isMeTurn) {
    if (newState.phase === 'robber') uiMode = 'moveRobber';
    else if (newState.phase === 'robber-steal') uiMode = 'stealFrom';
    else if (newState.phase === 'setup') {
      uiMode = newState.setupSubPhase === 'settlement' ? 'placeSettlement' : 'placeRoad';
    } else if (newState.pendingDevCard === 'roadBuilding') uiMode = 'placeRoad';
    else if (newState.phase === 'preRoll' || newState.phase === 'postRoll') {
      // Reset to idle when the phase becomes sane
      if (uiMode === 'moveRobber' || uiMode === 'stealFrom') uiMode = 'idle';
    }
  } else {
    if (uiMode !== 'idle') uiMode = 'idle';
  }

  state = newState;
  myIdx = state.playerIdx;
  render();
});

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!state) return;
  _rendering = true;

  const playerColors = state.players.map(p => p.color);

  // Determine interactive elements based on current phase + uiMode
  board.clearInteractive();

  if (isMyTurn()) {
    switch (uiMode) {
      case 'placeSettlement':
        board.setInteractiveVertices(validSettlementVertices());
        break;
      case 'placeCity':
        board.setInteractiveVertices(validCityVertices());
        break;
      case 'placeRoad':
        board.setInteractiveEdges(validRoadEdges());
        break;
      case 'moveRobber':
        board.setInteractiveTiles(validRobberTiles());
        break;
    }
  }

  board.render(state, playerColors);

  renderPlayers();
  renderHand();
  renderActions();
  renderLog();
  renderDice();
  renderTrade();

  // Phase label
  document.getElementById('phase-label').textContent = phaseLabel();
  document.getElementById('turn-label').textContent = state.phase !== 'ended'
    ? `${state.players[state.currentPlayer].name}'s turn`
    : '';

  _rendering = false;
}

function phaseLabel() {
  if (!state) return '';
  const p = state.phase;
  if (p === 'setup') return state.setupSubPhase === 'settlement' ? 'Setup: Place Settlement' : 'Setup: Place Road';
  if (p === 'preRoll') return 'Pre-Roll';
  if (p === 'postRoll') return 'Build / Trade';
  if (p === 'robber' || p === 'robber-steal') return 'Robber';
  if (p === 'discard') return 'Discard';
  if (p === 'ended') return '🏆 Game Over';
  return p;
}

// ── Player panels ─────────────────────────────────────────────────────────────

function renderPlayers() {
  const panel = document.getElementById('player-cards');
  panel.innerHTML = '';

  state.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-card';
    if (i === state.currentPlayer) div.classList.add('active');
    if (i === myIdx) div.classList.add('me');
    div.style.borderLeftColor = p.color;

    const vp = i === myIdx ? state.myVP : p.vp;

    div.innerHTML = `
      <div class="player-name">
        <span class="player-vp">${vp} VP</span>
        ${p.name}${i === myIdx ? ' (You)' : ''}
      </div>
      <div class="resource-row">${RESOURCES.map(r => `
        <span class="res-badge res-${r}">${p.resources[r]}</span>`).join('')}
      </div>
      <div class="special-badges">
        ${p.devCardsCount > 0 ? `<span class="badge">${p.devCardsCount} cards</span>` : ''}
        ${p.playedKnights > 0 ? `<span class="badge">${p.playedKnights} ⚔</span>` : ''}
        ${state.longestRoad.player === i ? `<span class="badge">🛤 Road</span>` : ''}
        ${state.largestArmy.player === i ? `<span class="badge">⚔ Army</span>` : ''}
      </div>`;

    // Steal button if in steal mode
    if (uiMode === 'stealFrom' && state.robbablePlayers.includes(i) && i !== myIdx) {
      const btn = document.createElement('button');
      btn.className = 'btn-primary btn-small';
      btn.style.marginTop = '6px';
      btn.textContent = 'Steal from';
      btn.addEventListener('click', () => {
        socket.emit('stealFrom', { victimIdx: i });
        setUIMode('idle');
      });
      div.appendChild(btn);
    }

    panel.appendChild(div);
  });
}

// ── Hand ──────────────────────────────────────────────────────────────────────

function renderHand() {
  if (myIdx === null) return;
  const me = state.players[myIdx];

  const resDiv = document.getElementById('resource-display');
  resDiv.innerHTML = '';
  RESOURCES.forEach(r => {
    const item = document.createElement('div');
    item.className = 'res-item' + (me.resources[r] === 0 ? ' zero' : '');
    item.title = RES_LABELS[r];
    item.innerHTML = `<span class="res-emoji">${RES_ICONS[r]}</span><span class="res-count">${me.resources[r]}</span>`;
    resDiv.appendChild(item);
  });

  const devDiv = document.getElementById('dev-card-display');
  devDiv.innerHTML = '';
  if (state.myDevCards) {
    const counts = {};
    state.myDevCards.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
    Object.entries(counts).forEach(([type, count]) => {
      const card = document.createElement('div');
      card.className = 'dev-card';
      const canPlay = type !== 'vp' && isMyTurn() && canPlayDevCard();
      card.innerHTML = `${DEV_ICONS[type] || ''} ${DEV_LABELS[type] || type}${count > 1 ? ` ×${count}` : ''}`;
      if (canPlay) {
        card.title = 'Click to play';
        card.addEventListener('click', () => playDevCard(type));
      } else {
        card.style.opacity = '0.5';
      }
      devDiv.appendChild(card);
    });
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

function renderActions() {
  const hint = document.getElementById('action-hint');
  const buttons = document.getElementById('action-buttons');
  buttons.innerHTML = '';

  if (!isMyTurn()) {
    hint.textContent = `Waiting for ${state.players[state.currentPlayer].name}…`;

    // Show discard button if I need to discard
    if (state.phase === 'discard' && myIdx in state.pendingDiscard) {
      hint.textContent = `Discard ${state.pendingDiscard[myIdx]} cards`;
      buttons.appendChild(makeBtn('Discard', () => openDiscardModal(state.pendingDiscard[myIdx])));
    }
    // Show trade response if there's an offer for me
    renderTradeResponse();
    return;
  }

  // My turn
  const p = state.players[myIdx];
  const ph = state.phase;

  if (ph === 'setup') {
    if (state.setupSubPhase === 'settlement') {
      hint.textContent = 'Click a valid vertex to place your settlement';
    } else {
      hint.textContent = 'Click an adjacent edge to place your road';
    }
    return;
  }

  if (ph === 'discard') {
    if (myIdx in state.pendingDiscard) {
      hint.textContent = `Discard ${state.pendingDiscard[myIdx]} cards`;
      buttons.appendChild(makeBtn('Choose Cards to Discard', () => openDiscardModal(state.pendingDiscard[myIdx])));
    } else {
      hint.textContent = 'Waiting for others to discard…';
    }
    return;
  }

  if (ph === 'robber') {
    hint.textContent = 'Move the robber to a new tile';
    return;
  }

  if (ph === 'robber-steal') {
    hint.textContent = 'Choose a player to steal from (see player list)';
    return;
  }

  if (state.pendingDevCard === 'roadBuilding') {
    hint.textContent = `Place ${state.pendingRoads} free road(s) — click an edge`;
    return;
  }

  if (ph === 'preRoll') {
    hint.textContent = 'Roll the dice to begin your turn';
    buttons.appendChild(makeBtn('🎲 Roll Dice', () => socket.emit('rollDice'), true));
    return;
  }

  if (ph === 'postRoll') {
    hint.textContent = '';

    if (uiMode === 'placeSettlement') {
      hint.textContent = 'Click a valid vertex to place settlement';
      buttons.appendChild(makeBtn('Cancel', () => setUIMode('idle')));
      return;
    }
    if (uiMode === 'placeRoad') {
      hint.textContent = 'Click an edge to place road';
      buttons.appendChild(makeBtn('Cancel', () => setUIMode('idle')));
      return;
    }
    if (uiMode === 'placeCity') {
      hint.textContent = 'Click your settlement to upgrade to city';
      buttons.appendChild(makeBtn('Cancel', () => setUIMode('idle')));
      return;
    }

    const canRoad = canAfford(p, {wood:1,brick:1}) && p.roadsLeft > 0;
    const canSettlement = canAfford(p, {wood:1,brick:1,sheep:1,wheat:1}) && p.settlementsLeft > 0 && hasValidSettlement();
    const canCity = canAfford(p, {wheat:2,ore:3}) && p.citiesLeft > 0 && hasOwnSettlement();
    const canDev = canAfford(p, {sheep:1,wheat:1,ore:1}) && state.devDeckCount > 0;

    buttons.appendChild(makeBtn(`🛤 Road`, () => setUIMode('placeRoad'), canRoad, !canRoad));
    buttons.appendChild(makeBtn(`🏠 Settlement`, () => setUIMode('placeSettlement'), canSettlement, !canSettlement));
    buttons.appendChild(makeBtn(`🏰 City`, () => setUIMode('placeCity'), canCity, !canCity));
    buttons.appendChild(makeBtn(`📜 Dev Card`, () => socket.emit('buyDevCard'), canDev, !canDev));
    buttons.appendChild(makeBtn('🏦 Bank Trade', () => openBankTradeModal()));
    buttons.appendChild(makeBtn('🤝 Offer Trade', () => openOfferTradeModal()));
    buttons.appendChild(makeBtn('⏭ End Turn', () => { socket.emit('endTurn'); setUIMode('idle'); }, true));

    renderTradeResponse();
  }
}

function renderTradeResponse() {
  if (!state.tradeOffer || state.tradeOffer.from === myIdx) return;
  const offer = state.tradeOffer;
  const myResponse = offer.responses[myIdx];
  if (myResponse) return; // already responded

  const giveStr = RESOURCES.filter(r => offer.give[r]).map(r => `${offer.give[r]} ${r}`).join(', ') || '–';
  const wantStr = RESOURCES.filter(r => offer.want[r]).map(r => `${offer.want[r]} ${r}`).join(', ') || '–';

  const tradeArea = document.getElementById('trade-area');
  tradeArea.classList.remove('hidden');
  const content = document.getElementById('trade-content');
  content.innerHTML = `<div class="trade-offer-box">
    <p><b>${state.players[offer.from].name}</b> offers:</p>
    <p>Gives you: <b>${giveStr}</b></p>
    <p>Wants: <b>${wantStr}</b></p>
  </div>`;
  const acceptBtn = makeBtn('Accept', () => socket.emit('respondTrade', { accept: true }));
  const rejectBtn = makeBtn('Decline', () => socket.emit('respondTrade', { accept: false }));
  rejectBtn.className = 'btn-secondary';
  content.appendChild(acceptBtn);
  content.appendChild(rejectBtn);
}

function renderTrade() {
  const tradeArea = document.getElementById('trade-area');

  if (!state.tradeOffer) {
    tradeArea.classList.add('hidden');
    return;
  }

  const offer = state.tradeOffer;

  // If I'm the offerer, show who accepted
  if (offer.from === myIdx) {
    tradeArea.classList.remove('hidden');
    const content = document.getElementById('trade-content');
    const giveStr = RESOURCES.filter(r => offer.give[r]).map(r => `${offer.give[r]} ${r}`).join(', ') || '–';
    const wantStr = RESOURCES.filter(r => offer.want[r]).map(r => `${offer.want[r]} ${r}`).join(', ') || '–';

    let html = `<div class="trade-offer-box">
      <p>Offering: <b>${giveStr}</b></p>
      <p>For: <b>${wantStr}</b></p>
    </div>`;

    const acceptors = Object.entries(offer.responses)
      .filter(([,v]) => v === 'accept')
      .map(([k]) => parseInt(k));

    if (acceptors.length > 0) {
      html += '<p>Accepted by:</p>';
      acceptors.forEach(pi => {
        html += `<div style="display:flex;gap:6px;align-items:center;margin:4px 0">
          <span>${state.players[pi].name}</span>
          <button class="btn-primary btn-small" onclick="confirmTrade(${pi})">Trade</button>
        </div>`;
      });
    } else {
      html += '<p style="color:var(--text2);font-size:12px">Waiting for responses…</p>';
    }

    html += `<button class="btn-secondary btn-small" style="margin-top:8px" onclick="cancelTrade()">Cancel</button>`;
    content.innerHTML = html;
  }
}

window.confirmTrade = (pi) => { socket.emit('confirmTrade', { withPlayer: pi }); };
window.cancelTrade = () => { socket.emit('cancelTrade'); };

// ── Log ───────────────────────────────────────────────────────────────────────

function renderLog() {
  const list = document.getElementById('log-list');
  list.innerHTML = '';
  (state.log || []).forEach(msg => {
    const li = document.createElement('li');
    li.textContent = msg;
    list.appendChild(li);
  });
}

// ── Dice ──────────────────────────────────────────────────────────────────────

function renderDice() {
  document.getElementById('die1').textContent = state.dice[0] ?? '–';
  document.getElementById('die2').textContent = state.dice[1] ?? '–';
}

// ── Valid placement helpers ───────────────────────────────────────────────────

function validSettlementVertices() {
  const verts = state.board.vertices;
  return verts
    .filter(v => {
      if (v.building !== null) return false;
      if (!v.adjacentVertices.every(avId => verts[avId].building === null)) return false;
      if (state.phase === 'postRoll') {
        return v.adjacentEdges.some(eId => state.board.edges[eId].road === myIdx);
      }
      return true;
    })
    .map(v => v.id);
}

function validCityVertices() {
  return state.board.vertices
    .filter(v => v.player === myIdx && v.building === 'settlement')
    .map(v => v.id);
}

function validRoadEdges() {
  const edges = state.board.edges;
  const verts = state.board.vertices;

  // During setup, only edges adjacent to last settlement
  if (state.phase === 'setup') {
    // Server will validate; just show all unoccupied edges adjacent to any own settlement
    return edges
      .filter(e => {
        if (e.road !== null) return false;
        return e.vertices.some(vId => {
          const v = verts[vId];
          return v.player === myIdx && v.building !== null;
        });
      })
      .map(e => e.id);
  }

  return edges
    .filter(e => {
      if (e.road !== null) return false;
      return e.vertices.some(vId => {
        const v = verts[vId];
        if (v.player === myIdx) return true;
        if (v.player !== null && v.player !== myIdx) return false;
        return v.adjacentEdges.some(aeId => aeId !== e.id && edges[aeId].road === myIdx);
      });
    })
    .map(e => e.id);
}

function validRobberTiles() {
  return state.board.tiles
    .map((_, i) => i)
    .filter(i => i !== state.robberTile);
}

function hasValidSettlement() {
  return validSettlementVertices().length > 0;
}

function hasOwnSettlement() {
  return state.board.vertices.some(v => v.player === myIdx && v.building === 'settlement');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isMyTurn() {
  return myIdx !== null && state && state.currentPlayer === myIdx;
}

function canPlayDevCard() {
  if (!isMyTurn()) return false;
  if (state.players[myIdx].hasPlayedDevCard) return false;
  const ph = state.phase;
  return ph === 'preRoll' || ph === 'postRoll';
}

function canAfford(p, cost) {
  return RESOURCES.every(r => p.resources[r] >= (cost[r] || 0));
}

let _rendering = false;
function setUIMode(mode) {
  uiMode = mode;
  if (state && !_rendering) render();
}

function makeBtn(label, onClick, primary = false, disabled = false) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = primary ? 'btn-primary btn-small' : 'btn-secondary btn-small';
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

// ── Dev card play ─────────────────────────────────────────────────────────────

function playDevCard(type) {
  if (type === 'knight') {
    socket.emit('playDevCard', { cardType: 'knight' });
    setUIMode('moveRobber');
    return;
  }
  if (type === 'roadBuilding') {
    socket.emit('playDevCard', { cardType: 'roadBuilding' });
    setUIMode('placeRoad');
    return;
  }
  if (type === 'yearOfPlenty') {
    openYearOfPlentyModal();
    return;
  }
  if (type === 'monopoly') {
    openMonopolyModal();
    return;
  }
}

// ── Modals ────────────────────────────────────────────────────────────────────

function openModal(title, contentHTML, onCancel) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-content').innerHTML = contentHTML;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-cancel').onclick = () => {
    closeModal();
    if (onCancel) onCancel();
  };
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function openDiscardModal(amount) {
  const me = state.players[myIdx];
  let html = `<p>Choose ${amount} cards to discard:</p><div class="modal-trade-grid">`;
  RESOURCES.forEach(r => {
    html += `<div class="trade-resource-row">
      <span>${RES_LABELS[r]} (${me.resources[r]})</span>
      <input type="number" id="disc-${r}" min="0" max="${me.resources[r]}" value="0">
    </div>`;
  });
  html += `</div><button class="btn-primary" id="confirm-discard">Confirm Discard</button>`;
  openModal(`Discard ${amount} Cards`, html);

  document.getElementById('confirm-discard').addEventListener('click', () => {
    const resources = {};
    RESOURCES.forEach(r => { resources[r] = parseInt(document.getElementById(`disc-${r}`).value) || 0; });
    const total = RESOURCES.reduce((s,r) => s + resources[r], 0);
    if (total !== amount) { showToast(`Must discard exactly ${amount} cards`); return; }
    socket.emit('discardResources', { resources });
    closeModal();
  });
}

function openBankTradeModal() {
  const me = state.players[myIdx];
  let html = `<p>Select resource to give and receive:</p>
  <div class="modal-trade-grid">
    <div><h4>Give (select one)</h4>
      ${RESOURCES.map(r => {
        const rate = getPortRate(r);
        return `<label style="display:flex;gap:6px;align-items:center;margin:3px 0">
          <input type="radio" name="give" value="${r}"> ${RES_LABELS[r]} (${me.resources[r]}) @ ${rate}:1
        </label>`;
      }).join('')}
    </div>
    <div><h4>Receive (select one)</h4>
      ${RESOURCES.map(r => `<label style="display:flex;gap:6px;align-items:center;margin:3px 0">
        <input type="radio" name="want" value="${r}"> ${RES_LABELS[r]}
      </label>`).join('')}
    </div>
  </div>
  <button class="btn-primary" id="confirm-bank">Trade</button>`;

  openModal('Bank Trade', html);

  document.getElementById('confirm-bank').addEventListener('click', () => {
    const give = document.querySelector('input[name="give"]:checked')?.value;
    const want = document.querySelector('input[name="want"]:checked')?.value;
    if (!give || !want) { showToast('Select both resources'); return; }
    if (give === want) { showToast('Cannot trade same resource'); return; }
    socket.emit('bankTrade', { give, want });
    closeModal();
  });
}

function openOfferTradeModal() {
  const me = state.players[myIdx];
  let html = `<div class="modal-trade-grid">
    <div>
      <h4>You Give</h4>
      ${RESOURCES.map(r => `<div class="trade-resource-row">
        <span>${RES_LABELS[r]} (${me.resources[r]})</span>
        <input type="number" id="give-${r}" min="0" max="${me.resources[r]}" value="0" style="width:48px">
      </div>`).join('')}
    </div>
    <div>
      <h4>You Want</h4>
      ${RESOURCES.map(r => `<div class="trade-resource-row">
        <span>${RES_LABELS[r]}</span>
        <input type="number" id="want-${r}" min="0" max="10" value="0" style="width:48px">
      </div>`).join('')}
    </div>
  </div>
  <button class="btn-primary" id="confirm-offer" style="margin-top:8px">Send Offer</button>`;

  openModal('Offer Trade to Players', html);

  document.getElementById('confirm-offer').addEventListener('click', () => {
    const give = {}, want = {};
    RESOURCES.forEach(r => {
      give[r] = parseInt(document.getElementById(`give-${r}`).value) || 0;
      want[r] = parseInt(document.getElementById(`want-${r}`).value) || 0;
    });
    socket.emit('offerTrade', { give, want });
    closeModal();
  });
}

function openYearOfPlentyModal() {
  let html = `<p>Choose 2 resources to gain:</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
    <div><h4 style="margin-bottom:4px">Resource 1</h4>
      <div class="resource-picker">
        ${RESOURCES.map(r => `<button data-yop="1" data-r="${r}">${r}</button>`).join('')}
      </div>
    </div>
    <div><h4 style="margin-bottom:4px">Resource 2</h4>
      <div class="resource-picker">
        ${RESOURCES.map(r => `<button data-yop="2" data-r="${r}">${r}</button>`).join('')}
      </div>
    </div>
  </div>
  <button class="btn-primary" id="confirm-yop" style="margin-top:8px">Take Resources</button>`;

  openModal('Year of Plenty', html);

  let r1 = null, r2 = null;
  document.querySelectorAll('[data-yop="1"]').forEach(b => {
    b.addEventListener('click', () => {
      r1 = b.dataset.r;
      document.querySelectorAll('[data-yop="1"]').forEach(x => x.style.background = '');
      b.style.background = 'var(--accent)';
    });
  });
  document.querySelectorAll('[data-yop="2"]').forEach(b => {
    b.addEventListener('click', () => {
      r2 = b.dataset.r;
      document.querySelectorAll('[data-yop="2"]').forEach(x => x.style.background = '');
      b.style.background = 'var(--accent)';
    });
  });

  document.getElementById('confirm-yop').addEventListener('click', () => {
    if (!r1 || !r2) { showToast('Choose both resources'); return; }
    socket.emit('playDevCard', { cardType: 'yearOfPlenty', data: { r1, r2 } });
    closeModal();
  });
}

function openMonopolyModal() {
  let html = `<p>Choose a resource to monopolize:</p>
  <div class="resource-picker" style="margin-top:8px">
    ${RESOURCES.map(r => `<button class="monopoly-btn" data-r="${r}">${RES_LABELS[r]}</button>`).join('')}
  </div>`;

  openModal('Monopoly', html);

  let chosen = null;
  document.querySelectorAll('.monopoly-btn').forEach(b => {
    b.addEventListener('click', () => {
      chosen = b.dataset.r;
      document.querySelectorAll('.monopoly-btn').forEach(x => x.style.background = '');
      b.style.background = 'var(--accent)';
      // Auto-confirm after choosing
      setTimeout(() => {
        socket.emit('playDevCard', { cardType: 'monopoly', data: { resource: chosen } });
        closeModal();
      }, 300);
    });
  });
}

function getPortRate(resource) {
  if (!state || myIdx === null) return 4;
  const ports = state.board.ports;
  const verts = state.board.vertices;
  let best = 4;
  for (const port of ports) {
    const hasPort = port.vertices.some(vId => {
      const v = verts[vId];
      return v.player === myIdx && v.building !== null;
    });
    if (hasPort) {
      if (port.type === '3:1') best = Math.min(best, 3);
      if (port.type === resource) best = Math.min(best, 2);
    }
  }
  return best;
}

// ── Steal detection ───────────────────────────────────────────────────────────

function detectStealEvent(prevState, newState) {
  if (!prevState || newState.playerIdx === null) return;
  const wasRobbing = prevState.phase === 'robber' || prevState.phase === 'robber-steal';
  if (!wasRobbing) return;

  const myI = newState.playerIdx;
  const prev = prevState.players[myI]?.resources;
  const next = newState.players[myI]?.resources;
  if (!prev || !next) return;

  const gained = RESOURCES.filter(r => next[r] > prev[r]);
  const lost   = RESOURCES.filter(r => next[r] < prev[r]);

  if (gained.length) {
    const desc = gained.map(r => `${RES_ICONS[r]}×${next[r] - prev[r]}`).join(' ');
    showToast(`You stole ${desc} 😈`);
  } else if (lost.length) {
    const desc = lost.map(r => `${RES_ICONS[r]}×${prev[r] - next[r]}`).join(' ');
    showToast(`Robbed! Lost ${desc}`, true);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%)',
    background: isError ? '#e74c3c' : '#2ecc71',
    color:'#fff', padding:'8px 18px', borderRadius:'6px', zIndex:200,
    fontSize:'14px', fontWeight:600, boxShadow:'0 2px 8px rgba(0,0,0,.4)'
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

