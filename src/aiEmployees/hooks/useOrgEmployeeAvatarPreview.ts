import { useEffect, useState } from 'react';
import type { AiEmployeesConnection } from '../api/client';
import { orgEmployeeAvatarSrc } from '../api/orgClient';

/** 拉取组织成员头像（Bearer + X-Workspace-ID），返回 blob: URL 或 null */
export function useOrgEmployeeAvatarPreview(
	conn: AiEmployeesConnection,
	workspaceId: string,
	employeeId: string | null,
	enabled: boolean
): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!enabled || !employeeId || !workspaceId) {
			setUrl((prev) => {
				if (prev) {
					URL.revokeObjectURL(prev);
				}
				return null;
			});
			return;
		}
		let blobUrl: string | null = null;
		let cancelled = false;
		void (async () => {
			try {
				const r = await fetch(orgEmployeeAvatarSrc(conn, employeeId), {
					headers: {
						Authorization: `Bearer ${conn.token.trim()}`,
						'X-Workspace-ID': workspaceId,
					},
				});
				if (!r.ok || cancelled) {
					return;
				}
				const b = await r.blob();
				blobUrl = URL.createObjectURL(b);
				if (!cancelled) {
					setUrl(blobUrl);
				}
			} catch {
				/* ignore */
			}
		})();
		return () => {
			cancelled = true;
			if (blobUrl) {
				URL.revokeObjectURL(blobUrl);
			}
		};
	}, [conn, employeeId, enabled, workspaceId]);
	return url;
}
