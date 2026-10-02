import type {
  Callback,
  Outcome,
  ResilienceContext,
  OutcomePredicate,
  DiscardResult,
} from "./types";
export async function captureOutcome<T>(
  callback: Callback<T>,
  context: ResilienceContext,
): Promise<Outcome<T>> {
  try {
    if (context.signal.aborted) throw context.signal.reason;
    return { kind: "result", value: await callback(context) };
  } catch (error) {
    return { kind: "error", error };
  }
}
export function unwrapOutcome<T>(outcome: Outcome<T>): T {
  if (outcome.kind === "error") throw outcome.error;
  return outcome.value;
}
export const defaultShouldHandle: OutcomePredicate<unknown> = ({
  outcome,
  context,
}) => !context.signal.aborted && outcome.kind === "error";
/** Always run cleanup after a hook failure; preserve both failures if cleanup fails too. */
export async function discardAfter<T>(
  outcome: Outcome<T>,
  context: ResilienceContext,
  discard: DiscardResult<T> | undefined,
  hook: () => Promise<void>,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await hook();
  } catch (e) {
    errors.push(e);
  }
  if (outcome.kind === "result" && discard)
    try {
      await discard(outcome.value, context);
    } catch (e) {
      errors.push(e);
    }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Hook and result cleanup failed");
}
