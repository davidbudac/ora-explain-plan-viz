import { describe, expect, it } from 'vitest';
import { AGENT_SKILL_FILES, AGENT_SKILL_NAME, agentSkillPlaybook, agentSkillZip } from '../agentSkill';

const skillMd = () => AGENT_SKILL_FILES.find((f) => f.path === 'SKILL.md')!.content;

function frontmatter(markdown: string): Record<string, string> {
  const block = markdown.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  return Object.fromEntries(
    block.split('\n').map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
  );
}

describe('bundled agent skill', () => {
  it('loads SKILL.md first, then its references', () => {
    expect(AGENT_SKILL_FILES.map((f) => f.path)).toEqual([
      'SKILL.md',
      'references/data-requests.md',
      'references/patterns.md',
    ]);
  });

  it('has frontmatter that skill loaders (Claude Code, claude.ai) accept', () => {
    const meta = frontmatter(skillMd());
    expect(meta.name).toBe(AGENT_SKILL_NAME);
    expect(meta.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
    expect(meta.description).not.toMatch(/[<>]/);
  });

  it('links only to files it ships', () => {
    const paths = new Set(AGENT_SKILL_FILES.map((f) => f.path));
    const links = [...skillMd().matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(paths).toContain(link);
  });

  it('flattens into one playbook without frontmatter, headings pushed below the handoff\'s', () => {
    const playbook = agentSkillPlaybook();
    expect(playbook.startsWith('## Oracle plan analysis')).toBe(true);
    expect(playbook).not.toMatch(/^---$/m);
    expect(playbook).not.toMatch(/^# /m);
    expect(playbook).toContain('## File: references/patterns.md\n\n### Plan patterns');
    expect(playbook).toContain('## File: references/data-requests.md');
    // SQL comments inside fences are not headings and stay untouched.
    expect(playbook).toContain('-- Re-run the statement once');
  });

  it('zips under the skill folder name', () => {
    const text = new TextDecoder().decode(agentSkillZip());
    expect(text).toContain(`${AGENT_SKILL_NAME}/SKILL.md`);
    expect(text).toContain(`${AGENT_SKILL_NAME}/references/patterns.md`);
  });
});
