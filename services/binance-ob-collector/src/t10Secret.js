export function usableSecret(value) {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return null;

  if (
    normalized.includes("${{") ||
    normalized.startsWith("${") ||
    normalized.endsWith("}}")
  ) {
    return null;
  }

  return normalized;
}

export function resolveT10IngestSecret(env = process.env) {
  const dedicated = usableSecret(env.T10_INGEST_SECRET);
  if (dedicated) {
    return { value: dedicated, source: "T10_INGEST_SECRET" };
  }

  const shared = usableSecret(env.BINANCE_OB_INGEST_SECRET);
  if (shared) {
    return { value: shared, source: "BINANCE_OB_INGEST_SECRET" };
  }

  return null;
}

export function startT10Collector({
  enabled,
  env = process.env,
  ingestUrl,
  boundaryUrl,
  buildIdentifier,
  createCollector,
  log,
}) {
  if (!enabled) return null;

  const resolved = resolveT10IngestSecret(env);
  if (!resolved) {
    log("[t10] disabled: T10_SIGNING_SECRET_UNAVAILABLE");
    return null;
  }

  if (env.T10_INGEST_SECRET && !usableSecret(env.T10_INGEST_SECRET)) {
    log("[t10] warning: unresolved T10 secret rejected; using valid fallback");
  }

  log(`[t10] signing secret source=${resolved.source}`);
  const collector = createCollector({
    ingestUrl,
    secret: resolved.value,
    boundaryUrl,
    buildIdentifier,
    log: { log, warn: (...args) => log(...args) },
  });
  collector.start();
  log("[t10] started", { ingest: ingestUrl, boundary: boundaryUrl });
  return collector;
}