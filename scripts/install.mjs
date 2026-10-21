import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const vaultArg = process.argv[2];
if (!vaultArg || vaultArg.startsWith('--')) throw new Error('Usage: node scripts/install.mjs <vault-path> [--enable]');
const vault = path.resolve(vaultArg);
const config = path.join(vault, '.obsidian');
if (!(await fs.stat(config)).isDirectory()) throw new Error('Expected an existing vault with a .obsidian directory');
const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', dist), 'utf8'));
const artifacts = ['main.js', 'manifest.json', 'styles.css', 'versions.json'];
for (const artifact of artifacts) await fs.access(new URL(artifact, dist));
const enabledPath = path.join(config, 'community-plugins.json');
let enabled;
if (process.argv.includes('--enable')) {
  const enabledJson = await fs.readFile(enabledPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '[]';
    throw error;
  });
  enabled = JSON.parse(enabledJson.replace(/^\uFEFF/, ''));
  if (!Array.isArray(enabled) || enabled.some(id => typeof id !== 'string')) throw new Error('Invalid community-plugins.json; installation cancelled');
}
const target = path.join(config, 'plugins', manifest.id);
await fs.mkdir(target, { recursive: true });
for (const artifact of artifacts) await fs.copyFile(fileURLToPath(new URL(artifact, dist)), path.join(target, artifact));
if (enabled && !enabled.includes(manifest.id)) {
  await fs.writeFile(enabledPath, JSON.stringify([...enabled, manifest.id], null, 2) + '\n');
}
console.log(`Installed ${manifest.name} ${manifest.version} to ${target}`);
console.log(enabled ? 'Reload Obsidian to activate the plugin.' : 'Enable Bases View Favorites in Settings > Community plugins.');
