import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { download } from './download.mjs';

const nodeVersion = '22.23.5';
const runtimes = {
  'darwin-arm64': ['tar.gz', 'e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d'],
  'darwin-x64': ['tar.gz', 'c53383238206b9ae4db23c5d8a63645e2e753bec8ab51a49cc81939aa64e9422'],
  'win-x64': ['zip', '4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3'],
};
const windows = process.platform === 'win32';
const target = `${windows ? 'win' : process.platform}-${process.arch}`;
const runtime = runtimes[target];
if (!runtime) throw new Error(`No packaged Node runtime for ${target}.`);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const output = resolve('build/local-release');
const temporary = await mkdtemp(join(tmpdir(), 'tocify-local-'));
const root = join(temporary, 'Tocify');
const launcher = windows ? 'Start Tocify.cmd' : 'Start Tocify.command';
const nodeName = windows ? 'node.exe' : 'node';
const nodeDirectory = `node-v${nodeVersion}-${target}`;
const nodeArchive = `${nodeDirectory}.${runtime[0]}`;
const archivePath = join(temporary, nodeArchive);

try {
  await mkdir(join(root, 'scripts/local'), { recursive: true });
  await mkdir(join(root, 'runtime'), { recursive: true });
  await mkdir(output, { recursive: true });
  await Promise.all([
    cp('build/local', join(root, 'build/local'), { recursive: true }),
    cp('scripts/local/server.mjs', join(root, 'scripts/local/server.mjs')),
    cp('scripts/local/START-HERE.txt', join(root, 'START-HERE.txt')),
    cp('LICENSE', join(root, 'LICENSE')),
    cp('scripts/local/THIRD-PARTY.txt', join(root, 'THIRD-PARTY.txt')),
    writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' })),
    download(`https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`, archivePath, runtime[1]),
  ]);
  execFileSync('tar', ['-xf', archivePath, '-C', temporary], { stdio: 'inherit' });
  const nodeSource = join(temporary, nodeDirectory);
  const executable = join(root, 'runtime', nodeName);
  await cp(windows ? join(nodeSource, nodeName) : join(nodeSource, 'bin', nodeName), executable);
  await cp(join(nodeSource, 'LICENSE'), join(root, 'runtime', 'LICENSE'));
  await writeFile(join(root, launcher), windows
    ? '@echo off\r\ncd /d "%~dp0"\r\n"runtime\\node.exe" "scripts\\local\\server.mjs"\r\nif errorlevel 1 pause\r\n'
    : '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec "./runtime/node" "./scripts/local/server.mjs"\n',
  { mode: 0o755 });

  execFileSync(process.execPath, [resolve('scripts/local/smoke.mjs'), executable, join(root, 'scripts/local/server.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });

  const platform = windows ? 'windows' : 'macos';
  const outputArchive = join(output, `Tocify-Local-v${manifest.version}-${platform}-${process.arch}.zip`);
  execFileSync('tar', ['-a', '-cf', outputArchive, '-C', temporary, 'Tocify'], { stdio: 'inherit' });
  console.log(outputArchive);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
