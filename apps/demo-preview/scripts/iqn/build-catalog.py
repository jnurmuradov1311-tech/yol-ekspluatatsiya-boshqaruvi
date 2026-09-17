"""Build source-addressable demo catalog. Never treat material rows as labor norms.
Usage: python scripts/iqn/build-catalog.py EXTRACTED_DIR SOURCE_DOCX
"""
import csv,json,re,sys,hashlib
from pathlib import Path
from docx import Document
root=Path(__file__).resolve().parents[2]
p=Path(sys.argv[1]); source=Path(sys.argv[2]); doc=Document(source)
rows=list(csv.DictReader(open(p/'time-norms.csv',encoding='utf-8-sig')))
summary=json.loads((p/'summary.json').read_text()); topics={int(t['table_no']):t for t in summary['time_norm_tables']}
letters=dict(zip('абвгдеёжзийклмнопрстуфхцчшъьэюяўқғҳ', ['a','b','v','g','d','e','yo','j','z','i','y','k','l','m','n','o','p','r','s','t','u','f','x','ts','ch','sh','’','','e','yu','ya','o‘','q','g‘','h']))
def latin(s):
 return ''.join(letters.get(c.lower(),c).capitalize() if c.isupper() and c.lower() in letters else letters.get(c,c) for c in s)
def number(s):
 try:return float(s.replace(',','.').strip())
 except:return None

def basis(s,n):
 v=s.lower().strip().replace('²','2').replace('³','3')
 v=re.sub(r'(?<![а-я])м(?=\d|\s|$)','m',v)
 if n in [28,29] and ('одам' in v or not v):return 1,'km'
 match=re.match(r'^(\d+(?:[.,]\d+)?)\s*(.*)$',v)
 q=number(match[1]) if match else 1; u=(match[2] if match else v).strip()
 u=re.sub(r'\s+',' ',u)
 if q is None or q<=0:return None,s
 if u in ['m','pm','m ёриқ','m трос','m қувур оғзи']:return q,'m'
 if u in ['m2','m3','km','t']:return q,u
 if u in ['т']:return q,'t'
 if u in ['дона','д','pcs','psc','рsc','та бута','дарахт','дарахт ёки буталар','дарахт ёки буталар.','ҳарф','қудуқ','асос','киши','та туташма','ёритгич','чироқ','дона қувур']:return q,'dona'
 if u=='h':return q,'soat'
 if u=='иш куни':return q,'kun'
 if u.startswith('комплект'):return q,'komplekt'
 if u=='группа':return q,'guruh'
 if v in ['мавсум давомида','mавсуm давоmида']:return 1,'mavsum'
 if v=='йил давомида' or v=='йил давоmида':return 1,'yil'
 if u.startswith('km'):return q,'km·o‘tish'
 return None,s
out=[]; excluded=[]; parent=''; section=''; context=''; last_area=''; last_table=None
for i,r in enumerate(rows):
 n=int(r['table_no']); rowno=int(r['source_row']); ti=int(r['source_table_index']); code=r['explicit_code'] or r['effective_parent_code']; name=r['work_type']; raw=r['time_norm_raw_person_hours']; unit=r['unit_raw']
 if n!=last_table: parent=section=context=last_area='';last_table=n
 # CSV can repeat merged codes on resources. Raw XML cell reveals continuation.
 cells=doc.tables[ti].rows[rowno-1]._tr.findall('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tc')
 if len(cells)<4:continue
 rawcode=''.join(cells[0].xpath('.//*[local-name()="t"]/text()')).strip()
 if (n==19 and rowno>=30 and not rawcode) or ('маш' in unit.lower()):
  excluded.append({'table':n,'row':rowno,'reason':'resource component','name':name});continue
 # Table 19 starts an embedded resource schedule here; its numeric values are materials, not labor.
 if n==19 and rowno>=30:raw=''
 if r['row_kind']=='heading':section=name;continue
 if not raw and (not unit or (i+1<len(rows) and rows[i+1]['table_no']==r['table_no'] and rows[i+1]['row_kind']=='variant_or_continuation' and not(n==19 and rowno>=30))):
  if r['explicit_code']:parent=name;context='';last_area=''
  else:context=name
  continue
 if r['explicit_code'] and rawcode:
  if parent and not (name.startswith(('1 ','2 ','3 ','Чўмич','Кенглиги','Кранни','25 ','а)','б)'))):parent='';context='';last_area=''
 if n in [2,3,4] and r['row_kind']=='variant_or_continuation':
  if re.match(r'^[аб]\)',name):context=name.split(':')[0]
  if '50 mm' in name or '50мм' in name:last_area=name
  if name.startswith('70 mm') and last_area:name=last_area.replace('50 mm','70 mm')
 full=' · '.join(dict.fromkeys(v.strip(' :') for v in [section,parent,context,name] if v))
 if n==8 and rowno==18:full='Ажратувчи ва муҳофазаловчи темирбетон тўсиқлар · '+name
 b,u=basis(unit,n); v=number(raw); issues=[]; rng=None
 match=re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*[–-]\s*,?(\d+(?:[.,]\d+)?)',raw)
 if match:rng=[number(match[1]),number(match[2])];v=None
 if v is None and not rng:issues.append('Manbada mehnat me’yori aniqlashtirilishi kerak' if not raw else 'Manbadagi bir nechta qiymatning qo‘llanishini aniqlashtiring')
 if not b:issues.append('Manbadagi o‘lchov bazasini aniqlashtiring')
 if n==19 and rowno>=30:issues=['Jadvalda materiallar sarfi berilgan; mehnat me’yori ko‘rsatilmagan']
 item={'id':f'iqn02-t{n}-r{rowno}','code':code or f'{n}-jadval, {rowno}-satr','name':latin(full),'sourceName':full,'iqnTopicId':f'02000000-0000-4000-8000-{n:012d}','iqnTopicName':latin(topics[n]['title']), 'normReference':f'IQN 02-24 · {n}-jadval · {rowno}-satr'+(f' · {code}' if code else ''),'unit':u,'requiredWorkers':1,'laborMinutesPerUnit':(v*60/b if v is not None and b else 0),'normBasisQuantity':b,'normHoursRaw':raw,'normRange':rng,'normIssue':'; '.join(issues) or None,'catalogSeries':'TIME','sourceTable':ti,'sourceRow':rowno,'resources':[]}
 if n in [28,29]:item['unit']='km'
 out.append(item)
# Resource estimate variants remain separate: their norms must never be added to time norms.
for t in json.loads((p/'resource-norms.json').read_text()):
 for idx,code in enumerate(t['norm_codes_canonical']):
  desc=t['variant_descriptions'][min(idx+1,len(t['variant_descriptions'])-1)] if t['variant_descriptions'] else t['title']
  name=re.sub(r'^[ЕE]?\d[\d-]*\s*:?\s*','',desc)
  b,u=basis(t['measurement_raw'],0); rr=[r for r in t['requirements'] if r['norm_code']==code];lab=[r for r in rr if r['resource_category'] in ['labor_worker','labor_operator','labor']]
  vals=[number(r['quantity_per_work_unit_raw']) for r in lab if r['quantity_per_work_unit_raw'] not in ['-','']]
  issue=None
  if not b or not vals or any(v is None for v in vals):issue='Resurs jadvalidagi mehnat me’yori yoki o‘lchov bazasini aniqlashtiring'
  if 'қўшилади' in name or 'камайтир' in name:issue='Bu qo‘shimcha norma; asosiy ish bilan birga hisoblanadi'
  resources=[{'code':r['resource_code'],'name':latin(r['resource_name']),'unit':r['unit_raw'],'quantityRaw':r['quantity_per_work_unit_raw'],'quantityPerUnit':number(r['quantity_per_work_unit_raw'])/b if b and number(r['quantity_per_work_unit_raw']) is not None else None,'kind':r['resource_category']} for r in rr if r['resource_category'] not in ['labor_worker','labor_operator','labor'] and r['quantity_per_work_unit_raw'] not in ['-','']]
  out.append({'id':f'iqn02-r-{code}-t{t["source_table_index"]}','code':code,'name':latin(name),'sourceName':name,'iqnTopicId':'iqn02-resource','iqnTopicName':'Resurs-smeta me’yorlari','normReference':f'IQN 02-24 · {code}','unit':u,'requiredWorkers':1,'laborMinutesPerUnit':sum(v for v in vals if v is not None)*60/b if b else 0,'normBasisQuantity':b,'normHoursRaw':' + '.join(r['quantity_per_work_unit_raw'] for r in lab),'normRange':None,'normIssue':issue,'catalogSeries':'RESOURCE','sourceTable':t['source_table_index'],'sourceRow':None,'resources':resources})
(root/'src/lib/iqn/catalog-data.ts').write_text('// Generated from the user-supplied IQN 02-24. See scripts/iqn/build-catalog.py.\nexport const iqnCatalogData = '+json.dumps(out,ensure_ascii=False,indent=2)+';\n')
(root/'src/lib/iqn/source-audit.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceFile':source.name,'timeTables':29,'timeOptions':sum(x['catalogSeries']=='TIME' for x in out),'resourceOptions':sum(x['catalogSeries']=='RESOURCE' for x in out),'needsClarification':sum(bool(x['normIssue']) for x in out),'excludedResourceRows':excluded},ensure_ascii=False,indent=2))
print('Catalog:',len(out),'time:',sum(x['catalogSeries']=='TIME' for x in out),'resource:',sum(x['catalogSeries']=='RESOURCE' for x in out),'needs clarification:',sum(bool(x['normIssue']) for x in out))
