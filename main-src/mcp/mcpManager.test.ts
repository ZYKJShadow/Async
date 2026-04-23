import { describe, expect, it } from 'vitest';
import { McpManager } from './mcpManager.js';
import type { McpServerConfig, McpServerStatus } from './mcpTypes.js';

function makeConfig(
	id: string,
	patch?: Partial<McpServerConfig>
): McpServerConfig {
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

function makeStatus(
	id: string,
	status: McpServerStatus['status']
): McpServerStatus {
	return {
		id,
		status,
		tools: status === 'connected' ? [{ name: 'ping', inputSchema: { type: 'object', properties: {}, required: [] } }] : [],
		resources: [],
		prompts: [],
	};
}

describe('McpManager', () => {
	it('reports disabled, not_started, stopped, and connected statuses distinctly', () => {
		const manager = new McpManager();
		const idle = makeConfig('idle');
		const disabled = makeConfig('disabled', { enabled: false });
		const stopped = makeConfig('stopped');
		const connected = makeConfig('connected');
		manager.loadConfigs([idle, disabled, stopped, connected]);

		(manager as any).clients.set('stopped', {
			config: stopped,
			getServerStatus: () => makeStatus('stopped', 'disconnected'),
		});
		(manager as any).clients.set('connected', {
			config: connected,
			getServerStatus: () => makeStatus('connected', 'connected'),
		});

		expect(manager.getServerStatuses()).toEqual([
			makeStatus('idle', 'not_started'),
			makeStatus('disabled', 'disabled'),
			makeStatus('stopped', 'stopped'),
			makeStatus('connected', 'connected'),
		]);
	});

	it('drops existing clients when a config is disabled or changed', () => {
		const manager = new McpManager();
		const base = makeConfig('srv');
		manager.loadConfigs([base]);

		const destroyed: string[] = [];
		(manager as any).clients.set('srv', {
			config: base,
			destroy: () => {
				destroyed.push('srv');
			},
			getServerStatus: () => makeStatus('srv', 'connected'),
		});

		manager.loadConfigs([{ ...base, enabled: false }]);
		expect(destroyed).toEqual(['srv']);
		expect((manager as any).clients.has('srv')).toBe(false);

		(manager as any).clients.set('srv', {
			config: base,
			destroy: () => {
				destroyed.push('srv:changed');
			},
			getServerStatus: () => makeStatus('srv', 'connected'),
		});
		manager.loadConfigs([{ ...base, command: 'uvx' }]);
		expect(destroyed).toEqual(['srv', 'srv:changed']);
		expect((manager as any).clients.has('srv')).toBe(false);
	});

	it('does NOT destroy a client that is currently connecting', () => {
		const manager = new McpManager();
		const base = makeConfig('srv');
		manager.loadConfigs([base]);

		const destroyed: string[] = [];
		(manager as any).clients.set('srv', {
			config: base,
			destroy: () => {
				destroyed.push('srv');
			},
			getServerStatus: () => makeStatus('srv', 'connecting'),
		});

		// Even though we disable the config, the connecting client should be protected
		manager.loadConfigs([{ ...base, enabled: false }]);
		expect(destroyed).toEqual([]);
		expect((manager as any).clients.has('srv')).toBe(true);
	});

	it('allows destroying a client once it leaves connecting state', () => {
		const manager = new McpManager();
		const base = makeConfig('srv');
		manager.loadConfigs([base]);

		const destroyed: string[] = [];
		const mockClient = {
			config: base,
			destroy: () => {
				destroyed.push('srv');
			},
			getServerStatus: () => makeStatus('srv', 'connecting'),
		};
		(manager as any).clients.set('srv', mockClient);

		// Protected while connecting
		manager.loadConfigs([{ ...base, enabled: false }]);
		expect(destroyed).toEqual([]);

		// Simulate connection finished (error)
		mockClient.getServerStatus = () => makeStatus('srv', 'error');
		manager.loadConfigs([{ ...base, enabled: false }]);
		expect(destroyed).toEqual(['srv']);
		expect((manager as any).clients.has('srv')).toBe(false);
	});

	it('restartServer stops then starts the server', async () => {
		const manager = new McpManager();
		const base = makeConfig('srv');
		manager.loadConfigs([base]);

		const events: string[] = [];
		(manager as any).clients.set('srv', {
			config: base,
			getServerStatus: () => makeStatus('srv', 'connected'),
			disconnect: async () => {
				events.push('disconnect');
			},
			connect: async () => {
				events.push('connect');
			},
		});

		await manager.restartServer('srv');
		expect(events).toEqual(['disconnect', 'connect']);
	});
});
