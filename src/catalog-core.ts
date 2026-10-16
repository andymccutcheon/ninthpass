import { parseDocument } from 'yaml';
import { z } from 'zod';

const Metadata = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1).max(4000),
});
export interface Skill { name: string; description: string; source: string; instructions: string; uri: string }
export const skillUri = (name: string) => `promptzilla://skills/${name}`;
export const assetUri = (path: string) => `promptzilla://assets/${path.split('/').map(encodeURIComponent).join('/')}`;

export class Catalog {
  protected constructor(private readonly skills: Map<string, Skill>, readonly assets: Map<string, string>) {}

  static fromAssets(sources: ReadonlyMap<string, string>): Catalog {
    const assets = new Map(sources);
    const skills = new Map<string, Skill>();
    for (const [path, source] of [...assets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const match = /^([^/]+)\/SKILL\.md$/.exec(path);
      if (!match) continue;
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
      if (!frontmatter) throw new Error(`Missing YAML metadata in ${path}.`);
      const document = parseDocument(frontmatter[1]!);
      if (document.errors.length) throw new Error(`Invalid YAML metadata in ${path}.`);
      const metadata = Metadata.parse(document.toJS({ maxAliasCount: 0 }));
      if (metadata.name !== match[1]) throw new Error(`Skill name must equal folder in ${path}.`);
      if (!frontmatter[2]!.trim()) throw new Error(`Missing instructions in ${path}.`);
      skills.set(metadata.name, { ...metadata, source, instructions: frontmatter[2]!, uri: skillUri(metadata.name) });
    }
    if (!skills.size) throw new Error('No skills found. Expected skills/<name>/SKILL.md.');
    return new Catalog(skills, assets);
  }

  list() { return [...this.skills.values()].map(({ name, description, uri }) => ({ name, description, uri })); }
  get(name: string): Skill {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    return skill;
  }
  asset(path: string): string {
    const text = this.assets.get(path);
    if (text === undefined) throw new Error('Unknown catalog asset.');
    return text;
  }
  search(query: string, limit = 10) {
    const words = query.toLowerCase().match(/[a-z0-9-]+/g) ?? [];
    return this.list().map(skill => ({ ...skill, relevance: words.reduce((score, word) => score + (skill.name.includes(word) ? 5 : 0) + (skill.description.toLowerCase().includes(word) ? 1 : 0), 0) }))
      .filter(s => !words.length || s.relevance > 0).sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name)).slice(0, limit);
  }
}
