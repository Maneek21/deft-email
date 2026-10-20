import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const pins = [
  ['../app/deft-app-kit-0.1.0-alpha.39.tgz', '5d45f6cb9cdf4ffc238e1137609dda5f32bbf48f2ebd2d0e47fb50ac62622a5f'],
  ['../app/deft-app-kit-0.1.0-alpha.38.tgz', 'dbb35ea11e2ce192fed72889aee8ea65764aa16dd93ce0b71f5075e2fb655341'],
  ['../app/deft-app-kit-0.1.0-alpha.37.tgz', 'f4268e5c7d1cd0d880f25286ee5809f4e7c455a616cd9ec3a5d642c982d4711e'],
  ['../app/deft-app-kit-0.1.0-alpha.36.tgz', '2f4cc1dc08005b9b6191d6aaff409be61bee3b726b6cdf514a54cc7739adfc9d'],
  ['../app/deft-app-kit-0.1.0-alpha.35.tgz', '82c2d5bff2776e423b58647fad0f4a6a6430535f4e60c8146fed737d83f33ad5'],
  ['../runtime/deft-app-kit-0.1.0-alpha.35.tgz', '82c2d5bff2776e423b58647fad0f4a6a6430535f4e60c8146fed737d83f33ad5'],

  ['../app/deft-app-kit-0.1.0-alpha.34.tgz', 'd5b0c498025684e4eae9fafe950846794b39874fac1f3277914e7e3c61bd93ef'],
  ['../runtime/deft-app-kit-0.1.0-alpha.34.tgz', 'd5b0c498025684e4eae9fafe950846794b39874fac1f3277914e7e3c61bd93ef'],
  ['../app/deft-app-kit-0.1.0-alpha.33.tgz', 'c022a3e215766d9730367002f210013ec14b46e01ee6fdf71ed25ca754cb9037'],
  ['../runtime/deft-app-kit-0.1.0-alpha.33.tgz', 'c022a3e215766d9730367002f210013ec14b46e01ee6fdf71ed25ca754cb9037'],
  ['../app/deft-app-kit-0.1.0-alpha.30.tgz', '8ca1a4924826a2800cc4cec612d0aa729fe8ac20aa07c9025d0e2488f377f6d8'],
  ['../runtime/deft-app-kit-0.1.0-alpha.32.tgz', '44a4419d6f40320650f20f89d6a99ee3ee0631e613843439fc349849f5a35ddb'],
];
for (const [file, expected] of pins) {
  assert.equal(createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex'), expected, file);
  console.log(`${file}: SHA256 verified`);
}
