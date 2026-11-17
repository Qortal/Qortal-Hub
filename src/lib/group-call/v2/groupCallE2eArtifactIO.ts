import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GroupCallE2eArtifactBundle } from './groupCallE2eArtifacts';

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export async function writeGroupCallE2eArtifactBundle(
  outputRoot: string,
  bundle: GroupCallE2eArtifactBundle,
  extraFiles?: Record<string, string>
): Promise<string> {
  const dir = path.join(outputRoot, sanitizeSegment(bundle.report.scenarioId));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(dir, 'report.json'),
      `${JSON.stringify(bundle.report, null, 2)}\n`,
      'utf8'
    ),
    writeFile(path.join(dir, 'summary.md'), `${bundle.summaryMarkdown}\n`, 'utf8'),
    writeFile(
      path.join(dir, 'prompt-context.md'),
      `${bundle.promptContextMarkdown}\n`,
      'utf8'
    ),
    ...Object.entries(extraFiles ?? {}).map(([name, contents]) =>
      writeFile(path.join(dir, name), contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8')
    ),
  ]);
  return dir;
}
