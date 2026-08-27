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

const TEAMS = [
  { id: "T1", name: "Team 1" },
  { id: "T2", name: "Team 2" },
  { id: "T3", name: "Team 3" },
  { id: "T4", name: "Team 4" }
];

const QUOTA_RULES = {
  GK: { min: 1, max: 1 },
  ST: { min: 1, max: 1 },
  DF: { min: 2, max: 3 },
  MF: { min: 2, max: 3 }
};

let gameState = {
  status: 'SUBMISSION',
  teams: TEAMS,
  players: PLAYERS,
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
    gameState.results = null;
    TEAMS.forEach(t => {
      gameState.submissions[t.id] = { bids: {}, locked: false, timestamp: null };
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
    teams: gameState.teams,
    players: gameState.players,
    submissions: sanitizedSubmissions,
    results: gameState.results
  };
}

function runResolutionEngine() {
  gameState.status = 'RESOLVED';
  let flatBids = [];

  TEAMS.forEach(t => {
    const teamSub = gameState.submissions[t.id];
    PLAYERS.forEach(p => {
      const amt = teamSub.bids[p.id] || 0;
      if (amt > 0) {
        flatBids.push({ teamId: t.id, player: p, amount: amt, time: teamSub.timestamp });
      }
    });
  });

  flatBids.sort((a, b) => b.amount - a.amount || a.time - b.time);

  let rosters = {
    T1: { info: TEAMS[0], purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T2: { info: TEAMS[1], purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T3: { info: TEAMS[2], purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T4: { info: TEAMS[3], purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } }
  };

  let assignedPlayers = new Set();

  flatBids.forEach(bid => {
    const { teamId, player, amount } = bid;
    const roster = rosters[teamId];
    const pos = player.pos;

    if (assignedPlayers.has(player.id)) return;
    if (roster.squad.length >= 7) return;
    if (roster.purse < amount) return;
    if (roster.counts[pos] >= QUOTA_RULES[pos].max) return;

    assignedPlayers.add(player.id);
    roster.purse -= amount;
    roster.squad.push({ ...player, cost: amount });
    roster.counts[pos]++;
  });

  const unsold = PLAYERS.filter(p => !assignedPlayers.has(p.id));
  gameState.results = { rosters, unsold };
  io.emit('state:sync', getSanitizedState());
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));