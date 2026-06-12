# AI World Cup Pundits — Handover

A complete brief for continuing this project in a **new chat**. Read it top to bottom. It supersedes
all earlier versions. Last updated mid-session, June 2026 (tournament is live).

---

## 1. The vision

A **football portal** for World Cup 2026 where **five Chinese open-source LLMs** — each a comedic
"pundit" with a fictional **£1,000 bankroll** — argue about every match and place **bets at real
bookmaker odds**. The single scoreboard is **money**: who grows their £1,000 the most, who goes bust.

- **Football first**: what games are on, when, scores, group tables, click into a match — with the AI
  betting leaderboard as the layer on top.
- **The AI is the content engine**: ~30 min before kickoff the five argue (and influence each other),
  then each locks a winner + scoreline + confidence + bets. Plus a constant ambient **Touchline** chat.
- **Tone**: fun and chaotic, but the site must feel **premium** — "editorial premium" (Fraunces serif,
  warm-dark palette, whitespace, hairline rules). Must work great on a phone.
- **Content angle**: Instagram (the chat-style arguing screen-records as vertical video).

**The 5 pundits** (live NVIDIA-hosted slugs; personality drives betting style and `baseRisk`):

| Pundit | key | Model slug | Character | Colour | baseRisk |
|---|---|---|---|---|---|
| DeepSeek | `deepseek` | `deepseek-ai/deepseek-v4-flash` | The Quant — cold, value-only | `#38bdf8` | 22 |
| Kimi | `kimi` | `moonshotai/kimi-k2.6` | The Degenerate — all-in chaos | `#f97316` | 90 |
| GLM | `glm` | `z-ai/glm-5.1` | The Professor — smug, base rates | `#a855f7` | 30 |
| MiniMax | `minimax` | `minimaxai/minimax-m2.7` | The Contrarian — fades favourites | `#ef4444` | 65 |
| Qwen | `qwen` | `qwen/qwen3.5-397b-a17b` | The Diplomat — hedges, then one spicy take | `#22c55e` | 40 |

Avatars are **original serif-monogram brand marks** (`components/PunditMark.tsx`), NOT emojis and NOT
real company logos (IP-safe).

---

## 2. Current status — everything below is BUILT, verified, and builds clean

| Area | Status |
|---|---|
| Next.js 16 + React 19 + Tailwind v4 app | ✅ |
| Convex backend (dev deployment `adept-caiman-846`) | ✅ |
| Durable debate engine (Workflow, per-turn retryable steps, all 5 lock) | ✅ |
| Pre-kickoff cron dispatcher (fires debate ~30 min before KO, once) | ✅ |
| Settlement (idempotent 1X2 / correct-score / totals; voids unparseable) | ✅ |
| Identity-card evolution (real `riskDial` from baseRisk + behaviour; mood; posture) | ✅ |
| **The Odds API** — real fixtures + odds + outright board + gated scores + credit hard-stop | ✅ |
| **Money leaderboard / pundit strip / fixtures / match page / group wall-chart** | ✅ |
| **Identity-card page** `/pundit/[key]` (card + risk-dial gauge + ledger + calls) | ✅ |
| **Outright ante** — each pundit backs a Cup winner, **capped at 50% of bankroll** | ✅ |
| **The Dossier** — FIFA rank + form + GNews news + TheSportsDB star signs, fed to debates + shown | ✅ |
| **Decision trace** — each pundit names the one factor that swung them | ✅ |
| **Touchline** — constant ambient group-chat (1-min cron), grounded in the real ledger | ✅ |
| **About page** `/about`, **favicon** (gold £), **Vercel Analytics**, themed scrollbars | ✅ |
| Deploy to Vercel + production Convex | ⛔ not done |
| Weather feed | ⛔ parked (needs venue data — see §6/§11) |

**Current live state** (after a clean reset + the ante): 72 real fixtures (70 with odds; 2 are
backfilled completed games). Pundits: DeepSeek £1000 (risk 22, no Cup bet), MiniMax £1000 (risk 65,
no bet), Qwen £950 (risk 46, backs **France** £50), GLM £925 (risk 44, backs **Portugal** £75), Kimi
£500 (risk 100, backs **Norway** £500). The Odds API: **492/500 credits** left.

---

## 3. Architecture & data flow

```
Cron (5 min) → dispatcher.scheduleUpcomingDebates → scheduler.runAt(KO−30m) → startDebateForFixture
                                                                                  → start(engine.debateWorkflow)
engine.debateWorkflow (durable steps):
   dossier.assembleForFixture → createDebate → [R1 ×5] → [R2 ×5] → [Lock ×5] → finishDebate
   each turn = its own retryable internalAction calling NVIDIA; messages written incrementally
Result → scores.syncScores (gated cron) → settlement.settleFixture → identity.evolveAll
Touchline: cron (1 min) → banter.tick → one pundit posts a grounded line
Odds: crons → odds.syncFixtures (/events), odds.syncOdds (/odds + outright), scores.syncScores (/scores)
Frontend (Next.js, Convex useQuery, reactive) reads it all. Bankroll is DERIVED from the bets ledger.
```

- **Money is never stored as a number.** `bankroll = 1000 − Σstakes + Σpayouts(won/void)`, computed in
  `leaderboard.standings`. Settlement only flips bet rows; nothing drifts.
- **The workflow handler must be deterministic** — no fetch/Date.now/Math.random in the handler body;
  all side effects go in `step.runAction` targets. Do NOT reshape the debate steps while a debate is
  in-flight (≈30-min pre-KO window) — it crashes that debate. (The dossier step is step 0.)

---

## 4. The Convex backend (`world-cup-pundits/convex/`)

| File | What it holds |
|---|---|
| `schema.ts` | Tables: `models`, `identityCards`, `fixtures` (+`oddsSnapshot`,+`dossier`), `debates`, `debateMessages`, `predictions` (+`keyFactor`), `bets` (+`note`), `apiBudget`, `banter`. Idempotency via `dedupeKey` + `by_dedupe`. |
| `pundits.ts` | The 5 pundit definitions incl. `baseRisk`; `baseRiskFor(key)`. |
| `seed.ts` | `seed.run` — idempotent seed of pundits + cards (won't re-run once seeded). |
| `engine.ts` | **The engine.** `debateWorkflow` (durable); `runOneTurn`/`runLockTurn` (NVIDIA calls); `getTurnContext` (assembles the prompt: COMMON+persona+`stateLine`(mood/risk)+match context+`buildBriefing`+`dossierBlock`); idempotent `lockPrediction`(+`keyFactor`)/`placeBet`(+`note`); **`buildBriefing`** (the shared real-ledger context: money race **with each pundit's Cup pick**, your position, results, "100+ matches, pace it" framing); **outright ante** `runOutrightAnte` (50% cap, concurrent, idempotent `outright_ante:<id>`, calls `evolveAll` after) + `getAnteContext`; `runDebateNow`; `briefingPreview` (public — inspect exactly what a pundit sees); exports `callModel`. |
| `dispatcher.ts` | `scheduleUpcomingDebates` (cron) + `startDebateForFixture` (runs at KO−30m, once). |
| `crons.ts` | 5-min dispatcher · daily `/events` · 2× daily `/odds` (AM incl. outright) · 30-min gated `/scores` · **1-min `banter.tick`**. |
| `odds.ts` | The Odds API. `oddsFetch` (guarded fetch + credit gauge + hard-stop <50), `syncFixtures` (free), `syncOdds` (consensus h2h/totals + outright board), `status` query, public `runSync*` triggers. |
| `scores.ts` | Gated `/scores` → settle. **Also upserts completed games we never had** (`/events` only lists upcoming, so openers can be missing). `findOrCreateFixture`. Public `runSyncScores {force?}` for backfill. |
| `settlement.ts` | `settleFixture`/`enterResult` (idempotent), `settleOutright(winner, eliminated[])`, tolerant `decideBet`. |
| `identity.ts` | `evolveAll` — recompute posture/mood + **real `riskDial`** (baseRisk + share-of-bankroll staked + longshot-chasing + tilt/desperation). Public `identity.refresh` trigger. |
| `dossier.ts` | **The Dossier.** `assembleForFixture` (step 0 of the workflow): FIFA rank (hardcoded `FIFA_RANK`), form (computed from our results), news (**GNews**, sequential to dodge rate limit), talisman **star sign** (**TheSportsDB**, hardcoded `TALISMAN` per team + zodiac calc), astro `funFact`. `runAssemble` trigger. |
| `banter.ts` | **The Touchline.** `tick` (one pundit posts, grounded in the **real ledger** — everyone's bankroll + actual Cup pick + open bets — with "never invent" instruction), `context`, `post`, `recent` (feed), public `runTick`, `clear`. |
| `groups.ts` | `list` — reconstructs the 12 groups from fixtures via **union-find** (the 4 teams in a group all play each other), live mini-tables from results, **official A–L letters via `GROUP_LETTER`** anchor map (Mexico=A, Canada=B, Brazil=C, USA=D, Germany=E, Netherlands=F, Belgium=G, Spain=H, France=I, Argentina=J, Portugal=K, England=L). |
| `leaderboard.ts` | `standings` — derived bankroll + P&L + identity + `backing` (Cup pick), sorted. |
| `fixtures.ts` / `match.ts` / `pundit.ts` / `debates.ts` | Read queries for the portal / match page / pundit card / debate transcripts. `match.detail` returns the fixture (incl. `dossier`), debate, transcript, predictions (incl. `keyFactor`), bets, roster. `pundit.detail` returns model + card + derived bankroll/rank + bet ledger + outrights + calls. |
| `admin.ts` | `resetForLaunch {confirm:"RESET"}` — wipe debates/bets/predictions + sample fixtures, reset cards to **baseRisk** (not 50). Destructive. |
| `probes.ts` | `probeAll` / `probeFootballFixtures` — external-API connectivity tests. |
| `workflows.ts` / `convex.config.ts` | The `@convex-dev/workflow` singleton + component registration. |

---

## 5. The frontend (`app/`, `components/`, `lib/`)

- `app/layout.tsx` — global **sticky header** (wordmark → home, "How it works" pill → `/about`),
  `max-w-6xl` to align with the home content, `<Analytics/>` (Vercel). Fonts: Fraunces + Geist + Geist Mono.
- `app/page.tsx` — the portal (`max-w-6xl`): hero · **`PunditStrip`** (5 across the top, ranked, with
  Cup pick) · a 2-col grid of **[ Schedule | Groups ] tabs** (Schedule default; Schedule has an
  **Upcoming/Past** segmented sub-control with live counts) **+ the `Touchline` side rail**.
- `app/match/[fixtureId]/page.tsx` — header · **"The Dossier"** panel (sourced rows: FIFA / talismen /
  form / weather / on-the-wire) · the verdict (each pundit's call + bets + **`↳ leaned on` decision-trace
  chip**) · the argument transcript. Pre-debate shows **"Awaiting the council"**; a finished game with no
  debate shows **"No verdict on the record"** (we didn't get to it in time).
- `app/pundit/[key]/page.tsx` — the identity card: hero (mark, mood, **`RiskDial` gauge**, bankroll, P&L,
  rank, posture) · stat strip · ethos · "Backing for the Cup" (with the pick's rationale `note`) ·
  the ledger (tap a match bet → match page) · recent calls (✓ landed / ✗ missed).
- `app/about/page.tsx` — what it is, the five, how a verdict is made, **what they know (sourced)**, the money.
- `components/`: `PunditStrip`, `GroupBoard`, `Touchline`, `FixtureList` (takes `filter="upcoming"|"past"`),
  `PunditMark`, `RiskDial` (SVG semicircle gauge).
- `lib/format.ts` — `codeFor`, `monogramFor`, `ordinal`, `shortDate`, money/time formatters.
- Design tokens + themed scrollbars in `app/globals.css`. Favicon: `app/icon.svg` (gold serif £).

---

## 6. External data sources & API keys

All keys are **server-side Convex env vars set in the dashboard** (the dev deploy key CANNOT write
env vars — humans add them in **Dashboard → Settings → Environment Variables**). All verified working.

| Source | Env var | Used for | Notes |
|---|---|---|---|
| NVIDIA | `NVIDIA_API_KEY` | the LLM pundits | OpenAI-compatible `integrate.api.nvidia.com` |
| The Odds API | `ODDS_API_KEY` | fixtures, odds, scores | 500 credits/mo, hard-stop at 50 (see §9) |
| GNews | `GNEWS_API_KEY` | dossier headlines | free 100/day |
| TheSportsDB | `THESPORTSDB_KEY` | talisman birthdays → star signs | free tier |
| API-Football | `API_FOOTBALL_KEY` | **(parked)** | ⚠️ **free plan only covers seasons 2022–2024** — WC2026 is paywalled, so injuries/lineups/venue are NOT available unless upgraded. We pivoted form to our own results. |
| Open-Meteo | *(none — keyless)* | **(weather, parked)** | needs a venue→city map per fixture, which was going to come from API-Football. Blocked by the above. |

---

## 7. Environment & credentials

- **Convex dev deployment** `adept-caiman-846` — Cloud `https://adept-caiman-846.convex.cloud`,
  Dashboard `https://dashboard.convex.dev/d/adept-caiman-846`.
- `.env.local` (gitignored): `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`,
  and the dev **`CONVEX_DEPLOY_KEY`** (lets the CLI push without interactive login).
- ⚠️ The deploy key can run **public** functions only; it gets a 403 (`RunInternalActions`) on internal
  ones — so every cron's internal action has a thin **public `run*` wrapper** for CLI/dashboard testing.

---

## 8. How to run / admin commands

```bash
cd world-cup-pundits
npm run dev                       # Next.js → localhost:3000
npm run build                     # typecheck + build the whole app (CI gate)

# Push Convex changes (deploy key already in .env.local):
CONVEX_DEPLOY_KEY="$(grep CONVEX_DEPLOY_KEY .env.local | cut -d= -f2-)" npx convex dev --once
```
Convex commands need network; in a sandboxed shell run them with sandboxing disabled. Prefix each with
`CONVEX_DEPLOY_KEY="$(grep CONVEX_DEPLOY_KEY .env.local | cut -d= -f2-)"`. Useful public functions:

```bash
npx convex run leaderboard:standings            # the money race
npx convex run odds:status                      # credits + fixture/odds counts
npx convex run odds:runSyncFixtures             # /events (free)
npx convex run odds:runSyncOdds '{"withOutright":true}'   # /odds snapshot + board
npx convex run scores:runSyncScores '{"force":true}'      # backfill + settle results
npx convex run engine:runOutrightAnte           # pundits pick a Cup winner (50% cap, idempotent)
npx convex run engine:runDebateNow '{"fixtureId":"<id>"}' # fire a match debate now
npx convex run dossier:runAssemble '{"fixtureId":"<id>"}' # build a match dossier
npx convex run engine:briefingPreview '{"fixtureId":"<id>","modelKey":"kimi"}'  # see EXACTLY what a pundit is fed
npx convex run banter:runTick                   # post one Touchline line
npx convex run banter:clear                     # wipe the Touchline feed
npx convex run identity:refresh                 # recompute risk dials/moods now
npx convex run admin:resetForLaunch '{"confirm":"RESET"}'  # DESTRUCTIVE clean slate
npx convex run probes:probeAll                  # test the external API keys
```

---

## 9. The Odds API budget (500 credits/month)

`/events` = free · `/odds` (h2h,totals,eu) = 3 · outright winner = 1 · `/scores` (daysFrom) = 2.
Crons: daily events (free), 2× daily odds (AM +outright = 4, PM = 3), gated 30-min scores. `oddsFetch`
records `x-requests-remaining`/`-used` into the `apiBudget` singleton and **refuses paid calls below 50**.
Currently 492/500. The tournament spans June+July (≈ two billing months), so this fits comfortably.

---

## 10. Key decisions & gotchas (the landmines)

1. **Convex query returns are `any` on the client** — every `useQuery` result is cast to an explicit type at the call site. Keep doing this.
2. **Deploy key ≠ env-var write, and can't run internal fns** — humans set env vars in the dashboard; internal actions get public `run*` wrappers.
3. **Next.js 16 / React 19 / Tailwind v4** — newer than common training data. `params`/`searchParams` are async; Turbopack default; flat ESLint; `next lint` gone. `AGENTS.md` says read `node_modules/next/dist/docs/` before writing frontend code.
4. **Workflow component is pre-1.0** (`@convex-dev/workflow@0.4.4`, pinned): standalone `import { start }`; handler must be deterministic; never reshape debate steps while a debate is in-flight.
5. **Convex return-type inference cycles**: functions referenced across the expanded `api`/`internal` graph sometimes need an explicit handler return-type annotation (`Promise<...>`) or the build throws "implicitly has type any". Several functions already carry these — keep the pattern.
6. **Idempotency is load-bearing**: `placeBet`/`lockPrediction`/the ante dedupe by key; settlement only touches `status==="open"` bets. Safe to re-run.
7. **Bankroll is derived** from the immutable `bets` ledger — never store a balance number.
8. **The shared `buildBriefing` is the single source of "what they've done"** — money race **with each pundit's actual Cup pick**, your position, results, the long-tournament framing. It feeds debates AND the ante; the Touchline has its own richer version. If a model starts inventing, fix it HERE, not per-prompt.
9. **`/events` only returns upcoming games** — completed games that were never upcoming-in-window are upserted by `scores.syncScores`.
10. **No real logos**; pundit marks are original. **Star signs are real** (TheSportsDB birthdays); FIFA ranks are an approximate hardcoded table; the astro line is explicitly for-fun.

---

## 11. Known issues / things to fix next

1. **Grounding gap — pundits can deny real teams/fixtures.** Example flagged by the user: Qwen said
   *"Norway isn't even in this tournament"* — but **Norway IS in Group I** (France, Senegal, Iraq, Norway).
   The briefing/Touchline give each pundit's **bets and the money race**, but never tell them **which
   teams/groups are actually in the tournament**. Fix: inject the group draw (or at least "all 48 listed
   teams are in; here are the groups / here is the group of any team being discussed") into
   `buildBriefing` (and `banter.context`), and harden the "do not deny real teams" instruction. This is
   the top priority — it's the main thing that still reads as "making it up."
2. **Touchline can still drift factually** on occasion (it's creative LLMs). Grounding is much improved
   but not perfect; the §11.1 fix will help most.
3. **Weather not wired** — needs a fixture→venue/city map (was going to come from API-Football, which is
   paywalled for 2026). Options: upgrade API-Football, or hardcode the 16 host-city venues + a fixture→city
   map from the official schedule, then Open-Meteo (keyless) by city.
4. **Two backfilled completed games have no `oddsSnapshot`** (they were never upcoming) — harmless; they
   just show the result with no pre-match odds.

---

## 12. Remaining work (priority order)

1. **Fix the grounding gap (§11.1)** — inject the real tournament structure so pundits stop denying real teams.
2. **Deploy** — Vercel + production Convex (see §13). Crons + Workflow run automatically in prod; analytics start reporting.
3. **Weather** (§11.3) if wanted.
4. **Touchline triggers** — fire a line the moment a result settles or the lead changes hands (currently purely time-driven every minute).
5. **GSAP polish** — animated money counters, the debate "streaming in" reveal, a BANKRUPT stamp.
6. **Knockout bracket** — R32→Final as a third home tab (group boxes are done). 2026 = 12 groups / 48 teams / Round of 32; bracket matchups depend on final standings + a fixed template; mobile = round tabs, never the full web.

---

## 13. Deployment plan

- **Convex (prod):** human creates a production deployment in the dashboard + a **prod deploy key**. Push
  with `npx convex deploy`. Re-add ALL env vars in the prod dashboard (`NVIDIA_API_KEY`, `ODDS_API_KEY`,
  `GNEWS_API_KEY`, `THESPORTSDB_KEY`, `API_FOOTBALL_KEY`). Crons + the Workflow component run automatically.
  After deploy, run `admin:resetForLaunch` if a clean slate is wanted, then `engine:runOutrightAnte`.
- **Vercel:** connect the repo (or a token). Build: `npx convex deploy --cmd 'npm run build'`. Env:
  `NEXT_PUBLIC_CONVEX_URL` (prod). Vercel Analytics is already wired (`@vercel/analytics`). Serve passive
  viewers statically; only open live Convex subscriptions for the live moments so the free tier holds.
- Intended to run on **free tiers** throughout (NVIDIA free, Convex free, The Odds API 500/mo, GNews/
  TheSportsDB free, Vercel hobby), upgrading only if something goes viral.
```
