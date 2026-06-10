/* =====================================================================
   Envoy EMEA Quiz — LIVE multiplayer (host + players join on phones)
   Pure Node.js. No dependencies. Server-Sent Events + fetch.

   Run:   node server.js
   Host:  open the URL it prints (project this screen)
   Play:  players open  http://<that-ip>:3000/play  on their phones
   ===================================================================== */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT        = process.env.PORT || 3000;
const TIME_PER_Q  = 60;          // seconds per question
const MAX_POINTS  = 1000;
const DURATION_MS = TIME_PER_Q * 1000;

/* ---------- Questions (from https://changelog.envoy.com/) ---------- */
const QUESTIONS = [
  { q: "Which new Wi-Fi integration automatically detects on-site employees by matching MAC addresses?",
    a: ["Cisco Meraki", "Meter", "Ubiquiti", "Aruba"], correct: 1 },
  { q: "The new browser-based network connection testing tool verifies connectivity by testing each host on the…?",
    a: ["VPN", "Firewall log", "Allowlist", "DNS server"], correct: 2 },
  { q: "How often do the on-demand analytics dashboards now refresh?",
    a: ["Once a day", "Every 30–60 minutes", "Every 5 minutes", "Once a week"], correct: 1 },
  { q: "On-demand analytics dashboards now surface data from within the last…?",
    a: ["6 months", "12 months", "24 months", "36 months"], correct: 2 },
  { q: "Which Microsoft integration syncs managed device MAC addresses to eliminate manual CSV uploads?",
    a: ["Microsoft Entra", "Microsoft Intune", "Microsoft Defender", "Microsoft Teams"], correct: 1 },
  { q: "Which product area gained the ability to send follow-up messages with per-message delivery tracking?",
    a: ["Visitors", "Deliveries", "Emergency Notifications", "Rooms"], correct: 2 },
  { q: "Employee desk move requests are routed to admins through which centralized queue?",
    a: ["Move Queue", "Desk Hub", "Space Manager", "Request Inbox"], correct: 0 },
  { q: "What custom interval options were added for visitor reminder emails?",
    a: ["12, 24 or 36 hours", "24, 48 or 72 hours", "1, 2 or 3 days", "6, 12 or 24 hours"], correct: 1 },
  { q: "What is the new real-time tool for monitoring integration status called?",
    a: ["Integrations Health Dashboard", "Status Center", "Connection Monitor", "Admin Insights"], correct: 0 },
  { q: "The improved ID scanning flow adds live feedback for capturing what?",
    a: ["A visitor selfie", "Front and back of government-issued IDs", "A QR code", "A signature"], correct: 1 },
  { q: "The new Prism visitor-access integration is made by which company?",
    a: ["Building Engines", "JLL", "Brivo", "Kisi"], correct: 0 }
];

/* ---------- Game state (in memory, single game) ---------- */
const game = {
  phase: 'lobby',          // lobby | question | reveal | ended
  qIndex: -1,
  startTs: 0,
  timer: null,
  players: new Map(),      // id -> {id,name,score,choice,answered,gain,correct,res}
  hostClients: new Set()   // SSE response objects for host screens
};

let nextId = 1;

/* ---------- SSE helpers ---------- */
function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('retry: 2000\n\n');
}
function emit(res, event, data) {
  if (!res || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publicState() {
  const q = (game.phase === 'question' || game.phase === 'reveal') ? QUESTIONS[game.qIndex] : null;
  const leaderboard = [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .map(p => ({ id: p.id, name: p.name, score: p.score }));

  // distribution of chosen options (does NOT reveal which is correct)
  let distribution = null, answeredCount = 0;
  if (q) {
    distribution = [0, 0, 0, 0];
    for (const p of game.players.values()) {
      if (p.answered) {
        answeredCount++;
        if (p.choice >= 0) distribution[p.choice]++;
      }
    }
  }

  return {
    phase: game.phase,
    qIndex: game.qIndex,
    total: QUESTIONS.length,
    startTs: game.startTs,
    durationMs: DURATION_MS,
    // NOTE: correct answer is intentionally never sent to any client
    question: q ? { q: q.q, answers: q.a, index: game.qIndex } : null,
    playerCount: game.players.size,
    answeredCount,
    distribution,
    leaderboard
  };
}

function broadcast() {
  const state = publicState();
  for (const res of game.hostClients) emit(res, 'state', state);
  for (const p of game.players.values()) emit(p.res, 'state', state);
}

function sendResults() {
  // private per-player result so the correct answer is never inferable by others
  const ranked = [...game.players.values()].sort((a, b) => b.score - a.score);
  ranked.forEach((p, i) => {
    emit(p.res, 'result', {
      correct: !!p.correct,
      gain: p.gain || 0,
      score: p.score,
      rank: i + 1,
      total: game.players.size
    });
  });
}

/* ---------- Game flow ---------- */
function startQuestion(index) {
  game.qIndex = index;
  game.phase = 'question';
  game.startTs = Date.now();
  for (const p of game.players.values()) {
    p.choice = -1; p.answered = false; p.gain = 0; p.correct = false;
  }
  clearTimeout(game.timer);
  game.timer = setTimeout(reveal, DURATION_MS);
  broadcast();
}

function reveal() {
  clearTimeout(game.timer);
  game.phase = 'reveal';
  broadcast();
  sendResults();
}

function nextStep() {
  if (game.qIndex + 1 < QUESTIONS.length) startQuestion(game.qIndex + 1);
  else { game.phase = 'ended'; broadcast(); sendResults(); }
}

function resetGame() {
  // "Play again" — keep the same players, zero their scores
  clearTimeout(game.timer);
  game.phase = 'lobby';
  game.qIndex = -1;
  for (const p of game.players.values()) {
    p.score = 0; p.choice = -1; p.answered = false; p.gain = 0; p.correct = false;
  }
  broadcast();
}

function clearGame() {
  // "New game" — remove ALL players and return to an empty lobby
  clearTimeout(game.timer);
  game.phase = 'lobby';
  game.qIndex = -1;
  for (const p of game.players.values()) {
    try { if (p.res && !p.res.writableEnded) { emit(p.res, 'reset', {}); p.res.end(); } } catch (e) {}
  }
  game.players.clear();
  broadcast();
}

function recordAnswer(id, choice) {
  if (game.phase !== 'question') return;
  const p = game.players.get(id);
  if (!p || p.answered) return;
  const elapsed = Date.now() - game.startTs;
  if (elapsed > DURATION_MS) return;
  p.answered = true;
  p.choice = choice;
  const Q = QUESTIONS[game.qIndex];
  if (choice === Q.correct) {
    const remaining = Math.max(0, DURATION_MS - elapsed) / DURATION_MS;
    p.gain = Math.round(MAX_POINTS * (0.5 + 0.5 * remaining));
    p.correct = true;
    p.score += p.gain;
  }
  broadcast();
  // auto-advance to reveal once everyone has answered
  if (game.players.size > 0 && [...game.players.values()].every(x => x.answered)) reveal();
}

/* ---------- HTTP plumbing ---------- */
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

function serveFile(res, file, type) {
  fs.readFile(path.join(__dirname, 'public', file), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ---- static pages ----
  if (req.method === 'GET' && (p === '/' || p === '/host')) return serveFile(res, 'host.html', 'text/html');
  if (req.method === 'GET' && p === '/play')               return serveFile(res, 'play.html', 'text/html');
  if (req.method === 'GET' && p === '/quiz.css')           return serveFile(res, 'quiz.css', 'text/css');

  // ---- host info (join url) ----
  if (req.method === 'GET' && p === '/api/info') {
    // Derive the join URL from the request so it works both on LAN and when deployed (Render etc.)
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    const host  = req.headers['host'] || `${getLanIp()}:${PORT}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ joinUrl: `${proto}://${host}/play`, total: QUESTIONS.length, time: TIME_PER_Q }));
  }

  // ---- SSE stream ----
  if (req.method === 'GET' && p === '/events') {
    const role = url.searchParams.get('role');
    const id   = url.searchParams.get('id');
    sse(res);
    if (role === 'host') {
      game.hostClients.add(res);
      emit(res, 'state', publicState());
      req.on('close', () => game.hostClients.delete(res));
    } else {
      const player = game.players.get(id);
      if (!player) { emit(res, 'reset', {}); return; }   // server restarted / unknown -> rejoin
      player.res = res;
      emit(res, 'state', publicState());
      req.on('close', () => { if (player.res === res) player.res = null; });
    }
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 25000);
    req.on('close', () => clearInterval(ping));
    return;
  }

  // ---- player joins ----
  if (req.method === 'POST' && p === '/api/join') {
    const { name } = await readBody(req);
    const clean = String(name || '').trim().slice(0, 24);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!clean)               return res.end(JSON.stringify({ error: 'Name required' }));
    if (game.phase !== 'lobby') return res.end(JSON.stringify({ error: 'Game already started' }));
    for (const pl of game.players.values())
      if (pl.name.toLowerCase() === clean.toLowerCase())
        return res.end(JSON.stringify({ error: 'That name is taken' }));
    const id = 'p' + (nextId++);
    game.players.set(id, { id, name: clean, score: 0, choice: -1, answered: false, gain: 0, correct: false, res: null });
    broadcast();
    return res.end(JSON.stringify({ id, name: clean }));
  }

  // ---- player answers ----
  if (req.method === 'POST' && p === '/api/answer') {
    const { id, choice } = await readBody(req);
    recordAnswer(id, Number(choice));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ---- host controls ----
  if (req.method === 'POST' && p === '/api/host') {
    const { action } = await readBody(req);
    if (action === 'start' && game.phase === 'lobby' && game.players.size > 0) startQuestion(0);
    else if (action === 'reveal') reveal();
    else if (action === 'next') nextStep();
    else if (action === 'reset') resetGame();
    else if (action === 'clear') clearGame();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  const ip = getLanIp();
  console.log('\n  ┌────────────────────────────────────────────┐');
  console.log('  │   Envoy EMEA Quiz — LIVE                     │');
  console.log('  └────────────────────────────────────────────┘\n');
  console.log('  HOST screen (project this):');
  console.log(`     http://localhost:${PORT}      or   http://${ip}:${PORT}\n`);
  console.log('  PLAYERS join on their phones (same Wi-Fi):');
  console.log(`     http://${ip}:${PORT}/play\n`);
});
