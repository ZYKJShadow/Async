import { describe, expect, it } from 'vitest';
import { McpManager } from './mcpManager.js';
import type { McpServerConfig, McpServerStatus } from './mcpTypes.js';

function makeConfig(id: string, patch?: Partial<McpServerConfig>): McpServerConfig {
	return {
		id,
		name: id,
		enabled: true,
		transport: 'stdio',
		command: 'npx',
		args: ['-y', 'demo'],
		...patch,
	};
}

function makeStatus(id: string, status: McpServerStatus['status']): McpServerStatus {
	return {
		id,
		status,
		tools: [],
		resources: [],
		prompts: [],
	};
}

describe('MCP critical fix verification', () => {
	it('loadConfigs does NOT destroy a client that is currently connecting', () => {
		const manager = new McpManager();
		const base = makeConfig('srv');
		manager.loadConfigs([base]);

		let destroyed = false;
		(manager as any).clients.set('srv', {
			config: base,
			destroy() {
				destroyed = true;
			},
			getServerStatus() {
				return makeStatus('srv', 'connecting');
			},
		});

		// Try to load a config that disables srv1
		manager.loadConfigs([{ ...base, enabled: false }]);

		expect(destroyed).toBe(false);
		expect((manager as any).clients.has('srv')).toBe(true);

		// Now simulate connection finished (error state)
		(manager as any).clients.get('srv').getServerStatus = () => makeStatus('srv', 'error');
		manager.loadConfigs([{ ...base, enabled: false }]);

		expect(destroyed).toBe(true);
		expect((manager as any).clients.has('srv')).toBe(false);
	});

	it('restartServer awaits disconnect before connect', async () => {
		const manager = new McpManager();
		const base = makeConfig('srv');
		manager.loadConfigs([base]);

		const events: string[] = [];
		(manager as any).clients.set('srv', {
			config: base,
			getServerStatus() {
				return makeStatus('srv', 'connected');
			},
			async disconnect() {
				await new Promise((r) => setTimeout(r, 10));
				events.push('disconnect-done');
			},
			async connect() {
				events.push('connect');
			},
		});

		await manager.restartServer('srv');
		expect(events).toEqual(['disconnect-done', 'connect']);
	});

	it('loadConfigs preserves unchanged clients across reloads', () => {
		const manager = new McpManager();
		const base = makeConfig('srv');
		manager.loadConfigs([base]);

		let destroyed = false;
		(manager as any).clients.set('srv', {
			config: base,
			destroy() {
				destroyed = true;
			},
			getServerStatus() {
				return makeStatus('srv', 'connected');
			},
		});

		// Reload identical config
		manager.loadConfigs([base]);

		expect(destroyed).toBe(false);
		expect((manager as any).clients.has('srv')).toBe(true);
	});
});
