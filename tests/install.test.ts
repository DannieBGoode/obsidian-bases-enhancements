import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function withVault(enabledJson: string | undefined, check: (fixture: {
  run: (...args: string[]) => ReturnType<typeof spawnSync>;
  config: string;
  plugin: string;
}) => void): void {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, 'bvf-install-'));
  try {
    const script = path.join(directory, 'scripts', 'install.mjs');
    mkdirSync(path.dirname(script));
    copyFileSync(path.join(__dirname, '..', 'scripts', 'install.mjs'), script);
    const dist = path.join(directory, 'dist');
    mkdirSync(dist);
    for (const [name, content] of Object.entries({
      'manifest.json': JSON.stringify({ id: 'bases-view-favorites', name: 'Bases Enhancements', version: '0.1.0' }),
      'main.js': 'example build',
      'styles.css': 'example styles',
      'versions.json': '{}'
    })) writeFileSync(path.join(dist, name), content);
    const vault = path.join(directory, 'vault');
    const config = path.join(vault, '.obsidian', 'community-plugins.json');
    mkdirSync(path.dirname(config), { recursive: true });
    if (enabledJson !== undefined) writeFileSync(config, enabledJson);
    check({
      run: (...args) => spawnSync(process.execPath, [script, vault, ...args], { encoding: 'utf8' }),
      config,
      plugin: path.join(vault, '.obsidian', 'plugins', 'bases-view-favorites')
    });
  } finally {
    if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith('bvf-install-')) {
      throw new Error('Unexpected temporary fixture path');
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test('installer enables the plugin in a vault with no existing community plugins file', () => {
  withVault(undefined, ({ run, config, plugin }) => {
    const result = run('--enable');
    assert.equal(result.status, 0, String(result.stderr));
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), ['bases-view-favorites']);
    assert.equal(readFileSync(path.join(plugin, 'main.js'), 'utf8'), 'example build');
    assert.ok(existsSync(path.join(plugin, 'styles.css')));
  });
});

test('installer preserves existing enabled plugins and avoids duplicate entries', () => {
  withVault('["existing-plugin"]', ({ run, config }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = run('--enable');
      assert.equal(result.status, 0, String(result.stderr));
    }
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), ['existing-plugin', 'bases-view-favorites']);
  });
});

test('installer without --enable copies artifacts without creating enabled settings', () => {
  withVault(undefined, ({ run, config, plugin }) => {
    const result = run();
    assert.equal(result.status, 0, String(result.stderr));
    assert.equal(existsSync(config), false);
    assert.ok(existsSync(path.join(plugin, 'manifest.json')));
  });
});

test('installer rejects malformed enabled settings before writing plugin files', () => {
  for (const contents of ['not JSON', '["existing-plugin", 42]']) {
    withVault(contents, ({ run, config, plugin }) => {
      assert.notEqual(run('--enable').status, 0);
      assert.equal(readFileSync(config, 'utf8'), contents);
      assert.equal(existsSync(plugin), false);
    });
  }
});
