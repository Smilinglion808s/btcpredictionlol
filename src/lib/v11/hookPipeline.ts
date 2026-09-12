// Version 1.1 boundary composition.
//
// The fallback leg is timed against the interval open and must reach the wire
// inside the 60s ceiling. Its dispatch is therefore attached to the observer's
// OWN promise continuation: the instant the atomic commit resolves, the
// dispatch decision runs — it never queues behind the legacy T45 legs, the
// backlog resolvers or anything else on the hook. The hook still awaits this
// combined promise before responding, so the HTTP response remains truthful.

export interface V11PipelineOutcome<O> {
  observation: O | { error: string };
  dispatch: unknown;
}

export function v11ObserveAndDispatch<O>(
  observe: () => Promise<O>,
  dispatch: (observation: O) => Promise<unknown>,
): Promise<V11PipelineOutcome<O>> {
  return observe().then(
    async (observation) => {
      let result: unknown;
      try {
        result = await dispatch(observation);
      } catch (e) {
        result = { verdict: "ERROR", error: e instanceof Error ? e.message : String(e) };
      }
      return { observation, dispatch: result };
    },
    (e: unknown) => ({
      observation: { error: e instanceof Error ? e.message : String(e) },
      dispatch: { verdict: "NO_FRESH_COMMIT", reason: "observation_failed" },
    }),
  );
}
