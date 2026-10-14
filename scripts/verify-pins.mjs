import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const pins = [
  ['../app/deft-app-kit-0.1.0-alpha.33.tgz', 'c022a3e215766d9730367002f210013ec14b46e01ee6fdf71ed25ca754cb9037'],
  ['../runtime/deft-app-kit-0.1.0-alpha.33.tgz', 'c022a3e215766d9730367002f210013ec14b46e01ee6fdf71ed25ca754cb9037'],
  ['../app/deft-app-kit-0.1.0-alpha.30.tgz', '8ca1a4924826a2800cc4cec612d0aa729fe8ac20aa07c9025d0e2488f377f6d8'],
  ['../runtime/deft-app-kit-0.1.0-alpha.32.tgz', '44a4419d6f40320650f20f89d6a99ee3ee0631e613843439fc349849f5a35ddb'],
];
for (const [file, expected] of pins) {
  assert.equal(createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex'), expected, file);
  console.log(`${file}: SHA256 verified`);
}
