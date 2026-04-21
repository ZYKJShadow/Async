import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	base: './',
	root: '.',
	resolve: {
		alias: {
			'@resources': path.resolve(__dirname, 'resources'),
		},
	},
	build: {
		target: 'esnext',
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks: {
					monaco: ['monaco-editor'],
					xterm: ['@xterm/xterm', '@xterm/addon-fit'],
					markdown: ['react-markdown', 'remark-gfm'],
					charts: ['recharts'],
				},
			},
		},
	},
	optimizeDeps: {
		include: ['monaco-editor', 'react', 'react-dom', 'shiki', '@shikijs/engine-javascript'],
	},
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true,
	},
	preview: {
		host: '127.0.0.1',
		port: 4173,
		strictPort: true,
	},
});
