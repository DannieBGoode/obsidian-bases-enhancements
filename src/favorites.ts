/** The metadata travels with its view through native rename, move, and sync. */
export const FAVORITE_KEY = 'viewFavorites';

export interface FavoriteView {
  name: string;
  type: string;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function favoriteOrder(view: FavoriteView): number | null {
  const value = view.get(FAVORITE_KEY);
  if (!value || typeof value !== 'object') return null;
  const order = (value as { order?: unknown }).order;
  return typeof order === 'number' && Number.isSafeInteger(order) && order >= 0 ? order : null;
}

export function starredViews<T extends FavoriteView>(views: readonly T[]): T[] {
  return views.filter(view => favoriteOrder(view) !== null)
    .sort((a, b) => favoriteOrder(a)! - favoriteOrder(b)!);
}

export function setStarred(views: readonly FavoriteView[], view: FavoriteView, starred: boolean): void {
  if (!views.includes(view) || (favoriteOrder(view) !== null) === starred) return;
  if (!starred) {
    view.set(FAVORITE_KEY, null);
    return;
  }
  const favorites = starredViews(views);
  // Reindex instead of incrementing an untrusted / potentially exhausted rank.
  [...favorites, view].forEach((entry, order) => {
    if (favoriteOrder(entry) !== order) entry.set(FAVORITE_KEY, { order });
  });
}

export function moveFavorite(views: readonly FavoriteView[], name: string, targetIndex: number): boolean {
  const favorites = starredViews(views);
  const from = favorites.findIndex(view => view.name === name);
  if (from < 0 || !Number.isFinite(targetIndex)) return false;
  const to = Math.max(0, Math.min(favorites.length - 1, Math.trunc(targetIndex)));
  if (from === to) return false;
  favorites.splice(to, 0, favorites.splice(from, 1)[0]);
  favorites.forEach((view, order) => {
    if (favoriteOrder(view) !== order) view.set(FAVORITE_KEY, { order });
  });
  return true;
}
