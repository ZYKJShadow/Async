import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TFunction } from '../../i18n';
import { IconEye, IconPencil } from '../../icons';

function isMarkdownPath(path: string) {
	return path.endsWith('.md') || path.endsWith('.mdx');
}

type Frontmatter = Record<string, string>;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(raw: string): { frontmatter: Frontmatter | null; body: string } {
	const match = FRONTMATTER_RE.exec(raw);
	if (!match) {
		return { frontmatter: null, body: raw };
	}

	const yamlBlock = match[1]!;
	const body = raw.slice(match[0].length);
	const frontmatter: Frontmatter = {};

	for (const line of yamlBlock.split('\n')) {
		const idx = line.indexOf(':');
		if (idx === -1) {
			continue;
		}
		const key = line.slice(0, idx).trim();
		let value = line.slice(idx + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key) {
			frontmatter[key] = value;
		}
	}

	return {
		frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : null,
		body,
	};
}

function FrontmatterCard({ data }: { data: Frontmatter }) {
	return (
		<div className="ref-ai-employees-skill-fm-card">
			{Object.entries(data).map(([key, value]) => (
				<div key={key} className="ref-ai-employees-skill-fm-row">
					<span className="ref-ai-employees-skill-fm-key">{key}</span>
					<span className="ref-ai-employees-skill-fm-val">{value}</span>
				</div>
			))}
		</div>
	);
}

export function SkillFileViewer({
	path,
	content,
	onChange,
	t,
}: {
	path: string;
	content: string;
	onChange: (next: string) => void;
	t: TFunction;
}) {
	const [editing, setEditing] = useState(false);
	const isMd = isMarkdownPath(path);

	const { frontmatter, body } = useMemo(
		() => (isMd ? parseFrontmatter(content) : { frontmatter: null, body: content }),
		[content, isMd]
	);

	return (
		<div className="ref-ai-employees-skill-file-viewer">
			<div className="ref-ai-employees-skill-file-viewer-head">
				<span className="ref-ai-employees-skill-file-viewer-path">{path}</span>
				<div className="ref-ai-employees-skill-file-viewer-actions">
					{isMd ? (
						<button
							type="button"
							className="ref-ai-employees-skill-file-viewer-toggle"
							title={editing ? t('aiEmployees.skills.editorPreview') : t('aiEmployees.skills.editorEdit')}
							aria-label={editing ? t('aiEmployees.skills.editorPreview') : t('aiEmployees.skills.editorEdit')}
							onClick={() => setEditing(!editing)}
						>
							{editing ? <IconEye className="ref-ai-employees-skill-file-viewer-toggle-ico" /> : <IconPencil className="ref-ai-employees-skill-file-viewer-toggle-ico" />}
						</button>
					) : null}
				</div>
			</div>
			<div className="ref-ai-employees-skill-file-viewer-body">
				{isMd && !editing ? (
					<div className="ref-ai-employees-skill-md-preview-wrap">
						{frontmatter ? <FrontmatterCard data={frontmatter} /> : null}
						<div className="ref-ai-employees-skill-md-preview">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>{body.trim() ? body : t('aiEmployees.skills.mdEmptyPreview')}</ReactMarkdown>
						</div>
					</div>
				) : (
					<textarea
						className="ref-ai-employees-skill-file-textarea"
						value={content}
						onChange={(e) => onChange(e.target.value)}
						placeholder={isMd ? t('aiEmployees.skills.mdPlaceholder') : t('aiEmployees.skills.filePlaceholder')}
						spellCheck={false}
					/>
				)}
			</div>
		</div>
	);
}
