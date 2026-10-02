# resilience-ts

Composable resilience pipelines for Node 22+ and TypeScript, inspired by Polly.
Independent package, zero runtime dependencies, ESM and CommonJS with shared class identity.
Original code is MIT; attributed translated portions retain their upstream BSD license.

```ts
import { ResiliencePipelineBuilder } from '@jcf-dev/resilience-ts';
const pipeline = new ResiliencePipelineBuilder<number>().build();
const value = await pipeline.execute(() => 42);
```

See [compatibility](docs/compatibility.md) for upstream provenance and Node adaptations.
