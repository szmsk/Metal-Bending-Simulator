#!/usr/bin/env python3
"""Package app source for embedding into the Windows Go launcher."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
target = root / 'launcher' / 'bundle' / 'project.zip'
target.parent.mkdir(parents=True, exist_ok=True)

source_files = ['package.json', 'index.html', 'vite.config.ts', 'tsconfig.json',
                'metadata.json']
for folder in ['src', 'public']:
    source_files.extend(str(path.relative_to(root)).replace('\\', '/')
                        for path in sorted((root / folder).rglob('*')) if path.is_file())

with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in source_files:
        path = root / name
        if path.is_file():
            archive.write(path, arcname=name)
print(f'Created {target} with {len(source_files)} files')
