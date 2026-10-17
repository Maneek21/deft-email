import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script = fileURLToPath(new URL('./package-source.py', import.meta.url));
const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [script], {encoding:'utf8'});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert.equal(result.status, 0, result.error?.message || 'Source packaging failed');
