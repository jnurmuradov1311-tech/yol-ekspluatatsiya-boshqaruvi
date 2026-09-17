import {currentScript,localizeWorkbookFiles,scriptText,scriptFilename} from '../script';
import template from './workbook-template.json';
import {budgetWorkbookModel,column,type BookCell,type BookSheet,type BudgetBook} from './workbook-model';
import type {AssetSnapshot,FundingPolicy} from './types';

const xml=(value:unknown)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function cellXml(cell:BookCell,address:string){
 const style=template.styles[cell.style as keyof typeof template.styles];
 if(style===undefined)throw new Error('Excel uslubi topilmadi. Sahifani yangilang.');
 const {value,formula}=cell;
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Excel hisobida yaroqsiz son bor.');
 if(formula)return `<c r="${address}" s="${style}"${typeof value==='string'||value===null?' t="str"':''}><f>${xml(formula)}</f><v>${xml(value)}</v></c>`;
 // Text is always stored as text, including labels starting with =, +, - or @.
 return typeof value==='number'?`<c r="${address}" s="${style}"><v>${value}</v></c>`:`<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function sheetXml(sh:BookSheet){
 const last=column(sh.widths.length),end=Math.max(...Object.keys(sh.rows).map(Number));
 const rows=Object.entries(sh.rows).map(([r,cells])=>`<row r="${r}" ht="${sh.heights[Number(r)]??32}" customHeight="1">${cells.slice(2).map((cell,i)=>cellXml(cell,`${column(i+3)}${r}`)).join('')}</row>`).join('');
 const pagesWide=sh.widths.reduce((a,b)=>a+b,0)>220?2:1;
 const validations=Object.entries(sh.rows).flatMap(([r,cells])=>cells.flatMap((cell,i)=>{
  if(!cell.style.startsWith('input'))return [];
  const address=`${column(i+1)}${r}`,strict=sh.name==='Hisob shartlari'&&['D9','D10','D11','D12','D13','D19'].includes(address),whole=sh.name==='Hisob shartlari'&&['D17','D19'].includes(address);
  return [`<dataValidation type="${whole?'whole':'decimal'}" operator="${strict?'greaterThan':'greaterThanOrEqual'}" allowBlank="1" showErrorMessage="1" errorTitle="Qiymatni tekshiring" error="${strict?'Musbat qiymat kiriting.':'Manfiy bo‘lmagan qiymat kiriting.'}" sqref="${address}"><formula1>0</formula1></dataValidation>`];
 }));
 const conditional=sh.name==='Jamlama'?'<conditionalFormatting sqref="D30:D31"><cfRule type="cellIs" dxfId="0" priority="1" operator="notBetween"><formula>-0.01</formula><formula>0.01</formula></cfRule></conditionalFormatting>':'';
 return `<?xml version="1.0" encoding="utf-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><tabColor rgb="FF${sh.tabColor.slice(1)}"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="C1:${last}${end}"/><sheetViews><sheetView showGridLines="0" zoomScale="90" workbookViewId="0">${sh.freeze?`<pane xSplit="3" ySplit="${sh.freeze}" topLeftCell="D${sh.freeze+1}" activePane="bottomRight" state="frozen"/>`:''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${sh.widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData>${sh.filter?`<autoFilter ref="${sh.filter}"/>`:''}${sh.merges.length?`<mergeCells count="${sh.merges.length}">${sh.merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}${conditional}${validations.length?`<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`:''}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="${sh.widths.length>8?'8':'9'}" orientation="landscape" fitToWidth="${pagesWide}" fitToHeight="0"/><headerFooter><oddFooter>&amp;LSaqlash budjeti&amp;C&amp;A&amp;R&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;
}

/** Styles and layout were authored with Artifact Tool; the browser fills that template. */
export function fundingWorkbook(snapshot:AssetSnapshot,policy:FundingPolicy,limit:unknown=null):Uint8Array {
 return serializeBudgetWorkbook(budgetWorkbookModel(snapshot,policy,limit));
}
export function serializeBudgetWorkbook(model:BudgetBook):Uint8Array {
 const files:Record<string,string>={...template.files};
 model.sheets.forEach((sh,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(sh);});
 const sheetEntries=model.sheets.map((sh,i)=>`<x:sheet name="${xml(sh.name)}" sheetId="${i+1}" r:id="RoadOpsSheet${i+1}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`).join('');
 files['xl/workbook.xml']=files['xl/workbook.xml']!.replace(/<x:sheets>[\s\S]*?<\/x:sheets>/,`<x:sheets>${sheetEntries}</x:sheets>`);
 files['xl/_rels/workbook.xml.rels']=files['xl/_rels/workbook.xml.rels']!.replace(/<Relationship\b[^>]*Type="[^"]*\/worksheet"[^>]*\/>/g,'').replace('</Relationships>',model.sheets.map((_,i)=>`<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet${i+1}.xml" Id="RoadOpsSheet${i+1}"/>`).join('')+'</Relationships>');
 files['[Content_Types].xml']=files['[Content_Types].xml']!.replace(/<Override\b[^>]*PartName="\/xl\/worksheets\/sheet\d+.xml"[^>]*\/>/g,'').replace('</Types>',model.sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>');
 const definitions=model.sheets.map((sh,i)=>{
  const name=sh.name.replaceAll("'","''"),end=Math.max(...Object.keys(sh.rows).map(Number));
  return `<x:definedName name="_xlnm.Print_Area" localSheetId="${i}">${xml(`'${name}'!$C$1:$${column(sh.widths.length)}$${end}`)}</x:definedName>${sh.freeze?`<x:definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xml(`'${name}'!$7:$7,'${name}'!$C:$C`)}</x:definedName>`:''}`;
 }).join('');
 files['xl/workbook.xml']=files['xl/workbook.xml']!.replace('<x:sheets>','<x:bookViews><x:workbookView activeTab="0"/></x:bookViews><x:sheets>').replace('</x:workbook>',`<x:definedNames>${definitions}</x:definedNames><x:calcPr calcMode="auto" fullCalcOnLoad="1"/></x:workbook>`);
 return zip(localizeWorkbookFiles(files,currentScript()));
}

// Dependency-free ZIP container for the authored OpenXML parts.
function zip(files:Record<string,string>){
 const enc=new TextEncoder(),parts:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
 const set=(b:Uint8Array,p:number,n:number,size=4)=>{const v=new DataView(b.buffer);if(size===2)v.setUint16(p,n,true);else v.setUint32(p,n>>>0,true);};
 for(const [path,xml] of Object.entries(files)){const name=enc.encode(path),data=enc.encode(xml);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const h=new Uint8Array(30+name.length);set(h,0,0x04034b50);set(h,4,20,2);set(h,6,0x800,2);set(h,12,0x21,2);set(h,14,crc);set(h,18,data.length);set(h,22,data.length);set(h,26,name.length,2);h.set(name,30);
  const d=new Uint8Array(46+name.length);set(d,0,0x02014b50);set(d,4,20,2);set(d,6,20,2);set(d,8,0x800,2);set(d,14,0x21,2);set(d,16,crc);set(d,20,data.length);set(d,24,data.length);set(d,28,name.length,2);set(d,42,offset);d.set(name,46);directory.push(d);parts.push(h,data);offset+=h.length+data.length;
 }
 const centralSize=directory.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22);set(end,0,0x06054b50);set(end,8,directory.length,2);set(end,10,directory.length,2);set(end,12,centralSize);set(end,16,offset);
 const output=new Uint8Array(offset+centralSize+end.length);let pos=0;for(const p of [...parts,...directory,end]){output.set(p,pos);pos+=p.length;}return output;
}
export function downloadFundingWorkbook(snapshot:AssetSnapshot,policy:FundingPolicy,limit:unknown=null){
 const bytes=fundingWorkbook(snapshot,policy,limit),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download=`Saqlash-budjeti-${policy.year}.xlsx`;anchor.download=scriptFilename(anchor.download,currentScript());anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
