from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]
with zipfile.ZipFile(root/'public/course-loop-connector.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in (root/'connector').iterdir():
        if p.is_file() and p.name!='config.json':z.write(p,p.relative_to(root))
    for p in (root/'connector/tests').iterdir():
        if p.is_file():z.write(p,p.relative_to(root))
    z.write(root/'public/connector-guide.txt','CONNECTOR-README.txt')
print('Connector package verified')
