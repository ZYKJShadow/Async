import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isWatch = process.argv.includes('--watch');

const ctx = await esbuild.context({
	entryPoints: [path.join(__dirname, 'main-src', 'index.ts')],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'cjs',
	outfile: path.join(__dirname, 'electron', 'main.bundle.cjs'),
	external: ['electron', 'node-pty', 'ssh2', 'ssh2-sftp-client', 'cpu-features'],
	sourcemap: true,
	minify: !isWatch,
});

if (isWatch) {
	await ctx.watch();
	console.log('[esbuild] watching main-src → electron/main.bundle.cjs');
} else {
	await ctx.rebuild();
	await ctx.dispose();
	console.log('[esbuild] built electron/main.bundle.cjs');
}
