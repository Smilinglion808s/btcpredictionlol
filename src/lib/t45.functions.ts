// T45 Balanced server functions: dashboard stats, pending row, CSV exports.
//
// Thin wrapper only — every runtime helper lives in ./t45/statsQuery.server
// because the server-function splitter drops module-scope siblings here.

import { createServerFn } from "@tanstack/react-start";
import {
  buildT45Csv,
  buildT45FeaturesCsv,
  buildT45Stats,
  loadT45Pending,
} from "./t45/statsQuery.server";

/** Live + research performance for T45 Balanced. */
export const getT45Stats = createServerFn({ method: "GET" }).handler(async () => buildT45Stats());

/** Most recent live T45 row — its decision for the pending candle. */
export const getT45Pending = createServerFn({ method: "GET" }).handler(async () =>
  loadT45Pending(),
);

/** Every T45 decision row (research backfill + live). */
export const exportT45Csv = createServerFn({ method: "GET" }).handler(async () => buildT45Csv());

/** Every tracked T45 feature joined to its decision. */
export const exportT45FeaturesCsv = createServerFn({ method: "GET" }).handler(async () =>
  buildT45FeaturesCsv(),
);
