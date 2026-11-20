import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// An app's picture is /arbitrary/THUMBNAIL/<name>/qortal_avatar. Registered
// names can hold #, ?, / and spaces, so every link to one encodes the name.
const srcDir = resolve(__dirname, '../../..');
const appsDir = resolve(srcDir, 'components/Apps');
const alsoChecked = [
  'components/GeneralNotifications.tsx',
  'components/Group/HomeFeaturedApps.tsx',
  'components/Group/QortinoWorkspaceApps.tsx',
].map((file) => resolve(srcDir, file));

const sources = [
  ...readdirSync(appsDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name)),
  ...alsoChecked,
].filter(
  (file) =>
    /\.tsx?$/.test(file) &&
    !/\.test\.tsx?$/.test(file) &&
    !file.split(sep).includes('__tests__')
);

describe('links to an app’s picture', () => {
  it('encode the app’s name', () => {
    const unencoded = sources.flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /\/THUMBNAIL\/\$\{\s*(?!encodeURIComponent\(|enc\()([^}]*)\}/g
        ),
      ].map((match) => `${relative(srcDir, file)}: ${match[1].trim()}`)
    );

    expect(sources.length).toBeGreaterThan(50);
    expect(unencoded).toEqual([]);
  });
});
