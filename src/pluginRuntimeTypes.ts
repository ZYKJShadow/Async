import type { AgentCommand, AgentSkill } from './agentSettingsTypes';
import type { McpServerConfig } from './mcpTypes';
import type { PluginInstallScope } from './pluginMarketplaceTypes';

export type PluginRuntimeContributionView = {
	pluginId: string;
	pluginName: string;
	installDir: string;
	scope: PluginInstallScope;
	skills: AgentSkill[];
	commands: AgentCommand[];
	mcpServers: McpServerConfig[];
};

export type PluginRuntimeState = {
	plugins: PluginRuntimeContributionView[];
	skills: AgentSkill[];
	commands: AgentCommand[];
	mcpServers: McpServerConfig[];
};

export const EMPTY_PLUGIN_RUNTIME_STATE: PluginRuntimeState = {
	plugins: [],
	skills: [],
	commands: [],
	mcpServers: [],
};
