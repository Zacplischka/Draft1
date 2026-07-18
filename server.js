const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const sessions = {};

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function computeResults(session) {
  const map = {};
  session.solutions.forEach(s => { map[s.id] = { text: s.text, scores: [] }; });
  session.scores.forEach(scoreMap => {
    Object.entries(scoreMap).forEach(([id, score]) => {
      if (map[id]) map[id].scores.push(score);
    });
  });
  return Object.entries(map)
    .map(([id, d]) => ({
      id, text: d.text,
      avg: d.scores.length ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length * 10) / 10 : 0,
    }))
    .sort((a, b) => b.avg - a.avg);
}

io.on('connection', socket => {

  socket.on('create-session', ({ problem, name, cap }, cb) => {
    if (!problem || !name || !cap) return cb({ error: 'Missing fields.' });
    if (name.length > 8) return cb({ error: 'Name max 8 characters.' });

    let code;
    do { code = generateCode(); } while (sessions[code]);

    const session = {
      code,
      problem: problem.trim(),
      host: socket.id,
      cap: Math.max(1, parseInt(cap) || 8),
      participants: new Map(),
      solutions: [],
      scores: new Map(),
      status: 'step1',
    };

    session.participants.set(socket.id, { name: name.trim(), submitted: false, scored: false });
    sessions[code] = session;
    socket.join(code);
    socket.sessionCode = code;

    console.log(`[server] session created: ${code} by ${name} (socket ${socket.id})`);
    cb({ ok: true, code, problem: session.problem, count: 1, cap: session.cap });
  });

  socket.on('join-session', ({ code, name }, cb) => {
    if (!code || !name) return cb({ error: 'Missing fields.' });
    if (name.length > 8) return cb({ error: 'Name max 8 characters.' });

    const s = sessions[code.toUpperCase()];
    if (!s) return cb({ error: 'Session not found. Check the code.' });
    if (s.status !== 'step1') return cb({ error: 'Session already in progress.' });
    if (s.participants.size >= s.cap) return cb({ error: 'Session is full.' });

    for (const [, p] of s.participants) {
      if (p.name.toLowerCase() === name.trim().toLowerCase()) return cb({ error: 'Name already taken.' });
    }

    const upperCode = code.toUpperCase();
    s.participants.set(socket.id, { name: name.trim(), submitted: false, scored: false });
    socket.join(upperCode);
    socket.sessionCode = upperCode;

    console.log(`[server] ${name.trim()} joined session ${upperCode} — participants: ${s.participants.size}/${s.cap}`);
    io.to(upperCode).emit('participant-update', { count: s.participants.size, cap: s.cap });
    cb({ ok: true, problem: s.problem, count: s.participants.size, cap: s.cap });
  });

  socket.on('submit-solution', ({ text }, cb) => {
    const s = sessions[socket.sessionCode];
    if (!s) return cb({ error: 'No session.' });
    const p = s.participants.get(socket.id);
    if (!p) return cb({ error: 'Not in session.' });
    if (p.submitted) return cb({ error: 'Already submitted.' });
    if (!text || !text.trim()) return cb({ error: 'Solution cannot be empty.' });

    const sol = { id: crypto.randomUUID(), text: text.trim(), author: p.name };
    s.solutions.push(sol);
    p.submitted = true;
    console.log(`[server] solution submitted in session ${socket.sessionCode} by ${p.name} — total solutions: ${s.solutions.length}`);

    io.to(socket.sessionCode).emit('solutions-update', {
      solutions: s.solutions.map(x => ({ id: x.id, text: x.text, author: x.author })),
    });
    cb({ ok: true });
  });

  socket.on('host-combine', ({ ids }, cb) => {
    const s = sessions[socket.sessionCode];
    if (!s) return cb({ error: 'No session.' });
    if (s.host !== socket.id) return cb({ error: 'Host only.' });
    if (!ids || ids.length < 1) return cb({ error: 'Select at least one solution.' });

    const selected = s.solutions.filter(x => ids.includes(x.id));
    if (selected.length === 0) return cb({ error: 'No valid solutions selected.' });

    const combined = {
      id: crypto.randomUUID(),
      text: selected.map(x => x.text).join(' / '),
      author: 'combined',
    };

    s.solutions = s.solutions.filter(x => !ids.includes(x.id));
    s.solutions.unshift(combined);

    io.to(socket.sessionCode).emit('solutions-update', {
      solutions: s.solutions.map(x => ({ id: x.id, text: x.text, author: x.author })),
    });
    cb({ ok: true });
  });

  socket.on('start-voting', (_, cb) => {
    const s = sessions[socket.sessionCode];
    if (!s) return cb({ error: 'No session.' });
    if (s.host !== socket.id) return cb({ error: 'Host only.' });
    if (s.solutions.length === 0) return cb({ error: 'No solutions to vote on.' });

    s.status = 'step2';
    io.to(socket.sessionCode).emit('voting-started', {
      solutions: s.solutions.map(x => ({ id: x.id, text: x.text })),
    });
    cb({ ok: true });
  });

  socket.on('submit-scores', ({ scores }, cb) => {
    const s = sessions[socket.sessionCode];
    if (!s) return cb({ error: 'No session.' });
    const p = s.participants.get(socket.id);
    if (!p) return cb({ error: 'Not in session.' });
    if (p.scored) return cb({ error: 'Already scored.' });

    for (const sol of s.solutions) {
      if (scores[sol.id] == null) return cb({ error: 'Score all solutions.' });
    }

    s.scores.set(socket.id, scores);
    p.scored = true;

    const scoredIds = [...s.participants.entries()].filter(([, v]) => v.scored).map(([k]) => k);
    const done = scoredIds.length;
    const total = s.participants.size;

    console.log(`[server] voting-progress session=${socket.sessionCode} scoredIds=${JSON.stringify(scoredIds)} done=${done}/${total} phase=${s.status}`);

    io.to(socket.sessionCode).emit('voting-progress', { done, total, scoredIds });

    if (done === total) {
      s.status = 'results';
      console.log(`[server] all voted — emitting show-results for session ${socket.sessionCode}`);
      io.to(socket.sessionCode).emit('show-results', { results: computeResults(s) });
    }
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const code = socket.sessionCode;
    if (!code) return;
    const s = sessions[code];
    if (!s) return;
    s.participants.delete(socket.id);
    if (s.participants.size === 0) {
      delete sessions[code];
    } else {
      io.to(code).emit('participant-update', { count: s.participants.size, cap: s.cap });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
