// Makes the upload for GoDaddy's Node.js hosting ("My Apps" → folder/zip
// upload):
//
//   npm run package:godaddy      → build/kc-admin-api-godaddy.zip
//
// GoDaddy builds from source: it runs `npm install` (production dependencies
// only), `npm run build`, then `npm start`. So the zip holds the source,
// package.json and package-lock.json, and never node_modules, build output,
// tests or secrets (.env).

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'build', 'kc-admin-api-godaddy');
const zip = join(root, 'build', 'kc-admin-api-godaddy.zip');

const include = [
  'src',
  'prisma/schema.prisma',
  'prisma/migrations',
  'database',
  'docs',
  'server.js',
  'start.js',
  'database-url.js',
  'database-url.d.ts',
  'next.config.ts',
  'prisma.config.ts',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
  '.npmrc',
  '.env.example',
  'README.md',
];

rmSync(join(root, 'build'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const path of include) {
  if (!existsSync(join(root, path))) throw new Error(`Missing ${path}`);
  cpSync(join(root, path), join(out, path), { recursive: true });
}
// Generated on the server by `npm install` / `npm run build`.
rmSync(join(out, 'src', 'generated'), { recursive: true, force: true });
cpSync(join(root, 'deploy', 'DEPLOY.md'), join(out, 'DEPLOY.md'));

const windowsTar = 'C:\\Windows\\System32\\tar.exe';
if (process.platform === 'win32' && existsSync(windowsTar)) {
  execFileSync(windowsTar, ['-a', '-c', '-f', zip, '-C', out, '.'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out, stdio: 'inherit' });
}
console.log(`Done: ${zip}`);
