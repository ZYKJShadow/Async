import { describe, expect, it } from 'vitest';
import {
	AGENT_FILE_PREVIEW_SHIKI_THEME_DARK,
	AGENT_FILE_PREVIEW_SHIKI_THEME_LIGHT,
	resolveAgentFilePreviewShikiTheme,
} from './agentFilePreviewShiki';

describe('resolveAgentFilePreviewShikiTheme', () => {
	it('returns the dark Shiki theme for dark mode', () => {
		expect(resolveAgentFilePreviewShikiTheme('dark')).toBe(AGENT_FILE_PREVIEW_SHIKI_THEME_DARK);
	});

	it('returns the light Shiki theme for light mode', () => {
		expect(resolveAgentFilePreviewShikiTheme('light')).toBe(AGENT_FILE_PREVIEW_SHIKI_THEME_LIGHT);
	});
});
