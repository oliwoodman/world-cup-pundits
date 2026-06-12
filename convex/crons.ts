import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 5 minutes: a lightweight dispatcher that schedules each upcoming fixture's
// debate to fire ~30 min before kickoff (exactly once).
crons.interval(
  "dispatch upcoming debates",
  { minutes: 5 },
  internal.dispatcher.scheduleUpcomingDebates,
  {},
);

// ---- The Odds API sync (see HANDOFF §8 for the credit budget) ----
// Daily fixture refresh from /events (free).
crons.cron("sync fixtures", "0 5 * * *", internal.odds.syncFixtures, {});

// Two match-odds snapshots a day. Morning pull also refreshes the outright board (+1 credit);
// evening pull skips it. ~ (3+1) + 3 = 7 credits/day.
crons.cron("sync odds (morning)", "0 8 * * *", internal.odds.syncOdds, { withOutright: true });
crons.cron("sync odds (evening)", "0 18 * * *", internal.odds.syncOdds, { withOutright: false });

// Gated score polling: the action early-returns for free unless a fixture has plausibly
// finished but isn't settled, so this only spends 2 credits around full-time of real games.
// Every 15 min keeps the settlement lag short while staying free outside those windows.
crons.interval("poll scores", { minutes: 15 }, internal.scores.syncScores, {});

// The Touchline: a constant ambient group chat — one pundit chimes in each minute (models are free).
crons.interval("touchline banter", { minutes: 1 }, internal.banter.tick, {});

export default crons;
