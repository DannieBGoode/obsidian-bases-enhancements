/** Restore only our own wrapper; coexist with wrappers installed later. */
export function aroundMethod(target: object, key: string, around: (self: unknown, run: () => unknown) => unknown): () => void {
  const record = target as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
  const original = record[key];
  if (typeof original !== 'function') return () => {};
  let callback: typeof around | null = around;
  const wrapper = function(this: unknown, ...args: unknown[]): unknown {
    const run = (): unknown => original.apply(this, args);
    return callback ? callback(this, run) : run();
  };
  record[key] = wrapper;
  return () => {
    callback = null;
    if (record[key] !== wrapper) return;
    if (hadOwn) record[key] = original;
    else delete record[key];
  };
}

export function afterMethod(target: object, key: string, after: (self: unknown) => void): () => void {
  return aroundMethod(target, key, (self, run) => {
    const result = run();
    after(self);
    return result;
  });
}
