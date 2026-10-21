import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const readJson = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const [manifest, pkg, versions] = await Promise.all(['manifest.json', 'package.json', 'versions.json'].map(readJson));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || pkg.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error('package.json, manifest.json, and versions.json must have matching release metadata');
}
await mkdir(new URL('dist/', root), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('src/main.ts', root))],
  outfile: fileURLToPath(new URL('dist/main.js', root)),
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  logLevel: 'info'
});
for (const name of ['manifest.json', 'styles.css', 'versions.json']) {
  await copyFile(new URL(name, root), new URL('dist/' + name, root));
}
