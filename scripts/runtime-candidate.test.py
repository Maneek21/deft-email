import importlib.util,io,json,sys,tarfile,tempfile,threading,unittest
from unittest.mock import patch
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('candidate',Path(__file__).with_name('runtime-candidate.py'));C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
def archive(path,rows):
 with tarfile.open(path,'w:gz') as t:
  for name,raw,mode in rows:
   info=tarfile.TarInfo(name);info.mode=mode;info.size=len(raw);info.uid=info.gid=info.mtime=0;t.addfile(info,io.BytesIO(raw))
class CandidateTests(unittest.TestCase):
 def test_archive_rejects_traversal_duplicate_link_and_changed_modes(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'source.tgz'
   for rows in [[('../escape',b'x',0o644)],[('runtime/a',b'x',0o644),('runtime/a',b'y',0o644)],[('runtime/a',b'x',0o755)],[('runtime/node_modules/a',b'x',0o644)]]:
    archive(p,rows)
    with self.assertRaises(ValueError):C.files(p,'runtime')
   with tarfile.open(p,'w:gz') as t:
    info=tarfile.TarInfo('runtime/link');info.type=tarfile.SYMTYPE;info.linkname='elsewhere';t.addfile(info)
   with self.assertRaises(ValueError):C.files(p,'runtime')
 def test_offline_recipe_preserves_base_dependency_and_network_fences(self):
  text=C.recipe('a'*40,'node');self.assertIn('FROM '+C.BASE_TAG,text);self.assertIn('--prod --frozen-lockfile --ignore-scripts --offline',text);self.assertIn('node verify-provenance.mjs',text);self.assertTrue(text.endswith('a'*40+'"\n'));self.assertNotIn('apt-get',text)
  for commit,user in [('bad','node'),('a'*40,'node\nRUN bad')]:
   with self.assertRaises(ValueError):C.recipe(commit,user)
 def test_build_validates_actual_sealed_kit_archive_without_docker_and_denies_drift(self):
  with tempfile.TemporaryDirectory() as d:
   d=Path(d);f=d/'frozen';f.mkdir();out=d/'build';kit=(C.ROOT/'runtime/deft-app-kit-0.1.0-alpha.35.tgz').read_bytes()
   package=json.dumps({'version':C.VERSION,'dependencies':{'@deft/app-kit':'file:deft-app-kit-0.1.0-alpha.35.tgz'}}).encode()
   archive(f/'runtime-artifact.tgz',[('runtime/package.json',package,0o644),('runtime/deft-app-kit-0.1.0-alpha.35.tgz',kit,0o644)])
   C.write_json(f/'BUILD.json',{'source_commit':'a'*40,'runtime_version':C.VERSION,'kit_sha256':C.KIT,'package_digest':'sha256:'+C.APP,'app_kit_sha256':C.APP_KIT,'runtime_source_sha256':C.file_sha(f/'runtime-artifact.tgz')})
   base=d/'base.json';C.write_json(base,[{'Id':C.BASE,'Config':{'User':'node'}}])
   result=C.build(f,base,out,False);self.assertEqual(result['docker_calls'],0);self.assertFalse(out.exists())
   with self.assertRaisesRegex(ValueError,'EXCLUSIVE_OUTPUT_REQUIRED'):C.build(f,base,f/'nested-output',False)
   with (f/'runtime-artifact.tgz').open('ab') as t:t.write(b'changed')
   with self.assertRaisesRegex(ValueError,'FROZEN_ARCHIVE_DRIFT'):C.build(f,base,out,False)
 def test_dirty_source_cannot_create_a_frozen_candidate(self):
  old=C.command
  try:
   C.command=lambda args,**kw:'a'*40+'\n' if args[1]=='rev-parse' else b' M runtime/data-runtime.mjs\n'
   with tempfile.TemporaryDirectory() as d:
    out=Path(d)/'output'
    with self.assertRaisesRegex(ValueError,'CLEAN_COMMITTED_SOURCE_REQUIRED'):C.freeze('a'*40,out)
    self.assertFalse(out.exists())
  finally:C.command=old
 def test_output_capacity_reserve_denies_before_writes(self):
  with tempfile.TemporaryDirectory() as d,patch.object(C.shutil,'disk_usage') as usage:
   usage.return_value=type('Space',(),{'free':C.RESERVE+99})()
   with self.assertRaisesRegex(ValueError,'LOCAL_OUTPUT_RESERVE_DENIED'):C.require_space(Path(d)/'new',100)
   usage.return_value=type('Space',(),{'free':C.RESERVE+100})();C.require_space(Path(d)/'new',100)
 def test_source_membership_selection_matches_packager_boundaries(self):
  names={'runtime/a.mjs','scripts/runtime-candidate.py','README.md','runtime/private/key','runtime/node_modules/a','app/app.deft.json','app/worker.bundle.js','docs/private/a','runtime/a.log','.env.example','.env.secret','unrelated.txt'}
  self.assertEqual(C.selected_git_source(names),{'runtime/a.mjs','scripts/runtime-candidate.py','README.md','.env.example'})
 def test_blocked_save_pipe_has_bounded_owned_child_cleanup_and_no_retry(self):
  stopped=threading.Event()
  class Pipe:
   sent=False
   def read(self,n):
    if not self.sent:self.sent=True;return b'partial'
    assert stopped.wait(1);return b''
   def close(self):pass
  class Child:
   stdout=Pipe();kills=0
   def poll(self):return -9 if stopped.is_set() else None
   def kill(self):self.kills+=1;stopped.set()
   def wait(self,timeout):return -9
  child=Child();sink=io.BytesIO()
  with patch.object(C.subprocess,'Popen',return_value=child) as launch:
   with self.assertRaisesRegex(ValueError,'EXPORT_FAILED_PRESERVE_NO_REPLAY'):C.save_image('exact-tag',sink,0.02)
   self.assertEqual(launch.call_count,1);self.assertEqual(child.kills,1);self.assertEqual(sink.getvalue(),b'partial')
if __name__=='__main__':unittest.main()
