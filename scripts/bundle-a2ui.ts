#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const HASH_FILE = path.join(ROOT_DIR, 'src/canvas-host/a2ui/.bundle.hash');
const OUTPUT_FILE = path.join(ROOT_DIR, 'src/canvas-host/a2ui/a2ui.bundle.js');
const A2UI_RENDERER_DIR = path.join(ROOT_DIR, 'vendor/a2ui/renderers/lit');
const A2UI_APP_DIR = path.join(ROOT_DIR, 'apps/shared/OpenClawKit/Tools/CanvasA2UI');

// 检查源码是否存在
async function checkSources() {
    const rendererExists = await fs.stat(A2UI_RENDERER_DIR).then(() => true, () => false);
    const appExists = await fs.stat(A2UI_APP_DIR).then(() => true, () => false);

    if (!rendererExists || !appExists) {
        if (await fs.stat(OUTPUT_FILE).then(() => true, () => false)) {
            console.log('A2UI sources missing; keeping prebuilt bundle.');
            process.exit(0);
        }
        console.error('A2UI sources missing and no prebuilt bundle found at:', OUTPUT_FILE);
        process.exit(1);
    }
}

// 递归遍历文件
async function walk(dir: string, files: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            await walk(fullPath, files);
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

// 计算哈希
async function computeHash(): Promise<string> {
    const inputPaths = [
        path.join(ROOT_DIR, 'package.json'),
        path.join(ROOT_DIR, 'pnpm-lock.yaml'),
        A2UI_RENDERER_DIR,
        A2UI_APP_DIR,
    ];

    const allFiles: string[] = [];
    for (const p of inputPaths) {
        const stat = await fs.stat(p);
        if (stat.isDirectory()) {
            await walk(p, allFiles);
        } else {
            allFiles.push(p);
        }
    }

    // 排序（模拟 normalize）
    const normalized = allFiles.map(f => f.split(path.sep).join('/'));
    const sortedIndices = normalized
        .map((_, i) => i)
        .sort((a, b) => normalized[a].localeCompare(normalized[b]));

    const hash = createHash('sha256');
    for (const i of sortedIndices) {
        const filePath = allFiles[i];
        const rel = path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
        hash.update(rel);
        hash.update('\0');
        hash.update(await fs.readFile(filePath));
        hash.update('\0');
    }

    return hash.digest('hex');
}

function run(command: string, args: string[], cwd?: string) {
    // 在 Windows 上，必须通过 shell 执行 npx 命令
    const isWindows = process.platform === 'win32';
    const finalCommand = isWindows ? 'npx.cmd' : 'npx';
    const finalArgs = [command, ...args];

    console.log('Running:', finalCommand, finalArgs.join(' '));

    const result = spawnSync(finalCommand, finalArgs, {
        cwd,
        stdio: 'inherit', // 继承 stdout/stderr，方便调试
        shell: true,      // ⚠️ 关键：Windows 必须设为 true
        windowsHide: false,
    });

    if (result.status !== 0) {
        console.error(`Command failed with exit code ${result.status}`);
        process.exit(1);
    }
}
// 主逻辑
async function main() {
    await checkSources();

    const currentHash = await computeHash();
    let previousHash = '';

    try {
        previousHash = (await fs.readFile(HASH_FILE, 'utf8')).trim();
    } catch {}

    if (previousHash === currentHash) {
        try {
            await fs.access(OUTPUT_FILE);
            console.log('A2UI bundle up to date; skipping.');
            return;
        } catch {}
    }

    // 构建步骤
    console.log('Building A2UI bundle...');
    const tsconfig = path.join(A2UI_RENDERER_DIR, 'tsconfig.json');
    run('pnpm', ['-s', 'exec', 'tsc', '-p', tsconfig]);
    const configPath = path.join(A2UI_APP_DIR, 'rolldown.config.mjs');
    run('rolldown', ['-c', configPath]);
    await fs.writeFile(HASH_FILE, currentHash);
    console.log('A2UI bundle updated.');
}

main().catch(err => {
    console.error('A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle');
    console.error('If this persists, verify pnpm deps and try again.');
    process.exit(1);
});
