# Code-Clash: Arena of Algorithms

A real-time 1v1 competitive coding game where solving algorithm puzzles attacks the opponent's tower. Faster, correct code = higher damage. Features health bars, spells (hints), and a global ranked leaderboard.

## Quick Start

```bash
# Clone and start all services
git clone <repo>
cd code-clash
docker-compose up

# Web app: http://localhost:3000
# API: http://localhost:3001
# Judge Service: http://localhost:3002
```

## Architecture

- **Web**: React + Tailwind + Monaco Editor
- **Mobile**: Flutter + Flame Engine
- **Backend**: Node.js + Express + Socket.io
- **Database**: PostgreSQL + Redis
- **Judge**: Docker sandboxed code execution

## Development

See `implementation_plan.md` for detailed phased approach and architecture overview.
# codeclash
