require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Spotify Token ───────────────────────────────────────────────────────────

let spotifyToken = null;
let tokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken;
  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  spotifyToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

// ─── Spotify OAuth ────────────────────────────────────────────────────────────

app.get('/auth/login', (req, res) => {
  const scopes = 'user-library-read playlist-read-private playlist-read-collaborative';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: `${req.protocol}://${req.get('host')}/auth/callback`,
    state: req.query.state || '',
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  try {
    const creds = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokens = await tokenRes.json();

    // Récupérer le profil
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    // Redirect vers le frontend avec les tokens en query
    const params = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      display_name: profile.display_name || profile.id,
      state: state || '',
    });
    res.redirect(`${FRONTEND_URL}/game.html?${params}`);
  } catch (e) {
    res.redirect(`${FRONTEND_URL}/?error=auth_failed`);
  }
});

// ─── Spotify API Proxy ────────────────────────────────────────────────────────

// Récupérer les titres d'une playlist publique
app.get('/api/playlist/:id/tracks', async (req, res) => {
  try {
    const token = await getSpotifyToken();
    const r = await fetch(
      `https://api.spotify.com/v1/playlists/${req.params.id}/tracks?limit=50&fields=items(track(id,name,artists,preview_url,album(images)))`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const tracks = (data.items || [])
      .map(i => i.track)
      .filter(t => t && t.preview_url);
    res.json({ tracks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Récupérer les liked songs d'un user (avec son token OAuth)
app.get('/api/me/liked', async (req, res) => {
  const token = req.headers['x-spotify-token'];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const r = await fetch(
      'https://api.spotify.com/v1/me/tracks?limit=50',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const tracks = (data.items || [])
      .map(i => i.track)
      .filter(t => t && t.preview_url);
    res.json({ tracks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Récupérer les playlists d'un user
app.get('/api/me/playlists', async (req, res) => {
  const token = req.headers['x-spotify-token'];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const r = await fetch(
      'https://api.spotify.com/v1/me/playlists?limit=20',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ playlists: data.items || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rooms & Game Logic ───────────────────────────────────────────────────────

const rooms = new Map();

function generateCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildTrackPool(room) {
  let pool = [];
  room.players.forEach((p) => {
    if (p.tracks && p.tracks.length > 0) {
      const picked = shuffle(p.tracks).slice(0, 8);
      picked.forEach(t => pool.push({ ...t, ownerSocketId: p.id, ownerName: p.name }));
    }
  });
  return shuffle(pool).slice(0, room.settings.rounds);
}

function startGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.pool = buildTrackPool(room);
  if (room.pool.length === 0) {
    io.to(roomCode).emit('error', { msg: 'Aucun titre avec preview audio trouvé dans les playlists !' });
    return;
  }
  room.currentIdx = 0;
  room.phase = 'playing';
  room.players.forEach(p => { p.score = 0; });
  io.to(roomCode).emit('game_started', { totalRounds: room.pool.length });
  sendRound(roomCode);
}

function sendRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.currentIdx >= room.pool.length) {
    endGame(roomCode);
    return;
  }
  const track = room.pool[room.currentIdx];
  room.roundAnswers = {};
  room.roundDeadline = Date.now() + room.settings.timerSecs * 1000;

  // Envoyer les infos du round (sans révéler le owner)
  io.to(roomCode).emit('new_round', {
    roundNum: room.currentIdx + 1,
    totalRounds: room.pool.length,
    trackId: track.id,
    previewUrl: track.preview_url,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
    timerSecs: room.settings.timerSecs,
  });

  // Timer auto
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => {
    resolveRound(roomCode, true);
  }, room.settings.timerSecs * 1000 + 1000);
}

function resolveRound(roomCode, timedOut = false) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }

  const track = room.pool[room.currentIdx];
  const answers = room.roundAnswers;

  // Calculer les points
  const correctPlayers = [];
  room.players.forEach(p => {
    if (p.id === track.ownerSocketId) return; // le owner ne joue pas ce round
    const guess = answers[p.id];
    if (guess === track.ownerSocketId) {
      p.score += 10;
      correctPlayers.push(p.id);
    }
  });

  io.to(roomCode).emit('round_result', {
    ownerSocketId: track.ownerSocketId,
    ownerName: track.ownerName,
    trackName: track.name,
    artists: track.artists.map(a => a.name).join(', '),
    albumArt: track.album?.images?.[0]?.url || null,
    correctPlayers,
    answers,
    scores: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
    timedOut,
  });

  room.currentIdx++;
}

function endGame(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.phase = 'ended';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(roomCode).emit('game_over', { scores: sorted.map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score })) });
}

// ─── Socket.io Events ─────────────────────────────────────────────────────────

const PLAYER_COLORS = ['#1DB954','#E91E63','#FF6B35','#7C4DFF','#00BCD4','#FF9800'];

io.on('connection', (socket) => {

  // Créer une salle
  socket.on('create_room', ({ name, settings }) => {
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      phase: 'lobby',
      settings: {
        rounds: settings?.rounds || 10,
        timerSecs: settings?.timer || 30,
      },
      players: [{
        id: socket.id,
        name: name || 'Hôte',
        color: PLAYER_COLORS[0],
        score: 0,
        tracks: [],
        ready: false,
      }],
      pool: [],
      currentIdx: 0,
      roundAnswers: {},
      roundTimer: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room_created', { code, room: sanitizeRoom(room), playerId: socket.id });
  });

  // Rejoindre une salle
  socket.on('join_room', ({ code, name }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) return socket.emit('error', { msg: 'Salle introuvable.' });
    if (room.phase !== 'lobby') return socket.emit('error', { msg: 'Partie déjà en cours.' });
    if (room.players.length >= 6) return socket.emit('error', { msg: 'Salle pleine (6 joueurs max).' });
    if (room.players.find(p => p.id === socket.id)) return;

    const player = {
      id: socket.id,
      name: name || 'Joueur',
      color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
      score: 0,
      tracks: [],
      ready: false,
    };
    room.players.push(player);
    socket.join(code.toUpperCase());
    socket.data.roomCode = code.toUpperCase();
    socket.emit('room_joined', { room: sanitizeRoom(room), playerId: socket.id });
    io.to(code.toUpperCase()).emit('player_joined', { player: sanitizePlayer(player), players: room.players.map(sanitizePlayer) });
  });

  // Soumettre sa playlist / ses tracks
  socket.on('submit_tracks', ({ tracks }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.tracks = tracks;
    player.ready = true;
    io.to(socket.data.roomCode).emit('player_ready', {
      playerId: socket.id,
      playerName: player.name,
      trackCount: tracks.length,
      players: room.players.map(sanitizePlayer),
    });
  });

  // Lancer la partie (host seulement)
  socket.on('start_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.host !== socket.id) return socket.emit('error', { msg: 'Seul l\'hôte peut lancer.' });
    if (room.players.length < 2) return socket.emit('error', { msg: 'Il faut au moins 2 joueurs.' });
    startGame(socket.data.roomCode);
  });

  // Répondre à un round
  socket.on('guess', ({ guessedId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'playing') return;
    const track = room.pool[room.currentIdx];
    if (!track) return;
    if (socket.id === track.ownerSocketId) return; // le owner ne répond pas
    if (room.roundAnswers[socket.id] !== undefined) return; // déjà répondu
    room.roundAnswers[socket.id] = guessedId;

    io.to(socket.data.roomCode).emit('player_guessed', { playerId: socket.id });

    // Si tous ont répondu, résoudre
    const eligiblePlayers = room.players.filter(p => p.id !== track.ownerSocketId);
    const allAnswered = eligiblePlayers.every(p => room.roundAnswers[p.id] !== undefined);
    if (allAnswered) resolveRound(socket.data.roomCode);
  });

  // Passer au round suivant (host)
  socket.on('next_round', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.host !== socket.id) return;
    sendRound(socket.data.roomCode);
  });

  // Rejouer
  socket.on('restart_game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.host !== socket.id) return;
    room.phase = 'lobby';
    room.players.forEach(p => { p.ready = false; p.tracks = []; p.score = 0; });
    io.to(socket.data.roomCode).emit('game_restarted', { room: sanitizeRoom(room) });
  });

  // Déconnexion
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }
    if (room.host === socket.id) room.host = room.players[0].id;
    io.to(code).emit('player_left', { playerId: socket.id, players: room.players.map(sanitizePlayer), newHost: room.host });
  });
});

function sanitizeRoom(room) {
  return {
    code: room.code,
    host: room.host,
    phase: room.phase,
    settings: room.settings,
    players: room.players.map(sanitizePlayer),
  };
}

function sanitizePlayer(p) {
  return { id: p.id, name: p.name, color: p.color, score: p.score, ready: p.ready, trackCount: (p.tracks || []).length };
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));
