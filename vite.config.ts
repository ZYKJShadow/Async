import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	base: './',
	root: '.',
	build: {
		target: 'esnext',
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks: {
					monaco: ['monaco-editor'],
				},
			},
		},
	},
	optimizeDeps: {
		include: ['monaco-editor', 'react', 'react-dom'],
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
