'use strict';
const socket = io();

const joinCard  = document.getElementById('join-card');
const lobbyCard = document.getElementById('lobby-card');
const nameInput = document.getElementById('name-input');
const roomInput = document.getElementById('room-input');
const joinBtn   = document.getElementById('join-btn');
const startBtn  = document.getElementById('start-btn');
const copyBtn   = document.getElementById('copy-btn');
const roomTitle = document.getElementById('room-title');
const playerList= document.getElementById('player-list');
const lobbyStatus= document.getElementById('lobby-status');

let myId = null;
let hostId = null;

// Restore saved name (sessionStorage is per-tab, localStorage is cross-tab)
nameInput.value = sessionStorage.getItem('catanName') || localStorage.getItem('catanName') || '';

joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const room = roomInput.value.trim().toUpperCase();
  if (!name) { nameInput.focus(); return; }
  if (!room) { roomInput.focus(); return; }
  sessionStorage.setItem('catanName', name);  // per-tab
  localStorage.setItem('catanName', name);     // cross-tab convenience (last-used name)
  socket.emit('joinRoom', { roomId: room, name });
});

[nameInput, roomInput].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
});

startBtn.addEventListener('click', () => socket.emit('startGame'));

copyBtn.addEventListener('click', () => {
  const code = roomTitle.textContent.replace('Room: ', '');
  navigator.clipboard.writeText(code).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy Room Code'; }, 1500);
  });
});

socket.on('connect', () => { myId = socket.id; });

socket.on('roomUpdate', ({id, players, hostId: hId}) => {
  hostId = hId;
  joinCard.classList.add('hidden');
  lobbyCard.classList.remove('hidden');
  roomTitle.textContent = `Room: ${id}`;

  playerList.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = ['#e74c3c','#3498db','#2ecc71','#f39c12'][i];
    li.appendChild(dot);
    li.appendChild(document.createTextNode(p.name + (p.id === hId ? ' 👑' : '')));
    playerList.appendChild(li);
  });

  lobbyStatus.textContent = players.length < 2
    ? `Waiting for players… (${players.length}/4)`
    : `${players.length} players — host can start`;

  if (myId === hId) {
    startBtn.classList.remove('hidden');
    startBtn.disabled = players.length < 2;
  } else {
    startBtn.classList.add('hidden');
  }

  localStorage.setItem('catanRoom', id);
});

socket.on('gameState', state => {
  if (state.status === 'playing' || state.status === 'ended') {
    const code = roomInput.value.trim().toUpperCase();
    localStorage.setItem('catanRoom', code);
    window.location.href = `/game.html?room=${code}`;
  }
});

socket.on('error', msg => {
  alert(msg);
});
