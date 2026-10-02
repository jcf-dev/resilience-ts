# resilience-ts

Composable resilience pipelines for Node 22+ and TypeScript, inspired by Polly. Zero runtime dependencies. ESM and CommonJS share the same runtime and error-class identity.

## Install

Install from [npm](https://www.npmjs.com/package/@jcf-dev/resilience-ts). Requires Node 22 or later.

```sh
npm install @jcf-dev/resilience-ts
```

To pin the first release:

```sh
npm install @jcf-dev/resilience-ts@0.1.0
```

## Use

```ts
import { ResiliencePipelineBuilder } from "@jcf-dev/resilience-ts";

const pipeline = new ResiliencePipelineBuilder<string>()
  .addFallback({ fallbackAction: () => "cached" })
  .addRetry({ maxRetryAttempts: 2, delayMs: 100, backoffType: "exponential" })
  .addCircuitBreaker({ failureRatio: 0.5, minimumThroughput: 10 })
  .addTimeout(5_000)
  .addRateLimiter()
  .build();

const result = await pipeline.execute(
  async ({ signal }) => {
    const response = await fetch("https://example.com", { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  },
  { signal: new AbortController().signal, operationKey: "load" },
);

pipeline.dispose();
```

Builder order is **outermost to innermost**. The example's Fallback receives the exhausted Retry outcome; Timeout applies to each attempt. Put Timeout outside Retry for an overall deadline. Retry and Hedging may execute callbacks multiple times; choose repeatable operations.

`execute()` returns the value or throws the exact error. `executeOutcome()` returns a discriminated `{ kind: 'result', value }` or `{ kind: 'error', error }`, preserving thrown `undefined`, `null`, strings and objects.

## Strategies

| Builder method      | Defaults                                                | Options                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addRetry`          | 3 additional attempts; constant 2000ms; no jitter       | `maxRetryAttempts`, `delayMs`, `backoffType`, `useJitter`, `maxDelayMs`, `shouldHandle`, `delayGenerator`, `onRetry`                                                       |
| `addCircuitBreaker` | Ratio 0.1; throughput 100; 30000ms sample; 5000ms break | `failureRatio`, `minimumThroughput`, `samplingDurationMs`, `breakDurationMs`, `breakDurationGenerator`, `shouldHandle`, `stateProvider`, `manualControl`, transition hooks |
| `addTimeout`        | 30000ms                                                 | Millisecond number or `timeoutMs`, `timeoutGenerator`, `onTimeout`                                                                                                         |
| `addRateLimiter`    | Owned concurrency limiter; 1000 permits; no queue       | `limiter`, `ownsLimiter`, `onRejected`                                                                                                                                     |
| `addFallback`       | Handle errors; one replacement                          | Required `fallbackAction`; optional `shouldHandle`, `onFallback`                                                                                                           |
| `addHedging`        | 1 additional attempt; 2000ms delay                      | `maxHedgedAttempts`, `delayMs`, `delayGenerator`, `actionGenerator`, `shouldHandle`, `onHedging`                                                                           |

Reactive strategies handle errors by default and exclude caller cancellation. `PredicateBuilder<T>` combines `handleError`, `handleErrorType` and `handleResult` predicates with OR. Async predicates, generators, hooks and callbacks are supported.

Hedging delay > 0 starts another action after latency or a handled fast failure; zero allows immediate parallel branches; negative runs sequentially. Its first acceptable outcome wins. If every outcome is handled, it returns the primary outcome. Returning `null` from `actionGenerator` stops adding branches. An alternate callback still traverses all inner policies.

Circuit Breaker and Rate Limiter state belongs to each built pipeline and stays in process. Reuse that pipeline to share its state. Building twice creates independent default strategy instances. Supplied limiter adapters are intentionally shared and caller-owned unless `ownsLimiter: true`. A `CircuitBreakerStateProvider` or `CircuitBreakerManualControl` binds to one circuit. Manual `isolate()` and `close()` are async; no background recovery timer is needed.

## Cancellation and resource ownership

Callbacks receive an `AbortSignal`; respect it in I/O and cleanup. Timeout and Hedging **await callback settlement** after cancellation. A callback that ignores the signal can delay return indefinitely. Caller cancellation keeps its exact reason. Static timeout must be finite and positive; a finite generated timeout <= 0 disables the timeout for that execution.

Use `new ResiliencePipelineBuilder<T>({ discardResult: async (value, context) => { /* release value */ } })` when results own resources. Retry cleans handled retry results, Fallback cleans replaced results, Timeout cleans canceled late results, and Hedging cleans losing results. Cleanup is awaited, including when predicates, generators or transition hooks fail after a callback produced a result. Multiple hook/cleanup failures are preserved in `AggregateError`. Delivered results remain caller-owned.

`dispose()` rejects new calls, cancels strategy-owned Retry/Timeout/Hedging waits and signals, and disposes owned limiter adapters, including queued acquisitions. It starts no further retries or hedge branches. In-flight callbacks are still awaited; disposal does not detach them. All duration options use milliseconds; long finite waits are chunked to avoid Node timer overflow.

## Permit adapters

`createConcurrencyLimiter({ permitLimit, queueLimit, queueOrder })` and `createTokenBucketLimiter({ tokenLimit, tokensPerPeriod, replenishmentPeriodMs, queueLimit, queueOrder }, runtime?)` implement `AsyncPermitLimiter`. Queue order is `oldest-first` (default) or `newest-first`; a full newest-first queue rejects its oldest waiter to admit the newer one. Leases release idempotently; the token bucket replenishes by elapsed periods and owns no idle interval.

A custom adapter provides `acquire(signal): Promise<PermitLease>`. The lease has `acquired`, optional `retryAfterMs`, and `release()`. The strategy always releases a received lease, including on callback or rejection-hook failure. `RateLimiterRejectedError` exposes `retryAfterMs`.

## Durable scheduling

```ts
import { RetryPolicy } from "@jcf-dev/resilience-ts";
const policy = new RetryPolicy({
  maxRetryAttempts: 2,
  delayMs: 2_000,
  backoffType: "exponential",
});
const decision = await policy.evaluate(
  { kind: "error", error: new Error("temporary") },
  { attemptNumber: 0, jitterState: 0 },
  { signal: new AbortController().signal, properties: new Map() },
);
// retry => delayMs 2000, next state { attemptNumber: 1, jitterState: 0 }
// Persist the state and schedule a wake-up yourself; evaluate starts no timers/hooks.
```

`maxRetryAttempts: 2` means three total executions. `Runtime` injects monotonic time, random values and cancellable timers for deterministic tests. Property maps are fresh per execution; hedging branches shallow-copy them.

## Development and provenance

```sh
npm ci
npm run check
node examples/all.mjs
```

CI covers Node 22 and 24, including an isolated packed install and `.mts`/`.cts` type checking. See [compatibility](docs/compatibility.md) for Polly 8.8.0 source mappings and intentional Node adaptations. This is independent of App vNext and does not implement .NET DI, ValueTask, telemetry or context pooling.

Original code is [MIT](LICENSE). Translated backoff portions retain [BSD-3-Clause](licenses/Polly-BSD-3-Clause.txt) and attribution in [NOTICE](NOTICE).

## Releases

[GitHub Actions](https://github.com/jcf-dev/resilience-ts/actions/workflows/ci.yml) runs `npm run check` on Node 22 and 24 for pull requests and pushes to `main`. The checks cover formatting, types, all tests, the build and isolated packed consumers. Development and release tooling requires Node 22.14+ or Node 24.10+; the published runtime supports Node 22+.

After both CI jobs pass on `main`, semantic-release uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) to determine the next version:

| Commit                                            | Release                                          |
| ------------------------------------------------- | ------------------------------------------------ |
| `fix: ...`                                        | Patch                                            |
| `feat: ...`                                       | Minor                                            |
| `feat!: ...` or a `BREAKING CHANGE:` footer       | Major                                            |
| `docs: ...`, `chore: ...`, `ci: ...`, `test: ...` | No release unless they declare a breaking change |

For squash merges, use a Conventional Commit as the pull request title. The release job stages the npm package, creates its `v<version>` Git tag and GitHub release with generated notes, and attaches the matching package tarball and staging receipt. Pull requests never release. The existing `v0.1.0` tag is the initial release baseline.

Do not manually bump `package.json` or create release tags for this workflow. semantic-release updates the version in the package artifact; the source manifest's version is not the latest release indicator. Check [npm](https://www.npmjs.com/package/@jcf-dev/resilience-ts) for publicly installable versions. GitHub releases may still be awaiting npm approval.

### Approve the staged npm package

Following npm's [recommended stage-only publishing](https://docs.npmjs.com/staged-publishing/), CI cannot make packages public. Review the GitHub release's tarball, generated notes and `staging.json` receipt, then approve the stage in the npm website's **Staged Packages** tab using your 2FA/passkey. Alternatively, with npm 11.15+:

```sh
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

Approval publishes the staged package to `latest`. Until approval, `npm install` continues to resolve the previous public version. npm versions are immutable; if a stage is rejected, fix the issue with a new release commit rather than reusing the version.

### npm trusted publisher

The release job uses npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/) through GitHub OIDC, with no stored npm publishing token. Configure this connection in the package's [npm settings](https://www.npmjs.com/package/@jcf-dev/resilience-ts/access):

| Setting              | Value                                             |
| -------------------- | ------------------------------------------------- |
| Publisher            | GitHub Actions                                    |
| Organization or user | `jcf-dev`                                         |
| Repository           | `resilience-ts`                                   |
| Workflow filename    | `ci.yml`                                          |
| Environment name     | `npm-publish`                                     |
| Allow npm publish    | Disabled; stage-only publishing                   |
| Allow npm dist-tag   | Disabled; this workflow releases only to `latest` |

Set **Publishing access** to **Require two-factor authentication and disallow tokens**. Remove unused automation tokens. Trusted publishing continues to work with this restriction.

GitHub's built-in `GITHUB_TOKEN` creates the tag and release. Only the release job receives `contents: write` and `id-token: write`; test jobs have read access. Release jobs run one at a time on GitHub-hosted runners, with package caching disabled. The `npm-publish` environment permits deployments only from `main`. The npm CLI is pinned in the lockfile and generates provenance automatically through OIDC from this public repository. Audit the trusted publisher periodically and keep release tags protected from unauthorized changes.
