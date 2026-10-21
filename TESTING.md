# Testing

## Automated checks

Use Node.js 22 or later:

```sh
npm ci
npm run check
```

The unit suite covers favorite metadata, layout independence, ordering, renamed and deleted views, malformed metadata, fresh-vault installation, and safe cleanup when another plugin wraps the same native method. The TypeScript checker includes both source and test files.

## Real Obsidian smoke tests

Use a disposable vault named **Bases Enhancements QA**. The smoke script creates sample notes and bases in the connected vault and refuses to run if its name differs from the expected name.

1. Build the plugin and install it into the disposable vault:

   ```sh
   npm run build
   node scripts/install.mjs "/path/to/Bases Enhancements QA" --enable
   ```

2. Enable the Bases core plugin in that vault. Start a separate Obsidian instance with a separate user data directory and a loopback debugging port:

   ```sh
   Obsidian --user-data-dir="/path/to/disposable-profile" --remote-debugging-port=9237 --remote-debugging-address=127.0.0.1
   ```

3. Open the disposable vault in that instance and keep the test pane rendered, wide enough to show at least two favorite tabs.
4. Run:

   ```sh
   npm run test:native -- 9237
   ```

For a different disposable vault name, pass its exact name after the port:

```sh
npm run test:native -- 9237 "Another disposable vault"
```

The checks cover native starring controls, every built-in layout, keyboard reordering, configuration preservation, persisted favorites, plugin unload/reload, trusted Enter and Space events, and a trusted mouse drag.

To run only the native Kanban card checks, use:

```sh
npm run test:kanban -- 9237
```

These cover missing and blank values, empty lists, zero and unchecked checkboxes, literal text, the per-view toggle, scrolling, live note edits, persistence, cleanup, trusted mouse hover, variable card heights, long-column virtualization, drag placeholders and native moves, cover images, embedded-height sizing, and layout restoration on unload.

To verify native folder-aware note creation without the plugin enabled:

```sh
npm run test:creation -- 9237
```

These checks click the native New button across Table, Kanban, Cards, and List views, verify per-view and shared folder filters, retain native scalar and list property defaults, and assert that new notes match the originating view and appear in a visible Kanban column. A regression case verifies that showing an unassigned group reveals a previously hidden card without changing its frontmatter. All created notes stay in the disposable vault.

## Compatibility checks

Native integration has been checked on Obsidian **1.14.4 desktop on Windows**. Additional manual checks covered a registered community Board layout, independent panes with shared favorites, view and base renames, deleted views, file-backed embeds, cleanup, and toolbar widths of 1600, 800, and 480 pixels. Mobile hardware has not been tested.

The private integration surface is confined to `src/native.ts`, the controller hook in `src/main.ts`, toolbar controls in `src/toolbar.ts`, and Kanban decoration in `src/kanban.ts`. When upgrading Obsidian, rerun the native smoke test and check centered spacing, horizontal overflow, focus visibility, popup controls, multiple panes, and embeds.
