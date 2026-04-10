import type { AiEmployeesSettings } from '../../../shared/aiEmployeesSettings';
import type { AiEmployeesConnection } from '../api/client';

export const DEFAULT_API = 'http://127.0.0.1:8080';
export const DEFAULT_WS = 'ws://127.0.0.1:8080/ws';

export function normConn(s: AiEmployeesSettings): AiEmployeesConnection {
	return {
		apiBaseUrl: (s.apiBaseUrl ?? DEFAULT_API).trim() || DEFAULT_API,
		wsBaseUrl: (s.wsBaseUrl ?? DEFAULT_WS).trim() || DEFAULT_WS,
		token: (s.token ?? 'dev').trim(),
	};
}
