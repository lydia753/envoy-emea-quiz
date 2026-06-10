# Envoy EMEA Quiz — Live Multiplayer

A Kahoot-style quiz for the EMEA office. One person **hosts** (project the screen),
everyone else **joins from their phones** on the same office Wi-Fi.

Questions are based on the [Envoy changelog](https://changelog.envoy.com/).
No npm dependencies — pure Node.js.

## Run it

```bash
cd emea-quiz-live
node server.js
```

The terminal prints two URLs, e.g.:

```
HOST screen (project this):
   http://localhost:3000      or   http://192.168.1.42:3000

PLAYERS join on their phones (same Wi-Fi):
   http://192.168.1.42:3000/play
```

1. Open the **HOST** URL on the laptop you're projecting from.
2. Tell players to open the **/play** URL on their phones (it's shown big on the host screen too).
3. As people join, their names pop up in the lobby. Click **Start Quiz**.
4. Each question runs for **60 seconds**. Players tap an answer; faster correct answers score more (up to 1000 pts).
5. Click **Skip to results** to end a question early, or it auto-advances when the timer ends / everyone has answered.
6. Click **Next Question** to continue, and **Final Results** after the last one.

## Deploy it publicly (host + players join from anywhere)

GitHub **Pages cannot run this** — it only serves static files, and this needs a running
Node server. Push the code to GitHub, then deploy from there to a free Node host.

### Render (recommended, free)
1. Push this folder to a GitHub repo (see below).
2. Go to <https://render.com> → **New + → Web Service** → connect your GitHub repo.
   (Or **New + → Blueprint** — it auto-reads `render.yaml`.)
3. Settings (auto-filled by `render.yaml`): Runtime **Node**, Start command `node server.js`,
   Build command empty. Click **Create**.
4. After ~1 minute you get a public URL like `https://envoy-emea-quiz.onrender.com`.
   - Open that on the projector = **host screen**.
   - Players open `https://envoy-emea-quiz.onrender.com/play` on their phones — anywhere, no shared Wi-Fi needed.

> Free tier note: the service "sleeps" after ~15 min idle and takes ~30s to wake on the
> first request, and restarting wipes the in-memory game (players rejoin). Fine for a one-off
> office session. Keep it on **one instance** — the game state lives in memory, so don't scale out.

Railway, Fly.io, and Glitch work too — any host that runs `node server.js` and sets `PORT`.

### Push to GitHub
```bash
cd emea-quiz-live
git init && git add -A && git commit -m "Envoy EMEA live quiz"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## Notes

- **Same Wi-Fi required.** Players' phones must be on the same network as the host laptop.
  If a phone can't load the page, the laptop's firewall may be blocking the port — allow incoming
  connections for Node, or pick another port with `PORT=8080 node server.js`.
- **Answers are never revealed.** The correct option is computed only on the server and is never
  sent to any browser. Players see only their own right/wrong + points; the host sees the spread of
  votes (which doesn't disclose the correct one) and the leaderboard.
- **One game at a time.** It's a single shared game — perfect for one office session.
- Joining closes once the host starts. Restarting the server clears all players (they'll be asked to rejoin).

## Files

| File | Purpose |
|------|---------|
| `server.js` | Node server: game logic, scoring, SSE broadcast, questions |
| `public/host.html` | Host / projector screen |
| `public/play.html` | Player join + play screen (phones) |
| `public/quiz.css` | Shared Envoy-branded styling |

> The original single-file, pass-the-device version is still at `../emea-quiz.html`.
