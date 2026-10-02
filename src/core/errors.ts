export class PipelineDisposedError extends Error {
  constructor() {
    super("Pipeline has been disposed");
    this.name = "PipelineDisposedError";
  }
}
