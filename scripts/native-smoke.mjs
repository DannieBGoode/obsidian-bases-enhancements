import fs from 'node:fs/promises';
const args = process.argv.slice(2).filter(arg => arg !== '--kanban-only');
const port = Number(args[0] ?? 9237);
const expectedVault = args[1] ?? 'Bases View Favorites QA';
const kanbanOnly = process.argv.includes('--kanban-only');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Expected a valid loopback debugging port');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(entry => entry.type === 'page' && entry.url === 'app://obsidian.md/index.html');
if (!target) throw new Error('No Obsidian vault window on that debugging port');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
const listeners = new Set();
socket.onmessage = ({ data }) => {
  const response = JSON.parse(data);
  for (const listener of listeners) listener(response);
  const handler = pending.get(response.id);
  if (!handler) return;
  pending.delete(response.id);
  clearTimeout(handler.timeout);
  response.error ? handler.reject(new Error(JSON.stringify(response.error))) : handler.resolve(response.result);
};
socket.onclose = () => {
  for (const handler of pending.values()) { clearTimeout(handler.timeout); handler.reject(new Error('Test app disconnected')); }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function smoke(vaultName) {
  if (app.vault.getName() !== vaultName) throw new Error(`Refusing to modify ${app.vault.getName()}; expected disposable vault ${vaultName}`);
  if (!app.plugins.plugins['bases-view-favorites']) throw new Error('Install and enable Bases View Favorites first');
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
  const folder = `_bvf-smoke-${Date.now()}`;
  await app.vault.createFolder(folder);
  await app.vault.create(`${folder}/Example.md`, '---\nStatus: ToDo\n---\nExample\n');
  const base = await app.vault.create(`${folder}/Favorites.base`, JSON.stringify({
    filters: `file.folder == "${folder}" && file.ext == "md"`,
    views: [
      { name: 'Home', type: 'table' },
      { name: 'Board', type: 'kanban', groupBy: { property: 'Status', direction: 'ASC' } },
      { name: 'List', type: 'list' },
      { name: 'Gallery', type: 'cards' }
    ]
  }, null, 2));
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(base);
  const ctrl = leaf.view.controller;
  const tabs = () => Array.from(ctrl.viewHeaderEl.querySelectorAll('.bvf-tab')).map(el => el.dataset.viewName);
  const canonical = () => { const value = ctrl.query.getSerializable(); value.views.forEach(view => delete view.viewFavorites); return JSON.stringify(value); };
  const original = canonical();
  await wait();
  assert(ctrl.viewHeaderEl.querySelector('.bvf-bar').hidden, 'Empty favorites bar is hidden');
  for (const name of ['Home', 'Board', 'List', 'Gallery']) {
    const host = ctrl.viewMenu.toolbarItem;
    host.setOpen(true);
    await wait();
    host.menu.scrollEl.querySelector(`[aria-label="Star view ${name}"]`).click();
    await wait();
    assert(ctrl.viewName === 'Home' && host.menu.isOpen, `Starring ${name} leaves the active view and dropdown intact`);
    host.setOpen(false);
  }
  for (const [name, type] of [['Home', 'table'], ['Board', 'kanban'], ['List', 'list'], ['Gallery', 'cards']]) {
    ctrl.viewHeaderEl.querySelector(`[data-view-name="${name}"]`).click();
    await wait();
    assert(ctrl.view.type === type && !ctrl.error, `Favorite uses the ${type} renderer`);
  }
  const gallery = ctrl.viewHeaderEl.querySelector('[data-view-name="Gallery"]');
  gallery.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
  assert(tabs().join(',') === 'Home,Board,Gallery,List', 'Keyboard reorder preserves the native view list');
  assert(ctrl.viewHeaderEl.querySelector('[data-view-name="Gallery"]') === gallery, 'Reorder retains the tab DOM node');
  ctrl.selectView('Board');
  const host = ctrl.viewMenu.toolbarItem;
  host.setOpen(true);
  await wait();
  host.menu.pageStack.at(-1).handleNext(ctrl.query.views.find(view => view.name === 'Board'));
  await wait();
  host.menu.scrollEl.querySelector('.bvf-config-star .checkbox-container').click();
  await wait();
  assert(!tabs().includes('Board') && ctrl.viewName === 'Board', 'Unstarring the active view keeps it open');
  host.menu.scrollEl.querySelector('.bvf-config-star .checkbox-container').click();
  await wait();
  assert(tabs().includes('Board'), 'Configure view can star the view again');
  host.setOpen(false);
  assert(canonical() === original, 'All original view filters, layout configuration, and native order are unchanged');
  const order = tabs().join(',');
  await wait(1000);
  assert((await app.vault.read(base)).includes('viewFavorites:'), 'Favorites persist in the base file');
  await app.plugins.disablePlugin('bases-view-favorites');
  assert(!document.querySelector('.bvf-bar,.bvf-star,.bvf-config-star,.bvf-toolbar'), 'Plugin unload removes all injected interface elements');
  ctrl.selectView('Home');
  assert(ctrl.view.type === 'table', 'Native view switching works after plugin unload');
  await app.plugins.enablePlugin('bases-view-favorites');
  await wait();
  assert(tabs().join(',') === order, 'Re-enabling restores favorites without duplicates');
  return { vault: vaultName, sample: base.path, checks };
}

async function compactKanbanSmoke(vaultName) {
  if (app.vault.getName() !== vaultName) throw new Error('Expected disposable vault');
  const checks = [];
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  const wait = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
  const folder = `_compact-kanban-${Date.now()}`;
  await app.vault.createFolder(folder);
  await app.vault.create(`${folder}/Cover.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#8296a8"/></svg>');
  await Promise.all(Array.from({ length: 80 }, (_, index) => app.vault.create(`${folder}/Task${String(index).padStart(3, '0')}.md`, `---\nStatus: ${index < 70 ? 'ToDo' : 'Done'}\n${index % 2 ? 'Detail: Next step\n' : ''}Cover: "[[${folder}/Cover.svg]]"\n---\n`)));
  const base = await app.vault.create(`${folder}/Long.base`, JSON.stringify({
    filters: `file.folder == "${folder}" && file.ext == "md"`,
    views: [
      { name: 'Compact', type: 'kanban', groupBy: { property: 'Status', direction: 'ASC' }, order: ['file.name', 'Detail'] },
      { name: 'Images', type: 'kanban', groupBy: { property: 'Status', direction: 'ASC' }, order: ['file.name', 'Detail'], image: 'note.Cover', imageAspectRatio: 0.5 }
    ]
  }, null, 2));
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(base);
  const c = window.compactKanbanController = leaf.view.controller;
  for (let i = 0; i < 60 && c.view.data?.data.length !== 80; i++) await wait(50);
  for (let i = 0; i < 60 && !c.view.columns.some(col => col.group.key?.toString() === 'ToDo' && col.group.entries.length === 70); i++) await wait(50);
  const v = c.view;
  const source = v.columns.find(col => col.group.key.toString() === 'ToDo');
  const target = v.columns.find(col => col.group.key.toString() === 'Done');
  assert(source && target && source.group.entries.length === 70, 'Long column fixture loaded');
  assert(source.items.length < source.group.entries.length / 2, 'Compact columns retain native virtualization');
  const empty = source.items.find(item => item.entry.file.basename === 'Task000');
  const filled = source.items.find(item => item.entry.file.basename === 'Task001');
  const emptyHeight = parseFloat(empty.el.style.minHeight), filledHeight = parseFloat(filled.el.style.minHeight);
  assert(emptyHeight < filledHeight, 'Title-only cards are shorter than populated cards');
  const expectedHeight = 35 * (emptyHeight + filledHeight) + 69 * v.measurements.cardGap;
  assert(Math.abs(parseFloat(source.innerEl.style.height) - expectedHeight) < 1, 'Column height sums compact cards without reserved space');
  source.contentEl.scrollTop = source.contentEl.scrollHeight;
  v.updateVirtualDisplay();
  await wait();
  const last = source.items.find(item => item.entry.file.basename === 'Task069');
  assert(last, 'Scrolling reaches the final card in a long compact column');
  assert(Math.abs(parseFloat(last.el.style.top) + parseFloat(last.el.style.minHeight) - expectedHeight) < 1, 'No blank tail is reserved after the final card');
  source.contentEl.scrollTop = 0;
  v.updateVirtualDisplay();
  const entry = source.group.entries.find(entry => entry.file.basename === 'Task000');
  const targetHeight = parseFloat(target.innerEl.style.height);
  v.setCardDrag(entry, target);
  assert(parseFloat(target.cardPlaceholderEl.style.height) === emptyHeight, 'Drop placeholder matches the dragged compact card height');
  assert(Math.abs(parseFloat(target.innerEl.style.height) - targetHeight - emptyHeight - v.measurements.cardGap) < 1, 'Drop placeholder adds exactly one compact slot');
  v.pendingMove = { entry, sourceKey: source.group.key, targetKey: target.group.key };
  v.updateVirtualDisplay();
  assert(!source.items.some(item => item.entry.file === entry.file), 'Optimistic native move removes the source card');
  await v.moveCardToColumn(entry.file, target.group.key);
  v.setCardDrag(null);
  for (let i = 0; i < 60 && v.columns.find(col => col.group.key.toString() === 'Done').group.entries.length !== 11; i++) await wait(50);
  assert(app.metadataCache.getFileCache(entry.file).frontmatter.Status === 'Done', 'Native move still updates frontmatter');
  assert(v.columns.find(col => col.group.key.toString() === 'Done').group.entries.length === 11, 'Moved card appears in its target column');
  c.selectView('Images');
  await wait();
  const imageView = c.view;
  const imageColumn = imageView.columns.find(col => col.group.key.toString() === 'ToDo');
  const covered = imageColumn.items.find(item => item.entry.file.basename === 'Task002');
  assert(covered.coverEl && parseFloat(covered.props[0].el.style.top) === imageView.measurements.coverHeight + imageView.measurements.cardPad.top, 'Cover images retain their height and title position');
  assert(parseFloat(covered.el.style.minHeight) === imageView.measurements.coverHeight + emptyHeight, 'Empty fields collapse beneath a cover image');
  c.selectView('Compact');
  await wait();

  const compactView = c.view;
  const embedHost = compactView.scrollEl.parentElement;
  embedHost.classList.add('bases-embed');
  try {
    compactView.updateVirtualDisplay();
    const maxHeight = Math.max(...compactView.columns.map(col => parseFloat(col.innerEl.style.height)));
    assert(parseFloat(compactView.containerEl.style.height) === compactView.measurements.pad.top + compactView.measurements.columnHeight + maxHeight + compactView.measurements.pad.bottom,
      'Embedded-height mode also collapses reserved card space');
  } finally {
    embedHost.classList.remove('bases-embed');
    compactView.updateVirtualDisplay();
  }
  await app.plugins.disablePlugin('bases-view-favorites');
  assert(!Object.hasOwn(compactView, 'updateVirtualDisplay') && compactView.columns.every(col => !Object.hasOwn(col, 'updateVirtualDisplay')),
    'Unloading restores view and column virtualization methods');
  assert(compactView.columns.every(col => col.items.every(card => parseFloat(card.el.style.minHeight) === compactView.measurements.cardHeight)),
    'Unloading restores native card heights and positions');
  await app.plugins.enablePlugin('bases-view-favorites');
  await wait();
  return { checks, sample: base.path };
}

async function kanbanSmoke(vaultName) {
  if (app.vault.getName() !== vaultName) throw new Error('Expected disposable vault');
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
  const folder = `_bvf-kanban-${Date.now()}`;
  await app.vault.createFolder(folder);
  const cases = [
    ['01 Filled', { Detail: 'Call the supplier', List: ['one'] }, false, false],
    ['02 Missing', {}, true, true],
    ['03 Blank', { Detail: '' }, true, true],
    ['04 Whitespace', { Detail: '   ' }, true, true],
    ['05 Empty items', { List: ['', null] }, true, true],
    ['06 Literal null', { Detail: 'null' }, false, true]
  ];
  for (const [name, fields] of cases) {
    const data = { Status: 'ToDo', Zero: 0, Check: false, List: [], Literal: '—', ...fields };
    await app.vault.create(`${folder}/${name}.md`, `---\n${Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n`);
  }
  const order = ['file.name', 'Detail', 'Zero', 'Check', 'List', 'Literal'];
  const base = await app.vault.create(`${folder}/Cards.base`, JSON.stringify({
    filters: `file.folder == "${folder}" && file.ext == "md"`,
    views: [
      { name: 'Board', type: 'kanban', groupBy: { property: 'Status', direction: 'ASC' }, order },
      { name: 'Other board', type: 'kanban', groupBy: { property: 'Status', direction: 'ASC' }, order, bvfHideEmptyFields: false },
      { name: 'Table', type: 'table', order }
    ]
  }, null, 2));
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(base);
  await wait();
  const c = window.kanbanSmokeController = leaf.view.controller;
  const getCard = async name => {
    const view = c.view;
    const column = view.columns[0];
    column.contentEl.scrollTop = 0;
    let card;
    for (let attempt = 0; attempt < 30; attempt++) {
      view.updateVirtualDisplay();
      await wait(25);
      card = column.items.find(item => item.entry?.file.basename === name);
      if (card) break;
      const last = column.contentEl.scrollTop;
      column.contentEl.scrollTop += Math.max(100, column.contentEl.clientHeight * 0.8);
      if (column.contentEl.scrollTop === last) break;
    }
    if (!card) throw new Error(`Expected virtualized card ${name}`);
    return card;
  };
  const hidden = (card, property) => {
    const field = card.props.find(field => field.prop === property);
    if (!field) throw new Error(`Missing test field ${property}`);
    return getComputedStyle(field.el).display === 'none';
  };
  assert(c.view.containerEl.classList.contains('bvf-kanban'), 'Kanban enhancement attaches independently of starred views');
  for (const [name, , emptyDetail, emptyList] of cases) {
    const card = await getCard(name);
    assert(hidden(card, 'note.Detail') === emptyDetail && hidden(card, 'note.List') === emptyList, `Empty field detection is correct for ${name}`);
    assert(!hidden(card, 'file.name') && !hidden(card, 'note.Zero') && !hidden(card, 'note.Check') && !hidden(card, 'note.Literal'), `Title, zero, unchecked checkbox, and literal dash stay visible on ${name}`);
  }
  const host = c.viewMenu.toolbarItem;
  const openConfig = async () => {
    host.setOpen(true);
    await wait();
    host.menu.pageStack.at(-1).handleNext(c.query.views.find(view => view.name === c.viewName));
    await wait();
  };
  await openConfig();
  let toggle = host.menu.scrollEl.querySelector('[aria-label="Hide empty fields"]');
  assert(toggle?.classList.contains('is-enabled') === true, 'Configure view exposes the enabled Hide empty fields option');
  const compactHeight = parseFloat((await getCard('02 Missing')).el.style.minHeight);
  toggle.click();
  await wait();
  assert(c.query.views[0].get('bvfHideEmptyFields') === false && !hidden(await getCard('02 Missing'), 'note.Detail'), 'Turning off Hide empty fields restores the native field and placeholder');
  toggle.click();
  await wait();
  const compactCard = await getCard('02 Missing');
  assert(hidden(compactCard, 'note.Detail') && parseFloat(compactCard.el.style.minHeight) === compactHeight
    && compactHeight < c.view.measurements.cardHeight, 'Turning on Hide empty fields shrinks cards instead of reserving empty space');
  const zero = compactCard.props.find(field => field.prop === 'note.Zero');
  const title = compactCard.props[0];
  assert(parseFloat(zero.el.style.top) === parseFloat(title.el.style.top) + c.view.measurements.titleHeight + c.view.measurements.propGap,
    'Populated fields move up across hidden fields');
  const visibleCards = c.view.columns[0].items;
  assert(visibleCards.slice(1).every((card, index) => Math.abs(parseFloat(card.el.style.top) - parseFloat(visibleCards[index].el.style.top)
    - parseFloat(visibleCards[index].el.style.minHeight) - c.view.measurements.cardGap) < 0.5), 'Cards close the gaps after hidden fields');
  host.setOpen(false);
  c.selectView('Other board');
  await wait();
  assert(!hidden(await getCard('02 Missing'), 'note.Detail'), 'Each Kanban view keeps its own empty-field preference');
  c.selectView('Table');
  await wait();
  assert(!c.viewContainerEl.querySelector('.bvf-kanban'), 'Switching to Table detaches Kanban decoration');
  await openConfig();
  assert(!host.menu.scrollEl.querySelector('[aria-label="Hide empty fields"]'), 'Table configuration has no Kanban-only option');
  host.setOpen(false);
  c.selectView('Board');
  await wait();
  const missing = app.vault.getAbstractFileByPath(`${folder}/02 Missing.md`);
  for (const [value, expected] of [['New next step', false], ['', true]]) {
    await app.fileManager.processFrontMatter(missing, data => { data.Detail = value; });
    let matches = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await wait(50);
      if (hidden(await getCard('02 Missing'), 'note.Detail') === expected) { matches = true; break; }
    }
    assert(matches, `Editing a card ${expected ? 'hides a newly empty' : 'reveals a populated'} field`);
  }
  await wait(1000);
  assert((await app.vault.read(base)).includes('bvfHideEmptyFields:'), 'Empty-field preferences persist in the base file');
  await app.plugins.disablePlugin('bases-view-favorites');
  assert(!c.viewContainerEl.querySelector('.bvf-kanban,.bvf-empty-field') && !Object.hasOwn(c.view, 'updateVirtualDisplay'), 'Unloading restores native rows, styling, and the virtualization method');
  await app.plugins.enablePlugin('bases-view-favorites');
  await wait();
  assert(hidden(await getCard('02 Missing'), 'note.Detail'), 'Re-enabling restores the saved empty-field preference');
  await getCard('01 Filled');
  return { sample: base.path, checks };
}

try {
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  let report = { vault: expectedVault, checks: [] };
  if (!kanbanOnly) {
    const result = await send('Runtime.evaluate', {
      expression: `(${smoke.toString()})(${JSON.stringify(expectedVault)})`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    report = result.result.value;
    const controller = `app.workspace.getLeavesOfType('bases').find(leaf => leaf.view.file?.path === ${JSON.stringify(report.sample)}).view.controller`;
    await send('Page.bringToFront');
    await evaluate(`(${controller}).viewMenu.toolbarItem.setOpen(true)`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await evaluate(`(${controller}).viewMenu.toolbarItem.menu.scrollEl.querySelector('[aria-label="Unstar view List"]').focus()`);
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    const keyboardState = starred => `(() => { const c = ${controller}; return c.viewName === 'Home' && c.viewMenu.toolbarItem.menu.isOpen && (!!c.viewHeaderEl.querySelector('[data-view-name="List"]')) === ${starred}; })()`;
    if (!await evaluate(keyboardState(false))) throw new Error('Native Enter did not toggle the focused star independently of view selection');
    await evaluate(`(${controller}).viewMenu.toolbarItem.menu.scrollEl.querySelector('[aria-label="Star view List"]').focus()`);
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    if (!await evaluate(keyboardState(true))) throw new Error('Native Space did not toggle the focused star independently of view selection');
    await evaluate(`(${controller}).viewMenu.toolbarItem.setOpen(false)`);
    report.checks.push('Trusted Enter and Space toggle stars without selecting a view or closing the dropdown');

    // Test a real HTML drag, including Chromium's drag-start threshold.
    await send('Page.captureScreenshot');
    const boxes = await evaluate(`Array.from((${controller}).viewHeaderEl.querySelectorAll('.bvf-tab')).slice(0,2).map(el => ({name:el.dataset.viewName,...el.getBoundingClientRect().toJSON()}))`);
    if (boxes.length < 2 || boxes.some(box => !box.width)) throw new Error('The native test pane must be rendered for the mouse drag test');
    const from = { x: boxes[0].x + boxes[0].width / 2, y: boxes[0].y + boxes[0].height / 2 };
    const to = { x: boxes[1].right - 4, y: boxes[1].y + boxes[1].height / 2 };
    let dragTimeout;
    let dragListener;
    const intercepted = new Promise((resolve, reject) => {
      dragTimeout = setTimeout(() => reject(new Error('No native drag start')), 5000);
      dragListener = event => {
        if (event.method !== 'Input.dragIntercepted') return;
        clearTimeout(dragTimeout);
        resolve(event.params.data);
      };
      listeners.add(dragListener);
    });
    await send('Input.setInterceptDrags', { enabled: true });
    try {
      await send('Input.cancelDragging');
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...from });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...from });
      // Let Chromium process the pressed state before crossing its drag threshold.
      await new Promise(resolve => setTimeout(resolve, 120));
      for (const distance of [4, 9, 18]) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: from.x + distance, y: from.y });
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      const data = await intercepted;
      for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, data, ...to });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to });
      const moved = await evaluate(`(() => { const c = ${controller}; return c.viewHeaderEl.querySelectorAll('.bvf-tab')[1]?.dataset.viewName === ${JSON.stringify(boxes[0].name)} && !c.viewHeaderEl.querySelector('.is-dragging,.bvf-drop-before,.bvf-drop-after'); })()`);
      if (!moved) throw new Error('Native mouse drag did not reorder the favorite tabs cleanly');
      report.checks.push('Trusted native mouse drag reorders tabs and removes drag indicators');
    } finally {
      await send('Input.cancelDragging');
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to });
      clearTimeout(dragTimeout);
      listeners.delete(dragListener);
      await send('Input.setInterceptDrags', { enabled: false });
    }
  }
  const kanbanReport = await evaluate(`(${kanbanSmoke.toString()})(${JSON.stringify(expectedVault)})`);
  report.checks.push(...kanbanReport.checks);
  report.kanbanSample = kanbanReport.sample;
  const firstCard = "kanbanSmokeController.view.columns[0].items.find(item => item.entry?.file.basename === '01 Filled').el";
  await send('Page.captureScreenshot');
  await send('Page.bringToFront');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  const background = await evaluate(`getComputedStyle(${firstCard}).backgroundColor`);
  const box = await evaluate(`(${firstCard}).getBoundingClientRect().toJSON()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.width / 2, y: box.y + 10 });
  await new Promise(resolve => setTimeout(resolve, 160));
  const hover = await evaluate(`({background:getComputedStyle(${firstCard}).backgroundColor,cursor:getComputedStyle(${firstCard}).cursor})`);
  if (background === hover.background || hover.cursor !== 'pointer') throw new Error('Kanban hover did not highlight the clickable card');
  report.checks.push('Trusted mouse hover highlights clickable Kanban cards');
  const compactReport = await evaluate(`(${compactKanbanSmoke.toString()})(${JSON.stringify(expectedVault)})`);
  report.checks.push(...compactReport.checks);
  report.compactSample = compactReport.sample;
  console.log(JSON.stringify(report, null, 2));
  const screenshot = await send('Page.captureScreenshot');
  const output = new URL('../.test-build/native-smoke.png', import.meta.url);
  await fs.mkdir(new URL('../.test-build/', import.meta.url), { recursive: true });
  await fs.writeFile(output, Buffer.from(screenshot.data, 'base64'));
  console.log(`Screenshot: ${output.pathname}`);
} finally {
  socket.close();
}
