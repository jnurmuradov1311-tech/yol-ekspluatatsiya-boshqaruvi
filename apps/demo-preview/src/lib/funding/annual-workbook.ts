import {serializeBudgetWorkbook} from './export-workbook';
import {column,type BookCell,type BookSheet,type BudgetBook} from './workbook-model';
import {annualView} from './annual';
import {currentScript,scriptText,scriptFilename} from '../script';
const cell=(value:string|number|null,style=typeof value==='number'?'number':'text'):BookCell=>({value,style});
export function annualWorkbookModel(data:ReturnType<typeof annualView>):BudgetBook{
 if(!data.program)throw new Error('Tasdiqlangan yillik reja topilmadi.');const p=data.program;
 const make=(name:string,head:string[],widths:number[],values:BookCell[][]):BookSheet=>{
  const last=column(widths.length+2),rows:BookSheet['rows']={2:[cell(null),cell(null),cell(`${p.year}-YIL · ${name.toUpperCase()}`,'title')],3:[cell(null),cell(null),cell(`${p.revision}-tahrir · ${p.approvedBy} · ${p.approvedAt.slice(0,10)}`,'subtitle')],5:[cell(null),cell(null),cell(`Yillik bajarilish: ${data.progress.toFixed(2)}% · me’yoriy mehnat soati ulushida`,'section')],4:[cell(null),cell(null),cell('IQN 03-24, V-ilova: oy, yil boshidan va yillik rejaga nisbatan tasdiqlangan hajm. Turli birliklar jamlanmaydi.','note')],7:[cell(null),cell(null),...head.map(h=>cell(h,'header'))]};const heights={2:30,3:24,4:38,5:28,7:42} as Record<number,number>;
  values.forEach((v,i)=>{rows[8+i]=[cell(null),cell(null),...v];heights[8+i]=Math.max(36,...v.map((c,k)=>typeof c.value==='string'?Math.ceil(c.value.length/Math.max(8,widths[k]!-2))*14+10:36));});
  return {name,widths:[2,2,...widths],rows,heights,merges:[`C2:${last}2`,`C3:${last}3`,`C4:${last}4`,`C5:${last}5`],freeze:7,filter:`C7:${last}${Math.max(8,values.length+7)}`,tabColor:'#17324D',landscape:true};
 };
 const summary=make('Yillik reja',['Yo‘l','Ish / IQN','Birlik','Yillik reja','Oylarga ajratilgan','Band','Tasdiqlangan','Qoldiq','Bajarilish, %'],[15,64,12,20,20,20,20,20,20],data.lines.map(l=>[cell(p.snapshot.roads.find(r=>r.id===l.roadId)!.code),cell(`${l.workName}\n${l.normReference}`),cell(l.unit),cell(l.quantity),cell(l.monthly.reduce((s,n)=>s+n,0)),cell(l.reserved),cell(l.completed),cell(l.remaining),cell(l.percent/100,'percent')]));
 const monthly=make('Oylik ijro',['Yo‘l','Ish / IQN','Oy','Birlik','Oylik reja','Band','Oyda bajarilgan','Yil boshidan','Yillik reja','Yillik bajarilish, %'],[15,64,15,12,20,20,20,20,20,20],data.lines.flatMap(l=>l.months.map((m,i)=>{const completed=l.months.slice(0,i+1).reduce((s,n)=>s+n.completed,0);return [cell(p.snapshot.roads.find(r=>r.id===l.roadId)!.code),cell(`${l.workName}\n${l.normReference}`),cell(`${p.year}-${String(m.month).padStart(2,'0')}`),cell(l.unit),cell(m.planned),cell(m.reserved),cell(m.completed),cell(completed),cell(l.quantity),cell(l.quantity?completed/l.quantity:0,'percent')];})));
 return {sheets:[summary,monthly],total:p.total,year:p.year,checks:[]};
}
export function downloadAnnualWorkbook(data:ReturnType<typeof annualView>){const model=annualWorkbookModel(data),bytes=serializeBudgetWorkbook(model),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=scriptFilename(`Yillik-reja-${model.year}.xlsx`,currentScript());a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
