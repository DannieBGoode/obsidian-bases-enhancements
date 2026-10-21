import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterMethod } from '../src/patch';

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
