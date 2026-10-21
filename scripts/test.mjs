import { build } from 'esbuild';
import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const tests = (await readdir(new URL('tests/', root))).filter(name => name.endsWith('.test.ts'));
await mkdir(new URL('.test-build/', root), { recursive: true });
await build({
  entryPoints: tests.map(name => fileURLToPath(new URL('tests/' + name, root))),
  outdir: fileURLToPath(new URL('.test-build/', root)),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18'
});
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => fileURLToPath(new URL('.test-build/' + name.replace(/\.ts$/, '.js'), root)))], { stdio: 'inherit' });
process.exit(result.status ?? 1);
