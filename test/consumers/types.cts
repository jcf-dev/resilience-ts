import resilience = require("@jcf-dev/resilience-ts");
const pipeline = new resilience.ResiliencePipelineBuilder<number>()
  .addRetry({ delayMs: 0 })
  .build();
const value: Promise<number> = pipeline.execute(() => 42);
void value;
