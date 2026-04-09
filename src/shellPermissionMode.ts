import type { AgentCustomization, ShellPermissionMode } from './agentSettingsTypes';

export type { ShellPermissionMode };

export function getShellPermissionMode(agent: AgentCustomization | undefined): ShellPermissionMode {
	const a = agent ?? {};
	const m = a.shellPermissionMode;
	if (m === 'always' || m === 'rules' || m === 'ask_every_time') {
		return m;
	}
	if (a.confirmShellCommands === false) return 'always';
	if (a.skipSafeShellCommandsConfirm === false) return 'ask_every_time';
	return 'rules';
}

export function shellPermissionModeToAgentPatch(mode: ShellPermissionMode): Partial<AgentCustomization> {
	switch (mode) {
		case 'always':
			return { shellPermissionMode: 'always', confirmShellCommands: false };
		case 'rules':
			return { shellPermissionMode: 'rules', confirmShellCommands: true, skipSafeShellCommandsConfirm: true };
		case 'ask_every_time':
			return {
				shellPermissionMode: 'ask_every_time',
				confirmShellCommands: true,
				skipSafeShellCommandsConfirm: false,
			};
	}
}
