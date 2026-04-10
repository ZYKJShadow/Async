import type { TFunction } from '../i18n';

/**
 * AI 员工独立窗口顶栏：精简为标题与窗口控件，不暴露主窗口级「文件 / 窗口」菜单。
 * 不提供「文件 / 窗口」菜单；保留与主窗口相同的 ref-menubar 高度与拖拽区。
 */
export function AiEmployeesTitlebar({ t }: { t: TFunction }) {
	return (
		<header className="ref-menubar ref-ai-employees-titlebar" role="banner" aria-label={t('aiEmployees.titlebarAria')}>
			<div className="ref-ai-employees-titlebar-plate" aria-hidden />
			<div className="ref-ai-employees-titlebar-middle">
				<span className="ref-ai-employees-titlebar-text">{t('aiEmployees.windowTitle')}</span>
			</div>
			<div className="ref-ai-employees-titlebar-plate" aria-hidden />
		</header>
	);
}
