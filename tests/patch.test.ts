import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterMethod, aroundMethod } from '../src/patch';

test('controller hook preserves this, arguments, return value, and native exceptions', () => {
  const calls: string[] = [];
  const target = { value: 3, run(delta: number) { calls.push('native'); if (delta < 0) throw new Error('native failure'); return this.value + delta; } };
  const original = target.run;
  const undo = afterMethod(target, 'run', self => { assert.equal(self, target); calls.push('favorites'); });
  assert.equal(target.run(2), 5);
  assert.deepEqual(calls, ['native', 'favorites']);
  assert.throws(() => target.run(-1), /native failure/);
  assert.deepEqual(calls, ['native', 'favorites', 'native']);
  undo();
  assert.equal(target.run, original);
});

test('unloading does not overwrite a later plugin hook and disables our callback', () => {
  let favoritesCalls = 0;
  let otherCalls = 0;
  const target = { run() { return 42; } };
  const undo = afterMethod(target, 'run', () => favoritesCalls++);
  const ourWrapper = target.run;
  target.run = function() { otherCalls++; return ourWrapper.call(this); };
  const laterWrapper = target.run;
  undo();
  assert.equal(target.run, laterWrapper);
  assert.equal(target.run(), 42);
  assert.equal(favoritesCalls, 0);
  assert.equal(otherCalls, 1);
});

test('unloading restores inherited methods without adding an own property', () => {
  const base = { run() { return 'inherited'; } };
  const target = Object.create(base) as typeof base;
  const undo = afterMethod(target, 'run', () => {});
  assert.equal(Object.hasOwn(target, 'run'), true);
  undo();
  assert.equal(Object.hasOwn(target, 'run'), false);
  assert.equal(target.run(), 'inherited');
});

test('around hook restores temporary state even when the native method throws', () => {
  const target = { viewport: 'real', run(fail: boolean) { assert.equal(this.viewport, 'mapped'); if (fail) throw new Error('native'); return 42; } };
  const undo = aroundMethod(target, 'run', (_self, run) => {
    const original = target.viewport;
    target.viewport = 'mapped';
    try { return run(); } finally { target.viewport = original; }
  });
  assert.equal(target.run(false), 42);
  assert.equal(target.viewport, 'real');
  assert.throws(() => target.run(true), /native/);
  assert.equal(target.viewport, 'real');
  undo();
});

test('around hook cleanup preserves wrappers installed by another plugin', () => {
  let decorations = 0;
  const target = { run(value: number) { return value + 1; } };
  const undo = aroundMethod(target, 'run', (_self, run) => { decorations++; return run(); });
  const ours = target.run;
  target.run = value => ours.call(target, value) * 2;
  assert.equal(target.run(2), 6);
  undo();
  assert.equal(target.run(3), 8);
  assert.equal(decorations, 1);
});
