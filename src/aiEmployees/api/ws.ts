import type { WSMessage, WSEventType } from './types';
import { buildWsUrl, type AiEmployeesConnection } from './client';

export type WsHandler = (msg: WSMessage) => void;

export class AiEmployeesWsClient {
	private ws: WebSocket | null = null;
	private handlers = new Map<WSEventType | string, Set<(p: unknown, actorId?: string) => void>>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private shouldReconnect = false;
	private reconnectListeners = new Set<() => void>();

	constructor(
		private conn: AiEmployeesConnection,
		private workspaceId: string
	) {}

	connect() {
		this.shouldReconnect = true;
		const url = buildWsUrl(this.conn.wsBaseUrl, this.conn.token, this.workspaceId);
		try {
			this.ws = new WebSocket(url);
		} catch {
			this.scheduleReconnect();
			return;
		}
		this.ws.onmessage = (ev) => {
			try {
				const msg = JSON.parse(String(ev.data)) as WSMessage;
				const set = this.handlers.get(msg.type);
				if (set) {
					for (const fn of set) {
						try {
							fn(msg.payload, msg.actor_id);
						} catch {
							/* ignore */
						}
					}
				}
			} catch {
				/* ignore */
			}
		};
		this.ws.onclose = () => {
			this.ws = null;
			if (this.shouldReconnect) {
				this.scheduleReconnect();
			}
		};
		this.ws.onerror = () => {
			/* onclose handles reconnect */
		};
	}

	private scheduleReconnect() {
		if (this.reconnectTimer) {
			return;
		}
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.shouldReconnect) {
				for (const fn of this.reconnectListeners) {
					try {
						fn();
					} catch {
						/* ignore */
					}
				}
				this.connect();
			}
		}, 3000);
	}

	/** 断线后即将重连前触发，用于大范围失效补偿 */
	onReconnect(fn: () => void): () => void {
		this.reconnectListeners.add(fn);
		return () => {
			this.reconnectListeners.delete(fn);
		};
	}

	on(type: WSEventType | string, fn: (payload: unknown, actorId?: string) => void): () => void {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(fn);
		return () => {
			set!.delete(fn);
		};
	}

	updateConnection(conn: AiEmployeesConnection, workspaceId: string) {
		this.conn = conn;
		this.workspaceId = workspaceId;
		this.disconnect();
		this.connect();
	}

	disconnect() {
		this.shouldReconnect = false;
		this.reconnectListeners.clear();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			try {
				this.ws.close();
			} catch {
				/* ignore */
			}
			this.ws = null;
		}
	}
}
