import {currentScript,localizeWorkbookFiles,scriptText,scriptFilename} from '../script';
import template from './template.json';
import type { CostTrace, ExcelReport } from '../api/excel-report';

type Cell = string | number | null | { value: string | number | null; formula: string };
type Sheet = typeof template.sheets[number];
const escape = (value:unknown) => String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const col = (i:number) => {let s='';for(;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
const formula=(expression:string,value:number|string|null):Cell=>({formula:expression,value});
const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const resourceLabel=(name:string,trace?:CostTrace)=>trace?`${name}\n${trace.orderNumber} · ${trace.workDate} · ${trace.roadCode}\n${trace.resourceCode} · ${trace.rateSource} (v${trace.rateVersion})\nTekshirdi: ${trace.verifiedBy}`:name;
function cellXml(value:Cell,address:string,style:string) {
  const f=typeof value==='object'&&value!==null?value.formula:null;
  const v=typeof value==='object'&&value!==null?value.value:value;
  if(typeof v==='number'&&!Number.isFinite(v))throw new Error(`${address}: yaroqsiz son`);
  if(f)return `<c r="${address}" s="${style}"${typeof v==='string'?' t="str"':''}><f>${escape(f)}</f>${v===null?'':`<v>${escape(v)}</v>`}</c>`;
  return typeof v==='number'?`<c r="${address}" s="${style}"><v>${v}</v></c>`:`<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`;
}
const stateName=(state:string)=>({DRAFT:'Qoralama',SUBMITTED:'Tasdiqqa yuborilgan',APPROVED:'Tasdiqlangan',VERIFIED:'Tekshirilgan',REJECTED:'Rad etilgan'} as Record<string,string>)[state]??state;
function sheetXml(meta:Sheet,rows:Cell[][],totals:Cell[],report:ExcelReport,extra:Cell[][]=[]) {
  const n=Math.max(rows.length,1),end=meta.bodyRow+n;
  const data=rows.length?rows:[Array(meta.cols).fill(null) as Cell[]];
  const values=[...data,totals,...extra];
  const body=values.map((values,i)=>{const row=meta.bodyRow+i;return `<row r="${row}" ht="${meta.name==='Ф2-Сақлаш'&&i>n?32:meta.name==='Ф2-Сақлаш'?Math.max(50,...[1,2].map(k=>String(values[k]??'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/(k===1?55:22))),0)*16+14)):meta.name==='Ҳисоб асоси'?48:['ММФ','Материал'].includes(meta.name)?Math.max(64,String(values[1]??'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/60)),0)*15+12):32}" customHeight="1">${Array.from({length:meta.cols},(_,j)=>cellXml(values[j]??null,`${col(j+1)}${row}`,meta.name==='Ф2-Сақлаш'&&i>n&&j===6?'36':String((i>=n?meta.totalStyles:meta.styles)[col(j+1) as keyof typeof meta.styles]??'0'))).join('')}</row>`;}).join('');
  const merges=meta.name==='Ф2-Сақлаш'?['A2:G2','A3:G3','A4:G4','A5:G5','A6:G6','A7:G7','A9:A10','B9:B10','C9:C10','D9:D10','E9:E10','F9:G9']:[...meta.merges];
  if(meta.name==='Ф2-Сақлаш')for(let i=0;i<extra.length;i++)merges.push(`B${end+1+i}:F${end+1+i}`);
  for(let row=meta.bodyRow;row<=end+extra.length;row++)for(const span of meta.bodyMerges){const [a,b]=span.split(':');merges.push(`${a}${row}:${b}${row}`);}
  let header=meta.header.replace(/__DIVISION__/g,escape(report.divisionName)).replace(/__ROAD__/g,escape(report.roadLabel)).replace(/__PERIOD__/g,escape(report.period)).replace(/__REFERENCE__/g,escape(report.reference)).replace(/__STATE__/g,escape(stateName(report.state)+' · DEMO')).replace(/__NORM__/g,escape([...new Set(report.payroll.rows.flatMap(r=>r.segments?.map(s=>s.normMinutes/60)??[]))].join(' / ')+' соат')).replace(/__TARIFF__/g,'Ставка асосида').replace(/__TITLE__/g,escape(`${report.period} · ${report.divisionName} · ${report.roadLabel} · ${meta.name==='Ф2-Сақлаш'?'БАЖАРИЛГАН САҚЛАШ ИШЛАРИНИ ҚАБУЛ ҚИЛИШ':meta.name==='Харажат'?'ИШ ҲАҚИ ҲИСОБИ':meta.name} (${stateName(report.state)}, DEMO)`));
  if(meta.name==='Ф2-Сақлаш'){
    const heading=(r:number,text:string,height:number,style='69')=>`<row r="${r}" ht="${height}" customHeight="1">${cellXml(text,`A${r}`,style)}</row>`;
    header=heading(2,'BAJARILGAN SAQLASH ISHLARI DALOLATNOMASI',32)+heading(3,report.divisionName,24,'37')+heading(4,report.roadLabel,Math.max(26,Math.ceil(report.roadLabel.length/110)*17),'37')+heading(5,`Davr: ${report.period} · Hujjat: ${report.reference}`,25,'37')+heading(6,`${stateName(report.state)} · DEMO`,22,'37')+heading(7,'Ф2-Сақлаш · hajm va mehnat me’yorlari',27)+meta.header.slice(meta.header.indexOf('<row ',meta.header.indexOf('r="8"'))).replace(/r="9" ht="15"/,'r="9" ht="30"').replace(/r="10" ht="25.5"/,'r="10" ht="48"').replace('Мехнат сарф меъёри</v>','Mehnat me’yori, soat/birlik</v>').replace('Жами мехнат сарф меъёри</v>','Jami me’yoriy vaqt, soat</v>');
  }
  const footerRow=end+extra.length+3;
  const foot=meta.name==='Ҳисоб асоси'?'':`<row r="${footerRow}" ht="30" customHeight="1">${cellXml(report.approvedBy?`Tasdiqladi: ${report.approvedBy} · ${report.approvedAt?.slice(0,10)??''}`:'Бўлим бошлиғи: ____________________',`B${footerRow}`,'0')}</row><row r="${footerRow+1}" ht="30" customHeight="1">${cellXml(report.preparedBy?`Tuzdi: ${report.preparedBy} · imzo: __________`:'Ҳисобчи: ____________________',`B${footerRow+1}`,'0')}</row>`;
  if(foot)merges.push(`B${footerRow}:${col(Math.min(meta.cols,6))}${footerRow}`,`B${footerRow+1}:${col(Math.min(meta.cols,6))}${footerRow+1}`);
  return `<?xml version="1.0" encoding="utf-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${col(meta.cols)}${footerRow+1}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${meta.headerRows}" topLeftCell="A${meta.bodyRow}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${meta.name==='Ф2-Сақлаш'?'<cols>'+[6,62,24,14,16,19,20].map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')+'</cols>':meta.columns}<sheetData>${header}${body}${foot}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="${meta.name==='Ф2-Сақлаш'?9:8}" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${escape(report.reference)}&amp;R&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;
}

export function reportWorkbook(report:ExcelReport,kind:'payroll'|'act'|'timesheet'='act'):Uint8Array {
  const basis=report.payroll.rows.flatMap(worker=>(worker.segments??[]).map(segment=>({worker,segment})));
  const basisRows:Cell[][]=basis.map(({worker,segment:s},i)=>{const r=i+2;return [worker.workerId,worker.fullName,s.workDate,s.workOrderId,s.minutes,s.normMinutes,s.monthlySalary,s.bonusBps/100,s.trafficBps/100,s.travelBps/100,s.socialBps/100,s.trafficBase,s.travelBase,formula(`ROUND(G${r}*AD${r}*E${r}/F${r},2)`,s.base),formula(`ROUND(N${r}*H${r}/100,2)`,s.bonus),formula(`ROUND(L${r}*E${r}/F${r}*I${r}/100,2)`,s.traffic),formula(`ROUND(M${r}*E${r}/F${r}*J${r}/100,2)`,s.travel),formula(`ROUND(N${r}*AB${r}/100,2)`,s.seniority),formula(`ROUND(N${r}*AC${r}/100,2)`,s.additional),s.holiday,s.oneTime,s.termination,s.sickLeave,s.leave,s.materialAid,formula(`SUM(N${r}:Y${r},AE${r})`,s.gross),formula(`ROUND(Z${r}*K${r}/100,2)`,s.social),s.seniorityBps/100,s.additionalBps/100,s.salaryCoefficient??1,s.meal??0];});
  const basisEnd=Math.max(2,basis.length+1);
  const sourceSum=(column:string,workerId:string,value:number)=>formula(`SUMIF('Ҳисоб асоси'!$A$2:$A$${basisEnd},"${workerId.replace(/"/g,'""')}",'Ҳисоб асоси'!${column}$2:${column}$${basisEnd})`,value);
  const payrollRows:Cell[][]=report.payroll.rows.map((worker,i)=>{
    const r=i+11,segs=worker.segments??[],first=basis.findIndex(v=>v.worker.workerId===worker.workerId)+2;
    const sum=(key:keyof typeof segs[number])=>round(segs.reduce((n,s)=>n+Number(s[key]),0));
    const other=sum('oneTime')+sum('termination')+sum('seniority')+sum('additional');
    return [i+1,worker.fullName,worker.positionName??'',worker.actualDays,null,new Set(segs.map(s=>s.salaryCoefficient??1)).size===1?formula(`'Ҳисоб асоси'!AD${first}`,segs[0]?.salaryCoefficient??1):null,worker.actualMinutes/60,new Set(segs.map(s=>s.monthlySalary)).size===1?formula(`'Ҳисоб асоси'!G${first}`,segs[0]!.monthlySalary):null,sourceSum('N',worker.workerId,Number(worker.baseWageAmountUzs)),sourceSum('O',worker.workerId,Number(worker.bonusAmountUzs)),new Set(segs.map(s=>s.bonusBps)).size===1?segs[0]!.bonusBps/100:null,sourceSum('P',worker.workerId,Number(worker.trafficAmountUzs??0)),sourceSum('Q',worker.workerId,Number(worker.travelAmountUzs??0)),sourceSum('T',worker.workerId,sum('holiday')),formula(['U','V','R','S'].map(c=>(sourceSum(c,worker.workerId,0) as {formula:string}).formula).join('+'),round(other)),sourceSum('W',worker.workerId,sum('sickLeave')),formula(['X','Y'].map(c=>(sourceSum(c,worker.workerId,0) as {formula:string}).formula).join('+'),sum('leave')+sum('materialAid')),formula(`SUM(I${r}:J${r},L${r}:Q${r},U${r})`,Number(worker.grossAmountUzs)),sourceSum('AA',worker.workerId,Number(worker.employerSocialAmountUzs)),formula(`R${r}+S${r}`,Number(worker.employerCostAmountUzs)),sourceSum('AE',worker.workerId,sum('meal'))];
  });
  const sumColumn=(rows:Cell[][],index:number)=>round(rows.reduce((n,row)=>{const cell=row[index];return n+Number(typeof cell==='object'&&cell!==null?cell.value:cell??0);},0));
  const total=(rows:Cell[][],start:number,cols:number,indexes:number[],precise:number[]=[])=>Array.from({length:cols},(_,i):Cell=>i===1?'Жами':indexes.includes(i)?formula(`ROUND(SUM(${col(i+1)}${start}:${col(i+1)}${start+Math.max(1,rows.length)-1}),${precise.includes(i)?6:2})`,precise.includes(i)?Math.round(rows.reduce((n,row)=>{const c=row[i];return n+Number(typeof c==='object'&&c!==null?c.value:c??0);},0)*1e6)/1e6:sumColumn(rows,i)):null);
  const materialRows:Cell[][]=report.materials.map((m,i)=>[i+1,resourceLabel(m.name,m.trace),null,null,null,m.unit,m.quantity,m.price,formula(`ROUND(G${i+9}*H${i+9},2)`,m.amount)]);
  const machineRows:Cell[][]=report.equipment.map((e,i)=>[i+1,resourceLabel(e.name,e.trace),null,null,null,e.hours,null,e.price,formula(`ROUND(F${i+15}*H${i+15},2)`,e.amount)]);
  const workRows:Cell[][]=report.works.map((w,i)=>[i+1,w.name,w.norm,w.unit,w.quantity,w.normHours,formula(`IF(F${i+12}="","",E${i+12}*F${i+12})`,w.totalNormHours??'')]);
  const timeRows:Cell[][]=report.timesheet.map((w,i)=>{const row=i+11;return [i+1,w.name,null,w.position,...Array.from({length:31},(_,d)=>{const entry=w.entries.find(e=>e.day===d+1);return entry?entry.minutes/60:null;}),formula(`COUNTIF(E${row}:AI${row},">0")`,w.days),formula(`SUM(E${row}:AI${row})`,w.minutes/60)];});
  const paymentRows:Cell[][]=report.payroll.rows.map((worker,i)=>{const r=i+4;const adjustment:Record<string,string|number|boolean|undefined>=worker.adjustments??{};const confirmed=worker.payableAmountUzs!==null;return [i+1,worker.fullName,formula(`'Харажат'!R${i+11}`,Number(worker.grossAmountUzs)),...['incomeTaxAmountUzs','unionFeeAmountUzs','advanceAmountUzs','otherDeductionAmountUzs'].map(key=>adjustment[key]===undefined||adjustment[key]===''?null:Number(adjustment[key])),formula(`SUM(D${r}:G${r})`,Number(worker.deductionsAmountUzs)),formula(`IF(J${r}="Тасдиқланган",C${r}-H${r},"")`,worker.payableAmountUzs===null?'':Number(worker.payableAmountUzs)),confirmed?'Тасдиқланган':'Текширилмаган'];});
  const generalRows:Cell[][]=[['1','Қўшимча харажатлар қайд этилмаган',null,null,null,null,null,0,null]];
  const rowsByName:Record<string,Cell[][]>={'Харажат':payrollRows,'ММФ':machineRows,'Материал':materialRows,'Ф2-Сақлаш':workRows,'Умумий харажат':generalRows,'Табель':timeRows,'Ҳисоб асоси':basisRows,'Тўлов':paymentRows};
  const totalIndexes:Record<string,number[]>={'Харажат':[3,6,8,9,11,12,13,14,15,16,17,18,19,20],'ММФ':[5,8],'Материал':[8],'Ф2-Сақлаш':[6],'Умумий харажат':[7],'Табель':[35,36],'Тўлов':[2,3,4,5,6,7,8],'Ҳисоб асоси':[4,13,14,15,16,17,18,19,20,21,22,23,24,25,26,30]};
  const files:Record<string,string>={...template.files};
  const payrollTotal=11+Math.max(1,payrollRows.length),materialTotal=9+Math.max(1,materialRows.length),machineTotal=15+Math.max(1,machineRows.length);
  const extras:Cell[][]=[['','Материаллар',...Array(17).fill(null),formula(`'Материал'!I${materialTotal}`,sumColumn(materialRows,8))],['','Машина-механизмлар',...Array(17).fill(null),formula(`'ММФ'!I${machineTotal}`,sumColumn(machineRows,8))],['','Жами харажат',...Array(17).fill(null),formula(`SUM(T${payrollTotal}:T${payrollTotal+2})`,round(Number(report.payroll.totals.employerCostAmountUzs)+sumColumn(materialRows,8)+sumColumn(machineRows,8)))]];
  const actExtras:Cell[][]=[
    [null,'XARAJATLAR, SO‘M',null,null,null,null,null],
    [null,'Ish haqi',null,null,null,null,formula(`'Харажат'!R${payrollTotal}`,Number(report.payroll.totals.grossAmountUzs))],
    [null,'Ijtimoiy ajratma',null,null,null,null,formula(`'Харажат'!S${payrollTotal}`,round(Number(report.payroll.totals.employerCostAmountUzs)-Number(report.payroll.totals.grossAmountUzs)))],
    [null,'Materiallar',null,null,null,null,formula(`'Материал'!I${materialTotal}`,sumColumn(materialRows,8))],
    [null,'Mashina-mexanizmlar',null,null,null,null,formula(`'ММФ'!I${machineTotal}`,sumColumn(machineRows,8))],
    [null,'DALOLATNOMA JAMI',null,null,null,null,formula(`'Харажат'!T${payrollTotal+3}`,round(Number(report.payroll.totals.employerCostAmountUzs)+sumColumn(materialRows,8)+sumColumn(machineRows,8)))],
  ];
  template.sheets.forEach((s,i)=>{const rows=rowsByName[s.name]!;const totals=total(rows,s.bodyRow,s.cols,totalIndexes[s.name]!,({'Ф2-Сақлаш':[6],'ММФ':[5],'Табель':[36],'Харажат':[6]} as Record<string,number[]>)[s.name]??[]);
    if(s.name==='Ф2-Сақлаш'&&report.works.some(w=>w.normHours===null)){totals[1]='Жами — норма тўлиқ эмас';totals[6]=formula(`IF(COUNT(F12:F${11+rows.length})<COUNTA(B12:B${11+rows.length}),"",SUM(G12:G${11+rows.length}))`,'');}
    if(s.name==='Тўлов')totals[8]=formula(`IF(COUNTIF(J4:J${3+rows.length},"Тасдиқланган")=COUNTA(B4:B${3+rows.length}),SUM(I4:I${3+rows.length}),"")`,report.payroll.totals.payableAmountUzs===null?'':Number(report.payroll.totals.payableAmountUzs));
    files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(s,rows,totals,report,s.name==='Харажат'?extras:s.name==='Ф2-Сақлаш'?actExtras:[]);});
  const active=kind==='act'?3:kind==='timesheet'?5:0;
  files['xl/workbook.xml']=files['xl/workbook.xml']!.replace('<sheets>',`<bookViews><workbookView activeTab="${active}"/></bookViews><sheets>`).replace('</workbook>',`<definedNames>${template.sheets.map((s,i)=>{const end=s.bodyRow+Math.max(1,rowsByName[s.name]!.length)+(s.name==='Харажат'?extras.length:s.name==='Ф2-Сақлаш'?actExtras.length:0)+4;return `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${escape(s.name)}'!$A$1:$${col(s.cols)}$${end}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${escape(s.name)}'!$${({'Харажат':4,'ММФ':12,'Материал':5,'Ф2-Сақлаш':9,'Умумий харажат':9,'Табель':9,'Ҳисоб асоси':1,'Тўлов':3} as Record<string,number>)[s.name]}:$${s.headerRows}</definedName>`;}).join('')}</definedNames></workbook>`).replace('</workbook>','<calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>');
  return zipFiles(localizeWorkbookFiles(files,currentScript()));
}

// Small standards-based ZIP container; workbook styles and layout come from the authored template.
function zipFiles(files:Record<string,string>):Uint8Array {
  const encoder=new TextEncoder(),parts:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
  const bytes=(size:number)=>new Uint8Array(size),set=(b:Uint8Array,p:number,n:number,size=4)=>{const v=new DataView(b.buffer);if(size===2)v.setUint16(p,n,true);else v.setUint32(p,n>>>0,true);};
  for(const [path,xml] of Object.entries(files)){const name=encoder.encode(path),data=encoder.encode(xml);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const h=bytes(30+name.length);set(h,0,0x04034b50);set(h,4,20,2);set(h,6,0x800,2);set(h,12,0x21,2);set(h,14,crc);set(h,18,data.length);set(h,22,data.length);set(h,26,name.length,2);h.set(name,30);
    const d=bytes(46+name.length);set(d,0,0x02014b50);set(d,4,20,2);set(d,6,20,2);set(d,8,0x800,2);set(d,14,0x21,2);set(d,16,crc);set(d,20,data.length);set(d,24,data.length);set(d,28,name.length,2);set(d,42,offset);d.set(name,46);directory.push(d);parts.push(h,data);offset+=h.length+data.length;
  }
  const centralSize=directory.reduce((n,b)=>n+b.length,0),end=bytes(22);set(end,0,0x06054b50);set(end,8,directory.length,2);set(end,10,directory.length,2);set(end,12,centralSize);set(end,16,offset);
  const result=bytes(offset+centralSize+end.length);let pos=0;for(const part of [...parts,...directory,end]){result.set(part,pos);pos+=part.length;}return result;
}

export function downloadReport(report:ExcelReport,kind:'payroll'|'act'|'timesheet') {
  const data=reportWorkbook(report,kind),url=URL.createObjectURL(new Blob([data as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=`${kind==='act'?'F2-Saqlash':kind==='payroll'?'Ish-haqi':'Tabel'}-${report.period}-${report.reference.replace(/[^a-zA-Z0-9-]/g,'_').slice(0,80)}.xlsx`;anchor.download=scriptFilename(anchor.download,currentScript());anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
