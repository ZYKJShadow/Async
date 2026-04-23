import { useCallback, useMemo, useState } from 'react';
import { useI18n } from './i18n';
import type { McpServerConfig, McpServerTemplate } from './mcpTypes';
import { exportMcpServersToJson, parseMcpServersJson } from './mcpJsonUtils';

export type SettingsMcpJsonEditorProps = {
	servers: McpServerConfig[];
	onChangeServers: (servers: McpServerConfig[]) => void;
	templates: McpServerTemplate[];
};

function templateToJsonSnippet(template: McpServerTemplate): string {
	const server: Partial<McpServerConfig> = {
		name: template.name,
		transport: template.transport,
		enabled: true,
		autoStart: true,
		timeout: 30000,
	};
	if (template.command) server.command = template.command;
	if (template.args) server.args = template.args;
	if (template.env) server.env = template.env;
	if (template.url) server.url = template.url;
	return JSON.stringify(server, null, 2);
}

export function SettingsMcpJsonEditor({ servers, onChangeServers, templates }: SettingsMcpJsonEditorProps) {
	const { t } = useI18n();
	const initialJson = useMemo(() => exportMcpServersToJson(servers), []);
	const [jsonText, setJsonText] = useState(initialJson);
	const [error, setError] = useState<string | null>(null);

	const handleChange = useCallback((value: string) => {
		setJsonText(value);
		const result = parseMcpServersJson(value);
		if (result.ok) {
			setError(null);
			onChangeServers(result.servers);
		} else {
			setError(result.error);
		}
	}, [onChangeServers]);

	const handleExport = useCallback(() => {
		const blob = new Blob([jsonText], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'mcp-servers.json';
		a.click();
		URL.revokeObjectURL(url);
	}, [jsonText]);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(jsonText);
		} catch {
			// ignore
		}
	}, [jsonText]);

	const handleImport = useCallback(() => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				setJsonText(text);
				const result = parseMcpServersJson(text);
				if (result.ok) {
					setError(null);
					onChangeServers(result.servers);
				} else {
					setError(result.error);
				}
			} catch {
				setError('Failed to read file');
			}
		};
		input.click();
	}, [onChangeServers]);

	const insertTemplate = useCallback((template: McpServerTemplate) => {
		const snippet = templateToJsonSnippet(template);
		let nextText = jsonText.trim();
		// 尝试以当前内容为基础插入；如果当前不是合法数组，则重置为单元素数组
		const currentParse = parseMcpServersJson(nextText);
		if (!currentParse.ok || nextText === '[]') {
			nextText = `[\n  ${snippet.replace(/\n/g, '\n  ')}\n]`;
		} else if (nextText.endsWith(']')) {
			// 插入到数组末尾
			const lastBracket = nextText.lastIndexOf(']');
			const beforeLastBracket = nextText.slice(0, lastBracket);
			const trimmed = beforeLastBracket.trimEnd();
			const needsComma = trimmed.length > 1 && (trimmed.endsWith('}') || trimmed.endsWith(']'));
			nextText = `${trimmed}${needsComma ? ',' : ''}\n  ${snippet.replace(/\n/g, '\n  ')}\n]`;
		} else {
			nextText = `[\n  ${snippet.replace(/\n/g, '\n  ')}\n]`;
		}
		setJsonText(nextText);
		const result = parseMcpServersJson(nextText);
		if (result.ok) {
			setError(null);
			onChangeServers(result.servers);
		} else {
			setError(result.error);
		}
	}, [jsonText, onChangeServers]);

	return (
		<div className="ref-mcp-json-editor">
			<div className="ref-mcp-json-toolbar">
				<div className="ref-mcp-json-actions">
					<button type="button" className="ref-mcp-json-btn" onClick={handleImport}>
						{t('mcp.importJson')}
					</button>
					<button type="button" className="ref-mcp-json-btn" onClick={handleCopy}>
						{t('mcp.copyJson')}
					</button>
					<button type="button" className="ref-mcp-json-btn" onClick={handleExport}>
						{t('mcp.exportJson')}
					</button>
				</div>
				<div className="ref-mcp-json-templates">
					<span className="ref-mcp-json-templates-label">{t('mcp.templates')}:</span>
					{templates.map((templ) => (
						<button
							key={templ.id}
							type="button"
							className="ref-mcp-json-template-chip"
							onClick={() => insertTemplate(templ)}
							title={templ.description}
						>
							{templ.name}
						</button>
					))}
				</div>
			</div>
			<textarea
				className={`ref-mcp-json-textarea ${error ? 'ref-mcp-json-textarea--error' : ''}`}
				value={jsonText}
				onChange={(e) => handleChange(e.target.value)}
				spellCheck={false}
			/>
			{error ? (
				<div className="ref-mcp-json-error">
					<span>{t('mcp.jsonInvalid')}: {error}</span>
				</div>
			) : null}
			<div className="ref-mcp-json-hint">
				<span>{t('mcp.jsonHint')}</span>
			</div>
		</div>
	);
}
