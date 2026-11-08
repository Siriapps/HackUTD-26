# Avon Night Shift

HackUTD ZeroDay · EOG "Beat the Shutdown". Night-shift console for Avon's produced-water network:
detects leaks, worn pumps and pump failures from telemetry alone, prices the cheapest response to every
pump failure (trucks, early shut-ins, or nothing, with trucks shared per system), and puts the plan in front
of the operator, the lone night technician (Gemini Live on a phone) and the morning crew.

```
npm install
cp .env.example .env.local   # add GEMINI_API_KEY, DISCORD_WEBHOOK_URL
npm run dev                  # http://localhost:3000
npm test                     # reproduces every reference plan cost from the answer keys
```

Datasets live in `public/data/<folder>/` (`network.json`, `ops.json`, `telemetry.csv`). Drop the judging
`test/` folder in there and pick it from the folder switcher; nothing else changes.

Plan: [docs/PLAN.md](docs/PLAN.md) · Team workflow: [CLAUDE.md](CLAUDE.md) · Workstreams: [docs/workstreams](docs/workstreams)

© 2026 Avon Corps
