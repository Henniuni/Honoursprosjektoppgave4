'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Orange'];
const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

const TILE_DISTRIBUTION = [
  'wood','wood','wood','wood',
  'brick','brick','brick',
  'sheep','sheep','sheep','sheep',
  'wheat','wheat','wheat','wheat',
  'ore','ore','ore',
  'desert'
];

const NUMBER_TOKENS = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];

const PORT_TYPES = ['3:1','3:1','3:1','3:1','wood','brick','sheep','wheat','ore'];

const DEV_DECK = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('vp'),
  ...Array(2).fill('roadBuilding'),
  ...Array(2).fill('yearOfPlenty'),
  ...Array(2).fill('monopoly')
];

const COSTS = {
  road:       { wood:1, brick:1, sheep:0, wheat:0, ore:0 },
  settlement: { wood:1, brick:1, sheep:1, wheat:1, ore:0 },
  city:       { wood:0, brick:0, sheep:0, wheat:2, ore:3 },
  devCard:    { wood:0, brick:0, sheep:1, wheat:1, ore:1 }
};

// ─── Board topology ───────────────────────────────────────────────────────────

const TILE_POSITIONS = [
  {q:0,r:-2},{q:1,r:-2},{q:2,r:-2},
  {q:-1,r:-1},{q:0,r:-1},{q:1,r:-1},{q:2,r:-1},
  {q:-2,r:0},{q:-1,r:0},{q:0,r:0},{q:1,r:0},{q:2,r:0},
  {q:-2,r:1},{q:-1,r:1},{q:0,r:1},{q:1,r:1},
  {q:-2,r:2},{q:-1,r:2},{q:0,r:2}
];

// Per-direction: which axial neighbor shares edge between corners [i,(i+1)%6]
const NEIGHBOR_DIRS = [
  {dq:1,dr:0},{dq:0,dr:1},{dq:-1,dr:1},
  {dq:-1,dr:0},{dq:0,dr:-1},{dq:1,dr:-1}
];

// [tileIndex, edgeDir] — verified border edges (clockwise from top)
const PORT_EDGE_POSITIONS = [
  [1, 4], [2, 5], [6, 0], [11, 1],
  [15, 0], [18, 1], [16, 3], [12, 2], [7, 4]
];

// ─── Board generation ─────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns a Map(tileIndex → number) where 6/8 are never placed adjacent to each other.
function generateValidNumbers(tiles) {
  const tileIndex = new Map(tiles.map((t, i) => [`${t.q},${t.r}`, i]));
  const tileAdj = tiles.map(t =>
    NEIGHBOR_DIRS
      .map(({dq, dr}) => tileIndex.get(`${t.q + dq},${t.r + dr}`))
      .filter(n => n !== undefined)
  );
  const nonDesert = tiles.map((_, i) => i).filter(i => tiles[i].type !== 'desert');
  const HOT = new Set([6, 8]);

  for (let attempt = 0; attempt < 500; attempt++) {
    const nums = shuffle(NUMBER_TOKENS);
    const assign = new Map();
    let ni = 0;
    for (const ti of nonDesert) assign.set(ti, nums[ni++]);

    let ok = true;
    for (const [ti, n] of assign) {
      if (HOT.has(n) && tileAdj[ti].some(aj => HOT.has(assign.get(aj)))) {
        ok = false;
        break;
      }
    }
    if (ok) return assign;
  }

  // Fallback (virtually never reached)
  const nums = shuffle(NUMBER_TOKENS);
  const assign = new Map();
  let ni = 0;
  for (const ti of nonDesert) assign.set(ti, nums[ni++]);
  return assign;
}

function generateBoard() {
  const tileSet = new Set(TILE_POSITIONS.map(({q,r}) => `${q},${r}`));

  const hexCenter = (q, r) => ({ x: 1.5*q, y: Math.sqrt(3)*(r + q/2) });
  const hexCorner = (cx, cy, i) => {
    const a = Math.PI/3 * i;
    return { x: +(cx + Math.cos(a)).toFixed(4), y: +(cy + Math.sin(a)).toFixed(4) };
  };

  const vertexMap = new Map();
  const edgeMap = new Map();
  let vId = 0, eId = 0;

  const tiles = TILE_POSITIONS.map(({q, r}, ti) => {
    const {x:cx, y:cy} = hexCenter(q, r);

    const vIds = Array.from({length:6}, (_, i) => {
      const {x,y} = hexCorner(cx, cy, i);
      const key = `${x},${y}`;
      if (!vertexMap.has(key)) {
        vertexMap.set(key, {
          id: vId++, x, y,
          building: null, player: null,
          adjacentTiles: [], adjacentVertices: [], adjacentEdges: []
        });
      }
      const v = vertexMap.get(key);
      if (!v.adjacentTiles.includes(ti)) v.adjacentTiles.push(ti);
      return v.id;
    });

    const eIds = Array.from({length:6}, (_, i) => {
      const sorted = [vIds[i], vIds[(i+1)%6]].sort((a,b)=>a-b);
      const key = `${sorted[0]}-${sorted[1]}`;
      if (!edgeMap.has(key)) edgeMap.set(key, {id:eId++, road:null, vertices:sorted});
      return edgeMap.get(key).id;
    });

    const borderEdges = NEIGHBOR_DIRS.map(({dq,dr}) => !tileSet.has(`${q+dq},${r+dr}`));

    return {q, r, cx, cy, type:null, number:null, hasRobber:false, vertices:vIds, edges:eIds, borderEdges};
  });

  const vertices = [...vertexMap.values()].sort((a,b)=>a.id-b.id);
  const edges    = [...edgeMap.values()].sort((a,b)=>a.id-b.id);

  for (const e of edges) {
    const [v1,v2] = e.vertices;
    vertices[v1].adjacentEdges.push(e.id);
    vertices[v2].adjacentEdges.push(e.id);
    if (!vertices[v1].adjacentVertices.includes(v2)) vertices[v1].adjacentVertices.push(v2);
    if (!vertices[v2].adjacentVertices.includes(v1)) vertices[v2].adjacentVertices.push(v1);
  }

  // Assign tile types
  const types = shuffle(TILE_DISTRIBUTION);
  let robberTile = 0;
  tiles.forEach((t, i) => {
    t.type = types[i];
    if (t.type === 'desert') { t.hasRobber = true; robberTile = i; }
  });

  // Assign number tokens — 6/8 guaranteed non-adjacent
  const numberAssign = generateValidNumbers(tiles);
  tiles.forEach((t, i) => { if (numberAssign.has(i)) t.number = numberAssign.get(i); });

  // Assign ports
  const portTypes = shuffle(PORT_TYPES);
  const ports = PORT_EDGE_POSITIONS.map(([ti, dir], i) => {
    const tile = tiles[ti];
    return { type: portTypes[i], vertices: [tile.vertices[dir], tile.vertices[(dir+1)%6]] };
  });

  return {tiles, vertices, edges, ports, robberTile};
}

// ─── Game state factory ───────────────────────────────────────────────────────

function createGame(playerList) {
  const {tiles, vertices, edges, ports, robberTile} = generateBoard();
  const n = playerList.length;
  const devDeck = shuffle(DEV_DECK);

  // Setup order: 0..n-1 then n-1..0
  const setupOrder = [...Array(n).keys(), ...[...Array(n).keys()].reverse()];

  return {
    players: playerList.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: COLORS[i],
      colorName: COLOR_NAMES[i],
      resources: {wood:0,brick:0,sheep:0,wheat:0,ore:0},
      devCards: [],        // private, only sent to owner
      devCardsCount: 0,
      playedKnights: 0,
      hasPlayedDevCard: false,
      roadsLeft: 15,
      settlementsLeft: 5,
      citiesLeft: 4,
      vp: 0               // public VP (not counting hidden vp cards)
    })),
    board: {tiles, vertices, edges, ports},
    robberTile,
    devDeck,
    phase: 'setup',        // setup | preRoll | postRoll | robber | discard | ended
    setupOrder,
    setupStep: 0,          // index into setupOrder
    setupSubPhase: 'settlement', // settlement | road
    currentPlayer: 0,
    dice: [null, null],
    longestRoad: {player: null, length: 4},
    largestArmy: {player: null, size: 2},
    pendingDiscard: {},    // playerIdx -> cardsToDiscard
    robbablePlayers: [],
    pendingDevCard: null,  // 'roadBuilding' | 'yearOfPlenty' | 'monopoly'
    pendingRoads: 0,
    tradeOffer: null,
    winner: null,
    log: []
  };
}

// ─── Game logic helpers ───────────────────────────────────────────────────────

function log(game, msg) {
  game.log.unshift(msg);
  if (game.log.length > 50) game.log.length = 50;
}

function canAfford(player, cost) {
  return RESOURCES.every(r => player.resources[r] >= (cost[r] || 0));
}

function deduct(player, cost) {
  RESOURCES.forEach(r => { player.resources[r] -= (cost[r] || 0); });
}

function grant(player, res) {
  RESOURCES.forEach(r => { player.resources[r] += (res[r] || 0); });
}

function totalResources(player) {
  return RESOURCES.reduce((s, r) => s + player.resources[r], 0);
}

function isValidSettlementPlacement(game, vertexId) {
  const v = game.board.vertices[vertexId];
  if (v.building !== null) return false;
  // Distance rule: no adjacent vertex can have a building
  return v.adjacentVertices.every(avId => game.board.vertices[avId].building === null);
}

function isValidRoadPlacement(game, edgeId, playerIdx, isSetupRoad, setupVertexId) {
  const e = game.board.edges[edgeId];
  if (e.road !== null) return false;

  if (isSetupRoad) {
    // Must be adjacent to the just-placed settlement
    return e.vertices.includes(setupVertexId);
  }

  const p = game.players[playerIdx];
  // Must be adjacent to own road, settlement, or city — not blocked by opponent
  return e.vertices.some(vId => {
    const v = game.board.vertices[vId];
    // Own building on vertex
    if (v.player === playerIdx) return true;
    // Own road on adjacent edge (and vertex not blocked by opponent)
    if (v.player !== null && v.player !== playerIdx) return false;
    return v.adjacentEdges.some(aeId => aeId !== edgeId && game.board.edges[aeId].road === playerIdx);
  });
}

function getPortRate(game, playerIdx, resource) {
  let best = 4;
  for (const port of game.board.ports) {
    if (port.vertices.some(vId => {
      const v = game.board.vertices[vId];
      return v.player === playerIdx && v.building !== null;
    })) {
      if (port.type === '3:1') best = Math.min(best, 3);
      if (port.type === resource) best = Math.min(best, 2);
    }
  }
  return best;
}

function computeVP(game, playerIdx) {
  const p = game.players[playerIdx];
  let vp = 0;
  // Buildings
  for (const v of game.board.vertices) {
    if (v.player === playerIdx) {
      vp += v.building === 'city' ? 2 : 1;
    }
  }
  // Special cards
  if (game.longestRoad.player === playerIdx) vp += 2;
  if (game.largestArmy.player === playerIdx) vp += 2;
  // VP dev cards (public only when winning)
  const vpCards = p.devCards.filter(c => c === 'vp').length;
  return { public: vp, total: vp + vpCards };
}

function updateSpecialCards(game) {
  // Longest road
  game.players.forEach((_, pi) => {
    const len = longestRoadLength(game, pi);
    if (len > game.longestRoad.length) {
      if (game.longestRoad.player !== pi) {
        log(game, `${game.players[pi].name} takes Longest Road (${len})`);
      }
      game.longestRoad = {player: pi, length: len};
    }
  });

  // Largest army
  game.players.forEach((p, pi) => {
    if (p.playedKnights > game.largestArmy.size) {
      if (game.largestArmy.player !== pi) {
        log(game, `${p.name} takes Largest Army (${p.playedKnights} knights)`);
      }
      game.largestArmy = {player: pi, size: p.playedKnights};
    }
  });
}

function longestRoadLength(game, playerIdx) {
  const playerEdges = new Set(
    game.board.edges.filter(e => e.road === playerIdx).map(e => e.id)
  );
  if (playerEdges.size === 0) return 0;

  let maxLen = 0;

  function dfs(vId, visitedEdges) {
    let best = 0;
    for (const eId of game.board.vertices[vId].adjacentEdges) {
      if (!playerEdges.has(eId) || visitedEdges.has(eId)) continue;
      const e = game.board.edges[eId];
      const nextV = e.vertices[0] === vId ? e.vertices[1] : e.vertices[0];
      const nextVert = game.board.vertices[nextV];
      // Opponent settlement/city blocks the road
      if (nextVert.player !== null && nextVert.player !== playerIdx) continue;
      visitedEdges.add(eId);
      const len = 1 + dfs(nextV, visitedEdges);
      if (len > best) best = len;
      visitedEdges.delete(eId);
    }
    return best;
  }

  for (const eId of playerEdges) {
    const e = game.board.edges[eId];
    for (const vId of e.vertices) {
      const visited = new Set();
      const len = dfs(vId, visited);
      if (len > maxLen) maxLen = len;
    }
  }

  return maxLen;
}

function checkWin(game) {
  for (let i = 0; i < game.players.length; i++) {
    const {total} = computeVP(game, i);
    if (total >= 10) {
      game.winner = i;
      game.phase = 'ended';
      log(game, `🏆 ${game.players[i].name} wins!`);
      return true;
    }
  }
  return false;
}

function distributeResources(game, roll) {
  const grants = {};
  game.players.forEach((_, i) => grants[i] = {wood:0,brick:0,sheep:0,wheat:0,ore:0});

  for (const tile of game.board.tiles) {
    if (tile.number !== roll || tile.hasRobber) continue;
    for (const vId of tile.vertices) {
      const v = game.board.vertices[vId];
      if (v.player === null) continue;
      const amount = v.building === 'city' ? 2 : 1;
      grants[v.player][tile.type] += amount;
    }
  }

  game.players.forEach((p, i) => {
    grant(p, grants[i]);
    const total = RESOURCES.reduce((s, r) => s + grants[i][r], 0);
    if (total > 0) {
      const parts = RESOURCES.filter(r => grants[i][r] > 0)
        .map(r => `${grants[i][r]} ${r}`).join(', ');
      log(game, `${p.name} receives ${parts}`);
    }
  });
}

function advanceSetup(game) {
  game.setupStep++;
  if (game.setupStep >= game.setupOrder.length) {
    // Setup complete
    game.phase = 'preRoll';
    game.currentPlayer = 0;
    log(game, 'Setup complete! Game begins.');
    return;
  }
  game.currentPlayer = game.setupOrder[game.setupStep];
  game.setupSubPhase = 'settlement';
  log(game, `${game.players[game.currentPlayer].name}'s turn to place`);
}

function collectSetupResources(game, vertexId, playerIdx) {
  const v = game.board.vertices[vertexId];
  for (const ti of v.adjacentTiles) {
    const tile = game.board.tiles[ti];
    if (tile.type !== 'desert') {
      game.players[playerIdx].resources[tile.type]++;
      log(game, `${game.players[playerIdx].name} collects 1 ${tile.type}`);
    }
  }
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

const rooms = {};

function getRoomState(roomId, forPlayer) {
  const room = rooms[roomId];
  if (!room) return null;
  if (!room.game) {
    return { id: roomId, players: room.players, status: 'lobby' };
  }

  const g = room.game;
  const state = {
    status: g.phase === 'ended' ? 'ended' : 'playing',
    phase: g.phase,
    setupSubPhase: g.setupSubPhase,
    setupStep: g.setupStep,
    currentPlayer: g.currentPlayer,
    dice: g.dice,
    players: g.players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      colorName: p.colorName,
      resources: p.resources,
      devCardsCount: p.devCards.length,
      playedKnights: p.playedKnights,
      hasPlayedDevCard: p.hasPlayedDevCard,
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
      vp: computeVP(g, i).public
    })),
    myDevCards: null,
    board: g.board,
    robberTile: g.robberTile,
    longestRoad: g.longestRoad,
    largestArmy: g.largestArmy,
    pendingDiscard: g.pendingDiscard,
    robbablePlayers: g.robbablePlayers,
    pendingDevCard: g.pendingDevCard,
    pendingRoads: g.pendingRoads,
    tradeOffer: g.tradeOffer,
    winner: g.winner,
    log: g.log,
    devDeckCount: g.devDeck.length,
    playerIdx: forPlayer !== undefined ? forPlayer : null
  };

  // Give each player their own dev cards
  if (forPlayer !== undefined) {
    state.myDevCards = g.players[forPlayer].devCards;
    state.myVP = computeVP(g, forPlayer).total;
  }

  return state;
}

function broadcastState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.players.forEach((p, i) => {
    const state = getRoomState(roomId, i);
    io.to(p.id).emit('gameState', state);
  });
}

// ─── Socket handlers ──────────────────────────────────────────────────────────

io.on('connection', socket => {
  let currentRoom = null;
  let playerIdx = null;

  socket.on('joinRoom', ({roomId, name}) => {
    if (!name || !roomId) return;
    roomId = roomId.toUpperCase().trim();
    name = name.trim().slice(0, 20);

    if (!rooms[roomId]) {
      rooms[roomId] = { id: roomId, players: [], game: null };
    }

    const room = rooms[roomId];

    if (room.game) {
      // Allow reconnection: match by name
      const existingIdx = room.game.players.findIndex(p => p.name === name);
      if (existingIdx === -1) {
        socket.emit('error', 'Game already in progress');
        return;
      }
      // Reconnect: update socket id and send current state
      room.game.players[existingIdx].id = socket.id;
      room.players[existingIdx].id = socket.id;
      currentRoom = roomId;
      playerIdx = existingIdx;
      socket.join(roomId);
      socket.emit('gameState', getRoomState(roomId, existingIdx));
      return;
    }

    if (room.players.length >= 4) {
      socket.emit('error', 'Room is full');
      return;
    }

    currentRoom = roomId;
    playerIdx = room.players.length;
    room.players.push({ id: socket.id, name });
    socket.join(roomId);

    io.to(roomId).emit('roomUpdate', {
      id: roomId,
      players: room.players,
      status: 'lobby',
      hostId: room.players[0].id
    });
  });

  socket.on('startGame', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || room.players[0].id !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }
    if (room.game) return;

    room.game = createGame(room.players);
    log(room.game, `${room.game.players[0].name}'s turn to place`);
    broadcastState(currentRoom);
  });

  // ── Setup placement ──

  socket.on('placeSettlement', ({vertexId}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g) return;

    if (g.phase === 'setup') {
      if (g.currentPlayer !== playerIdx) return socket.emit('error', 'Not your turn');
      if (g.setupSubPhase !== 'settlement') return socket.emit('error', 'Place road first');
      if (!isValidSettlementPlacement(g, vertexId)) return socket.emit('error', 'Invalid placement');

      const v = g.board.vertices[vertexId];
      v.building = 'settlement';
      v.player = playerIdx;
      g.players[playerIdx].settlementsLeft--;

      // Remember which vertex was placed for road adjacency check
      g._lastSetupVertex = vertexId;
      g.setupSubPhase = 'road';

      // Round 2: collect resources after placing settlement
      if (g.setupStep >= g.players.length) {
        collectSetupResources(g, vertexId, playerIdx);
      }

      log(g, `${g.players[playerIdx].name} placed a settlement`);
      broadcastState(currentRoom);

    } else if (g.phase === 'postRoll') {
      if (g.currentPlayer !== playerIdx) return socket.emit('error', 'Not your turn');
      if (!canAfford(g.players[playerIdx], COSTS.settlement)) return socket.emit('error', 'Cannot afford settlement');
      if (g.players[playerIdx].settlementsLeft === 0) return socket.emit('error', 'No settlements left');
      if (!isValidSettlementPlacement(g, vertexId)) return socket.emit('error', 'Invalid placement');
      // Must be connected to own road
      const v = g.board.vertices[vertexId];
      const connected = v.adjacentEdges.some(eId => g.board.edges[eId].road === playerIdx);
      if (!connected) return socket.emit('error', 'Must connect to your road');

      deduct(g.players[playerIdx], COSTS.settlement);
      v.building = 'settlement';
      v.player = playerIdx;
      g.players[playerIdx].settlementsLeft--;
      updateSpecialCards(g);
      log(g, `${g.players[playerIdx].name} built a settlement`);
      if (!checkWin(g)) broadcastState(currentRoom);
      else broadcastState(currentRoom);
    }
  });

  socket.on('placeRoad', ({edgeId}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g) return;

    if (g.phase === 'setup') {
      if (g.currentPlayer !== playerIdx) return socket.emit('error', 'Not your turn');
      if (g.setupSubPhase !== 'road') return socket.emit('error', 'Place settlement first');
      if (!isValidRoadPlacement(g, edgeId, playerIdx, true, g._lastSetupVertex)) return socket.emit('error', 'Must be adjacent to your settlement');

      const e = g.board.edges[edgeId];
      e.road = playerIdx;
      g.players[playerIdx].roadsLeft--;
      log(g, `${g.players[playerIdx].name} placed a road`);
      advanceSetup(g);
      broadcastState(currentRoom);

    } else if (g.phase === 'postRoll' || g.pendingDevCard === 'roadBuilding') {
      if (g.currentPlayer !== playerIdx) return socket.emit('error', 'Not your turn');

      if (g.pendingDevCard === 'roadBuilding') {
        if (!isValidRoadPlacement(g, edgeId, playerIdx, false, null)) return socket.emit('error', 'Invalid road placement');
        g.board.edges[edgeId].road = playerIdx;
        g.players[playerIdx].roadsLeft--;
        g.pendingRoads--;
        log(g, `${g.players[playerIdx].name} placed a free road`);
        if (g.pendingRoads === 0) g.pendingDevCard = null;
        updateSpecialCards(g);
        broadcastState(currentRoom);
        return;
      }

      if (!canAfford(g.players[playerIdx], COSTS.road)) return socket.emit('error', 'Cannot afford road');
      if (g.players[playerIdx].roadsLeft === 0) return socket.emit('error', 'No roads left');
      if (!isValidRoadPlacement(g, edgeId, playerIdx, false, null)) return socket.emit('error', 'Invalid road placement');

      deduct(g.players[playerIdx], COSTS.road);
      g.board.edges[edgeId].road = playerIdx;
      g.players[playerIdx].roadsLeft--;
      updateSpecialCards(g);
      log(g, `${g.players[playerIdx].name} built a road`);
      if (!checkWin(g)) broadcastState(currentRoom);
      else broadcastState(currentRoom);
    }
  });

  socket.on('upgradeCity', ({vertexId}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'postRoll' || g.currentPlayer !== playerIdx) return;

    const v = g.board.vertices[vertexId];
    if (v.player !== playerIdx || v.building !== 'settlement') return socket.emit('error', 'No settlement there');
    if (!canAfford(g.players[playerIdx], COSTS.city)) return socket.emit('error', 'Cannot afford city');
    if (g.players[playerIdx].citiesLeft === 0) return socket.emit('error', 'No cities left');

    deduct(g.players[playerIdx], COSTS.city);
    v.building = 'city';
    g.players[playerIdx].citiesLeft--;
    g.players[playerIdx].settlementsLeft++;
    updateSpecialCards(g);
    log(g, `${g.players[playerIdx].name} built a city`);
    if (!checkWin(g)) broadcastState(currentRoom);
    else broadcastState(currentRoom);
  });

  // ── Dice ──

  socket.on('rollDice', () => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'preRoll' || g.currentPlayer !== playerIdx) return;

    const d1 = Math.ceil(Math.random()*6);
    const d2 = Math.ceil(Math.random()*6);
    const roll = d1 + d2;
    g.dice = [d1, d2];
    g.players[playerIdx].hasPlayedDevCard = false; // reset for next turn
    log(g, `${g.players[playerIdx].name} rolled ${roll} (${d1}+${d2})`);

    if (roll === 7) {
      // Discard phase for players with >7 cards
      const pending = {};
      g.players.forEach((p, i) => {
        const total = totalResources(p);
        if (total > 7) pending[i] = Math.floor(total / 2);
      });

      if (Object.keys(pending).length > 0) {
        g.pendingDiscard = pending;
        g.phase = 'discard';
        log(g, 'Players with >7 resources must discard half');
      } else {
        g.phase = 'robber';
        g.robbablePlayers = [];
        log(g, `${g.players[playerIdx].name} must move the robber`);
      }
    } else {
      distributeResources(g, roll);
      g.phase = 'postRoll';
    }

    broadcastState(currentRoom);
  });

  // ── Robber ──

  socket.on('moveRobber', ({tileIdx}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g) return;
    if (g.currentPlayer !== playerIdx) return;

    const isRobberPhase = g.phase === 'robber';
    const isKnight = g.pendingDevCard === 'knight';
    if (!isRobberPhase && !isKnight) return;
    if (tileIdx === g.robberTile) return socket.emit('error', 'Must move robber to a different tile');

    g.board.tiles[g.robberTile].hasRobber = false;
    g.board.tiles[tileIdx].hasRobber = true;
    g.robberTile = tileIdx;
    log(g, `${g.players[playerIdx].name} moved the robber`);

    // Find players to steal from (adjacent settlements, not self)
    const adjacentPlayers = new Set();
    for (const vId of g.board.tiles[tileIdx].vertices) {
      const v = g.board.vertices[vId];
      if (v.player !== null && v.player !== playerIdx) {
        if (totalResources(g.players[v.player]) > 0) {
          adjacentPlayers.add(v.player);
        }
      }
    }

    if (adjacentPlayers.size === 0) {
      if (isKnight) finishKnight(g);
      else g.phase = 'postRoll';
    } else if (adjacentPlayers.size === 1) {
      // Auto-steal
      const victim = [...adjacentPlayers][0];
      stealFrom(g, playerIdx, victim);
      log(g, `${g.players[playerIdx].name} stole from ${g.players[victim].name}`);
      if (isKnight) finishKnight(g);
      else g.phase = 'postRoll';
    } else {
      g.robbablePlayers = [...adjacentPlayers];
      g.phase = 'robber-steal';
      if (isKnight) g._knightPendingSteal = true;
    }

    broadcastState(currentRoom);
  });

  socket.on('stealFrom', ({victimIdx}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'robber-steal' || g.currentPlayer !== playerIdx) return;
    if (!g.robbablePlayers.includes(victimIdx)) return socket.emit('error', 'Cannot steal from that player');

    stealFrom(g, playerIdx, victimIdx);
    log(g, `${g.players[playerIdx].name} stole from ${g.players[victimIdx].name}`);
    g.robbablePlayers = [];

    if (g._knightPendingSteal) {
      delete g._knightPendingSteal;
      finishKnight(g);
    } else {
      g.phase = 'postRoll';
    }

    broadcastState(currentRoom);
  });

  function stealFrom(g, thief, victim) {
    const pool = [];
    RESOURCES.forEach(r => {
      for (let i = 0; i < g.players[victim].resources[r]; i++) pool.push(r);
    });
    if (pool.length === 0) return;
    const stolen = pool[Math.floor(Math.random() * pool.length)];
    g.players[victim].resources[stolen]--;
    g.players[thief].resources[stolen]++;
  }

  function finishKnight(g) {
    g.pendingDevCard = null;
    g.phase = g.dice[0] ? 'postRoll' : 'preRoll';
    updateSpecialCards(g);
  }

  // ── Discard ──

  socket.on('discardResources', ({resources}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'discard') return;
    if (!(playerIdx in g.pendingDiscard)) return socket.emit('error', 'You do not need to discard');

    const required = g.pendingDiscard[playerIdx];
    const discarding = RESOURCES.reduce((s, r) => s + (resources[r] || 0), 0);
    if (discarding !== required) return socket.emit('error', `Must discard exactly ${required} cards`);

    for (const r of RESOURCES) {
      if ((resources[r] || 0) > g.players[playerIdx].resources[r]) return socket.emit('error', 'Insufficient resources');
    }

    RESOURCES.forEach(r => { g.players[playerIdx].resources[r] -= (resources[r] || 0); });
    delete g.pendingDiscard[playerIdx];
    log(g, `${g.players[playerIdx].name} discarded ${required} cards`);

    if (Object.keys(g.pendingDiscard).length === 0) {
      g.phase = 'robber';
      g.robbablePlayers = [];
      log(g, `${g.players[g.currentPlayer].name} must move the robber`);
    }

    broadcastState(currentRoom);
  });

  // ── Dev cards ──

  socket.on('buyDevCard', () => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'postRoll' || g.currentPlayer !== playerIdx) return;
    if (!canAfford(g.players[playerIdx], COSTS.devCard)) return socket.emit('error', 'Cannot afford dev card');
    if (g.devDeck.length === 0) return socket.emit('error', 'Dev card deck empty');

    deduct(g.players[playerIdx], COSTS.devCard);
    const card = g.devDeck.pop();
    g.players[playerIdx].devCards.push(card);
    log(g, `${g.players[playerIdx].name} bought a dev card`);
    broadcastState(currentRoom);
  });

  socket.on('playDevCard', ({cardType, data}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g) return;
    if (g.currentPlayer !== playerIdx) return socket.emit('error', 'Not your turn');
    if (g.players[playerIdx].hasPlayedDevCard) return socket.emit('error', 'Already played a dev card this turn');

    const cardIdx = g.players[playerIdx].devCards.indexOf(cardType);
    if (cardIdx === -1) return socket.emit('error', 'Card not in hand');
    if (cardType === 'vp') return socket.emit('error', 'VP cards are automatic');

    // Knight can be played before or after rolling, others only postRoll
    if (cardType !== 'knight' && g.phase !== 'postRoll') return socket.emit('error', 'Can only play dev cards after rolling');

    g.players[playerIdx].devCards.splice(cardIdx, 1);
    g.players[playerIdx].hasPlayedDevCard = true;

    if (cardType === 'knight') {
      g.players[playerIdx].playedKnights++;
      g.pendingDevCard = 'knight';
      log(g, `${g.players[playerIdx].name} played a Knight`);
      updateSpecialCards(g);
    } else if (cardType === 'roadBuilding') {
      g.pendingDevCard = 'roadBuilding';
      g.pendingRoads = Math.min(2, g.players[playerIdx].roadsLeft);
      log(g, `${g.players[playerIdx].name} played Road Building`);
      if (g.pendingRoads === 0) g.pendingDevCard = null;
    } else if (cardType === 'yearOfPlenty') {
      const {r1, r2} = data || {};
      if (!RESOURCES.includes(r1) || !RESOURCES.includes(r2)) return socket.emit('error', 'Invalid resources');
      g.players[playerIdx].resources[r1]++;
      g.players[playerIdx].resources[r2]++;
      log(g, `${g.players[playerIdx].name} played Year of Plenty: +1 ${r1}, +1 ${r2}`);
    } else if (cardType === 'monopoly') {
      const {resource} = data || {};
      if (!RESOURCES.includes(resource)) return socket.emit('error', 'Invalid resource');
      let total = 0;
      g.players.forEach((p, i) => {
        if (i !== playerIdx) {
          total += p.resources[resource];
          g.players[playerIdx].resources[resource] += p.resources[resource];
          p.resources[resource] = 0;
        }
      });
      log(g, `${g.players[playerIdx].name} played Monopoly on ${resource}: gained ${total}`);
    }

    if (!checkWin(g)) broadcastState(currentRoom);
    else broadcastState(currentRoom);
  });

  // ── Trading ──

  socket.on('bankTrade', ({give, want}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'postRoll' || g.currentPlayer !== playerIdx) return;

    if (!RESOURCES.includes(give) || !RESOURCES.includes(want) || give === want) {
      return socket.emit('error', 'Invalid trade');
    }

    const rate = getPortRate(g, playerIdx, give);
    if (g.players[playerIdx].resources[give] < rate) {
      return socket.emit('error', `Need ${rate} ${give}`);
    }

    g.players[playerIdx].resources[give] -= rate;
    g.players[playerIdx].resources[want]++;
    log(g, `${g.players[playerIdx].name} traded ${rate} ${give} → 1 ${want}`);
    broadcastState(currentRoom);
  });

  socket.on('offerTrade', ({give, want}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'postRoll' || g.currentPlayer !== playerIdx) return;

    for (const r of RESOURCES) {
      if ((give[r] || 0) > g.players[playerIdx].resources[r]) {
        return socket.emit('error', 'Insufficient resources for trade offer');
      }
    }

    g.tradeOffer = { from: playerIdx, give, want, responses: {}, accepted: null };
    log(g, `${g.players[playerIdx].name} offered a trade`);
    broadcastState(currentRoom);
  });

  socket.on('respondTrade', ({accept}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || !g.tradeOffer) return;
    if (g.tradeOffer.from === playerIdx) return;

    const offer = g.tradeOffer;
    // Check if player can fulfill the want side
    if (accept) {
      for (const r of RESOURCES) {
        if ((offer.want[r] || 0) > g.players[playerIdx].resources[r]) {
          return socket.emit('error', 'You cannot fulfill this trade');
        }
      }
      offer.responses[playerIdx] = 'accept';
    } else {
      offer.responses[playerIdx] = 'reject';
    }

    broadcastState(currentRoom);
  });

  socket.on('confirmTrade', ({withPlayer}) => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || !g.tradeOffer || g.tradeOffer.from !== playerIdx) return;

    const offer = g.tradeOffer;
    if (offer.responses[withPlayer] !== 'accept') return socket.emit('error', 'Player did not accept');

    const me = g.players[playerIdx];
    const them = g.players[withPlayer];
    for (const r of RESOURCES) {
      me.resources[r] -= (offer.give[r] || 0);
      them.resources[r] += (offer.give[r] || 0);
      them.resources[r] -= (offer.want[r] || 0);
      me.resources[r] += (offer.want[r] || 0);
    }

    log(g, `${me.name} and ${them.name} completed a trade`);
    g.tradeOffer = null;
    broadcastState(currentRoom);
  });

  socket.on('cancelTrade', () => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || !g.tradeOffer || g.tradeOffer.from !== playerIdx) return;
    g.tradeOffer = null;
    broadcastState(currentRoom);
  });

  // ── End turn ──

  socket.on('endTurn', () => {
    if (!currentRoom || playerIdx === null) return;
    const room = rooms[currentRoom];
    const g = room.game;
    if (!g || g.phase !== 'postRoll' || g.currentPlayer !== playerIdx) return;
    if (g.pendingDevCard) return socket.emit('error', 'Finish your card action first');
    if (g.tradeOffer) g.tradeOffer = null;

    g.currentPlayer = (g.currentPlayer + 1) % g.players.length;
    g.phase = 'preRoll';
    g.dice = [null, null];
    g.players[g.currentPlayer].hasPlayedDevCard = false;
    log(g, `${g.players[g.currentPlayer].name}'s turn`);
    broadcastState(currentRoom);
  });

  // ── Disconnect ──

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;
    if (!room.game) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[currentRoom];
        return;
      }
      io.to(currentRoom).emit('roomUpdate', {
        id: currentRoom,
        players: room.players,
        status: 'lobby',
        hostId: room.players[0].id
      });
    } else {
      log(room.game, `${room.game.players[playerIdx].name} disconnected`);
      broadcastState(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Catan server running on http://localhost:${PORT}`));
