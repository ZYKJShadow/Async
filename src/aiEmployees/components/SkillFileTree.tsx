import { useState } from 'react';
import { IconChevron, IconDoc, IconFileDoc, IconNewFolder } from '../../icons';

interface FileTreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children: FileTreeNode[];
}

function buildTree(filePaths: string[]): FileTreeNode[] {
	const root: FileTreeNode[] = [];

	for (const filePath of filePaths) {
		const parts = filePath.split('/');
		let current = root;

		for (let i = 0; i < parts.length; i++) {
			const name = parts[i]!;
			const isLast = i === parts.length - 1;
			const path = parts.slice(0, i + 1).join('/');

			let existing = current.find((n) => n.name === name);

			if (!existing) {
				existing = {
					name,
					path,
					isDirectory: !isLast,
					children: [],
				};
				current.push(existing);
			}

			if (!isLast) {
				current = existing.children;
			}
		}
	}

	function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
		nodes.sort((a, b) => {
			if (a.path === 'SKILL.md') {
				return -1;
			}
			if (b.path === 'SKILL.md') {
				return 1;
			}
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
		for (const node of nodes) {
			if (node.isDirectory) {
				sortNodes(node.children);
			}
		}
		return nodes;
	}

	return sortNodes(root);
}

function TreeNodeItem({
	node,
	selectedPath,
	onSelect,
	depth = 0,
}: {
	node: FileTreeNode;
	selectedPath: string;
	onSelect: (path: string) => void;
	depth?: number;
}) {
	const [expanded, setExpanded] = useState(true);
	const isSelected = node.path === selectedPath;

	if (node.isDirectory) {
		return (
			<div>
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="ref-ai-employees-skill-tree-folder-btn"
					style={{ paddingLeft: `${depth * 12 + 8}px` }}
				>
					<IconChevron className={`ref-ai-employees-skill-tree-chev${expanded ? ' is-open' : ''}`} />
					<IconNewFolder className="ref-ai-employees-skill-tree-ico" />
					<span className="ref-ai-employees-skill-tree-label">{node.name}</span>
				</button>
				{expanded ? (
					<div>
						{node.children.map((child) => (
							<TreeNodeItem key={child.path} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
						))}
					</div>
				) : null}
			</div>
		);
	}

	const FileIcon = node.name.endsWith('.md') || node.name.endsWith('.mdx') ? IconFileDoc : IconDoc;

	return (
		<button
			type="button"
			onClick={() => onSelect(node.path)}
			className={`ref-ai-employees-skill-tree-file-btn${isSelected ? ' is-active' : ''}`}
			style={{ paddingLeft: `${depth * 12 + 8 + 16}px` }}
		>
			<FileIcon className="ref-ai-employees-skill-tree-ico" />
			<span className="ref-ai-employees-skill-tree-label">{node.name}</span>
		</button>
	);
}

export function SkillFileTree({
	filePaths,
	selectedPath,
	onSelect,
	emptyLabel,
}: {
	filePaths: string[];
	selectedPath: string;
	onSelect: (path: string) => void;
	emptyLabel: string;
}) {
	const tree = buildTree(filePaths);

	if (tree.length === 0) {
		return (
			<div className="ref-ai-employees-skill-tree-empty">
				<IconNewFolder className="ref-ai-employees-skill-tree-empty-ico" />
				<p>{emptyLabel}</p>
			</div>
		);
	}

	return (
		<div className="ref-ai-employees-skill-tree-root">
			{tree.map((node) => (
				<TreeNodeItem key={node.path} node={node} selectedPath={selectedPath} onSelect={onSelect} />
			))}
		</div>
	);
}
