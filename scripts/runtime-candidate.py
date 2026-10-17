"""Deterministic Runtime15/App13 source candidate. Local artifacts only; never deploys a service.

freeze uses the maintained package-source.py, exact committed Git blobs and the
current App13/Kit38 package plus unchanged Runtime Kit35 pins. build defaults to validation only; explicit execute
uses the reviewed Runtime12 base and an offline, frozen, no-script install.
export saves the exact verified image; upload, load and swap are separate work.
"""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json,shutil,subprocess,tarfile,threading

ROOT=Path(__file__).resolve().parent.parent
VERSION='0.4.0-preview.15'
BASE='sha256:65a99b8f95836d91f6d36d4b0723772b622264b6d52dfb186fea944746f07215'
BASE_TAG='deft-email-runtime:0.4.0-preview.12-4af03db9'
KIT='82c2d5bff2776e423b58647fad0f4a6a6430535f4e60c8146fed737d83f33ad5'
APP='7ab7876f5318888ce13177d0d5f7fbf423c0083d437ee2c8b02b78aef66a840a'
APP_KIT='dbb35ea11e2ce192fed72889aee8ea65764aa16dd93ce0b71f5075e2fb655341'
DEFAULTS=('Env','Cmd','Entrypoint','WorkingDir','User','Healthcheck','ExposedPorts','Volumes','StopSignal')
RESERVE=512*1024*1024
def need(value,code):
 if not value:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def file_sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while block:=f.read(1024*1024):h.update(block)
 return h.hexdigest()
def command(args,**kwargs):return subprocess.check_output(args,**kwargs)
def write_json(path,value):path.write_text(json.dumps(value,indent=2)+'\n',encoding='utf8',newline='\n')
def require_space(path,growth):
 probe=path.resolve()
 while not probe.exists():probe=probe.parent
 need(shutil.disk_usage(probe).free>=RESERVE+growth,'LOCAL_OUTPUT_RESERVE_DENIED')
def selected_git_source(names):
 roots={'app','runtime','scripts','docs','.github','README.md','LICENSE','NOTICE','THIRD-PARTY-LICENSES.md','package.json','.gitignore','.gitattributes','.env.example'}
 excluded={'node_modules','.git','state','private','dist','coverage','__pycache__'};generated={'app/app.deft.json','app/artifact.json','app/worker.bundle.js','app/build-result.json'}
 return {name for name in names if name.split('/')[0] in roots and not set(name.split('/'))&excluded and name not in generated and not name.endswith(('.log','.pyc')) and not any(part.startswith('.env') and part!='.env.example' for part in name.split('/'))}
def files(path,prefix=None):
 result={}
 with tarfile.open(path,'r:gz') as archive:
  for row in archive:
   p=PurePosixPath(row.name)
   need(row.isfile() and not p.is_absolute() and '..' not in p.parts and '\\' not in row.name and row.name not in result and row.mode==0o644 and row.uid==row.gid==row.mtime==0,'UNSAFE_ARCHIVE_MEMBER')
   need('node_modules' not in p.parts and (not prefix or p.parts[0]==prefix),'CLEAN_SOURCE_REQUIRED')
   result[row.name]=archive.extractfile(row).read()
 need(result,'EMPTY_ARCHIVE_DENIED');return result
def freeze(commit,out):
 need(len(commit)==40 and all(c in '0123456789abcdef' for c in commit),'EXACT_COMMIT_REQUIRED')
 need(command(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==commit,'CURRENT_COMMIT_REQUIRED')
 need(not command(['git','status','--porcelain'],cwd=ROOT).strip(),'CLEAN_COMMITTED_SOURCE_REQUIRED')
 need(not out.exists(),'EXCLUSIVE_OUTPUT_REQUIRED')
 need(file_sha(ROOT/'app/app.deft.json')==APP and file_sha(ROOT/'app/deft-app-kit-0.1.0-alpha.38.tgz')==APP_KIT,'EXACT_APP13_REQUIRED')
 need(json.loads((ROOT/'runtime/package.json').read_text())['version']==VERSION,'EXACT_RUNTIME_VERSION_REQUIRED')
 tree={}
 for raw in command(['git','ls-tree','-rz','--full-tree',commit],cwd=ROOT).split(b'\0'):
  if raw:
   spec,name=raw.split(b'\t',1);mode,kind,blob=spec.split();tree[name.decode()]=(mode,kind,blob.decode())
 intended=selected_git_source(tree)
 # Two archive copies (dist and immutable output), including conservative tar
 # framing/gzip overhead, must leave the original local512MiB reserve.
 budget=sum((ROOT/name).stat().st_size+4096 for name in intended)
 budget+=sum((ROOT/name).stat().st_size+4096 for name in intended if name.startswith('runtime/'))
 require_space(ROOT/'dist',budget);require_space(out,2*budget)
 subprocess.run(['node',str(ROOT/'runtime/verify-provenance.mjs')],cwd=ROOT,check=True)
 subprocess.run(['python',str(ROOT/'scripts/package-source.py')],cwd=ROOT,check=True)
 source=ROOT/'dist/email-1.9.0-preview.13-source.tar.gz';members=files(source)
 need(set(members)==intended,'COMPLETE_SELECTED_GIT_MEMBERSHIP_REQUIRED')
 for name,raw in members.items():
  need(name in tree,'UNTRACKED_SOURCE_DENIED');mode,kind,blob=tree[name]
  need(kind==b'blob' and mode in (b'100644',b'100755') and hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==blob,'GIT_BLOB_DRIFT')
 runtime=files(ROOT/'dist/runtime-artifact.tgz','runtime')
 need(runtime=={n:v for n,v in members.items() if n.startswith('runtime/')},'RUNTIME_SOURCE_DRIFT')
 need(sha(runtime['runtime/deft-app-kit-0.1.0-alpha.35.tgz'])==KIT,'SEALED_RUNTIME_KIT35_REQUIRED')
 out.mkdir(parents=True,exist_ok=False)
 for name in ['runtime-artifact.tgz',source.name,'source-manifest.json']:shutil.copyfile(ROOT/'dist'/name,out/name)
 for name in ['app.deft.json','artifact.json','build-result.json']:shutil.copyfile(ROOT/'app'/name,out/name)
 result={'schema_version':'email.independent_runtime_frozen.v1','source_commit':commit,'runtime_version':VERSION,'app_version':'1.9.0-preview.13','package_digest':'sha256:'+APP,'app_kit_version':'0.1.0-alpha.38','app_kit_sha256':APP_KIT,'kit_sha256':KIT,'runtime_source_sha256':file_sha(out/'runtime-artifact.tgz'),'source_archive_sha256':file_sha(out/source.name),'source_member_count':len(members),'runtime_member_count':len(runtime),'all_source_members_match_exact_git_blobs':True,'archive_modes':'normalized0644','server_mutations':0}
 write_json(out/'BUILD.json',result);return result
def recipe(commit,user):
 need(len(commit)==40 and all(c in '0123456789abcdef' for c in commit),'EXACT_COMMIT_REQUIRED')
 need(user and all(c.isalnum() or c in '_:.-' for c in user),'BASE_USER_REQUIRED')
 return ('FROM '+BASE_TAG+'\nUSER root\nCOPY runtime-artifact.tgz /tmp/runtime-artifact.tgz\n'
 'RUN rm -rf /opt/email-runtime && mkdir /opt/email-runtime && tar -xzf /tmp/runtime-artifact.tgz --strip-components=1 -C /opt/email-runtime && rm /tmp/runtime-artifact.tgz && cd /opt/email-runtime && pnpm install --prod --frozen-lockfile --ignore-scripts --offline && node verify-provenance.mjs && chown -R node:node /opt/email-runtime\n'
 'USER '+user+'\nLABEL org.opencontainers.image.version="'+VERSION+'" org.opencontainers.image.revision="'+commit+'" org.opencontainers.image.source="https://github.com/Maneek21/deft-email/tree/'+commit+'"\n')
def prepare(frozen,base_inspect,out):
 need(not out.exists() and not out.resolve().is_relative_to(frozen.resolve()),'EXCLUSIVE_OUTPUT_REQUIRED')
 f=json.loads((frozen/'BUILD.json').read_bytes());commit=f['source_commit']
 need(f['runtime_version']==VERSION and f['kit_sha256']==KIT and f['package_digest']=='sha256:'+APP and f['app_kit_sha256']==APP_KIT,'FROZEN_SCOPE_REQUIRED')
 need(file_sha(frozen/'runtime-artifact.tgz')==f['runtime_source_sha256'],'FROZEN_ARCHIVE_DRIFT')
 members=files(frozen/'runtime-artifact.tgz','runtime');p=json.loads(members['runtime/package.json'])
 need(p['version']==VERSION and p['dependencies']['@deft/app-kit']=='file:deft-app-kit-0.1.0-alpha.35.tgz' and sha(members['runtime/deft-app-kit-0.1.0-alpha.35.tgz'])==KIT,'EXACT_PACKAGE_KIT_REQUIRED')
 base=json.loads(base_inspect.read_bytes());base=base[0] if isinstance(base,list) else base;need(base['Id']==BASE,'EXACT_BASE_REQUIRED')
 return f,base,{n.removeprefix('runtime/'):sha(raw) for n,raw in members.items()},recipe(commit,base['Config']['User'])
def build(frozen,base_inspect,out,execute):
 f,base,pins,text=prepare(frozen,base_inspect,out);tag='deft-email-runtime:'+VERSION+'-'+f['source_commit'][:8]
 result={'schema_version':'email.independent_runtime_build.v1','commit':f['source_commit'],'version':VERSION,'base_image':BASE,'tag':tag,'kit_sha256':KIT,'runtime_source_sha256':f['runtime_source_sha256'],'recipe_sha256':sha(text.encode()),'dependency_network':'none','service_mutations':0}
 if not execute:return {**result,'mode':'validated_only','docker_calls':0}
 require_space(out,(frozen/'runtime-artifact.tgz').stat().st_size+16*1024*1024)
 actual=json.loads(command(['docker','image','inspect',BASE]))[0]
 need(json.loads(command(['docker','image','inspect',BASE_TAG]))[0]['Id']==BASE and actual['RootFS']==base['RootFS'] and all(actual['Config'].get(k)==base['Config'].get(k) for k in DEFAULTS),'BASE_DRIFT')
 out.mkdir(parents=True,exist_ok=False);shutil.copyfile(frozen/'runtime-artifact.tgz',out/'runtime-artifact.tgz');(out/'Dockerfile').write_text(text,encoding='utf8',newline='\n');write_json(out/'base-image-inspect.json',[actual])
 with (out/'build.log').open('xb') as log:completed=subprocess.run(['docker','build','--pull=false','--network','none','--platform','linux/amd64','--progress','plain','--tag',tag,str(out)],stdout=log,stderr=subprocess.STDOUT,timeout=600)
 need(completed.returncode==0,'BUILD_FAILED_PRESERVE_LOG_NO_REPLAY');image=json.loads(command(['docker','image','inspect',tag]))[0]
 need(image['RootFS']['Layers'][:len(base['RootFS']['Layers'])]==base['RootFS']['Layers'] and all(image['Config'].get(k)==base['Config'].get(k) for k in DEFAULTS),'IMAGE_DEFAULT_OR_ANCESTRY_DRIFT')
 write_json(out/'image-inspect.json',[image])
 script="const fs=require('fs'),c=require('crypto');const pins="+json.dumps(pins)+";for(const [p,h]of Object.entries(pins))if(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)throw Error('SOURCE_DRIFT');import('@deft/app-kit').then(k=>{if(k.DEFT_APP_KIT_VERSION!=='0.1.0-alpha.35')throw Error('KIT_DRIFT');console.log('Runtime15/Kit35 exact source verified');});"
 verified=command(['docker','run','--rm','-i','--network','none','--entrypoint','node',tag,'-'],input=script.encode(),timeout=60).decode().strip()
 result.update(image=image['Id'],rootfs_diff_ids=image['RootFS']['Layers'],image_bytes=image['Size'],source_files_sha256=pins,source_files_verified_in_container=len(pins),source_version_check=verified,defaults_preserved=True,kit_version='0.1.0-alpha.35',clean_prod_install=True,base_lock_and_dependencies_unchanged=False,frozen_build_sha256=file_sha(frozen/'BUILD.json'),runtime_source_bytes=(frozen/'runtime-artifact.tgz').stat().st_size,package_json_sha256=pins['package.json'],lockfile_sha256=pins['pnpm-lock.yaml'],install_flags=['--prod','--frozen-lockfile','--ignore-scripts','--offline'])
 write_json(out/'BUILD.json',result);return result
def save_image(tag,sink,timeout_seconds=120):
 child=subprocess.Popen(['docker','image','save',tag],stdout=subprocess.PIPE)
 expired=threading.Event()
 def expire():
  expired.set()
  if child.poll() is None:child.kill()
 timer=threading.Timer(timeout_seconds,expire);timer.daemon=True;timer.start()
 try:
  shutil.copyfileobj(child.stdout,sink,1024*1024)
  need(child.wait(timeout=10)==0 and not expired.is_set(),'EXPORT_FAILED_PRESERVE_NO_REPLAY')
 finally:
  timer.cancel();child.stdout.close()
  if child.poll() is None:
   child.kill();child.wait(timeout=10)
def export(build_dir,out,execute):
 result=json.loads((build_dir/'BUILD.json').read_bytes());need(result['version']==VERSION and result['base_image']==BASE and result['kit_sha256']==KIT,'EXACT_BUILD_REQUIRED');need(not out.exists(),'EXCLUSIVE_EXPORT_REQUIRED')
 if not execute:return {'mode':'validated_only','image':result['image'],'docker_calls':0}
 inspect=json.loads(command(['docker','image','inspect',result['tag']]))[0];need(inspect['Id']==result['image'] and inspect['RootFS']['Layers']==result['rootfs_diff_ids'],'BUILT_IMAGE_DRIFT')
 require_space(out,inspect['Size']+16*1024*1024)
 out.parent.mkdir(parents=True,exist_ok=True)
 # Deterministic gzip header; docker save bytes are retained and hash-pinned.
 import gzip
 with out.open('xb') as raw,gzip.GzipFile(fileobj=raw,mode='wb',filename='',mtime=0) as gz:
  save_image(result['tag'],gz)
 receipt={'image':result['image'],'archive':out.name,'sha256':file_sha(out),'bytes':out.stat().st_size,'live_mutations':0};write_json(out.with_suffix(out.suffix+'.json'),receipt);return receipt
def main():
 p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='mode',required=True)
 f=s.add_parser('freeze');f.add_argument('--commit',required=True);f.add_argument('--output',type=Path,required=True)
 b=s.add_parser('build');b.add_argument('--frozen',type=Path,required=True);b.add_argument('--base-inspect',type=Path,required=True);b.add_argument('--output',type=Path,required=True);b.add_argument('--execute-root-only',action='store_true')
 e=s.add_parser('export');e.add_argument('--build-dir',type=Path,required=True);e.add_argument('--output',type=Path,required=True);e.add_argument('--execute-root-only',action='store_true');a=p.parse_args()
 result=freeze(a.commit,a.output) if a.mode=='freeze' else build(a.frozen,a.base_inspect,a.output,a.execute_root_only) if a.mode=='build' else export(a.build_dir,a.output,a.execute_root_only)
 print(json.dumps(result))
if __name__=='__main__':main()
