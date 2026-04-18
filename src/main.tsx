import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { APP_UI_STYLE, readPrefersDark, readStoredColorMode, resolveEffectiveScheme } from './colorMode';
import { I18nProvider } from './i18n';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import './styles/tokens.css';
import './styles/theme-dark.css';
import './styles/theme-light.css';
import './styles/motion.css';
import './styles/mac-codex.css';
import './styles/terminal-window.css';

const initialScheme = resolveEffectiveScheme(readStoredColorMode(), readPrefersDark());
document.documentElement.setAttribute('data-ui-style', APP_UI_STYLE);
document.documentElement.setAttribute('data-color-scheme', initialScheme);
const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
const platformRaw = userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
const platform = /win/i.test(platformRaw) ? 'win32' : /mac/i.test(platformRaw) ? 'darwin' : 'linux';
document.documentElement.setAttribute('data-platform', platform);

function readAppSurfaceFromUrl(): 'agent' | 'editor' | undefined {
	try {
		const s = new URLSearchParams(window.location.search).get('surface');
		if (s === 'agent' || s === 'editor') {
			return s;
		}
	} catch {
		/* ignore */
	}
	return undefined;
}

function readBrowserWindowFlagFromUrl(): boolean {
	try {
		return new URLSearchParams(window.location.search).get('browserWindow') === '1';
	} catch {
		return false;
	}
}

function readTerminalWindowFlagFromUrl(): boolean {
	try {
		return new URLSearchParams(window.location.search).get('terminalWindow') === '1';
	} catch {
		return false;
	}
}

function readTerminalStartPageFlagFromUrl(): boolean {
	try {
		return new URLSearchParams(window.location.search).get('startPage') === '1';
	} catch {
		return false;
	}
}

const appSurface = readAppSurfaceFromUrl();
const browserWindow = readBrowserWindowFlagFromUrl();
const terminalWindow = readTerminalWindowFlagFromUrl();
const terminalStartPage = readTerminalStartPageFlagFromUrl();

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<I18nProvider>
			<App
				appSurface={appSurface}
				browserWindow={browserWindow}
				terminalWindow={terminalWindow}
				terminalStartPage={terminalStartPage}
			/>
		</I18nProvider>
	</StrictMode>
);
