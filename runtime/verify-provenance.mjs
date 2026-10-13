import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = new URL('./', import.meta.url);
const provenance = JSON.parse((await readFile(new URL('PROVENANCE.json', root), 'utf8')).replace(/^\uFEFF/u, ''));
for (const row of provenance.copies) {
  const sha = createHash('sha256').update(await readFile(new URL(row.target, root))).digest('hex');
  if (sha !== row.sha256) throw Error('EMAIL_RUNTIME_PROVENANCE_CHANGED:' + row.target);
}
process.stdout.write(JSON.stringify({modules: provenance.copies.length, hashes_verified: true, unchanged_copies: provenance.copies.filter(row=>row.mode==='byte_copy').length, normalized_copies:provenance.copies.filter(row=>row.mode==='line_endings_normalized').length, reviewed_adaptations:provenance.copies.filter(row=>row.mode==='reviewed_adaptation').length, baseline: provenance.baseline}) + '\n');
