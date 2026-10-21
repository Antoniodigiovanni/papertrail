import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../client/pdfjs.js';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('unchanged PDF.js page-2 text fails without stream iteration and recovers with compatibility', async t => {
    // A subprocess contains prototype deletion and test-only browser API shims.
    // Inherited output also works where sandboxed child stdio pipes are denied.
    const directory = await mkdtemp(path.join(tmpdir(), 'papertrail-stream-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const report = path.join(directory, 'result.json');
    await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/pdfjs-text-regression.mjs', report], { stdio: 'inherit', timeout: 30000 });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`PDF.js text regression exited ${code} (${signal})`));
        });
    });
    // Require proof of reaching every assertion; an empty/failed child cannot pass.
    assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), { negativeControls: 2, recovered: 2, loaderStartup: true });
});
