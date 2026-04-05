/**
 * Rasterize docs/assets/async-logo.svg into:
 * - resources/icons/icon.png
 * - resources/icons/icon.ico
 * - public/favicon.png
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'docs', 'assets', 'async-logo.svg');
const outDir = path.join(root, 'resources', 'icons');
const outPng = path.join(outDir, 'icon.png');
const outIco = path.join(outDir, 'icon.ico');
const publicDir = path.join(root, 'public');
const faviconPng = path.join(publicDir, 'favicon.png');

const sharp = (await import('sharp')).default;
const pngToIco = (await import('png-to-ico')).default;

await mkdir(outDir, { recursive: true });
await mkdir(publicDir, { recursive: true });
const svg = await readFile(svgPath);

const size = 256;
const cornerRadius = Math.round(size * 0.156);
const logoPx = Math.round(size * 0.86);

const roundedPlateSvg = Buffer.from(
	`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
		<rect width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#0c0c0e"/>
	</svg>`,
);

const plate = await sharp(roundedPlateSvg).ensureAlpha().png().toBuffer();
const logo = await sharp(svg).resize(logoPx, logoPx).png().toBuffer();
const appIconPng = await sharp(plate)
	.composite([{ input: logo, gravity: 'center' }])
	.png()
	.toBuffer();

await writeFile(outPng, appIconPng);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoFrames = await Promise.all(
	icoSizes.map((sizePx) => sharp(appIconPng).resize(sizePx, sizePx).png().toBuffer()),
);
await writeFile(outIco, await pngToIco(icoFrames));

await sharp(appIconPng).resize(32, 32).png().toFile(faviconPng);

console.log('[export-app-icon] wrote', outPng, outIco, 'and', faviconPng);
