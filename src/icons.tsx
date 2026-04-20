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

export function IconArrowLeft({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
			<path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function IconArrowRight({ className }: { className?: string }) {
	return (
		<svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
			<path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

export function IconStop({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
			<rect x="6" y="6" width="12" height="12" rx="2" />
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

export function IconGlobe({ className }: { className?: string }) {
	return (
		<svg className={className} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" strokeLinecap="round" />
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

export function IconFolderOpen({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.9"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H10l2 2h6.5A2.5 2.5 0 0 1 21 10.5V11" />
			<path d="M4.5 12.5h15l-1.6 5.1A2 2 0 0 1 16 19H6.4a2 2 0 0 1-1.93-1.47z" />
		</svg>
	);
}

export function IconPlug({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.9"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M9 8V3M15 8V3" />
			<path d="M8 8h8v3a4 4 0 0 1-4 4 4 4 0 0 1-4-4z" />
			<path d="M12 15v6" />
		</svg>
	);
}

export function IconPin({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.9"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M9 4h6l-1 5 2.5 2.5v1H7.5v-1L10 9z" />
			<path d="M12 12.5V20" />
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

/** Font Awesome “browsers” glyph (Tabby `profiles.svg`) — profiles & connections toolbar. */
export function IconProfilesConnections({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="16"
			height="16"
			viewBox="0 0 576 512"
			fill="currentColor"
			aria-hidden
			focusable="false"
			role="img"
		>
			<path d="M464 480H96c-35.35 0-64-28.65-64-64V112C32 103.2 24.84 96 16 96S0 103.2 0 112V416c0 53.02 42.98 96 96 96h368c8.836 0 16-7.164 16-16S472.8 480 464 480zM512 0H160C124.7 0 96 28.65 96 64v288c0 35.35 28.65 64 64 64h352c35.35 0 64-28.65 64-64V64C576 28.65 547.3 0 512 0zM128 64c0-17.67 14.33-32 32-32h64v64H128V64zM544 352c0 17.67-14.33 32-32 32H160c-17.67 0-32-14.33-32-32V128h416V352zM544 96H256V32h256c17.67 0 32 14.33 32 32V96z" />
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

export function IconTerminal({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<path d="M7 9l3 3-3 3" />
			<path d="M12 15h5" />
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

export function IconTeam({ className }: { className?: string }) {
	return (
		<svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<circle cx="7" cy="9" r="2" />
			<circle cx="12" cy="7" r="2" />
			<circle cx="17" cy="9" r="2" />
			<path d="M4 18a3 3 0 0 1 6 0M9 18a3 3 0 0 1 6 0M14 18a3 3 0 0 1 6 0" strokeLinecap="round" />
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

/* ── Team Role Avatars (filled style, 14×14) ────────────────────────── */

/** Crown — Team Lead */
export function IconRoleLead({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
			<path d="M2 10.5V11.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10.5H2Z" />
			<path d="M1.5 5l2 3 3.5-3.5L10.5 8l2-3-.5 5H2L1.5 5Z" />
			<circle cx="1.5" cy="4.5" r="1" />
			<circle cx="7" cy="3.5" r="1" />
			<circle cx="12.5" cy="4.5" r="1" />
		</svg>
	);
}

/** Browser window — Frontend */
export function IconRoleFrontend({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
			<rect x="1" y="2" width="12" height="10" rx="1.5" fillOpacity="0.25" />
			<rect x="1" y="2" width="12" height="3.5" rx="1.5" />
			<circle cx="3" cy="3.75" r="0.6" fill="currentColor" fillOpacity="0.35" />
			<circle cx="4.8" cy="3.75" r="0.6" fill="currentColor" fillOpacity="0.35" />
			<circle cx="6.6" cy="3.75" r="0.6" fill="currentColor" fillOpacity="0.35" />
			<rect x="3" y="7" width="4" height="1.2" rx="0.4" />
			<rect x="3" y="9" width="6" height="1.2" rx="0.4" fillOpacity="0.5" />
		</svg>
	);
}

/** Terminal prompt — Backend */
export function IconRoleBackend({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
			<rect x="1" y="2" width="12" height="10" rx="1.5" fillOpacity="0.2" />
			<rect x="1" y="2" width="12" height="2.5" rx="1.5" />
			<path d="M3.5 6.5l2.5 1.75-2.5 1.75" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
			<rect x="7.5" y="9.2" width="3.5" height="1.1" rx="0.4" />
		</svg>
	);
}

/** Bug with checkmark — QA */
export function IconRoleQa({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
			<ellipse cx="7" cy="8.5" rx="3.5" ry="3.8" fillOpacity="0.9" />
			<circle cx="7" cy="4.5" r="2.2" />
			<path d="M3.5 7.5L1.5 6M10.5 7.5L12.5 6M3.8 10L2 11.5M10.2 10L12 11.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />
			<path d="M5.5 8.5l1 1 2-2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
		</svg>
	);
}

/** Eye — Reviewer */
export function IconRoleReviewer({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
			<path d="M7 4C4 4 1.5 7 1.5 7s2.5 3 5.5 3 5.5-3 5.5-3S10 4 7 4Z" fillOpacity="0.3" />
			<circle cx="7" cy="7" r="2.5" />
			<circle cx="7" cy="7" r="1" fillOpacity="0.4" />
			<path d="M7 4C4 4 1.5 7 1.5 7s2.5 3 5.5 3 5.5-3 5.5-3S10 4 7 4Z" fill="none" stroke="currentColor" strokeWidth="0.8" />
		</svg>
	);
}

/** Magnifying glass + sparkle — Researcher */
export function IconRoleResearcher({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
			<circle cx="6" cy="5.8" r="3.5" fillOpacity="0.25" />
			<circle cx="6" cy="5.8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
			<line x1="8.6" y1="8.4" x2="12" y2="11.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
			<path d="M10.5 2l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5Z" />
			<path d="M3.5 1.5l.3.7.7.3-.7.3-.3.7-.3-.7-.7-.3.7-.3Z" opacity="0.6" />
		</svg>
	);
}

/** Puzzle piece — Custom / fallback */
export function IconRoleCustom({ className }: { className?: string }) {
	return (
		<svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
			<path d="M6 1.5A1.25 1.25 0 0 1 8 1.5V3h2.5a1 1 0 0 1 1 1v2h-1.5a1.25 1.25 0 0 0 0 2.5H12v2a1 1 0 0 1-1 1H8v-1.5a1.25 1.25 0 0 0-2.5 0V12H4a1 1 0 0 1-1-1V8.5h1.5a1.25 1.25 0 0 0 0-2.5H3V4a1 1 0 0 1 1-1h2V1.5Z" />
		</svg>
	);
}
