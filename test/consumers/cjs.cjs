const assert = require("node:assert/strict");
const { ResiliencePipelineBuilder } = require("@jcf-dev/resilience-ts");
(async () => {
  const pipeline = new ResiliencePipelineBuilder()
    .addRetry({ delayMs: 0 })
    .build();
  assert.equal(await pipeline.execute(() => 42), 42);
  pipeline.dispose();
  console.log("Packed CommonJS passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
