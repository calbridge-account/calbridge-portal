# BOOTSTRAP.md - Project Context

_Read this first. It tells you everything you need to get up to speed._

## What This Is

A Node.js/Express web server. Currently minimal — one route, one file. Being built out into a proper structure.

## Stack

- **Runtime:** Node.js v22
- **Framework:** Express 5.x
- **Package manager:** npm

## Current State

- `index.js` — single entry point, Express app, one `GET /` route
- No project structure yet (planned — see below)
- No dev tooling yet (planned)

## Planned Structure (not yet implemented)

```
src/
  app.js       ← Express app setup
  server.js    ← entry point (listen)
  routes/
    index.js   ← route definitions
```

## Planned Scripts

| Script | Command |
|--------|---------|
| `npm start` | `node src/server.js` |
| `npm run dev` | `node --watch src/server.js` |

## Planned Improvements

- Port from `process.env.PORT || 3000`
- `express.json()` middleware
- Basic error handler
- `GET /health` endpoint

## How to Run (current)

```bash
node index.js
# → Server running on port 3000
```

## Key Facts

- Owner: Abe (Abraham Curry) — abe@teamcalbridge.com
- Git: initialized, commits attributed to Abraham Curry
- `.gitignore`: covers `.env`, keys, `node_modules`, `dist`, logs, `.openclaw/`

## Workflow Rules (Abe's preferences)

- Inspect before changing
- Propose plans first
- Prefer small reversible edits
- Verify after changes
- Never destructive without asking
