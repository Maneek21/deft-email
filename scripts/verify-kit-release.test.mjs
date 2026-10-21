import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyReleasedKit} from './verify-kit-release.mjs';

test('publication gate accepts only exact released bytes and immutable Host/source pins',()=>{
  const archive=Buffer.from('release-fixture'),metadata={schema:'deft.author_kit_release.v1',version:'0.1.0-alpha.42',
    filename:'deft-app-kit-0.1.0-alpha.42.tgz',source_repository:'Maneek21/Deft',source_commit:'a'.repeat(40),
    host_release:'0.3.0-preview.133',sha256:createHash('sha256').update(archive).digest('hex'),
    integrity:'sha512-'+createHash('sha512').update(archive).digest('base64')};
  const certificate={...metadata,artifact_origin:'Host release-flow artifact',expected_release_flow:{host_release:metadata.host_release}};
  const input={certificate,metadata,appArchive:archive,runtimeArchive:archive,releasedArchive:archive};
  assert.equal(verifyReleasedKit(input).source_commit,metadata.source_commit);
  for(const patch of [{certificate:{...certificate,artifact_origin:'local packed certification candidate; not published'}},
    {metadata:{...metadata,host_release:'0.3.0-preview.132'}},{metadata:{...metadata,source_commit:'b'.repeat(40)}},
    {appArchive:Buffer.from('changed')},{runtimeArchive:Buffer.from('changed')},{releasedArchive:Buffer.from('changed')}])
    assert.throws(()=>verifyReleasedKit({...input,...patch}));
});
