/**
 * 将工作区根路径与相对路径拼成 POSIX 风格绝对路径，并转为 LSP/Monaco 使用的 file URL。
 */

export function joinWorkspacePosixPath(root: string, rel: string): string {
	const a = root.replace(/\\/g, '/').replace(/\/$/, '');
	const b = rel.replace(/\\/g, '/').replace(/^\//, '');
	return `${a}/${b}`;
}

/** 与 Node pathToFileURL 常见输出一致：Windows 为 file:///D:/...，Unix 为 file:///home/... */
export function absolutePathToFileUrlString(absPath: string): string {
	const s = absPath.replace(/\\/g, '/');
	if (/^[A-Za-z]:\//.test(s)) {
		return 'file:///' + s;
	}
	return 'file://' + (s.startsWith('/') ? s : '/' + s);
}

export function workspaceRelativeFileUrl(workspaceRoot: string | null, relPath: string): string | null {
	if (!workspaceRoot?.trim() || !relPath.trim()) {
		return null;
	}
	return absolutePathToFileUrlString(joinWorkspacePosixPath(workspaceRoot.trim(), relPath.trim()));
}
