import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallTarget = 'claude' | 'opencode' | 'agents';

export const INSTALL_TARGETS: InstallTarget[] = ['claude', 'opencode', 'agents'];
export const LEGACY_SKILLS = ['tasker', 'metapod', 'judge-dredd', 'brian-spillner', 'prompt-pipeline'];

export interface InstallOptions {
  targets?: InstallTarget[];
  directory?: string;
  dryRun?: boolean;
  skillsDir?: string;
  home?: string;
}

export interface InstallResult {
  target: string;
  directory: string;
  skills: string[];
  dry_run: boolean;
}

export function targetDirectory(target: InstallTarget, home = homedir()): string {
  if (target === 'claude') return join(home, '.claude', 'skills');
  if (target === 'opencode') return join(home, '.config', 'opencode', 'skills');
  return join(home, '.agents', 'skills');
}

export async function detectTargets(home = homedir()): Promise<InstallTarget[]> {
  const candidates: Array<[InstallTarget, string]> = [
    ['claude', join(home, '.claude')],
    ['opencode', join(home, '.config', 'opencode')],
    ['agents', join(home, '.agents')],
  ];
  const found: InstallTarget[] = [];
  for (const [target, parent] of candidates) {
    try {
      if ((await lstat(parent)).isDirectory()) found.push(target);
    } catch {
      // Not installed on this machine.
    }
  }
  return found.length ? found : ['claude'];
}

export function bundledSkillsDirectory(): string {
  return fileURLToPath(new URL('../skills', import.meta.url));
}

export async function installSkills(options: InstallOptions = {}): Promise<InstallResult[]> {
  const source = resolve(options.skillsDir ?? bundledSkillsDirectory());
  const entries = await readdir(source, { withFileTypes: true });
  const skills: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in skills directory: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    try {
      if (!(await lstat(join(source, entry.name, 'SKILL.md'))).isFile()) continue;
    } catch {
      continue;
    }
    skills.push(entry.name);
  }
  if (!skills.length) throw new Error(`No skills found in ${source}.`);

  const targets = options.directory
    ? [{ target: 'custom', directory: resolve(options.directory) }]
    : (options.targets ?? await detectTargets(options.home)).map(target => ({
        target,
        directory: targetDirectory(target, options.home),
      }));

  const results: InstallResult[] = [];
  for (const { target, directory } of targets) {
    if (!options.dryRun) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const legacy of LEGACY_SKILLS) {
        if (skills.includes(legacy)) continue;
        const legacyDirectory = join(directory, legacy);
        try {
          if ((await lstat(join(legacyDirectory, 'SKILL.md'))).isFile()) {
            await rm(legacyDirectory, { recursive: true, force: true });
          }
        } catch {
          // No legacy copy in this target.
        }
      }
      for (const skill of skills) {
        await cp(join(source, skill), join(directory, skill), {
          recursive: true,
          force: true,
          dereference: false,
          errorOnExist: false,
        });
      }
    }
    results.push({ target, directory, skills, dry_run: options.dryRun ?? false });
  }
  return results;
}
