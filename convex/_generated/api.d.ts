/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as banter from "../banter.js";
import type * as crons from "../crons.js";
import type * as debates from "../debates.js";
import type * as dispatcher from "../dispatcher.js";
import type * as dossier from "../dossier.js";
import type * as engine from "../engine.js";
import type * as fixtures from "../fixtures.js";
import type * as groups from "../groups.js";
import type * as identity from "../identity.js";
import type * as leaderboard from "../leaderboard.js";
import type * as match from "../match.js";
import type * as odds from "../odds.js";
import type * as probes from "../probes.js";
import type * as pundit from "../pundit.js";
import type * as pundits from "../pundits.js";
import type * as scores from "../scores.js";
import type * as seed from "../seed.js";
import type * as settlement from "../settlement.js";
import type * as tournament from "../tournament.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  banter: typeof banter;
  crons: typeof crons;
  debates: typeof debates;
  dispatcher: typeof dispatcher;
  dossier: typeof dossier;
  engine: typeof engine;
  fixtures: typeof fixtures;
  groups: typeof groups;
  identity: typeof identity;
  leaderboard: typeof leaderboard;
  match: typeof match;
  odds: typeof odds;
  probes: typeof probes;
  pundit: typeof pundit;
  pundits: typeof pundits;
  scores: typeof scores;
  seed: typeof seed;
  settlement: typeof settlement;
  tournament: typeof tournament;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
