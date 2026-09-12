/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _runner_bundle from "../_runner/bundle.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as launch from "../launch.js";
import type * as levels from "../levels.js";
import type * as lib_auth from "../lib/auth.js";
import type * as runs from "../runs.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_runner/bundle": typeof _runner_bundle;
  auth: typeof auth;
  http: typeof http;
  launch: typeof launch;
  levels: typeof levels;
  "lib/auth": typeof lib_auth;
  runs: typeof runs;
  sessions: typeof sessions;
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

export declare const components: {};
