import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
	mergeDiscoveredProviderModels,
	type UserModelEntry,
} from './modelCatalog';

describe('mergeDiscoveredProviderModels', () => {
	it('adds newly discovered models for a provider', () => {
		const entries: UserModelEntry[] = [
			{
				id: 'existing',
				providerId: 'prov-a',
				displayName: 'GPT-4o',
				requestName: 'gpt-4o',
				maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
			},
		];

		const result = mergeDiscoveredProviderModels(entries, 'prov-a', [
			{ requestName: 'gpt-4o' },
			{ requestName: 'gpt-4.1-mini', contextWindowTokens: 128000, maxOutputTokens: 32768 },
		]);

		expect(result.addedCount).toBe(1);
		expect(result.totalDiscovered).toBe(2);
		expect(result.entries).toHaveLength(2);
		expect(result.entries[1]).toMatchObject({
			providerId: 'prov-a',
			displayName: 'gpt-4.1-mini',
			requestName: 'gpt-4.1-mini',
			contextWindowTokens: 128000,
			maxOutputTokens: 32768,
		});
	});

	it('reuses blank placeholder rows before appending new entries', () => {
		const entries: UserModelEntry[] = [
			{
				id: 'blank',
				providerId: 'prov-a',
				displayName: '',
				requestName: '',
				maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
			},
			{
				id: 'other-provider',
				providerId: 'prov-b',
				displayName: '',
				requestName: '',
				maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
			},
		];

		const result = mergeDiscoveredProviderModels(entries, 'prov-a', [
			{ requestName: 'llama3.2', maxOutputTokens: 8192 },
		]);

		expect(result.addedCount).toBe(1);
		expect(result.entries).toHaveLength(2);
		expect(result.entries[0]).toMatchObject({
			id: 'blank',
			providerId: 'prov-a',
			displayName: 'llama3.2',
			requestName: 'llama3.2',
			maxOutputTokens: 8192,
		});
	});

	it('filters already configured duplicate models without mutating existing entries', () => {
		const entries: UserModelEntry[] = [
			{
				id: 'no-display',
				providerId: 'prov-a',
				displayName: '',
				requestName: 'deepseek-r1',
				maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
			},
			{
				id: 'custom-display',
				providerId: 'prov-a',
				displayName: 'My Claude Alias',
				requestName: 'claude-3-7-sonnet',
				maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
			},
		];

		const result = mergeDiscoveredProviderModels(entries, 'prov-a', [
			{ requestName: 'deepseek-r1', displayName: 'DeepSeek R1' },
			{ requestName: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet' },
		]);

		expect(result.addedCount).toBe(0);
		expect(result.entries[0]).toMatchObject({
			displayName: '',
			requestName: 'deepseek-r1',
		});
		expect(result.entries[1]).toMatchObject({
			displayName: 'My Claude Alias',
			requestName: 'claude-3-7-sonnet',
		});
	});
});
