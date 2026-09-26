#!/usr/bin/env python3
"""Stable GUIDs for source assets; existing GUIDs and plugin settings are retained."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parents[1]
for path in sorted(root.rglob('*')):
    rel = path.relative_to(root)
    if any((part.endswith('~') and part != 'Samples~') or part.startswith('.') for part in rel.parts) or path.suffix == '.meta':
        continue
    if path.is_dir() and path.name == 'Samples~':
        continue  # UPM hides this container; only its importable contents need GUIDs.
    # Unity treats an XCFramework as one plugin; do not import its internals.
    if any(part.endswith('.xcframework') for part in rel.parts[:-1]):
        continue
    meta = Path(str(path) + '.meta')
    if meta.exists(): continue
    guid = hashlib.sha256(('co.rejourney.unity/' + rel.as_posix()).encode()).hexdigest()[:32]
    header = f'fileFormatVersion: 2\nguid: {guid}\n'
    if path.name.endswith('.xcframework') or path.suffix == '.aar':
        platform = 'iOS' if path.name.endswith('.xcframework') else 'Android'
        header += f'''PluginImporter:
  externalObjects: {{}}
  serializedVersion: 2
  isPreloaded: 0
  isOverridable: 0
  isExplicitlyReferenced: 0
  validateReferences: 1
  platformData:
  - first:
      Any:
    second:
      enabled: 0
      settings: {{}}
  - first:
      {'iPhone' if platform == 'iOS' else platform}: {platform}
    second:
      enabled: 1
      settings:
        AddToEmbeddedBinaries: 1
'''
    elif path.is_dir(): header += 'folderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n'
    elif path.suffix == '.cs': header += 'MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n'
    else: header += 'DefaultImporter:\n  externalObjects: {}\n'
    meta.write_text(header)
