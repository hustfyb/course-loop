from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]
source=root.parent/'04_素材包'
dest=root/'public'/'materials'
dest.mkdir(parents=True,exist_ok=True)
for name in ['rpg-baseline','rpg-docs','agent-reference','kb-qa-tool','security-samples','templates']:
    with zipfile.ZipFile(dest/(name+'.zip'),'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted((source/name).rglob('*')):
            if p.is_file() and not any(s in p.parts for s in ['__pycache__','.pytest_cache']):
                z.write(p,Path(name)/p.relative_to(source/name))
print('Packaged six original teaching material bundles; original intentional exercise gaps retained.')
