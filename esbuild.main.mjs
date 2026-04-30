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
	external: [
		'electron',
		'node-pty',
		// Keep native image processing external so electron-builder can package
		// the matching platform binaries instead of bundling sharp's JS loader.
		'sharp',
		'ssh2',
		'ssh2-sftp-client',
		'cpu-features',
		'chokidar',
		'fsevents',
		'better-sqlite3',
		// Playwright 携带可选依赖（chromium-bidi 等）和动态 require，
		// 不能 bundle，必须从 node_modules 在运行时加载。
		'playwright-core',
	],
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
