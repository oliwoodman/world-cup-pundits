@AGENTS.md

# AI World Cup Pundits

A World Cup 2026 football portal where **five Chinese open-source LLMs**, each a comedic pundit with a
fictional **£1,000 bankroll**, argue about every match and bet at real odds. The scoreboard is money.
Football first (what's on, when, scores, click into a match), AI betting leaderboard on top.
Design direction: **"editorial premium"** (Fraunces serif, warm-dark muted palette, whitespace).

**👉 Read `HANDOFF.md` for the full brief** — vision, architecture, file map, credentials, the Odds API
budget, gotchas, remaining work, and the deployment plan. Quick orientation:

- **Stack:** Next.js 16 + React 19 + Tailwind v4 (this dir) on a **Convex** backend (dev deployment
  `adept-caiman-846`). Engine calls NVIDIA's OpenAI-compatible endpoint.
- **Working & verified:** durable debate engine (per-turn Workflow steps; all 5 lock), pre-kickoff cron
  dispatcher, idempotent settlement, identity-card evolution, money leaderboard, editorial portal + match
  page. `npm run dev` → localhost:3000.
- **Working & verified (added 2026-06-12):** The Odds API integration — 70 real fixtures + consensus
  odds + outright board (`convex/odds.ts`), gated score settlement (`convex/scores.ts`), credit
  hard-stop (`apiBudget` table), daily/gated crons. See HANDOFF §12.
- **Not built yet:** identity-card UI page, GSAP polish, deploy. Parked: tournament bracket viz.
  Pending the user's go-ahead: `admin:resetForLaunch` to wipe the test money race for a clean £1000 start.

## Critical gotchas (don't relearn the hard way)
- **Convex query returns type as `any` on the client** — cast every `useQuery` result to an explicit type.
- **The dev deploy key cannot write Convex env vars** (403) — humans add `NVIDIA_API_KEY`/`ODDS_API_KEY`
  in the Convex dashboard, not via `npx convex env set`.
- **Workflow component is pre-1.0** (`@convex-dev/workflow@0.4.4`): standalone `import { start }` (not a
  method); the workflow **handler must be deterministic** (no fetch/Date.now/Math.random — side effects go
  in `step.runAction`). Never reshape debate steps while a debate is in-flight (determinism violation).
- **Bankroll is derived** from the immutable `bets` ledger — never store a balance number.
- **Pundit avatars are original serif-monogram brand marks**, not emojis and not real company logos (IP).
- Convex CLI commands need network — run with sandboxing disabled in a sandboxed shell.

## Common commands
```bash
npm run dev            # Next.js dev server
npm run build          # typecheck + build
# push Convex (deploy key is in .env.local):
CONVEX_DEPLOY_KEY="$(grep CONVEX_DEPLOY_KEY .env.local | cut -d= -f2-)" npx convex dev --once
npx convex run engine:runDebateNow '{"fixtureId":"<id>"}'   # fire a debate
npx convex run leaderboard:standings                         # see the money race
```
