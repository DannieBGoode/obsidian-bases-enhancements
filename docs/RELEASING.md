# Releasing Bases Enhancements

## Build and verify

1. Keep `manifest.json`, `package.json`, and `versions.json` consistent. Obsidian requires a plain semantic version, such as `0.1.0`.
2. Run `npm ci` and `npm run check`. Follow [TESTING.md](../TESTING.md) to check the exact build in a disposable Obsidian vault.
3. Commit and push, then push a tag that matches the manifest version exactly, without a `v` prefix.
4. The release workflow runs the checks and creates a draft GitHub release containing `main.js`, `manifest.json`, and `styles.css`.
5. Verify the attached files against the build, write release notes, and publish the draft.

## Community directory

Manage the listing at [Obsidian Community](https://community.obsidian.md/account/plugins). Publish new entries there, then check the release scan results on the management page. Obsidian checks the manifest, release assets, source code, and build; a public listing alone does not mean installation is available. Submission does not make this a first-party Obsidian plugin.

- Repository: `https://github.com/DannieBGoode/obsidian-bases-enhancements`
- Name: **Bases Enhancements**
- Plugin ID: `bases-view-favorites` (preserved for existing installations)
- Minimum Obsidian version: **1.14.4**
- License: MIT
- Suggested categories: Bases, navigation, task management (choose available matches).
- No accounts, network access, telemetry, or payments are required by the plugin.
- Integration uses private Bases APIs; compatibility and tested platforms are documented in the README and testing guide.

### Screenshots

These screenshots contain sample notes and are 1200 × 800 pixels, ready for the directory's desktop screenshot slots:

1. [Centered tabs and compact board](images/directory/board.png)
2. [Star and unstar saved views](images/directory/star-views.png)
3. [Per-view controls](images/directory/configure-view.png)

### Official requirements

- [Set up and claim entries](https://docs.obsidian.md/community-directory/set-up-and-claim)
- [Plugin submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Manage an entry](https://docs.obsidian.md/community-directory/manage-entry)
