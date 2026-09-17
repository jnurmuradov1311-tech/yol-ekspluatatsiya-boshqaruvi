import fs from 'node:fs/promises';
import {scriptText} from './script.mjs';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
import {budgetWorkbookModel,column} from './funding-model.mjs';
import {serializeBudgetWorkbook} from './funding-export.mjs';
import {demoSnapshot,defaultPolicy} from './assets.mjs';

const dir=process.argv[2];await fs.mkdir(dir,{recursive:true});
const s=demoSnapshot(),p=defaultPolicy(s);p.roadSelection=s.roads.map(r=>r.id);
const cases=[{name:'Saqlash-budjeti-2027-namuna',s,p,limit:500000000}];
const rounded=structuredClone(s),rp=structuredClone(p);
rounded.roads=[19/13,21/13,0].map((q,i)=>({...s.roads[0],id:`round-${i}`,code:`R${i}`,lengthKm:1,assets:q?[{id:`g${i}`,kind:'GRASS',name:'Grass',quantity:q,unit:'m2',condition:'GOOD'}]:[]}));
rp.roadSelection=rounded.roads.map(r=>r.id);rp.workerMonthly=1;rp.operatorMonthly=1;rp.supervisorMonthly=1;rp.otherAnnual=2/3;rp.overheadPercent=1.3;rp.contingencyPercent=2.7;
cases.push({name:'rounding-check',s:rounded,p:rp,limit:0});
const missing=structuredClone(p);Object.values(missing.rates)[0].price=null;missing.supervisors=0;
cases.push({name:'missing-check',s,p:missing,limit:null});
const empty=structuredClone(s),ep=structuredClone(p);empty.roads[0].assets=[];ep.roadSelection=[empty.roads[0].id];ep.supervisors=0;
cases.push({name:'no-work-check',s:empty,p:ep,limit:0});
const staff=structuredClone(p);staff.staff=[{role:'hht_muhandisi',heads:2,fte:.5,monthly:5000000,basis:'Sinov shtati'},{role:'energetik',heads:1,fte:.25,monthly:6000000,basis:'Sinov shtati'}];staff.otherCosts=[{id:'transport',name:'Uzoq masofaga tashish',amount:450000,basis:'Sinov: oldingi narxda yo‘q'}];staff.worksiteCount=3;staff.equipmentStock={cones:4,'temporary-signs':5};cases.push({name:'staff-and-kit-check',s,p:staff,limit:5000000000});
cases.push({name:'kirill-staff-and-kit',s,p:staff,limit:5000000000,script:'cyrl'});
let checked=0;
for(const [index,entry] of cases.entries()){
 const script=entry.script??'latn';globalThis.localStorage={getItem:()=>script};
 const model=budgetWorkbookModel(entry.s,entry.p,entry.limit,'2026-09-15T08:00:00.000Z');
 const path=`${dir}/${entry.name}.xlsx`;await fs.writeFile(path,serializeBudgetWorkbook(model));
 const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(path));wb.recalculate();
 for(const sheet of model.sheets){const ws=wb.worksheets.getItem(scriptText(sheet.name,script));for(const [r,cells] of Object.entries(sheet.rows))for(const [col,cell] of cells.entries()){
  if(!cell.formula)continue;const address=`${column(col+1)}${r}`,v=ws.getRange(address).values[0][0];
  if(typeof cell.value==='number'){if(typeof v!=='number'||Math.abs(v-cell.value)>.02)throw new Error(`${entry.name} ${sheet.name}!${address}: ${v} != ${cell.value}`);}
  else if((v??'')!==scriptText(String(cell.value??''),script))throw new Error(`${entry.name} ${sheet.name}!${address}: ${v} != ${cell.value}`);
  checked++;
 }}
 const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!',options:{useRegex:true,maxResults:10},maxChars:1500});console.log(entry.name,errors.ndjson);
 if(entry.script==='cyrl'){const preview=await wb.render({sheetName:scriptText('Ish haqi',script),range:'C1:N14',scale:1,format:'png'});await fs.writeFile(`${dir}/kirill-payroll.png`,new Uint8Array(await preview.arrayBuffer()));}
 if(index===0){
  for(const n of [0,1,3,4,5,6,7]){const sh=model.sheets[n],preview=await wb.render({sheetName:sh.name,range:`C1:${column(sh.widths.length)}${n===0?31:12}`,scale:1,format:'png'});await fs.writeFile(`${dir}/final-${n+1}.png`,new Uint8Array(await preview.arrayBuffer()));}
 }
}
console.log(JSON.stringify({cases:cases.length,formulaChecks:checked}));
