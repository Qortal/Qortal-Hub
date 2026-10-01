import { build } from '../../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = fileURLToPath(new URL('../../', import.meta.url));
const outfile = path.join(root, 'electron/build/foreign-wallet-engine.cjs');
const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, 'src/lib/foreign-wallet/desktop-engine.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  legalComments: 'eof',
  metafile: true,
});
// Preserve the licenses of bundled dependencies on every supported platform.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.add(match[1]);
}
const notices = [];
for (const pkg of [...packages].sort()) {
  const metadata = JSON.parse(
    await fs.readFile(path.join(root, pkg, 'package.json'), 'utf8')
  );
  const names = await fs.readdir(path.join(root, pkg));
  const license = names.find((name) =>
    /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name)
  );
  if (!license) throw new Error(`Missing dependency license: ${metadata.name}`);
  notices.push(
    `${metadata.name} ${metadata.version}\n${await fs.readFile(path.join(root, pkg, license), 'utf8')}`
  );
}
const text = notices.join('\n\n');
await fs.appendFile(outfile, `\n/*\n${text.replaceAll('*/', '* /')}\n*/\n`);
await fs.mkdir(path.join(root, 'public'), { recursive: true });
await fs.writeFile(
  path.join(root, 'public/wallet-dependency-licenses.txt'),
  text
);
