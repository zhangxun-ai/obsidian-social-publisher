import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const directory = `dist/${manifest.id}`;
const projectLicense = await readFile('LICENSE', 'utf8');
const yamlLicense = await readFile('node_modules/yaml/LICENSE', 'utf8');
await mkdir(directory, { recursive: true });
const options = {
  entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs',
  target: 'es2022', external: ['obsidian', 'electron'],
  banner: { js: `/* Social Publisher\n${projectLicense}\nBundled dependency: yaml (ISC)\n${yamlLicense}\n*/` },
  outfile: `${directory}/main.js`, sourcemap: false, logLevel: 'info'
};
for (const name of ['manifest.json', 'styles.css']) {
  await copyFile(name, `${directory}/${name}`);
}
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
