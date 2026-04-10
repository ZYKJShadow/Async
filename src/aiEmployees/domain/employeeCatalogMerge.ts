import type { AiEmployeeCatalogEntry } from '../../../shared/aiEmployeesSettings';
import type { AgentJson } from '../api/types';

/** 将远端 agent 与本地目录按 linkedRemoteAgentId 对齐；未关联的 agent 仅用于展示同步入口 */
export function catalogEntryForRemoteAgent(
	catalog: AiEmployeeCatalogEntry[] | undefined,
	remote: AgentJson
): AiEmployeeCatalogEntry | undefined {
	const list = catalog ?? [];
	return list.find((e) => e.linkedRemoteAgentId === remote.id);
}

export function mergeCatalogWithRemoteAgents(
	catalog: AiEmployeeCatalogEntry[] | undefined,
	agents: AgentJson[]
): { entry: AiEmployeeCatalogEntry; remote?: AgentJson }[] {
	const list = catalog ?? [];
	const used = new Set<string>();
	const rows: { entry: AiEmployeeCatalogEntry; remote?: AgentJson }[] = [];

	for (const ag of agents) {
		const hit = list.find((e) => e.linkedRemoteAgentId === ag.id);
		if (hit) {
			used.add(hit.id);
			rows.push({ entry: hit, remote: ag });
		} else {
			rows.push({
				entry: {
					id: `remote:${ag.id}`,
					displayName: ag.name,
					role: '',
					modelSource: 'hybrid',
					linkedRemoteAgentId: ag.id,
				},
				remote: ag,
			});
		}
	}

	for (const e of list) {
		if (!used.has(e.id) && !e.linkedRemoteAgentId) {
			rows.push({ entry: e });
		}
	}

	return rows;
}
