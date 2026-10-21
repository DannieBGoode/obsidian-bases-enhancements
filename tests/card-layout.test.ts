import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutCards, visibleCardRange } from '../src/card-layout';

test('mixed-height cards pack without reserved field space or a trailing gap', () => {
  const layout = layoutCards([{ value: 'full', height: 88 }, { value: 'empty', height: 40 }, { value: 'full', height: 88 }], 8);
  assert.deepEqual(layout.slots.map(({ top, height }) => [top, height]), [[0, 88], [96, 40], [144, 88]]);
  assert.equal(layout.height, 232);
});

test('viewport lookup finds short cards deep inside a mixed-height column', () => {
  const layout = layoutCards(Array.from({ length: 1000 }, (_, value) => ({ value, height: value % 2 ? 40 : 88 })), 8);
  const slot = layout.slots[731];
  assert.deepEqual(visibleCardRange(layout, slot.top + 5, slot.top + 10), { first: 731, last: 731 });
});

test('viewport lookup handles gaps, boundaries, empty columns, and offscreen ranges', () => {
  const layout = layoutCards([{ value: 'A', height: 40 }, { value: 'B', height: 88 }], 8);
  assert.equal(visibleCardRange(layout, 41, 47), null);
  assert.deepEqual(visibleCardRange(layout, 40, 48), { first: 0, last: 1 });
  assert.equal(visibleCardRange(layout, 200, 300), null);
  assert.equal(visibleCardRange(layoutCards([], 8), 0, 100), null);
  assert.equal(layoutCards([], 8).height, 0);
});
