export type McpKeyValueDraftEntry = {
	key: string;
	value: string;
};

export function serializeMcpArgs(args: readonly string[] | undefined): string[] {
	return (args ?? []).filter((arg) => arg.trim().length > 0);
}

export function serializeMcpKeyValueEntries(
	entries: readonly McpKeyValueDraftEntry[] | undefined
): Record<string, string> {
	const next: Record<string, string> = {};
	for (const entry of entries ?? []) {
		const key = entry.key.trim();
		if (!key) {
			continue;
		}
		next[key] = entry.value;
	}
	return next;
}

export function quoteMcpPreviewToken(token: string): string {
	if (!token.length) {
		return '""';
	}
	if (!/[\s"]/u.test(token)) {
		return token;
	}
	return `"${token.replace(/"/g, '\\"')}"`;
}

export function formatMcpCommandPreview(command: string | undefined, args: readonly string[] | undefined): string {
	const parts = [
		...(command?.trim() ? [command] : []),
		...serializeMcpArgs(args),
	];
	return parts.map(quoteMcpPreviewToken).join(' ');
}
