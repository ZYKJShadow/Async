/** 暂停方块：在 24×24 viewBox 内几何居中，与圆角发送钮内对齐一致 */
const STOP_ICON_VIEWBOX_CENTER = 'translate(12 12)';

export function IconArrowUp({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
			<path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function IconArrowDown({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<g transform="translate(12 13)">
				<path d="M0-7v14M-7 0l7 7 7-7" />
			</g>
		</svg>
	);
}

export function IconStop({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<g transform={STOP_ICON_VIEWBOX_CENTER}>
				<rect x="-6" y="-6" width="12" height="12" rx="2" />
			</g>
		</svg>
	);
}

export function IconExplorer({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path
				d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function IconCloudOutline({ className }: { className?: string }) {
	return (
		<svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" strokeLinejoin="round" />
		</svg>
	);
}

export function IconServerOutline({ className }: { className?: string }) {
	return (
		<svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<rect x="2" y="3" width="20" height="7" rx="2" />
			<rect x="2" y="14" width="20" height="7" rx="2" />
			<circle cx="6" cy="6.5" r="1" fill="currentColor" />
			<circle cx="6" cy="17.5" r="1" fill="currentColor" />
		</svg>
	);
}

export function IconGitSCM({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<circle cx="6" cy="6" r="2" />
			<circle cx="18" cy="18" r="2" />
			<circle cx="18" cy="6" r="2" />
			<path d="M6 8v4a2 2 0 0 0 2 2h8M16 8V6" />
		</svg>
	);
}

export function IconSearch({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.3-4.3" strokeLinecap="round" />
		</svg>
	);
}

export function IconRefresh({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" />
			<path d="M3 3v5h5" strokeLinecap="round" />
			<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" strokeLinecap="round" />
			<path d="M16 21h5v-5" strokeLinecap="round" />
		</svg>
	);
}

export function IconDoc({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline points="14 2 14 8 20 8" />
		</svg>
	);
}

export function IconNewFile({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.9"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
			<path d="M14 3v5h5" />
			<path d="M12 12v6M9 15h6" />
		</svg>
	);
}

export function IconNewFolder({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.9"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
			<path d="M12 11.5v5M9.5 14h5" />
		</svg>
	);
}

export function IconChevron({ className }: { className?: string }) {
	return (
		<svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M6 9l6 6 6-6" strokeLinecap="round" />
		</svg>
	);
}

export function IconMic({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" strokeLinejoin="round" />
			<path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3M8 22h8" strokeLinecap="round" />
		</svg>
	);
}

export function IconPlus({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
			<path d="M12 5v14M5 12h14" strokeLinecap="round" />
		</svg>
	);
}

export function IconCloseSmall({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
		</svg>
	);
}

export function IconPencil({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function IconTrash({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function IconCheckCircle({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<circle cx="12" cy="12" r="9" />
			<path d="M8 12l2.5 2.5 5-5" />
		</svg>
	);
}

export function IconSettings({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="3"></circle>
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
		</svg>
	);
}

export function IconPlugin({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M9 7.5V6a3 3 0 1 1 6 0v1.5" />
			<path d="M7.5 10h9A2.5 2.5 0 0 1 19 12.5v1A2.5 2.5 0 0 1 16.5 16H14v3a1 1 0 0 1-2 0v-3h-2.5A2.5 2.5 0 0 1 7 13.5v-1A2.5 2.5 0 0 1 9.5 10Z" />
			<path d="M5 13h2M17 13h2" />
		</svg>
	);
}

export function IconHistory({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M3 12a9 9 0 1 0 3-6.7" />
			<path d="M3 4v4h4" />
			<path d="M12 7v5l3 2" />
		</svg>
	);
}

export function IconDotsHorizontal({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<circle cx="5" cy="12" r="1.5" />
			<circle cx="12" cy="12" r="1.5" />
			<circle cx="19" cy="12" r="1.5" />
		</svg>
	);
}

export function IconArrowUpRight({ className }: { className?: string }) {
	return (
		<svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M7 17L17 7" strokeLinecap="round" />
			<path d="M8 7h9v9" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function IconEye({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.9"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

export function IconArchive({ className }: { className?: string }) {
	return (
		<svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
			<rect x="3" y="4" width="18" height="5" rx="1.5" />
			<path d="M5 9v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" strokeLinecap="round" />
			<path d="M10 13h4" strokeLinecap="round" />
		</svg>
	);
}

export function IconImageOutline({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
			<circle cx="8.5" cy="8.5" r="1.5" />
			<path d="M21 15l-5-5L5 21" />
		</svg>
	);
}

/** 侧栏等：与 lucide Inbox 同语义 */
export function IconInbox({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
			<path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
		</svg>
	);
}

/** lucide CircleUser */
export function IconCircleUser({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<circle cx="12" cy="12" r="10" />
			<circle cx="12" cy="10" r="3" />
			<path d="M7 20.5c1.5-2 3.5-3 5-3s3.5 1 5 3" />
		</svg>
	);
}

/** lucide ListTodo */
export function IconListTodo({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<rect x="3" y="5" width="6" height="6" rx="1" />
			<path d="m3 17 2 2 4-4" />
			<path d="M13 6h8M13 12h8M13 18h8" />
		</svg>
	);
}

/** lucide FolderKanban */
export function IconFolderKanban({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
			<path d="M8 10v4M12 10v2M16 10v6" />
		</svg>
	);
}

/** lucide MessageCircle — 沟通 / 聊天入口 */
export function IconMessageCircle({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
		</svg>
	);
}

/** lucide Send — 发送消息 */
export function IconSend({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
			<path d="m21.854 2.147-10.94 10.939" />
		</svg>
	);
}

/** lucide Bot */
export function IconBot({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M12 8V4H8" />
			<rect width="16" height="12" x="4" y="8" rx="2" />
			<path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
		</svg>
	);
}

/** 任务流：列表 + 脉冲节点（与侧栏「任务」对应） */
export function IconTaskPulse({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M8 6h13M8 12h13M8 18h13" />
			<circle cx="4" cy="6" r="2" />
			<circle cx="4" cy="12" r="2" />
			<circle cx="4" cy="18" r="2" />
		</svg>
	);
}

/** lucide Monitor */
export function IconMonitor({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<rect width="20" height="14" x="2" y="3" rx="2" />
			<path d="M8 21h8M12 17v4" />
		</svg>
	);
}

/** lucide BookOpenText */
export function IconBookOpen({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
			<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
		</svg>
	);
}
