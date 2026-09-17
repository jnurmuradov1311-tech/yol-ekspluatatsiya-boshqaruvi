"""Read the Artifact Tool workbook's styles into the browser export template."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
ns = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(source / 'template.xlsx') as archive:
    files = {name: archive.read(name).decode('utf-8') for name in archive.namelist()
             if not name.startswith('xl/worksheets/')}
    sheets = {}
    styles = {}
    for item in json.loads((source / 'style-cells.json').read_text()):
        number = item['sheet']
        if number not in sheets:
            root = ET.fromstring(archive.read(f'xl/worksheets/sheet{number}.xml'))
            sheets[number] = {c.attrib['r']: c.attrib.get('s', '0') for c in root.findall('.//x:c', ns)}
        style = sheets[number].get(item['address'])
        if style is not None:
            styles.setdefault(item['style'], style)
    destination.write_text(json.dumps({'files': files, 'styles': styles}, ensure_ascii=False, separators=(',', ':')))
print(json.dumps({'style_count': len(styles), 'template': str(destination)}))
