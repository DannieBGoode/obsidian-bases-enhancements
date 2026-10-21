import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_KEY, favoriteOrder, FavoriteView, moveFavorite, setStarred, starredViews } from '../src/favorites';

function view(name: string, type = 'table', metadata?: unknown): FavoriteView {
  const data: Record<string, unknown> = { [FAVORITE_KEY]: metadata };
  return { name, type, get: key => data[key], set: (key, value) => { if (value === null) delete data[key]; else data[key] = value; } };
}

test('all layouts can be starred; favorites stay within the supplied base', () => {
  const views = ['table', 'kanban', 'cards', 'list', 'custom-layout'].map(type => view(type, type));
  const other = view('Other base');
  views.forEach(entry => setStarred(views, entry, true));
  setStarred(views, other, true);
  assert.deepEqual(starredViews(views).map(entry => entry.type), views.map(entry => entry.type));
  assert.equal(favoriteOrder(other), null);
});

test('reordering changes favorite ranks without changing native order or view configuration', () => {
  const views = [view('Home'), view('IOG'), view('Board', 'kanban')];
  views.forEach(entry => setStarred(views, entry, true));
  assert.equal(moveFavorite(views, 'Board', 0), true);
  assert.deepEqual(starredViews(views).map(entry => entry.name), ['Board', 'Home', 'IOG']);
  assert.deepEqual(views.map(entry => entry.name), ['Home', 'IOG', 'Board']);
  assert.equal(views[2].type, 'kanban');
  assert.equal(moveFavorite(views, 'Board', -1), false);
  assert.equal(moveFavorite(views, 'Missing', 0), false);
  assert.equal(moveFavorite(views, 'Board', NaN), false);
});

test('unstarring and restarring appends the view; repeat operations are idempotent', () => {
  const views = [view('Home'), view('IOG'), view('Board')];
  views.forEach(entry => setStarred(views, entry, true));
  setStarred(views, views[1], false);
  setStarred(views, views[1], false);
  assert.deepEqual(starredViews(views).map(entry => entry.name), ['Home', 'Board']);
  setStarred(views, views[1], true);
  setStarred(views, views[1], true);
  assert.deepEqual(starredViews(views).map(entry => entry.name), ['Home', 'Board', 'IOG']);
});

test('favorite status follows a renamed view; deleted views disappear naturally', () => {
  const views = [view('Home'), view('Board')];
  views.forEach(entry => setStarred(views, entry, true));
  views[0].name = 'Personal';
  assert.deepEqual(starredViews(views).map(entry => entry.name), ['Personal', 'Board']);
  views.splice(1, 1);
  assert.deepEqual(starredViews(views).map(entry => entry.name), ['Personal']);
});

test('invalid metadata cannot create favorites or break sorting', () => {
  for (const metadata of [undefined, true, 'yes', [], {}, { order: '0' }, { order: -1 }, { order: Infinity }, { order: NaN }, { order: 0.5 }, { order: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(favoriteOrder(view('Invalid', 'table', metadata)), null);
  }
  const views = [view('A', 'table', { order: Number.MAX_SAFE_INTEGER }), view('B')];
  setStarred(views, views[1], true);
  assert.deepEqual(views.map(favoriteOrder), [0, 1]);
});

test('duplicate ranks resolve in native view order until reordered', () => {
  const views = [view('Original', 'table', { order: 0 }), view('Duplicate', 'table', { order: 0 }), view('Board', 'kanban', { order: 1 })];
  assert.deepEqual(starredViews(views).map(entry => entry.name), ['Original', 'Duplicate', 'Board']);
  moveFavorite(views, 'Duplicate', 0);
  assert.deepEqual(starredViews(views).map(entry => entry.name), ['Duplicate', 'Original', 'Board']);
});
