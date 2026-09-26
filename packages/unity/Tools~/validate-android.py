#!/usr/bin/env python3
"""Check 16 KB ELF LOAD alignment in an AAR/APK, plus uncompressed APK ZIP offsets."""
import json
from pathlib import Path
import struct
import sys
import zipfile


def inspect(path):
    results = []
    with zipfile.ZipFile(path) as archive, open(path, 'rb') as raw:
        for info in archive.infolist():
            if not info.filename.endswith('.so'):
                continue
            data = archive.read(info)
            if data[:4] != b'\x7fELF' or data[5] != 1 or data[4] not in (1, 2):
                raise ValueError(f'Unsupported ELF: {info.filename}')
            wide = data[4] == 2
            phoff = struct.unpack_from('<Q' if wide else '<I', data, 32 if wide else 28)[0]
            phsize, phcount = struct.unpack_from('<HH', data, 54 if wide else 42)
            alignments = []
            for index in range(phcount):
                offset = phoff + index * phsize
                if struct.unpack_from('<I', data, offset)[0] != 1:
                    continue
                alignment = struct.unpack_from('<Q' if wide else '<I', data, offset + (48 if wide else 28))[0]
                segment_offset, address = struct.unpack_from('<QQ' if wide else '<II', data, offset + (8 if wide else 4))
                if alignment < 16384 or (segment_offset - address) % 16384:
                    raise ValueError(f'ELF LOAD is not 16 KB compatible: {info.filename}')
                alignments.append(alignment)
            if not alignments:
                raise ValueError(f'ELF has no LOAD segments: {info.filename}')
            zip_aligned = None
            if path.suffix == '.apk' and info.compress_type == zipfile.ZIP_STORED:
                raw.seek(info.header_offset + 26)
                name_length, extra_length = struct.unpack('<HH', raw.read(4))
                zip_aligned = (info.header_offset + 30 + name_length + extra_length) % 16384 == 0
                if not zip_aligned:
                    raise ValueError(f'Uncompressed APK library is not ZIP aligned: {info.filename}')
            results.append({'library': info.filename, 'loadAlignments': alignments, 'zip16KBAligned': zip_aligned})
    if not results:
        raise ValueError('No native libraries found')
    return {'artifact': path.name, 'passed': True, 'libraries': results}


if __name__ == '__main__':
    print(json.dumps(inspect(Path(sys.argv[1])), indent=2))
