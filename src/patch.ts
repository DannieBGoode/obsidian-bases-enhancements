/** Restore only our own wrapper; coexist with wrappers installed later. */
export function afterMethod(target: object, key: string, after: (self: unknown) => void): () => void {
  const record = target as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, key);
  const original = record[key];
  if (typeof original !== 'function') return () => {};
  let callback: ((self: unknown) => void) | null = after;
  const wrapper = function(this: unknown, ...args: unknown[]): unknown {
    const result: unknown = original.apply(this, args);
    callback?.(this);
    return result;
  };
  record[key] = wrapper;
  return () => {
    callback = null;
    if (record[key] !== wrapper) return;
    if (hadOwn) record[key] = original;
    else delete record[key];
  };
}
