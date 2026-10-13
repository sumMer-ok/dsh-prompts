/** Browser half of the prompts bundle: a CJS factory consumed by the module loader. */
declare function factory(require: (id: string) => unknown): {
  apply(ctx: unknown): void
  dispose(ctx: unknown): void
}

export = factory
