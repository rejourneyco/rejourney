#!/usr/bin/env python3
"""Bind shipped native binaries to the source tree used to build them."""
import hashlib
import json
from pathlib import Path
import sys
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'Plugins/native-artifacts.json'
EXCLUDED = {'.gradle', '.kotlin', '.cxx', '.build', '.swiftpm', 'build', '.DS_Store', 'local.properties'}


def digest_tree(path):
    digest = hashlib.sha256()
    files = [path] if path.is_file() else sorted(p for p in path.rglob('*') if p.is_file())
    for file in files:
        relative = file.relative_to(ROOT)
        if any(part in EXCLUDED for part in relative.parts):
            continue
        digest.update(relative.as_posix().encode() + b'\0')
        digest.update(hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


def entry(platform):
    source = ROOT / 'Native~' / ('iOS' if platform == 'ios' else 'Android')
    binary = ROOT / 'Plugins' / ('iOS/RejourneyUnity.xcframework' if platform == 'ios' else 'Android/rejourney-unity.aar')
    if not binary.exists():
        raise RuntimeError(f'Missing native artifact: {binary.relative_to(ROOT)}')
    if platform == 'ios' and sys.platform == 'darwin':
        required = {'_rj_unity_frame', '_rj_unity_free', '_rj_unity_poll', '_rj_unity_request', '_rj_unity_test_crash', '_rj_unity_test_ui_stall'}
        for library in binary.glob('*/RejourneyUnity.framework/RejourneyUnity'):
            symbols = subprocess.check_output(['nm', '-gU', str(library)], text=True)
            exports = {line.split()[-1] for line in symbols.splitlines() if line.split()}
            if not required.issubset(exports):
                raise RuntimeError(f'Missing public C ABI exports in {library.parent.parent.name}: {sorted(required - exports)}')
    return {'sourceSha256': digest_tree(source), 'artifactSha256': digest_tree(binary)}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    value = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'schemaVersion': 1}
    platforms = ['ios', 'android'] if len(sys.argv) < 3 or sys.argv[2] == 'all' else [sys.argv[2]]
    for platform in platforms:
        if platform not in ('ios', 'android'):
            raise ValueError('Platform must be ios, android or all')
        actual = entry(platform)
        if mode == 'write':
            value[platform] = actual
        elif mode == 'check':
            if value.get(platform) != actual:
                raise RuntimeError(f'{platform} native source/artifact mismatch. Rebuild with Tools~/build-native.sh {platform}.')
        else:
            raise ValueError('Expected check or write')
    if mode == 'write':
        MANIFEST.write_text(json.dumps(value, indent=2) + '\n')
    print('Native artifact provenance: ' + ', '.join(platforms) + ' ' + mode + ' passed')


if __name__ == '__main__':
    main()
