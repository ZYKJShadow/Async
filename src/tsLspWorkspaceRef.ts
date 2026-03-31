/** 供 Monaco LSP DefinitionProvider 解析 file:// URI（工作区切换时由 App 更新）。 */
export const monacoWorkspaceRootRef: { current: string | null } = { current: null };
