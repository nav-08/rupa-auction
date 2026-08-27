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
  { id: 28, name: "Omesh", pos: "DF" }
];

const SQUAD_TARGETS = { GK: 1, DF: 3, MF: 2, ST: 1 };

let gameState = {
  teams: {
    T1: { id: "T1", name: "Team 1", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T2: { id: "T2", name: "Team 2", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T3: { id: "T3", name: "Team 3", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
    T4: { id: "T4", name: "Team 4", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } }
  },
  currentLot: null, // { player, currentBid, highBidderTeamId, highBidderName, passes: [] }
  timer: null,
  timeLeft: 60,
  soldHistory: []
};

let timerInterval = null;

function broadcastState() {
  io.emit('state:sync', {
    teams: gameState.teams,
    currentLot: gameState.currentLot,
    timeLeft: gameState.timeLeft,
    soldHistory: gameState.soldHistory,
    players: PLAYERS
  });
}

function startTimer() {
  clearInterval(timerInterval);
  gameState.timeLeft = 60;
  timerInterval = setInterval(() => {
    gameState.timeLeft--;
    if (gameState.timeLeft <= 0) {
      clearInterval(timerInterval);
      hammerDown();
    } else {
      io.emit('timer:tick', gameState.timeLeft);
    }
  }, 1000);
}

function hammerDown() {
  clearInterval(timerInterval);
  if (!gameState.currentLot) return;

  const { player, currentBid, highBidderTeamId } = gameState.currentLot;

  if (highBidderTeamId && currentBid > 0) {
    const team = gameState.teams[highBidderTeamId];
    team.purse -= currentBid;
    team.squad.push({ ...player, cost: currentBid, isCaptain: false });
    team.counts[player.pos]++;

    gameState.soldHistory.push({
      player,
      teamId: highBidderTeamId,
      teamName: team.name,
      cost: currentBid,
      status: 'SOLD'
    });
  } else {
    gameState.soldHistory.push({
      player,
      teamId: null,
      teamName: 'Unsold',
      cost: 0,
      status: 'UNSOLD'
    });
  }

  gameState.currentLot = null;
  gameState.timeLeft = 60;
  broadcastState();
}

io.on('connection', (socket) => {
  socket.emit('state:sync', {
    teams: gameState.teams,
    currentLot: gameState.currentLot,
    timeLeft: gameState.timeLeft,
    soldHistory: gameState.soldHistory,
    players: PLAYERS
  });

  // Captain Login & Auto Team Assignment
  socket.on('captain:claim', ({ playerId }) => {
    const pId = parseInt(playerId);
    const player = PLAYERS.find(p => p.id === pId);
    if (!player) return;

    // Check if already captain
    for (const team of Object.values(gameState.teams)) {
      if (team.captain && team.captain.id === pId) {
        socket.emit('error:msg', 'This player is already a registered captain.');
        return;
      }
    }

    // Find next open team
    const openTeam = Object.values(gameState.teams).find(t => !t.captain);
    if (!openTeam) {
      socket.emit('error:msg', 'All 4 Captain slots are filled.');
      return;
    }

    openTeam.captain = player;
    openTeam.name = `${player.name}'s Team`;
    openTeam.squad.push({ ...player, cost: 0, isCaptain: true });
    openTeam.counts[player.pos]++;

    socket.emit('captain:assigned', { teamId: openTeam.id, captain: player });
    broadcastState();
  });

  // Admin puts player up for bid
  socket.on('admin:start_lot', ({ playerId }) => {
    if (gameState.currentLot) return;
    const player = PLAYERS.find(p => p.id === parseInt(playerId));
    if (!player) return;

    gameState.currentLot = {
      player,
      currentBid: 0,
      highBidderTeamId: null,
      highBidderName: null,
      passes: []
    };

    startTimer();
    broadcastState();
  });

  // Place Incremental Bid
  socket.on('bid:place', ({ teamId, increment }) => {
    if (!gameState.currentLot) return;
    const team = gameState.teams[teamId];
    if (!team) return;

    const player = gameState.currentLot.player;
    const nextBid = gameState.currentLot.currentBid === 0 ? Math.max(1, increment) : gameState.currentLot.currentBid + increment;

    // Validation 1: Squad Full
    if (team.squad.length >= 7) {
      socket.emit('error:msg', 'Your squad is already full (7 players).');
      return;
    }

    // Validation 2: Position Full
    if (team.counts[player.pos] >= SQUAD_TARGETS[player.pos]) {
      socket.emit('error:msg', `You have already satisfied your quota for ${player.pos}.`);
      return;
    }

    // Validation 3: Budget check
    if (team.purse < nextBid) {
      socket.emit('error:msg', 'Insufficient points remaining.');
      return;
    }

    // Validation 4: Must leave at least 0 points (or reserve for future slots)
    const unfilledSlots = 7 - team.squad.length;
    if (team.purse - nextBid < (unfilledSlots - 1) * 0) {
      socket.emit('error:msg', 'Bid exceeds maximum purse safety limit.');
      return;
    }

    gameState.currentLot.currentBid = nextBid;
    gameState.currentLot.highBidderTeamId = team.id;
    gameState.currentLot.highBidderName = team.name;
    gameState.currentLot.passes = []; // reset passes on new bid

    startTimer(); // Reset 1-minute countdown
    broadcastState();
  });

  // Captain Passes
  socket.on('bid:pass', ({ teamId }) => {
    if (!gameState.currentLot) return;
    if (!gameState.currentLot.passes.includes(teamId)) {
      gameState.currentLot.passes.push(teamId);
    }

    const activeCaptains = Object.values(gameState.teams).filter(t => t.captain);
    if (activeCaptains.length > 0 && gameState.currentLot.passes.length >= activeCaptains.length) {
      hammerDown();
    } else {
      broadcastState();
    }
  });

  // Admin Force Hammer
  socket.on('admin:hammer', () => {
    hammerDown();
  });

  // Admin Reset
  socket.on('admin:reset', () => {
    clearInterval(timerInterval);
    gameState = {
      teams: {
        T1: { id: "T1", name: "Team 1", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
        T2: { id: "T2", name: "Team 2", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
        T3: { id: "T3", name: "Team 3", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } },
        T4: { id: "T4", name: "Team 4", captain: null, purse: 100, squad: [], counts: { GK: 0, DF: 0, MF: 0, ST: 0 } }
      },
      currentLot: null,
      timer: null,
      timeLeft: 60,
      soldHistory: []
    };
    broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Live Auction Server running on port ${PORT}`));
