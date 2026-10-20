import * as esbuild from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp('public', outdir, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    background: 'src/background.ts',
    content: 'src/content.ts',
    panel: 'src/panel/main.ts',
  },
  bundle: true,
  format: 'iife', // content script 不能是 ESM;其餘兩者 iife 也相容

  target: 'chrome114',
  outdir,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(options);
}
