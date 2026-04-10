import type { AiEmployeeChatAccountRef } from '../../../shared/aiEmployeesSettings';

/**
 * 外部 IM 桥接占位：未来在此接入飞书/TG/Discord 的 OAuth、Webhook 或 Bot。
 * UI 层只操作 AiEmployeeChatAccountRef，不直接依赖各平台 SDK。
 */
export type ChatBridgeStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

export function chatBridgeLabel(ref: AiEmployeeChatAccountRef): string {
	switch (ref.provider) {
		case 'feishu':
			return `Feishu · ${ref.handle}`;
		case 'telegram':
			return `Telegram · ${ref.handle}`;
		case 'discord':
			return `Discord · ${ref.handle}`;
		default:
			return ref.handle;
	}
}

export async function probeChatBridge(_ref: AiEmployeeChatAccountRef): Promise<ChatBridgeStatus> {
	void _ref;
	return 'disconnected';
}
