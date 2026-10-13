"""Deterministic source and Runtime archives using only Python's standard library."""
from pathlib import Path
import gzip, hashlib, io, json, os, tarfile

root = Path(__file__).resolve().parent.parent
output = root/'dist'
output.mkdir(exist_ok=True)
excluded = {'node_modules', '.git', 'state', 'private', 'dist', 'coverage'}
generated = {'app/app.deft.json','app/artifact.json','app/worker.bundle.js','app/build-result.json'}
files = []
entries = ['app','runtime','scripts','docs','.github','README.md','LICENSE','NOTICE','THIRD-PARTY-LICENSES.md','package.json','.gitignore','.gitattributes','.env.example']
for name in entries:
    entry = root/name
    assert not entry.is_symlink(), f'Source links are not allowed: {name}'
    if entry.is_file():
        files.append(entry)
    else:
        assert entry.is_dir(), f'Source input missing: {name}'
        for directory, directories, names in os.walk(entry):
            directories[:] = sorted(name for name in directories if name not in excluded)
            for name in directories:
                assert not (Path(directory)/name).is_symlink(), f'Source links are not allowed: {name}'
            for name in sorted(names):
                path = Path(directory)/name
                relative = path.relative_to(root).as_posix()
                assert not path.is_symlink(), f'Source links are not allowed: {relative}'
                assert '\n' not in relative and '\r' not in relative
                if relative not in generated and not name.endswith('.log') and not any(part.startswith('.env') and part != '.env.example' for part in path.relative_to(root).parts):
                    files.append(path)
files.sort(key=lambda path:path.relative_to(root).as_posix())
version = json.loads((root/'package.json').read_text())['version']

def archive(filename, paths):
    target = output/filename
    with target.open('wb') as raw, gzip.GzipFile(fileobj=raw,mode='wb',filename='',mtime=0) as gz, tarfile.open(fileobj=gz,mode='w',format=tarfile.PAX_FORMAT) as tf:
        for path in paths:
            data = path.read_bytes()
            info = tarfile.TarInfo(path.relative_to(root).as_posix())
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            info.uid, info.gid, info.uname, info.gname = 0, 0, '', ''
            tf.addfile(info, io.BytesIO(data))
    return hashlib.sha256(target.read_bytes()).hexdigest()

source_name = f'email-{version}-source.tar.gz'
manifest = {'version':version,'archive':'dist/'+source_name,'sha256':archive(source_name,files),
    'files':[{'path':path.relative_to(root).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in files],
    'runtime_archive':'dist/runtime-artifact.tgz','runtime_sha256':archive('runtime-artifact.tgz',[path for path in files if path.relative_to(root).parts[0]=='runtime']),
    'archive_metadata':{'mtime':0,'uid':0,'gid':0,'mode':'0644','order':'sorted','gzip_timestamp':0}}
(output/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({**{key:manifest[key] for key in ['archive','sha256','runtime_archive','runtime_sha256']},'files':len(files)}))
