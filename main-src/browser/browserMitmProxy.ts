import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tls from 'node:tls';
import * as zlib from 'node:zlib';
import * as forge from 'node-forge';
import { addBrowserCaptureExternalRequestForHostId } from './browserCapture.js';

const DEFAULT_PROXY_PORT = 8888;
const CA_KEY_FILE = 'async-capture-ca-key.pem';
const CA_CERT_FILE = 'async-capture-ca.pem';
const CA_DOWNLOAD_PATH = '/__async_capture/ca.pem';
const MAX_CAPTURE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CERT_CACHE_SIZE = 300;

const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'proxy-connection',
	'te',
	'trailer',
	'upgrade',
]);

export type BrowserCaptureProxyStatus = {
	running: boolean;
	port: number;
	ownerHostId: number | null;
	localAddresses: string[];
	primaryAddress: string;
	proxyUrl: string;
	caDownloadUrl: string;
	caCertPath: string;
	caReady: boolean;
	caInstalled: boolean;
	systemProxyEnabled: boolean;
	httpsMitm: boolean;
	startedAt: number | null;
	requestCount: number;
	lastError: string | null;
};

export type BrowserCaptureProxyCaExport = {
	fileName: string;
	mimeType: string;
	pem: string;
	path: string;
};

type ProxyTarget = {
	protocol: 'http:' | 'https:';
	hostname: string;
	port: number;
	hostHeader: string;
	url: URL;
};

type ConnectTarget = {
	hostname: string;
	port: number;
	hostHeader: string;
};

type CaptureBuffer = {
	chunks: Buffer[];
	bytes: number;
	truncated: boolean;
};

class BrowserCaptureCaStore {
	private caKey: forge.pki.rsa.KeyPair | null = null;
	private caCert: forge.pki.Certificate | null = null;
	private leafKey: forge.pki.rsa.KeyPair | null = null;
	private contextCache = new Map<string, tls.SecureContext>();

	get certsDir(): string {
		return path.join(app.getPath('userData'), 'capture-certificates');
	}

	get caCertPath(): string {
		return path.join(this.certsDir, CA_CERT_FILE);
	}

	get caKeyPath(): string {
		return path.join(this.certsDir, CA_KEY_FILE);
	}

	isReady(): boolean {
		return this.caKey !== null && this.caCert !== null && existsSync(this.caCertPath);
	}

	ensureReady(): void {
		if (this.caKey && this.caCert) {
			return;
		}
		mkdirSync(this.certsDir, { recursive: true });
		if (existsSync(this.caKeyPath) && existsSync(this.caCertPath)) {
			const keyPem = readFileSync(this.caKeyPath, 'utf8');
			const certPem = readFileSync(this.caCertPath, 'utf8');
			const privateKey = forge.pki.privateKeyFromPem(keyPem);
			this.caKey = {
				privateKey,
				publicKey: forge.pki.setRsaPublicKey(privateKey.n, privateKey.e),
			} as forge.pki.rsa.KeyPair;
			this.caCert = forge.pki.certificateFromPem(certPem);
			return;
		}
		this.generateCa();
	}

	readCaPem(): string {
		this.ensureReady();
		return readFileSync(this.caCertPath, 'utf8');
	}

	getSecureContextForHost(hostname: string): tls.SecureContext {
		this.ensureReady();
		const normalized = hostname.trim().toLowerCase();
		const cached = this.contextCache.get(normalized);
		if (cached) {
			this.contextCache.delete(normalized);
			this.contextCache.set(normalized, cached);
			return cached;
		}
		if (this.contextCache.size >= MAX_CERT_CACHE_SIZE) {
			const oldestKey = this.contextCache.keys().next().value;
			if (oldestKey) {
				this.contextCache.delete(oldestKey);
			}
		}
		const { key, cert } = this.issueLeafCert(normalized);
		const secureContext = tls.createSecureContext({ key, cert });
		this.contextCache.set(normalized, secureContext);
		return secureContext;
	}

	private generateCa(): void {
		const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
		const cert = forge.pki.createCertificate();
		cert.publicKey = keys.publicKey;
		cert.serialNumber = this.randomSerial();
		const now = new Date();
		cert.validity.notBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
		cert.validity.notAfter = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
		const attrs: forge.pki.CertificateField[] = [
			{ shortName: 'CN', value: 'Async IDE Local Capture Root' },
			{ shortName: 'O', value: 'Async IDE' },
		];
		cert.setSubject(attrs);
		cert.setIssuer(attrs);
		cert.setExtensions([
			{ name: 'basicConstraints', cA: true, critical: true },
			{ name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
			{ name: 'subjectKeyIdentifier' },
		]);
		cert.sign(keys.privateKey, forge.md.sha256.create());
		this.caKey = keys;
		this.caCert = cert;
		this.contextCache.clear();
		writeFileSync(this.caKeyPath, forge.pki.privateKeyToPem(keys.privateKey), 'utf8');
		writeFileSync(this.caCertPath, forge.pki.certificateToPem(cert), 'utf8');
	}

	private getLeafKey(): forge.pki.rsa.KeyPair {
		if (!this.leafKey) {
			this.leafKey = forge.pki.rsa.generateKeyPair({ bits: 2048 });
		}
		return this.leafKey;
	}

	private issueLeafCert(hostname: string): { key: string; cert: string } {
		if (!this.caKey || !this.caCert) {
			throw new Error('Capture CA is not initialized.');
		}
		const keys = this.getLeafKey();
		const cert = forge.pki.createCertificate();
		cert.publicKey = keys.publicKey;
		cert.serialNumber = this.randomSerial();
		const now = new Date();
		cert.validity.notBefore = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
		cert.validity.notAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 398);
		cert.setSubject([{ shortName: 'CN', value: hostname }]);
		cert.setIssuer(this.caCert.subject.attributes);
		const altName =
			net.isIP(hostname) > 0
				? { type: 7, ip: hostname }
				: { type: 2, value: hostname };
		cert.setExtensions([
			{ name: 'basicConstraints', cA: false },
			{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
			{ name: 'extKeyUsage', serverAuth: true },
			{ name: 'subjectAltName', altNames: [altName] },
		]);
		cert.sign(this.caKey.privateKey, forge.md.sha256.create());
		return {
			key: forge.pki.privateKeyToPem(keys.privateKey),
			cert: forge.pki.certificateToPem(cert),
		};
	}

	private randomSerial(): string {
		return `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
	}
}

class BrowserCaptureMitmProxyService {
	private readonly caStore = new BrowserCaptureCaStore();
	private server: http.Server | null = null;
	private tlsHttpServer: http.Server | null = null;
	private readonly sockets = new Set<net.Socket>();
	private readonly tunneledTargets = new WeakMap<net.Socket, ConnectTarget>();
	private ownerHostId: number | null = null;
	private port = DEFAULT_PROXY_PORT;
	private startedAt: number | null = null;
	private requestCount = 0;
	private lastError: string | null = null;
	private caInstalled = false;
	private systemProxyEnabled = false;

	setCaInstalledHint(installed: boolean): void {
		this.caInstalled = installed;
	}

	setSystemProxyEnabledHint(enabled: boolean): void {
		this.systemProxyEnabled = enabled;
	}

	getStatus(): BrowserCaptureProxyStatus {
		const localAddresses = getLocalIPv4Addresses();
		const primaryAddress = localAddresses[0] ?? '127.0.0.1';
		const port = this.port || DEFAULT_PROXY_PORT;
		const proxyUrl = `http://${primaryAddress}:${port}`;
		return {
			running: Boolean(this.server?.listening),
			port,
			ownerHostId: this.ownerHostId,
			localAddresses,
			primaryAddress,
			proxyUrl,
			caDownloadUrl: `${proxyUrl}${CA_DOWNLOAD_PATH}`,
			caCertPath: this.caStore.caCertPath,
			caReady: this.caStore.isReady(),
			caInstalled: this.caInstalled,
			systemProxyEnabled: this.systemProxyEnabled,
			httpsMitm: true,
			startedAt: this.startedAt,
			requestCount: this.requestCount,
			lastError: this.lastError,
		};
	}

	exportCa(): BrowserCaptureProxyCaExport {
		return {
			fileName: CA_CERT_FILE,
			mimeType: 'application/x-pem-file',
			pem: this.caStore.readCaPem(),
			path: this.caStore.caCertPath,
		};
	}

	async start(hostId: number, options?: { port?: number }): Promise<BrowserCaptureProxyStatus> {
		const requestedPort = normalizeListenPort(options?.port ?? DEFAULT_PROXY_PORT);
		this.ownerHostId = hostId;
		this.caStore.ensureReady();
		if (this.server?.listening && this.port === requestedPort) {
			this.lastError = null;
			return this.getStatus();
		}
		if (this.server) {
			await this.stop();
			this.ownerHostId = hostId;
		}
		this.port = requestedPort;
		this.tlsHttpServer = http.createServer((req, res) => {
			const target = this.tunneledTargets.get(req.socket);
			this.handleProxyRequest(req, res, target ? connectTargetToProxyTarget(req, target) : null);
		});
		this.server = http.createServer((req, res) => {
			this.handleProxyRequest(req, res, null);
		});
		this.server.on('connect', (req, socket, head) => this.handleConnect(req, socket as net.Socket, head));
		this.server.on('connection', (socket) => this.trackSocket(socket));
		this.server.on('error', (error) => {
			this.lastError = error instanceof Error ? error.message : String(error);
		});
		await new Promise<void>((resolve, reject) => {
			const server = this.server;
			if (!server) {
				reject(new Error('Proxy server was not created.'));
				return;
			}
			const onError = (error: Error) => {
				server.off('listening', onListening);
				this.lastError = error.message;
				reject(error);
			};
			const onListening = () => {
				server.off('error', onError);
				this.startedAt = Date.now();
				this.lastError = null;
				resolve();
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen(this.port, '0.0.0.0');
		});
		return this.getStatus();
	}

	async stop(): Promise<BrowserCaptureProxyStatus> {
		for (const socket of Array.from(this.sockets)) {
			socket.destroy();
		}
		this.sockets.clear();
		const server = this.server;
		const tlsHttpServer = this.tlsHttpServer;
		this.server = null;
		this.tlsHttpServer = null;
		this.startedAt = null;
		if (server?.listening) {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
		tlsHttpServer?.close();
		return this.getStatus();
	}

	private trackSocket(socket: net.Socket): void {
		this.sockets.add(socket);
		socket.on('close', () => {
			this.sockets.delete(socket);
		});
	}

	private handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
		const target = parseConnectTarget(req.url);
		if (!target) {
			clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
			return;
		}
		let secureContext: tls.SecureContext;
		try {
			secureContext = this.caStore.getSecureContextForHost(target.hostname);
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
			return;
		}
		clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Async IDE Capture\r\n\r\n');
		const tlsSocket = new tls.TLSSocket(clientSocket, {
			isServer: true,
			secureContext,
		});
		this.trackSocket(tlsSocket);
		this.tunneledTargets.set(tlsSocket, target);
		tlsSocket.on('error', (error) => {
			this.lastError = error instanceof Error ? error.message : String(error);
			tlsSocket.destroy();
		});
		if (head.length > 0) {
			tlsSocket.unshift(head);
		}
		this.tlsHttpServer?.emit('connection', tlsSocket);
	}

	private handleProxyRequest(
		clientReq: http.IncomingMessage,
		clientRes: http.ServerResponse,
		fallbackTarget: ProxyTarget | null
	): void {
		if (isCaDownloadRequest(clientReq.url)) {
			this.serveCaCertificate(clientRes);
			return;
		}
		const target = resolveProxyTarget(clientReq, fallbackTarget);
		if (!target) {
			clientRes.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
			clientRes.end('Async proxy could not resolve the target URL.');
			return;
		}
		const hostId = this.ownerHostId;
		const startedAt = Date.now();
		const method = String(clientReq.method || 'GET').toUpperCase();
		const requestCapture = createCaptureBuffer();
		const upstreamHeaders = buildUpstreamHeaders(clientReq.headers, target.hostHeader);
		let recorded = false;
		const recordCapture = (
			status: number | null,
			responseHeaders: http.IncomingHttpHeaders,
			responseCapture: CaptureBuffer | null,
			errorText: string | null
		) => {
			if (recorded || hostId == null) {
				return;
			}
			recorded = true;
			const requestBody = finalizeCapturedBody(requestCapture, clientReq.headers);
			const responseBody = responseCapture ? finalizeCapturedBody(responseCapture, responseHeaders) : null;
			this.requestCount += 1;
			addBrowserCaptureExternalRequestForHostId(hostId, {
				method,
				url: target.url.toString(),
				status,
				requestHeaders: clientReq.headers,
				requestBody: requestBody?.body ?? null,
				requestBodyTruncated: requestBody?.truncated,
				responseHeaders,
				responseBody: responseBody?.body ?? null,
				responseBodyTruncated: responseBody?.truncated,
				responseBodyOmittedReason: responseBody?.omittedReason ?? null,
				resourceType: 'proxy',
				startedAt,
				durationMs: Date.now() - startedAt,
				errorText,
			});
		};
		clientReq.on('data', (chunk: Buffer) => addCaptureChunk(requestCapture, chunk));
		const transport = target.protocol === 'https:' ? https : http;
		const upstreamReq = transport.request(
			{
				protocol: target.protocol,
				hostname: target.hostname,
				port: target.port,
				method,
				path: `${target.url.pathname}${target.url.search}`,
				headers: upstreamHeaders,
				rejectUnauthorized: false,
			},
			(upstreamRes) => {
				const responseCapture = createCaptureBuffer();
				clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, upstreamRes.headers);
				upstreamRes.on('data', (chunk: Buffer) => addCaptureChunk(responseCapture, chunk));
				upstreamRes.on('end', () => {
					recordCapture(upstreamRes.statusCode ?? null, upstreamRes.headers, responseCapture, null);
				});
				upstreamRes.on('error', (error) => {
					const message = error instanceof Error ? error.message : String(error);
					this.lastError = message;
					recordCapture(upstreamRes.statusCode ?? null, upstreamRes.headers, responseCapture, message);
					clientRes.destroy();
				});
				upstreamRes.pipe(clientRes);
			}
		);
		upstreamReq.on('error', (error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.lastError = message;
			recordCapture(null, {}, null, message);
			if (!clientRes.headersSent) {
				clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
				clientRes.end('Async proxy upstream request failed.');
			} else {
				clientRes.destroy();
			}
		});
		clientReq.on('error', (error) => {
			this.lastError = error instanceof Error ? error.message : String(error);
			upstreamReq.destroy();
		});
		clientReq.pipe(upstreamReq);
	}

	private serveCaCertificate(clientRes: http.ServerResponse): void {
		try {
			const pem = this.caStore.readCaPem();
			clientRes.writeHead(200, {
				'cache-control': 'no-store',
				'content-disposition': `attachment; filename="${CA_CERT_FILE}"`,
				'content-type': 'application/x-pem-file; charset=utf-8',
			});
			clientRes.end(pem);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.lastError = message;
			clientRes.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
			clientRes.end(message);
		}
	}
}

const proxyService = new BrowserCaptureMitmProxyService();

export function getBrowserCaptureProxyStatusForHostId(_hostId: number): BrowserCaptureProxyStatus {
	return proxyService.getStatus();
}

export async function startBrowserCaptureProxyForHostId(
	hostId: number,
	options?: { port?: number }
): Promise<BrowserCaptureProxyStatus> {
	return await proxyService.start(hostId, options);
}

export async function stopBrowserCaptureProxyForHostId(_hostId: number): Promise<BrowserCaptureProxyStatus> {
	return await proxyService.stop();
}

export function exportBrowserCaptureProxyCaForHostId(_hostId: number): BrowserCaptureProxyCaExport {
	return proxyService.exportCa();
}

export function setBrowserCaptureProxyCaInstalled(installed: boolean): void {
	proxyService.setCaInstalledHint(installed);
}

export function setBrowserCaptureProxySystemProxyEnabled(enabled: boolean): void {
	proxyService.setSystemProxyEnabledHint(enabled);
}

export async function disposeBrowserCaptureProxy(): Promise<void> {
	await proxyService.stop();
}

function normalizeListenPort(raw: unknown): number {
	const port = Number(raw);
	return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PROXY_PORT;
}

function normalizeTargetPort(raw: unknown, fallback: number): number {
	const port = Number(raw);
	return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function getLocalIPv4Addresses(): string[] {
	const out: string[] = [];
	for (const entries of Object.values(os.networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === 'IPv4' && !entry.internal && entry.address && !out.includes(entry.address)) {
				out.push(entry.address);
			}
		}
	}
	return out;
}

function parseConnectTarget(rawUrl: string | undefined): ConnectTarget | null {
	const raw = String(rawUrl ?? '').trim();
	if (!raw) {
		return null;
	}
	try {
		const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
		const hostname = parsed.hostname.trim();
		const port = normalizeTargetPort(parsed.port ? Number(parsed.port) : 443, 443);
		if (!hostname) {
			return null;
		}
		return {
			hostname,
			port,
			hostHeader: formatHostHeader(hostname, port, 'https:'),
		};
	} catch {
		return null;
	}
}

function connectTargetToProxyTarget(req: http.IncomingMessage, target: ConnectTarget): ProxyTarget {
	const rawPath = String(req.url || '/');
	const url = new URL(rawPath.startsWith('/') ? rawPath : `/${rawPath}`, `https://${target.hostHeader}`);
	return {
		protocol: 'https:',
		hostname: target.hostname,
		port: target.port,
		hostHeader: target.hostHeader,
		url,
	};
}

function resolveProxyTarget(req: http.IncomingMessage, fallbackTarget: ProxyTarget | null): ProxyTarget | null {
	const rawUrl = String(req.url || '').trim();
	if (!rawUrl) {
		return null;
	}
	try {
		const url =
			/^[a-z][a-z\d+\-.]*:\/\//i.test(rawUrl)
				? new URL(rawUrl)
				: fallbackTarget
					? new URL(rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`, `${fallbackTarget.protocol}//${fallbackTarget.hostHeader}`)
					: new URL(rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`, `http://${String(req.headers.host ?? '')}`);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return null;
		}
		const hostname = url.hostname.trim();
		if (!hostname) {
			return null;
		}
		const port = normalizeTargetPort(
			url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
			url.protocol === 'https:' ? 443 : 80
		);
		return {
			protocol: url.protocol as 'http:' | 'https:',
			hostname,
			port,
			hostHeader: formatHostHeader(hostname, port, url.protocol as 'http:' | 'https:'),
			url,
		};
	} catch {
		return null;
	}
}

function formatHostHeader(hostname: string, port: number, protocol: 'http:' | 'https:'): string {
	const host = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
	const defaultPort = protocol === 'https:' ? 443 : 80;
	return port === defaultPort ? host : `${host}:${port}`;
}

function isCaDownloadRequest(rawUrl: string | undefined): boolean {
	const raw = String(rawUrl || '').trim();
	if (!raw) {
		return false;
	}
	try {
		const pathname = /^[a-z][a-z\d+\-.]*:\/\//i.test(raw) ? new URL(raw).pathname : new URL(raw, 'http://proxy.local').pathname;
		return pathname === CA_DOWNLOAD_PATH;
	} catch {
		return raw === CA_DOWNLOAD_PATH;
	}
}

function buildUpstreamHeaders(headers: http.IncomingHttpHeaders, hostHeader: string): http.OutgoingHttpHeaders {
	const out: http.OutgoingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		const lower = name.toLowerCase();
		if (!value || HOP_BY_HOP_HEADERS.has(lower)) {
			continue;
		}
		out[name] = value;
	}
	out.host = hostHeader;
	out.via = appendHeaderValue(headers.via, 'Async IDE Capture');
	return out;
}

function appendHeaderValue(existing: string | string[] | undefined, value: string): string {
	if (Array.isArray(existing)) {
		return [...existing, value].join(', ');
	}
	return existing ? `${existing}, ${value}` : value;
}

function createCaptureBuffer(): CaptureBuffer {
	return {
		chunks: [],
		bytes: 0,
		truncated: false,
	};
}

function addCaptureChunk(capture: CaptureBuffer, chunk: Buffer): void {
	if (capture.bytes >= MAX_CAPTURE_BODY_BYTES) {
		capture.truncated = true;
		return;
	}
	const remaining = MAX_CAPTURE_BODY_BYTES - capture.bytes;
	if (chunk.length <= remaining) {
		capture.chunks.push(Buffer.from(chunk));
		capture.bytes += chunk.length;
		return;
	}
	capture.chunks.push(Buffer.from(chunk.subarray(0, remaining)));
	capture.bytes += remaining;
	capture.truncated = true;
}

function finalizeCapturedBody(
	capture: CaptureBuffer,
	headers: http.IncomingHttpHeaders
): { body: Buffer | string | null; truncated: boolean; omittedReason: string | null } {
	if (capture.chunks.length <= 0) {
		return { body: null, truncated: false, omittedReason: null };
	}
	if (capture.truncated) {
		return {
			body: Buffer.concat([...capture.chunks, Buffer.from('\n[TRUNCATED]')]),
			truncated: true,
			omittedReason: 'body-too-large',
		};
	}
	const body = Buffer.concat(capture.chunks);
	const encoding = headerValue(headers['content-encoding']).toLowerCase();
	if (!encoding || encoding === 'identity') {
		return { body, truncated: false, omittedReason: null };
	}
	try {
		if (encoding.includes('br')) {
			return { body: zlib.brotliDecompressSync(body), truncated: false, omittedReason: null };
		}
		if (encoding.includes('gzip')) {
			return { body: zlib.gunzipSync(body), truncated: false, omittedReason: null };
		}
		if (encoding.includes('deflate')) {
			return { body: zlib.inflateSync(body), truncated: false, omittedReason: null };
		}
		return { body, truncated: false, omittedReason: null };
	} catch {
		return { body: null, truncated: false, omittedReason: 'decode-failed' };
	}
}

function headerValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value.join(', ');
	}
	return value ?? '';
}
