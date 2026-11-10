# Team setup (5 minutes per machine)

```bash
git clone https://github.com/Siriapps/HackUTD-26.git && cd HackUTD-26
npm install
cp .env.example .env.local        # GEMINI_API_KEY at minimum; see .env.example for Photon, Discord, voice, Tiger Data
npm run dev                       # http://localhost:3000
npm test -- --run                 # must stay green
```

## Claude Code on your machine
Open `claude` inside the repo. It reads `CLAUDE.md`, `docs/PLAN.md` and your workstream brief automatically.

Install the same skill plugins once (interactive session):
```
/plugin install superpowers
/plugin install frontend-design
/plugin install impeccable
/plugin install dataviz        # charts (W2, W4)
/plugin install threejs        # W4
```

Add this to `.claude/settings.local.json` in the repo (not committed) so agents don't stall on prompts:
```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)", "Bash(npm test*)", "Bash(npx vitest*)", "Bash(npx tsc*)", "Bash(npx eslint*)",
      "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(git add*)", "Bash(git commit*)",
      "Bash(git checkout*)", "Bash(git switch*)", "Bash(git fetch*)", "Bash(git pull*)", "Bash(git push*)",
      "Bash(gh pr *)", "Bash(gh run *)"
    ]
  }
}
```

## Working agreement
- One branch per workstream: `ws/w1-data-core`, `ws/w2-ops-ui`, `ws/w3-tech-ai`, `ws/w4-twin-forecast`.
- Start a task by telling Claude: "You are workstream W2. Read CLAUDE.md and docs/workstreams/w2-ops-ui.md, then …".
- Small PRs to `main`, CI green, squash-merge. Review each other's PRs with `gh pr review`.
- `src/lib/data/types.ts` is frozen. Need a field? Open a PR labelled `contract` first and say so in the channel.
- Sync points (hours from kickoff): 1 scaffold+contract · 2.5 detection merged · 4.5 optimiser merged · 7 integration demo · 10 freeze.
- Judging day: drop the `test/` folder into `public/data/test/` (git-ignored), run `npm run dev`, pick it in the folder switcher.
