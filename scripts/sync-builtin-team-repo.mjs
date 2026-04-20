import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const sourceRoot = path.resolve(
	process.env.ASYNC_BUILTIN_TEAM_SOURCE || 'D:\\WebstormProjects\\agency-agents'
);
const targetRoot = path.join(projectRoot, 'resources', 'builtin-team', 'agency-agents');

const SKIP_DIRS = new Set([
	'.git',
	'.github',
	'examples',
	'integrations',
	'node_modules',
	'scripts',
]);

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
	fs.rmSync(dirPath, { recursive: true, force: true });
	fs.mkdirSync(dirPath, { recursive: true });
}

function shouldCopyFile(fullPath) {
	return path.extname(fullPath).toLowerCase() === '.md';
}

function copyDocs(sourceDir, destDir) {
	ensureDir(destDir);
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) {
				continue;
			}
			copyDocs(path.join(sourceDir, entry.name), path.join(destDir, entry.name));
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const sourceFile = path.join(sourceDir, entry.name);
		if (!shouldCopyFile(sourceFile)) {
			continue;
		}
		ensureDir(destDir);
		fs.copyFileSync(sourceFile, path.join(destDir, entry.name));
	}
}

if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
	console.error(`[builtin-team] source repo not found: ${sourceRoot}`);
	process.exit(1);
}

cleanDir(targetRoot);
copyDocs(sourceRoot, targetRoot);
console.log(`[builtin-team] synced ${sourceRoot} -> ${targetRoot}`);
