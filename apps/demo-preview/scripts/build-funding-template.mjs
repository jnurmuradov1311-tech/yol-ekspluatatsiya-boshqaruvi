// Run from a temporary directory with the Codex primary runtime dependencies.
// Compile workbook-model.ts and assets.ts beside this script before running.
import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
import {budgetWorkbookModel,column} from './funding-model.mjs';
import {demoSnapshot,defaultPolicy} from './assets.mjs';

const output=process.argv[2];
if(!output)throw new Error('Output directory is required.');
await fs.mkdir(output,{recursive:true});
const snapshot=demoSnapshot(),policy=defaultPolicy(snapshot);
policy.roadSelection=snapshot.roads.map(r=>r.id);
const model=budgetWorkbookModel(snapshot,policy,500000000,'2026-09-15T08:00:00.000Z');
const wb=Workbook.create();
const font='Arial',ink='#17324D',line='#CBD5E1';
const numeric='#,##0.000;(#,##0.000);"—"',integer='#,##0;(#,##0);"—"';
const money='#,##0.00;(#,##0.00);"—"';
const styles={
 text:{},year:{horizontalAlignment:'right',numberFormat:'0'},number:{horizontalAlignment:'right',numberFormat:numeric},integer:{horizontalAlignment:'right',numberFormat:integer},numberInteger:{horizontalAlignment:'right',numberFormat:integer},quantity:{horizontalAlignment:'right',numberFormat:'#,##0.000000;(#,##0.000000);"—"'},
 money:{horizontalAlignment:'right',numberFormat:money},
 input:{horizontalAlignment:'right',numberFormat:numeric,font:{color:'#1756B5'},fill:'#F0F6FF'},
 inputMoney:{horizontalAlignment:'right',numberFormat:money,font:{color:'#1756B5'},fill:'#F0F6FF'},
 inputPercent:{horizontalAlignment:'right',numberFormat:'0.0%',font:{color:'#1756B5',italic:true},fill:'#F0F6FF'},
 formula:{horizontalAlignment:'right',numberFormat:numeric,font:{color:'#17212C'}},formulaInteger:{horizontalAlignment:'right',numberFormat:integer,font:{color:'#17212C'}},
 formulaMoney:{horizontalAlignment:'right',numberFormat:money,font:{color:'#17212C'}},
 link:{horizontalAlignment:'right',numberFormat:numeric,font:{color:'#087342'}},linkInteger:{horizontalAlignment:'right',numberFormat:integer,font:{color:'#087342'}},
 linkMoney:{horizontalAlignment:'right',numberFormat:money,font:{color:'#087342'}},
 linkPercent:{horizontalAlignment:'right',numberFormat:'0.0%',font:{color:'#087342',italic:true}},
 percent:{horizontalAlignment:'right',numberFormat:'0.0%',font:{italic:true}},
 header:{fill:ink,font:{color:'#FFFFFF',bold:true},horizontalAlignment:'center',borders:{right:{style:'thin',color:'#FFFFFF'}}},
 title:{font:{size:17,bold:true,color:ink},borders:{bottom:{style:'thin',color:'#218B87'}}},
 subtitle:{font:{size:11,color:'#586D7C',italic:true}},
 note:{font:{size:11,color:'#586D7C'}},
 warning:{font:{color:'#8B4B09'},fill:'#FFF1D6'},
 section:{fill:'#EAF2F6',font:{bold:true,color:ink}},
 total:{fill:'#EAF2F6',font:{bold:true,color:ink},borders:{top:{style:'thin',color:line}}},
 totalMoney:{fill:'#EAF2F6',font:{bold:true,color:ink},horizontalAlignment:'right',numberFormat:money,borders:{top:{style:'thin',color:line}}},
 totalNumber:{fill:'#EAF2F6',font:{bold:true,color:ink},horizontalAlignment:'right',numberFormat:numeric,borders:{top:{style:'thin',color:line}}},totalInteger:{fill:'#EAF2F6',font:{bold:true,color:ink},horizontalAlignment:'right',numberFormat:integer,borders:{top:{style:'thin',color:line}}},
 totalPercent:{fill:'#EAF2F6',font:{bold:true,color:ink,italic:true},horizontalAlignment:'right',numberFormat:'0.0%',borders:{top:{style:'thin',color:line}}},
 bigMoney:{font:{size:17,bold:true,color:ink},numberFormat:'#,##0.00" so‘m"',fill:'#EAF5F3'},
 check:{font:{color:ink},numberFormat:'0.00;(0.00);0.00',horizontalAlignment:'right'},
};
for(const sh of model.sheets)wb.worksheets.add(sh.name);
const styleCells=[];
for(const [index,sh] of model.sheets.entries()){
 const ws=wb.worksheets.getItem(sh.name);ws.showGridLines=false;ws.tabColor=sh.tabColor;
 sh.widths.forEach((w,i)=>{ws.getRange(`${column(i+1)}1`).format.columnWidth=w;});
 for(const [r,cells] of Object.entries(sh.rows)){
  const row=Number(r);ws.getRange(`A${r}:${column(sh.widths.length)}${r}`).format.rowHeight=sh.heights[row]??32;
  cells.forEach((cell,i)=>{if(i<2)return;const address=`${column(i+1)}${r}`,range=ws.getRange(address),style=styles[cell.style];
   if(!style)throw new Error(`Unknown style ${cell.style}`);
   range.format={font:{name:font,size:11,color:ink,...style.font},fill:style.fill??'#FFFFFF',verticalAlignment:'center',wrapText:true,...style,font:{name:font,size:11,color:ink,...style.font}};
   if(cell.formula)range.formulas=[['='+cell.formula]];
   else range.values=[[typeof cell.value==='string'&&cell.value.startsWith('=')?"'"+cell.value:cell.value]];
   styleCells.push({sheet:index+1,address,style:cell.style});
  });
 }
 sh.merges.forEach(m=>ws.mergeCells(m));
 if(sh.freeze)ws.freezePanes.freezeRows(sh.freeze);
 if(sh.name==='Jamlama')ws.getRange('D30:D31').conditionalFormats.add('cellIs',{operator:'notBetween',formula:[-.01,.01],format:{fill:'#FEE2E2',font:{bold:true,color:'#B91C1C'}}});
}
// Exercise editable prices and limits, restoring every temporary input before delivery.
const inputSheet=wb.worksheets.getItem('Hisob shartlari'),summary=wb.worksheets.getItem('Jamlama');
const changed=structuredClone(policy);changed.workerMonthly*=1.1;inputSheet.getRange('D10').values=[[changed.workerMonthly]];
wb.recalculate();
if(Math.abs(summary.getRange('D20').values[0][0]-budgetWorkbookModel(snapshot,changed,500000000).total)>.02)throw new Error('Salary recalculation mismatch');
inputSheet.getRange('D10').values=[[policy.workerMonthly]];
inputSheet.getRange('D24').values=[[0]];wb.recalculate();if(summary.getRange('H23').values[0][0]!==0)throw new Error('Zero budget must remain zero');
inputSheet.getRange('D24').values=[[null]];wb.recalculate();if(summary.getRange('H23').values[0][0]!=='')throw new Error('Missing budget must remain blank');
inputSheet.getRange('D24').values=[[500000000]];
const oldPrice=inputSheet.getRange('D29').values[0][0];inputSheet.getRange('D29').values=[[null]];wb.recalculate();
if(wb.worksheets.getItem('Resurslar').getRange('J8').values[0][0]!=='')throw new Error('Missing resource price became zero');
inputSheet.getRange('D29').values=[[0]];wb.recalculate();if(wb.worksheets.getItem('Resurslar').getRange('J8').values[0][0]!==0)throw new Error('Zero resource price was discarded');
inputSheet.getRange('D29').values=[[oldPrice]];
// Recalculation is tested against the separate application calculation.
wb.recalculate();
for(const check of model.checks){const value=wb.worksheets.getItem(check.sheet).getRange(check.cell).values[0][0];if(typeof value!=='number'||Math.abs(value-check.value)>.02)throw new Error(`${check.sheet}!${check.cell}: ${value} != ${check.value}`);}
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:30},maxChars:3000});console.log(errors.ndjson);
await fs.writeFile(`${output}/model.json`,JSON.stringify(model));await fs.writeFile(`${output}/style-cells.json`,JSON.stringify(styleCells));
await (await SpreadsheetFile.exportXlsx(wb)).save(`${output}/template.xlsx`);
// Visual verification covers all newly authored sheets, including wide detail tables.
for(const [index,sh] of model.sheets.entries()){
 const endRow=sh.name==='Jamlama'?31:Math.min(12,Math.max(...Object.keys(sh.rows).map(Number)));
 const image=await wb.render({sheetName:sh.name,range:`C1:${column(sh.widths.length)}${endRow}`,scale:1,format:'png'});
 await fs.writeFile(`${output}/sheet-${index+1}.png`,new Uint8Array(await image.arrayBuffer()));
}
console.log(JSON.stringify({sheets:model.sheets.length,total:model.total,checks:model.checks.length,output}));
