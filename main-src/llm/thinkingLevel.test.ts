import { describe, expect, it } from 'vitest';
import {
	anthropicEffectiveTemperature,
	openAICompatibleEffectiveTemperature,
	resolveRequestedTemperature,
} from './thinkingLevel.js';

describe('anthropicEffectiveTemperature', () => {
	it('preserves the configured temperature when thinking is disabled', () => {
		expect(anthropicEffectiveTemperature(0.75, null)).toBe(0.75);
		expect(anthropicEffectiveTemperature(0.3, null)).toBe(0.3);
	});

	it('forces temperature to 1 when extended thinking is enabled', () => {
		expect(anthropicEffectiveTemperature(0.75, 4096)).toBe(1);
		expect(anthropicEffectiveTemperature(0.25, 8192)).toBe(1);
	});
});

describe('openAICompatibleEffectiveTemperature', () => {
	it('preserves the requested temperature for regular chat models', () => {
		expect(openAICompatibleEffectiveTemperature('gpt-4o', 0.75)).toBe(0.75);
		expect(openAICompatibleEffectiveTemperature('deepseek-chat', 0)).toBe(0);
	});

	it('forces temperature to 1 for reasoning-style model ids', () => {
		expect(openAICompatibleEffectiveTemperature('gpt-5', 0.75)).toBe(1);
		expect(openAICompatibleEffectiveTemperature('gpt-5-mini', 0)).toBe(1);
		expect(openAICompatibleEffectiveTemperature('o3-mini', 0.25)).toBe(1);
		expect(openAICompatibleEffectiveTemperature('o4-mini', 0.25)).toBe(1);
	});
});

describe('resolveRequestedTemperature', () => {
	it('keeps the default temperature in auto mode', () => {
		expect(resolveRequestedTemperature(0.75, 'auto', 1)).toBe(0.75);
		expect(resolveRequestedTemperature(0.3, undefined, 0.5)).toBe(0.3);
	});

	it('uses the custom temperature when custom mode is enabled', () => {
		expect(resolveRequestedTemperature(0.75, 'custom', 1)).toBe(1);
		expect(resolveRequestedTemperature(0.75, 'custom', 0.35)).toBe(0.35);
	});

	it('falls back to the default temperature when the custom value is invalid', () => {
		expect(resolveRequestedTemperature(0.75, 'custom', undefined)).toBe(0.75);
		expect(resolveRequestedTemperature(0.75, 'custom', 3)).toBe(0.75);
	});
});
