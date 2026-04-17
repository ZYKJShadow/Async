let pluginDiscoveryVersion = 0;

export function getPluginDiscoveryVersion(): number {
	return pluginDiscoveryVersion;
}

export function bumpPluginDiscoveryVersion(): number {
	pluginDiscoveryVersion += 1;
	return pluginDiscoveryVersion;
}
