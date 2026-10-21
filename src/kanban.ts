import { BasesEntry, BasesPropertyId, ListValue, NullValue, StringValue, Value } from 'obsidian';
import { CardLayout, CardSlot, layoutCards, visibleCardRange } from './card-layout';
import { FavoriteView } from './favorites';
import { NativeController } from './native';
import { aroundMethod } from './patch';

export const HIDE_EMPTY_FIELDS_KEY = 'bvfHideEmptyFields';

interface NativeCard {
  entry: BasesEntry | null;
  el: HTMLElement;
  props: { prop: BasesPropertyId; el: HTMLElement }[];
}

interface NativeColumn {
  group: { key: Value | null; entries: BasesEntry[] } | null;
  items: NativeCard[];
  innerEl: HTMLElement;
  cardPlaceholderEl?: HTMLElement;
  viewport: { top: number; bottom: number } | null;
  readViewport(): void;
  updateVirtualDisplay(): void;
}

interface NativeKanban {
  type: 'kanban';
  containerEl: HTMLElement;
  scrollEl: HTMLElement;
  config: FavoriteView;
  data: { properties: BasesPropertyId[] } | null;
  imageProp: BasesPropertyId | null;
  columns: NativeColumn[];
  measurements: {
    pad: { top: number; bottom: number };
    cardPad: { top: number; bottom: number };
    cardHeight: number;
    cardGap: number;
    propGap: number;
    titleHeight: number;
    propHeight: number;
    coverHeight: number;
    columnHeight: number;
  };
  pendingMove: { entry: BasesEntry; sourceKey: Value | null; targetKey: Value | null } | null;
  cardDrag: { entry: BasesEntry; col: NativeColumn; index: number } | null;
  computeDropIndex(entry: BasesEntry, entries: BasesEntry[]): number;
  updateVirtualDisplay(): void;
  onDataUpdated(): void;
}

type CardContent = { entry: BasesEntry; visible: Set<BasesPropertyId>; placeholder: boolean };
interface ColumnLayout extends CardLayout<CardContent> {
  byFile: Map<BasesEntry['file'], CardSlot<CardContent>>;
  placeholder: CardSlot<CardContent> | undefined;
}
interface CachedLayout {
  data: NativeKanban['data'];
  entries: BasesEntry[];
  drag: NativeKanban['cardDrag'];
  move: NativeKanban['pendingMove'];
  geometry: string;
  layout: ColumnLayout;
}

function isNativeKanban(value: unknown): value is NativeKanban {
  const view = value as Partial<NativeKanban> | null;
  return !!view && view.type === 'kanban'
    && !!view.containerEl?.classList.contains('bases-kanban-container')
    && Array.isArray(view.columns) && typeof view.config?.get === 'function'
    && !!view.measurements?.cardPad && typeof view.computeDropIndex === 'function'
    && typeof view.updateVirtualDisplay === 'function';
}

export function hideEmptyFields(view: FavoriteView): boolean {
  return view.get(HIDE_EMPTY_FIELDS_KEY) !== false;
}

function isEmptyValue(value: Value | null | undefined): boolean {
  if (!value || value instanceof NullValue) return true;
  if (value instanceof StringValue) return value.toString().trim().length === 0;
  if (value instanceof ListValue) {
    for (let index = 0; index < value.length(); index++) {
      if (!isEmptyValue(value.get(index))) return false;
    }
    return true;
  }
  return false;
}

/** Reuse native rendering and recycling while mapping its slots to compact card heights. */
export class KanbanEnhancements {
  private view: NativeKanban | null = null;
  private readonly undo: (() => void)[] = [];
  private readonly columns = new Map<NativeColumn, () => void>();
  private readonly layouts = new Map<NativeColumn, CachedLayout>();

  constructor(private readonly controller: NativeController) {}

  render(): void {
    const candidate = this.controller.view;
    if (candidate !== this.view) {
      this.detach();
      if (isNativeKanban(candidate)) {
        this.view = candidate;
        candidate.containerEl.classList.add('bvf-kanban');
        this.undo.push(aroundMethod(candidate, 'onDataUpdated', (_self, run) => {
          this.layouts.clear();
          return run();
        }));
        this.undo.push(aroundMethod(candidate, 'updateVirtualDisplay', (_self, run) => this.updateView(candidate, run)));
      }
    }
    this.layouts.clear();
    this.view?.updateVirtualDisplay();
  }

  private updateView(view: NativeKanban, run: () => unknown): unknown {
    for (const [column, undo] of this.columns) {
      if (!view.columns.includes(column)) {
        undo();
        this.columns.delete(column);
        this.layouts.delete(column);
      }
    }
    for (const column of view.columns) {
      if (!this.columns.has(column)) {
        this.columns.set(column, aroundMethod(column, 'updateVirtualDisplay', (_self, next) => this.updateColumn(view, column, next)));
      }
    }
    const result = run();
    if (hideEmptyFields(view.config) && view.data && view.scrollEl.closest('.block-language-base,.bases-embed')) {
      const height = Math.max(0, ...view.columns.map(column => this.getLayout(view, column)?.height ?? 0));
      const m = view.measurements;
      view.containerEl.style.height = `${m.pad.top + m.columnHeight + height + m.pad.bottom}px`;
    }
    return result;
  }

  private getLayout(view: NativeKanban, column: NativeColumn): ColumnLayout | null {
    if (!view.data || !column.group) return null;
    const m = view.measurements;
    const geometry = [m.cardHeight, m.cardGap, m.propGap, m.titleHeight, m.propHeight, m.coverHeight, m.cardPad.top, m.cardPad.bottom, view.imageProp].join(',');
    const cached = this.layouts.get(column);
    if (cached && cached.data === view.data && cached.entries === column.group.entries
      && cached.drag === view.cardDrag && cached.move === view.pendingMove && cached.geometry === geometry) return cached.layout;
    let entries = column.group.entries;
    const move = view.pendingMove;
    if (move) {
      if (Value.looseEquals(column.group.key, move.sourceKey)) entries = entries.filter(entry => entry.file !== move.entry.file);
      else if (Value.looseEquals(column.group.key, move.targetKey) && !entries.some(entry => entry.file === move.entry.file)) {
        entries = entries.slice();
        entries.splice(view.computeDropIndex(move.entry, entries), 0, move.entry);
      }
    }
    const properties = view.data.properties;
    const content = (entry: BasesEntry, placeholder = false) => {
      const visible = new Set(properties.filter((property, index) => index === 0 || !isEmptyValue(entry.getValue(property))));
      const height = properties.length === 0 ? m.cardHeight
        : (view.imageProp ? m.coverHeight : 0) + m.cardPad.top + m.cardPad.bottom + m.titleHeight
          + Math.max(0, visible.size - 1) * (m.propHeight + m.propGap);
      return { value: { entry, visible, placeholder }, height };
    };
    const cards = entries.map(entry => content(entry));
    const drag = view.cardDrag;
    if (drag?.col === column && !entries.some(entry => entry.file === drag.entry.file)) cards.splice(drag.index, 0, content(drag.entry, true));
    const packed = layoutCards(cards, m.cardGap);
    const layout: ColumnLayout = {
      ...packed,
      byFile: new Map(packed.slots.filter(slot => !slot.value.placeholder).map(slot => [slot.value.entry.file, slot])),
      placeholder: packed.slots.find(slot => slot.value.placeholder),
    };
    this.layouts.set(column, { data: view.data, entries: column.group.entries, drag, move, geometry, layout });
    return layout;
  }

  private updateColumn(view: NativeKanban, column: NativeColumn, run: () => unknown): unknown {
    if (!hideEmptyFields(view.config)) {
      const result = run();
      for (const card of column.items) for (const field of card.props) field.el.classList.remove('bvf-empty-field');
      return result;
    }
    const layout = this.getLayout(view, column);
    if (!layout) return run();
    column.innerEl.style.height = `${layout.height}px`;
    column.readViewport();
    const viewport = column.viewport;
    if (!viewport) return run();
    const range = visibleCardRange(layout, viewport.top, viewport.bottom);
    const stride = view.measurements.cardHeight + view.measurements.cardGap;
    column.viewport = { ...viewport, top: range ? range.first * stride : -2 * stride,
      bottom: range ? range.last * stride + view.measurements.cardHeight : -stride };
    let result: unknown;
    try { result = run(); }
    finally { column.viewport = viewport; }
    const m = view.measurements;
    for (const card of column.items) {
      const slot = card.entry && layout.byFile.get(card.entry.file);
      if (!slot) continue;
      let top = (view.imageProp ? m.coverHeight : 0) + m.cardPad.top;
      for (const [index, field] of card.props.entries()) {
        const visible = slot.value.visible.has(field.prop);
        field.el.classList.toggle('bvf-empty-field', !visible);
        if (visible) {
          field.el.style.top = `${top}px`;
          top += (index === 0 ? m.titleHeight : m.propHeight) + m.propGap;
        }
      }
      card.el.style.top = `${slot.top}px`;
      card.el.style.minHeight = `${slot.height}px`;
    }
    const placeholder = layout.placeholder;
    if (placeholder && column.cardPlaceholderEl) {
      column.cardPlaceholderEl.style.top = `${placeholder.top}px`;
      column.cardPlaceholderEl.style.height = `${placeholder.height}px`;
    }
    column.innerEl.style.height = `${layout.height}px`;
    return result;
  }

  private detach(): void {
    const view = this.view;
    this.undo.splice(0).reverse().forEach(undo => undo());
    this.columns.forEach(undo => undo());
    this.columns.clear();
    this.layouts.clear();
    this.view = null;
    view?.containerEl.classList.remove('bvf-kanban');
    view?.containerEl.querySelectorAll('.bvf-empty-field').forEach(field => field.classList.remove('bvf-empty-field'));
    if (view?.containerEl.isConnected) view.updateVirtualDisplay();
  }

  destroy(): void { this.detach(); }
}
