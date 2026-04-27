/**
 * Browser-fingerprint presets — coherent device profiles ported from
 * anything-analyzer. Each preset is a single click that fills the editor
 * with a self-consistent identity (platform / GPU / screen / cores / locale).
 */

import type { BrowserFingerprintSpoofSettings } from './browserSidebarConfig.js';

export type BrowserFingerprintPreset = {
	id: string;
	label: string;
	description: string;
	settings: BrowserFingerprintSpoofSettings;
};

export const BROWSER_FINGERPRINT_PRESETS: BrowserFingerprintPreset[] = [
	{
		id: 'win-nvidia',
		label: 'Windows · NVIDIA · 1080p',
		description: 'Win32 / RTX-class GPU / 16-core / zh-CN',
		settings: {
			platform: 'Win32',
			languages: 'zh-CN, zh, en',
			hardwareConcurrency: 16,
			deviceMemory: 16,
			screenWidth: 1920,
			screenHeight: 1080,
			availHeightOffset: 40,
			devicePixelRatio: 1,
			colorDepth: 24,
			timezone: 'Asia/Shanghai',
			timezoneOffsetMinutes: -480,
			webglVendor: 'Google Inc. (NVIDIA)',
			webglRenderer:
				'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
			webrtcPolicy: 'block',
			maskWebdriver: true,
		},
	},
	{
		id: 'win-intel',
		label: 'Windows · Intel UHD · 1080p',
		description: 'Win32 / Intel UHD 770 / 8-core / en-US',
		settings: {
			platform: 'Win32',
			languages: 'en-US, en',
			hardwareConcurrency: 8,
			deviceMemory: 16,
			screenWidth: 1920,
			screenHeight: 1080,
			availHeightOffset: 40,
			devicePixelRatio: 1,
			colorDepth: 24,
			timezone: 'America/New_York',
			timezoneOffsetMinutes: 300,
			webglVendor: 'Google Inc. (Intel)',
			webglRenderer:
				'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
			webrtcPolicy: 'block',
			maskWebdriver: true,
		},
	},
	{
		id: 'mac-arm',
		label: 'macOS · Apple M2 · Retina',
		description: 'MacIntel / Apple M2 / 10-core / 2x DPR',
		settings: {
			platform: 'MacIntel',
			languages: 'en-US, en',
			hardwareConcurrency: 10,
			deviceMemory: 16,
			screenWidth: 1440,
			screenHeight: 900,
			availHeightOffset: 25,
			devicePixelRatio: 2,
			colorDepth: 30,
			timezone: 'America/Los_Angeles',
			timezoneOffsetMinutes: 480,
			webglVendor: 'Google Inc. (Apple)',
			webglRenderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)',
			webrtcPolicy: 'block',
			maskWebdriver: true,
		},
	},
	{
		id: 'mac-intel',
		label: 'macOS · Intel Iris · Retina',
		description: 'MacIntel / Iris Plus / 8-core / en-US',
		settings: {
			platform: 'MacIntel',
			languages: 'en-US, en',
			hardwareConcurrency: 8,
			deviceMemory: 16,
			screenWidth: 1680,
			screenHeight: 1050,
			availHeightOffset: 25,
			devicePixelRatio: 2,
			colorDepth: 24,
			timezone: 'America/Los_Angeles',
			timezoneOffsetMinutes: 480,
			webglVendor: 'Google Inc. (Intel)',
			webglRenderer: 'ANGLE (Intel, Intel(R) Iris Plus Graphics 645, OpenGL 4.1)',
			webrtcPolicy: 'block',
			maskWebdriver: true,
		},
	},
	{
		id: 'linux-nvidia',
		label: 'Linux · NVIDIA · 1080p',
		description: 'Linux x86_64 / GTX 1080 Ti / 16-core',
		settings: {
			platform: 'Linux x86_64',
			languages: 'en-US, en',
			hardwareConcurrency: 16,
			deviceMemory: 32,
			screenWidth: 1920,
			screenHeight: 1080,
			availHeightOffset: 40,
			devicePixelRatio: 1,
			colorDepth: 24,
			timezone: 'Europe/Berlin',
			timezoneOffsetMinutes: -60,
			webglVendor: 'Google Inc. (NVIDIA)',
			webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti, OpenGL 4.5)',
			webrtcPolicy: 'block',
			maskWebdriver: true,
		},
	},
	{
		id: 'linux-intel',
		label: 'Linux · Intel UHD · 1080p',
		description: 'Linux x86_64 / Mesa Intel UHD / 8-core',
		settings: {
			platform: 'Linux x86_64',
			languages: 'en-GB, en',
			hardwareConcurrency: 8,
			deviceMemory: 16,
			screenWidth: 1920,
			screenHeight: 1080,
			availHeightOffset: 40,
			devicePixelRatio: 1,
			colorDepth: 24,
			timezone: 'Europe/London',
			timezoneOffsetMinutes: 0,
			webglVendor: 'Google Inc. (Intel)',
			webglRenderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.5)',
			webrtcPolicy: 'block',
			maskWebdriver: true,
		},
	},
];

export function getBrowserFingerprintPreset(id: string): BrowserFingerprintPreset | null {
	return BROWSER_FINGERPRINT_PRESETS.find((preset) => preset.id === id) ?? null;
}
