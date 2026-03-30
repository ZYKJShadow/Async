import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

loader.config({ monaco });

/** 与 Async 壳层暗色 UI 一致的编辑器滚动条与阴影 */
monaco.editor.defineTheme('void-dark', {
	base: 'vs-dark',
	inherit: true,
	rules: [],
	colors: {
		'editor.background': '#181818',
		'editorGutter.background': '#181818',
		'scrollbar.shadow': '#00000000',
		'scrollbarSlider.background': '#3a3a4299',
		'scrollbarSlider.hoverBackground': '#4d4d56cc',
		'scrollbarSlider.activeBackground': '#5c5c66cc',
	},
});
