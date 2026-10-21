import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function verifyReleasedKit({certificate,metadata,appArchive,runtimeArchive,releasedArchive}) {
  assert.equal(certificate.artifact_origin,'Host release-flow artifact','KIT42_CERTIFICATION_CANDIDATE_NOT_RELEASED');
  assert.equal(metadata.schema,'deft.author_kit_release.v1');
  assert.equal(metadata.version,'0.1.0-alpha.42');
  assert.equal(metadata.filename,'deft-app-kit-0.1.0-alpha.42.tgz');
  assert.equal(metadata.source_repository,'Maneek21/Deft');
  assert.equal(metadata.host_release,certificate.expected_release_flow.host_release);
  assert.match(metadata.source_commit,/^[a-f0-9]{40}$/u);
  for(const field of ['version','filename','source_commit','sha256','integrity']) assert.equal(certificate[field],metadata[field],`KIT42_RELEASE_PIN_CHANGED:${field}`);
  for(const archive of [appArchive,runtimeArchive,releasedArchive]) {
    assert.equal(createHash('sha256').update(archive).digest('hex'),metadata.sha256,'KIT42_RELEASE_ARCHIVE_CHANGED');
    assert.equal('sha512-'+createHash('sha512').update(archive).digest('base64'),metadata.integrity,'KIT42_RELEASE_INTEGRITY_CHANGED');
  }
  return {version:metadata.version,host_release:metadata.host_release,source_commit:metadata.source_commit,sha256:metadata.sha256};
}

async function main() {
  const root=new URL('../',import.meta.url),certificate=JSON.parse(readFileSync(new URL('KIT42-CERTIFICATION.json',root),'utf8'));
  const host=certificate.expected_release_flow.host_release;
  assert.match(host,/^0\.3\.0-preview\.[1-9][0-9]*$/u);
  const base=`https://github.com/Maneek21/Deft/releases/download/v${host}/`;
  const get=async name=>{const response=await fetch(base+name,{signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw Error(`KIT42_RELEASE_NOT_PUBLISHED:${host}:${name}:HTTP_${response.status}`);
    return Buffer.from(await response.arrayBuffer());};
  const metadata=JSON.parse((await get('author-kit-release.json')).toString('utf8'));
  const result=verifyReleasedKit({certificate,metadata,
    appArchive:readFileSync(new URL('app/'+certificate.filename,root)),
    runtimeArchive:readFileSync(new URL('runtime/'+certificate.filename,root)),
    releasedArchive:await get('deft-app-kit-0.1.0-alpha.42.tgz')});
  console.log(JSON.stringify(result));
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
