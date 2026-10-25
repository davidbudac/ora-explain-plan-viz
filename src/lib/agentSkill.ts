import { buildZip } from './zip';

/**
 * The companion agent skill (`skills/oracle-plan-analysis/` in the repo),
 * bundled into the app as raw text: the handoff dialog offers it as a
 * download and can embed it in the handoff for agents that lack it.
 */
export const AGENT_SKILL_NAME = 'oracle-plan-analysis';
export const AGENT_SKILL_URL =
  'https://github.com/davidbudac/ora-explain-plan-viz/tree/main/skills/oracle-plan-analysis';
export const AGENT_SKILL_INSTALL_COMMAND = 'npx skills add davidbudac/ora-explain-plan-viz';

export interface SkillFile {
  /** Path inside the skill folder, e.g. `SKILL.md`, `references/patterns.md`. */
  path: string;
  content: string;
}

const SKILL_DIR = `/skills/${AGENT_SKILL_NAME}/`;

const rawFiles = import.meta.glob('../../skills/oracle-plan-analysis/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** SKILL.md first, then the references in path order. */
export const AGENT_SKILL_FILES: SkillFile[] = Object.entries(rawFiles)
  .map(([key, content]) => ({ path: key.slice(key.indexOf(SKILL_DIR) + SKILL_DIR.length), content }))
  .sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)));

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

/** Push every Markdown heading one level down, leaving fenced code alone. */
function demoteHeadings(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^(```|~~~)/.test(line)) inFence = !inFence;
      return !inFence && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join('\n');
}

/**
 * The whole skill as one Markdown appendix: SKILL.md without its frontmatter,
 * then each reference file under a heading naming its path, so the skill's own
 * `references/...` links resolve to sections of the same document.
 */
export function agentSkillPlaybook(files: SkillFile[] = AGENT_SKILL_FILES): string {
  return files
    .map((file) => {
      const body = demoteHeadings(stripFrontmatter(file.content).trim());
      return file.path === 'SKILL.md' ? body : `## File: ${file.path}\n\n${demoteHeadings(body)}`;
    })
    .join('\n\n');
}

/** The skill folder as a ZIP (`oracle-plan-analysis/SKILL.md`, ...), for ~/.claude/skills or a claude.ai upload. */
export function agentSkillZip(files: SkillFile[] = AGENT_SKILL_FILES): Uint8Array<ArrayBuffer> {
  return buildZip(files.map((file) => ({ path: `${AGENT_SKILL_NAME}/${file.path}`, content: file.content })));
}
