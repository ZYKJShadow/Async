import { APIError as OpenAIAPIError } from 'openai';
import { APIError as AnthropicAPIError } from '@anthropic-ai/sdk';

function statusHintZh(status: number): string {
	if (status === 401 || status === 403) {
		return '（常见于 API Key 无效、欠费、无权限或被提供商拒绝。）';
	}
	if (status === 402) {
		return '（可能与账户计费或余额有关。）';
	}
	if (status === 429) {
		return '（可能是限流，请稍后重试。）';
	}
	if (status >= 500 && status <= 599) {
		return '（服务端错误，可稍后重试。）';
	}
	return '';
}

function stringifyErrorBody(err: unknown): string {
	if (err == null) return '';
	if (typeof err === 'string') return err;
	try {
		const s = JSON.stringify(err);
		return s === '{}' ? '' : s;
	} catch {
		return String(err);
	}
}

/**
 * 将 OpenAI / Anthropic SDK 的 APIError 等格式化为可读字符串（含 HTTP 状态与响应体），便于 UI 与主进程日志排查。
 */
export function formatLlmSdkError(e: unknown): string {
	if (e instanceof OpenAIAPIError || e instanceof AnthropicAPIError) {
		const status = e.status;
		const msg = (e.message ?? '').trim();
		const body = stringifyErrorBody(e.error);
		if (typeof status === 'number') {
			const hint = statusHintZh(status);
			const head = `HTTP ${status}${hint}`;
			const parts = [head, msg, body].filter((p) => p.length > 0);
			// 避免 message 与 body 完全重复
			const out = parts.join(' ');
			return out.trim() || String(e);
		}
		return [msg, body].filter((p) => p.length > 0).join(' ') || String(e);
	}
	if (e instanceof Error) {
		return e.message || String(e);
	}
	return String(e);
}
