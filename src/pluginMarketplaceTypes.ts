export type PluginInstallScope = 'user' | 'project';

export type PluginMarketplaceSourceKind = 'github' | 'git' | 'url' | 'directory' | 'file';

export type PluginSourceKind =
	| 'relative'
	| 'github'
	| 'git'
	| 'git-subdir'
	| 'url'
	| 'npm'
	| 'pip'
	| 'unknown';

export type InstalledPluginView = {
	id: string;
	pluginName: string;
	displayName: string;
	marketplaceName: string | null;
	scope: PluginInstallScope;
	installDir: string;
	enabled: boolean;
	version: string | null;
	description: string | null;
	sourceKind: 'marketplace' | 'local';
};

export type MarketplacePluginInstallView = {
	scope: PluginInstallScope;
	installDir: string;
	enabled: boolean;
	version: string | null;
};

export type MarketplacePluginView = {
	name: string;
	description: string | null;
	version: string | null;
	category: string | null;
	tags: string[];
	sourceKind: PluginSourceKind;
	installs: MarketplacePluginInstallView[];
};

export type MarketplaceView = {
	name: string;
	description: string | null;
	sourceKind: PluginMarketplaceSourceKind;
	sourceLabel: string;
	installLocation: string;
	manifestPath: string;
	pluginCount: number;
	isLocal: boolean;
	canRefresh: boolean;
	plugins: MarketplacePluginView[];
	error: string | null;
};

export type PluginPanelState = {
	userPluginsRoot: string;
	defaultUserPluginsRoot: string;
	userPluginsRootCustomized: boolean;
	projectPluginsRoot: string | null;
	installed: InstalledPluginView[];
	marketplaces: MarketplaceView[];
};
