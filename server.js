const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const PLAYERS = [
  { id: 1, name: "Arpit", pos: "GK" },
  { id: 2, name: "Tonmoy", pos: "GK" },
  { id: 3, name: "Neeraj", pos: "GK" },
  { id: 4, name: "Tiku", pos: "GK" },
  { id: 5, name: "Dhiraj", pos: "ST" },
  { id: 6, name: "Anurjn", pos: "ST" },
  { id: 7, name: "Charchit", pos: "ST" },
  { id: 8, name: "Divyansh", pos: "ST" },
  { id: 9, name: "Abhinab", pos: "MF" },
  { id: 10, name: "Abhijit", pos: "MF" },
  { id: 11, name: "Shuvam Bhargav", pos: "MF" },
  { id: 12, name: "Rohit", pos: "MF" },
  { id: 13, name: "Yash", pos: "MF" },
  { id: 14, name: "Mrinal", pos: "MF" },
  { id: 15, name: "Milind", pos: "MF" },
  { id: 16, name: "Saurav (Mid)", pos: "MF" },
  { id: 17, name: "Rohan", pos: "DF" },
  { id: 18, name: "Sourav (Def)", pos: "DF" },
  { id: 19, name: "Amar", pos: "DF" },
  { id: 20, name: "Piyush", pos: "DF" },
  { id: 21, name: "Mayank", pos: "DF" },
  { id: 22, name: "Paul", pos: "DF" },
  { id: 23, name: "Mriduraj", pos: "DF" },
  { id: 24, name: "Shivam", pos: "DF" },
  { id: 25, name: "Abhishek", pos: "DF" },
  { id: 26, name: "Nabadeep", pos: "DF" },
  { id: 27, name: "Tanay", pos: "DF" },
  { id: 28, name: "Final Slot (DF)", pos: "DF" }
];

// Strict Quota: 1 GK, 3 DF, 2 MF, 1 ST = 7 Players Total
const SQUAD_TARGETS = { GK: 1, DF: 3, MF: 2, ST: 1 };

let gameState = {
  status: 'SUBMISSION',
  captains: { T1: null, T2: null, T3: null, T4: null }, // Player ID assigned as captain
  submissions: {
    T1: { bids: {}, locked: false, timestamp: null },
    T2: { bids: {}, locked: false, timestamp: null },
    T3: { bids: {}, locked: false, timestamp: null },
    T4: { bids: {}, locked: false, timestamp: null }
  },
  results: null
};

io.on('connection', (socket) => {
  socket.emit('state:sync', getSanitizedState());

  // Assign Captain to Team
  socket.on('captain:select', ({ teamId, playerId }) => {
    if (gameState.status === 'RESOLVED') return;
    gameState.captains[teamId] = playerId ? parseInt(playerId) : null;
    io.emit('state:sync', getSanitizedState());
  });

  // Save / Lock Bids
  socket.on('bids:submit', ({ teamId, bids, locked }) => {
    if (gameState.status === 'RESOLVED') return;
    if (!gameState.submissions[teamId]) return;

    const total = Object.values(bids).reduce((acc, v) => acc + (Number(v) || 0), 0);
    if (total > 100) return;

    gameState.submissions[teamId].bids = bids;
    gameState.submissions[teamId].locked = locked;
    gameState.submissions[teamId].timestamp = Date.now();

    io.emit('state:sync', getSanitizedState());

    const allLocked = Object.values(gameState.submissions).every(s => s.locked);
    if (allLocked) runResolutionEngine();
  });

  socket.on('admin:reset', () => {
    gameState.status = 'SUBMISSION';
    gameState.captains = { T1: null, T2: null, T3: null, T4: null };
    gameState.results = null;
    ['T1', 'T2', 'T3', 'T4'].forEach(tId => {
      gameState.submissions[tId] = { bids: {}, locked: false, timestamp: null };
    });
    io.emit('state:sync', getSanitizedState());
  });
});

function getSanitizedState() {
  const sanitizedSubmissions = {};
  for (const [tId, sub] of Object.entries(gameState.submissions)) {
    sanitizedSubmissions[tId] = {
      locked: sub.locked,
      bidCount: Object.keys(sub.bids).filter(k => sub.bids[k] > 0).length
    };
  }
  return {
    status: gameState.status,
    players: PLAYERS,
    captains: gameState.captains,
    submissions: sanitizedSubmissions,
    results: gameState.results
  };
}

function runResolutionEngine() {
  gameState.status = 'RESOLVED';

  let rosters = {
    T1: { name: "Team 1", purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T2: { name: "Team 2", purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T3: { name: "Team 3", purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T4: { name: "Team 4", purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } }
  };

  let assignedPlayers = new Set();

  // 1. Pre-assign Captains to rosters for 0 pts
  ['T1', 'T2', 'T3', 'T4'].forEach(tId => {
    const capId = gameState.captains[tId];
    if (capId) {
      const capPlayer = PLAYERS.find(p => p.id === capId);
      if (capPlayer) {
        rosters[tId].squad.push({ ...capPlayer, cost: 0, isCaptain: true });
        rosters[tId].counts[capPlayer.pos]++;
        assignedPlayers.add(capPlayer.id);
      }
    }
  });

  // 2. Flatten & sort external bids
  let flatBids = [];
  ['T1', 'T2', 'T3', 'T4'].forEach(tId => {
    const teamSub = gameState.submissions[tId];
    PLAYERS.forEach(p => {
      // Cannot bid on own captain or assigned captain
      if (assignedPlayers.has(p.id)) return;
      const amt = teamSub.bids[p.id] || 0;
      if (amt > 0) {
        flatBids.push({ teamId: tId, player: p, amount: amt, time: teamSub.timestamp });
      }
    });
  });

  flatBids.sort((a, b) => b.amount - a.amount || a.time - b.time);

  // 3. Resolve bids against strict targets
  flatBids.forEach(bid => {
    const { teamId, player, amount } = bid;
    const roster = rosters[teamId];
    const pos = player.pos;

    if (assignedPlayers.has(player.id)) return;
    if (roster.squad.length >= 7) return;
    if (roster.purse < amount) return;
    if (roster.counts[pos] >= SQUAD_TARGETS[pos]) return;

    assignedPlayers.add(player.id);
    roster.purse -= amount;
    roster.squad.push({ ...player, cost: amount, isCaptain: false });
    roster.counts[pos]++;
  });

  const unsold = PLAYERS.filter(p => !assignedPlayers.has(p.id));
  gameState.results = { rosters, unsold };
  io.emit('state:sync', getSanitizedState());
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
