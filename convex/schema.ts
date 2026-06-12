import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The AI World Cup Pundits data model.
// Bankroll is DERIVED from the immutable `bets` ledger (1000 + sum(payout) - sum(stake)),
// so it is always auditable and cannot drift.
export default defineSchema({
  // The five pundit LLMs (static identity).
  models: defineTable({
    key: v.string(), // stable slug, e.g. "deepseek"
    displayName: v.string(), // "DeepSeek"
    modelSlug: v.string(), // NVIDIA endpoint id, e.g. "deepseek-ai/deepseek-v4-pro"
    emoji: v.string(),
    color: v.string(), // accent hex for the UI
    tagline: v.string(),
    persona: v.string(), // system-prompt personality
    bettingStyle: v.string(), // human-readable risk ethos
    startingBankroll: v.number(),
  }).index("by_key", ["key"]),

  // Evolving "identity card" state — mutates with performance, fed back into prompts.
  identityCards: defineTable({
    modelId: v.id("models"),
    posture: v.string(), // current narrative posture, e.g. "tilting after two losses"
    mood: v.string(), // "cocky" | "desperate" | "smug" | "tilting" | "neutral"
    riskDial: v.number(), // 0-100 current risk appetite
    updatedAt: v.number(),
  }).index("by_model", ["modelId"]),

  // World Cup 2026 matches.
  fixtures: defineTable({
    homeTeam: v.string(),
    awayTeam: v.string(),
    kickoffAt: v.number(), // ms epoch
    stage: v.string(), // "Group A", "Round of 32", ...
    status: v.string(), // "scheduled" | "debating" | "locked" | "live" | "finished"
    homeScore: v.optional(v.number()),
    awayScore: v.optional(v.number()),
    externalId: v.optional(v.string()),
    // scheduling bookkeeping (dispatcher fires the debate ~30 min pre-kickoff, once)
    debateScheduledId: v.optional(v.id("_scheduled_functions")),
    debateScheduledAt: v.optional(v.number()),
    debateWorkflowId: v.optional(v.string()),
    // cached odds snapshot taken at debate time
    oddsSnapshot: v.optional(
      v.object({
        home: v.number(),
        draw: v.number(),
        away: v.number(),
        over: v.optional(v.number()),
        under: v.optional(v.number()),
        line: v.optional(v.number()),
        outrightBoard: v.optional(v.string()),
        fetchedAt: v.number(),
      }),
    ),
    // the pundits' research dossier, assembled at debate time (fed into prompts + shown on the page).
    dossier: v.optional(
      v.object({
        homeRank: v.optional(v.number()), // FIFA world ranking
        awayRank: v.optional(v.number()),
        homeForm: v.optional(v.string()), // last-5 W/D/L from our own results, e.g. "WWDLW"
        awayForm: v.optional(v.string()),
        homeStar: v.optional(v.object({ player: v.string(), sign: v.string(), url: v.optional(v.string()) })), // TheSportsDB talisman
        awayStar: v.optional(v.object({ player: v.string(), sign: v.string(), url: v.optional(v.string()) })),
        weather: v.optional(v.string()),
        news: v.array(
          v.object({ team: v.string(), headline: v.string(), source: v.optional(v.string()), url: v.optional(v.string()) }),
        ),
        funFact: v.optional(v.string()),
        builtAt: v.number(),
      }),
    ),
  })
    .index("by_status_kickoff", ["status", "kickoffAt"])
    .index("by_kickoff", ["kickoffAt"]),

  // One orchestration record per pundit run on a fixture.
  debates: defineTable({
    fixtureId: v.id("fixtures"),
    status: v.string(), // "pending" | "running" | "locked" | "failed"
    startedAt: v.number(),
    lockedAt: v.optional(v.number()),
  }).index("by_fixture", ["fixtureId"]),

  // The streaming transcript: one row per message, ordered by seq (powers the live reveal).
  debateMessages: defineTable({
    debateId: v.id("debates"),
    modelId: v.id("models"),
    round: v.number(), // 1 = opening, 2 = rebuttal
    seq: v.number(), // global order within the debate
    content: v.string(),
  }).index("by_debate_seq", ["debateId", "seq"]),

  // Each model's locked structured call per debate.
  predictions: defineTable({
    debateId: v.id("debates"),
    fixtureId: v.id("fixtures"),
    modelId: v.id("models"),
    winner: v.string(), // "home" | "away" | "draw"
    scoreline: v.string(), // "2-1"
    confidence: v.number(), // 0-100
    trashTalk: v.string(),
    keyFactor: v.optional(v.string()), // the one dossier signal that swung this pundit (decision trace)
    dedupeKey: v.optional(v.string()), // `${debateId}:${modelId}` — makes lock idempotent on retry
  })
    .index("by_debate", ["debateId"])
    .index("by_fixture", ["fixtureId"])
    .index("by_dedupe", ["dedupeKey"]),

  // The ambient "Touchline" group chat — pundits chiming in and replying to each other between debates.
  banter: defineTable({
    modelId: v.id("models"),
    content: v.string(),
    createdAt: v.number(),
  }),

  // The Odds API credit gauge (singleton row keyed by provider). Updated from the
  // `x-requests-remaining` response header after every call so paid calls can hard-stop
  // before the free monthly quota runs out.
  apiBudget: defineTable({
    provider: v.string(), // "the-odds-api"
    remaining: v.number(),
    used: v.number(),
    updatedAt: v.number(),
  }).index("by_provider", ["provider"]),

  // THE immutable money ledger. Bankroll is computed from this.
  bets: defineTable({
    modelId: v.id("models"),
    kind: v.string(), // "match" | "outright"
    fixtureId: v.optional(v.id("fixtures")), // null for outright bets
    market: v.string(), // "match_result" | "correct_score" | "outright_winner" | ...
    selection: v.string(), // "Germany" | "2-1" | ...
    stake: v.number(),
    odds: v.number(), // decimal odds locked at placement
    status: v.string(), // "open" | "won" | "lost" | "void"
    payout: v.optional(v.number()), // total returned on settle (stake*odds if won)
    note: v.optional(v.string()), // the pundit's one-line rationale (esp. outright antes)
    placedAt: v.number(),
    settledAt: v.optional(v.number()),
    dedupeKey: v.string(), // idempotency: <debateId>:<modelId>:<market>:<selection>
  })
    .index("by_model", ["modelId"])
    .index("by_fixture", ["fixtureId"])
    .index("by_status", ["status"])
    .index("by_dedupe", ["dedupeKey"]),
});
