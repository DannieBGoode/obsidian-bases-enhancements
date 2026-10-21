export interface CardSlot<T> {
  value: T;
  top: number;
  height: number;
}

export interface CardLayout<T> {
  slots: CardSlot<T>[];
  height: number;
}

export function layoutCards<T>(cards: readonly { value: T; height: number }[], gap: number): CardLayout<T> {
  let top = 0;
  const slots = cards.map(card => {
    const slot = { ...card, top };
    top += card.height + gap;
    return slot;
  });
  return { slots, height: slots.length ? top - gap : 0 };
}

/** Map a pixel viewport to the inclusive range of intersecting card slots. */
export function visibleCardRange<T>(layout: CardLayout<T>, top: number, bottom: number): { first: number; last: number } | null {
  const slots = layout.slots;
  let low = 0, high = slots.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (slots[middle].top + slots[middle].height < top) low = middle + 1;
    else high = middle;
  }
  const first = low;
  high = slots.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (slots[middle].top <= bottom) low = middle + 1;
    else high = middle;
  }
  return first < low && bottom >= top ? { first, last: low - 1 } : null;
}
