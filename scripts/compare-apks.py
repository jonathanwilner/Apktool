#!/usr/bin/env python3
"""Compare APK provenance and entry bytes without extracting or executing APKs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile


def digest(stream):
    h = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()


def inventory(path, max_uncompressed=2 * 1024**3):
    path = Path(path)
    with path.open('rb') as source:
        sha = digest(source)
    entries = {}
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate ZIP entry names: comparison would be ambiguous')
        if sum(i.file_size for i in infos) > max_uncompressed:
            raise ValueError('APK exceeds uncompressed inspection budget')
        if 'AndroidManifest.xml' not in names:
            raise ValueError('Archive has no AndroidManifest.xml')
        for info in infos:
            if info.is_dir():
                continue
            with archive.open(info) as member:
                entries[info.filename] = {'sha256': digest(member), 'bytes': info.file_size}
    return {'path': str(path.resolve()), 'sha256': sha, 'bytes': path.stat().st_size,
            'entries': entries}


def verify(path, executable):
    result = subprocess.run([executable, 'verify', '--verbose', '--print-certs', str(path)],
                            capture_output=True, text=True, timeout=120)
    return {'valid': result.returncode == 0, 'exit_code': result.returncode,
            'output': result.stdout + result.stderr}


def compare(candidate, reference):
    a, b = candidate['entries'], reference['entries']
    common = a.keys() & b.keys()
    return {'exact_file_match': candidate['sha256'] == reference['sha256'],
            'added': sorted(a.keys() - b.keys()), 'removed': sorted(b.keys() - a.keys()),
            'changed': sorted(k for k in common if a[k] != b[k]),
            'unchanged_count': sum(a[k] == b[k] for k in common)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('reference', type=Path, help='Independently obtained trusted reference APK')
    parser.add_argument('--apksigner', default='apksigner')
    args = parser.parse_args()
    try:
        candidate, reference = inventory(args.candidate), inventory(args.reference)
        for item in (candidate, reference):
            item['signature'] = verify(item['path'], args.apksigner)
        report = {'candidate': candidate, 'reference': reference,
                  'comparison': compare(candidate, reference),
                  'limits': ['The caller must establish reference provenance independently.',
                             'A valid signature does not identify a trusted publisher by itself.',
                             'Byte equality establishes artifact identity, not absence of malware.',
                             'No device execution, network behavior, or DroiTong bypass is tested.']}
        print(json.dumps(report, indent=2))
        return 0 if all(i['signature']['valid'] for i in (candidate, reference)) else 2
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'error': str(error)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
