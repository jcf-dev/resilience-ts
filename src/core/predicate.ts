import type { MaybePromise, OutcomePredicate } from "./types";
export class PredicateBuilder<T> {
  private readonly predicates: OutcomePredicate<T>[] = [];
  handleError(predicate: (error: unknown) => MaybePromise<boolean>): this {
    this.predicates.push(({ outcome }) =>
      outcome.kind === "error" ? predicate(outcome.error) : false,
    );
    return this;
  }
  handleErrorType<E extends Error>(
    constructor: abstract new (...args: never[]) => E,
  ): this {
    return this.handleError((e) => e instanceof constructor);
  }
  handleResult(predicate: (value: T) => MaybePromise<boolean>): this {
    this.predicates.push(({ outcome }) =>
      outcome.kind === "result" ? predicate(outcome.value) : false,
    );
    return this;
  }
  build(): OutcomePredicate<T> {
    const list = [...this.predicates];
    return async (args) => {
      for (const predicate of list) if (await predicate(args)) return true;
      return false;
    };
  }
}
