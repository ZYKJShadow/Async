import { describe, expect, it } from 'vitest';
import { createEmptyBotIntegration } from './botSettingsTypes';

describe('createEmptyBotIntegration', () => {
	it('creates a disabled bot integration with platform defaults', () => {
		const integration = createEmptyBotIntegration();
		expect(integration.enabled).toBe(false);
		expect(integration.platform).toBe('telegram');
		expect(integration.defaultMode).toBe('agent');
		expect(integration.skills).toEqual([]);
		expect(integration.telegram?.requireMentionInGroups).toBe(true);
		expect(integration.discord?.requireMentionInGuilds).toBe(true);
		expect(integration.feishu?.streamingCard).toBe(true);
	});
});
