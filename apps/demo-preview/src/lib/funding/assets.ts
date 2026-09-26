import type {Asset,AssetSnapshot,FundingPolicy,Road} from './types';
import {iqnWorkCatalog} from '../iqn/catalog';
import {resourceChoices} from '../iqn/resource-plan';
import {equipmentNorms} from './norms';
export function demoSnapshot():AssetSnapshot{
 return {schemaVersion:1,source:'RAMS almashinuvi — sinov to‘plami',observedAt:new Date().toISOString().slice(0,10),mode:'DEMO',roads:[
 {id:'road-d001',code:'D001',name:'Toshkent halqa yo‘li · namuna aktivlar',importance:'STATE',category:'Ib',lengthKm:67,carriagewayWidthM:14,condition:'FAIR',trafficPerDay:25000,assets:[
 {id:'d001-pavement',kind:'PAVEMENT',name:'Asfalt qoplama',quantity:938000,unit:'m2',condition:'FAIR',defectQuantity:120,parameters:{thicknessMm:50,largestPatchM2:1,removeOld:true}},
 {id:'d001-grass',kind:'GRASS',name:'Yo‘l yoqasidagi o‘tlar',quantity:134000,unit:'m2',condition:'FAIR'},
 {id:'d001-drain',kind:'DRAIN',name:'Suv qochirish novlari',quantity:12000,unit:'m',condition:'FAIR'},
 {id:'d001-sign',kind:'SIGN',name:'Yo‘l belgilari',quantity:400,unit:'dona',condition:'FAIR',industrialZone:false},
 {id:'d001-pavilion',kind:'PAVILION',name:'Bekat pavilyonlari yuzasi',quantity:480,unit:'m2',condition:'FAIR'},
 {id:'d001-curb',kind:'CURB',name:'Bordyurlar',quantity:18000,unit:'m',condition:'FAIR',defectQuantity:100,repairMethod:'STRAIGHTEN'},
 {id:'d001-lighting',kind:'LIGHTING',name:'Yoritish ustunlari',quantity:200,unit:'dona',condition:'FAIR',defectQuantity:5,repairMethod:'REPLACE_FIXTURE'},
 ]},
 {id:'sample-local',code:'NAMUNA-02',name:'Mahalliy yo‘l · taqqoslash namunasi',importance:'LOCAL',category:'IV',lengthKm:20,carriagewayWidthM:6,condition:'GOOD',trafficPerDay:900,assets:[
 {id:'local-pavement',kind:'PAVEMENT',name:'Asfalt qoplama',quantity:120000,unit:'m2',condition:'GOOD',parameters:{thicknessMm:50,largestPatchM2:1,removeOld:true}},
 {id:'local-drain',kind:'DRAIN',name:'Suv qochirish novlari',quantity:4000,unit:'m',condition:'GOOD'},
 {id:'local-grass',kind:'GRASS',name:'Yo‘l yoqasi',quantity:40000,unit:'m2',condition:'GOOD'}]}
 ]};
}
export function defaultPolicy(snapshot:AssetSnapshot):FundingPolicy{
 const rates:FundingPolicy['rates']={};
 for(const r of resourceChoices(iqnWorkCatalog))rates[r.key]={unit:r.unit,price:r.kind==='machine'?200000:r.unit==='t'?1000000:r.unit==='m3'?60000:r.unit==='kg'?12000:50000,source:'Namuna narx — amaldagi tarif bilan almashtiring',...(r.kind==='machine'?{includesOperator:false}:{})};
 const equipmentPrices=Object.fromEntries(equipmentNorms.map(n=>[n.id,n.id==='gloves'?15000:n.id==='soap'?20000:n.id==='trimmer'?2500000:n.id==='suit'||n.id==='signal'?250000:100000]));
 return {year:new Date().getFullYear()+1,annualHours:1976,workerMonthly:3500000,operatorMonthly:4500000,supervisorMonthly:5500000,supervisors:null,divisionCount:1,wageCoefficient:1,allowancePercent:0,holidayPerYear:0,mealPerMonth:0,employerTaxPercent:0,overheadPercent:0,contingencyPercent:0,otherAnnual:0,conditionIIIRepeats:null,conditionIVRepeats:null,conditionBasis:'',reference:'Namuna hisob shartlari. Stavkalar, ish vaqti va soliqlarni tashkilot tasdiqlaydi.',roadSelection:[snapshot.roads[0]!.id],rates,equipmentPrices};
}
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown,name:string,max=250)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`${name}: matn yaroqsiz.`);return v.trim();};
const draftText=(v:unknown,name:string,max=1000)=>{if(typeof v!=='string'||v.length>max)throw new Error(`${name}: matn yaroqsiz.`);return v;};
const num=(v:unknown,name:string,max=1e9,min=0)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`${name}: son yaroqsiz.`);return v;};
const one=<T extends string>(v:unknown,allowed:readonly T[],name:string):T=>{if(!allowed.includes(v as T))throw new Error(`${name}: qiymat ro‘yxatga mos emas.`);return v as T;};
export function parseAssetSnapshot(raw:unknown,mode:'IMPORT'|'RAMS'='IMPORT'):AssetSnapshot{
 if(!object(raw)||raw.schemaVersion!==1||!Array.isArray(raw.roads)||raw.roads.length<1||raw.roads.length>100)throw new Error('schemaVersion: 1 va 1–100 ta yo‘l kerak.');
 const observedAt=str(raw.observedAt,'Tekshiruv sanasi');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(observedAt)||!Number.isFinite(Date.parse(observedAt))||new Date(observedAt).toISOString().slice(0,10)!==observedAt||Date.parse(observedAt)>Date.now()+86400000)throw new Error('Tekshiruv sanasi yaroqsiz.');
 let assetCount=0;
 const roads:Road[]=raw.roads.map((v,i)=>{
  if(!object(v)||!Array.isArray(v.assets))throw new Error(`${i+1}-yo‘l aktivlari yaroqsiz.`);
  const assets:Asset[]=v.assets.map((a:unknown)=>{
   if(!object(a)||++assetCount>5000)throw new Error('Aktivlar hajmi yoki tuzilishi yaroqsiz.');
   const parsed:Asset={id:str(a.id,'Aktiv ID',100),kind:one(a.kind,['PAVEMENT','GRASS','DRAIN','CULVERT','SIGN','PAVILION','BARRIER','CURB','LIGHTING','OTHER'],'Aktiv turi'),name:str(a.name,'Aktiv nomi'),quantity:num(a.quantity,'Aktiv miqdori'),unit:str(a.unit,'Birlik',20),condition:one(a.condition,['GOOD','FAIR','POOR','CRITICAL'],'Holat')};
   if(a.chainageStartM!==undefined)parsed.chainageStartM=num(a.chainageStartM,'Uchastka boshi',10000000);
   if(a.chainageEndM!==undefined)parsed.chainageEndM=num(a.chainageEndM,'Uchastka oxiri',10000000);
   if(a.physicalCount!==undefined){parsed.physicalCount=num(a.physicalCount,'Element soni');if(!Number.isInteger(parsed.physicalCount))throw new Error('Element soni butun bo‘lsin.');}
   if(a.defectQuantity!==undefined){parsed.defectQuantity=num(a.defectQuantity,'Nuqson hajmi');if(parsed.defectQuantity>parsed.quantity)throw new Error('Nuqson hajmi aktiv hajmidan katta.');}
   if(a.operatorHoursPerUnit!==undefined)parsed.operatorHoursPerUnit=num(a.operatorHoursPerUnit,'Mashinist mehnati',10000);
   if(a.operatorBasis!==undefined)parsed.operatorBasis=draftText(a.operatorBasis,'Mashinist mehnat asosi',1000);
   if(a.industrialZone!==undefined){if(typeof a.industrialZone!=='boolean')throw new Error('Sanoat hududi qiymati yaroqsiz.');parsed.industrialZone=a.industrialZone;}
   if(a.repairMethod!==undefined)parsed.repairMethod=one(a.repairMethod,['STRAIGHTEN','REPLACE_FIXTURE'] as const,'Ta’mir usuli');
   if(a.workQuantity!==undefined)parsed.workQuantity=num(a.workQuantity,'Ish hajmi');
   if(a.workUnit!==undefined)parsed.workUnit=draftText(a.workUnit,'Ish birligi',20);
   if(a.selectedNormHours!==undefined)parsed.selectedNormHours=num(a.selectedNormHours,'Tanlangan norma',1e9,0);
   if(a.workId!==undefined)parsed.workId=str(a.workId,'Ish ID',100);
   if(a.annualFrequency!==undefined)parsed.annualFrequency=num(a.annualFrequency,'Davriylik',366,0.001);
   if(a.frequencyBasis!==undefined)parsed.frequencyBasis=draftText(a.frequencyBasis,'Davriylik asosi',1000);
   if(a.parameters!==undefined){if(!object(a.parameters))throw new Error('Ta’mir o‘lchovlari yaroqsiz.');parsed.parameters={};if(a.parameters.thicknessMm!==undefined)parsed.parameters.thicknessMm=num(a.parameters.thicknessMm,'Qalinlik',1000,1);if(a.parameters.largestPatchM2!==undefined)parsed.parameters.largestPatchM2=num(a.parameters.largestPatchM2,'Chuqurcha maydoni',10000,.001);if(a.parameters.removeOld!==undefined){if(typeof a.parameters.removeOld!=='boolean')throw new Error('Qoplamani buzish qiymati yaroqsiz.');parsed.parameters.removeOld=a.parameters.removeOld;}}
   // Imported manual resource cards are validated by the calculation's existing IQN guard.
   if(a.resourcePlan!==undefined){if(!object(a.resourcePlan))throw new Error('Resurs kartasi yaroqsiz.');const p=a.resourcePlan;const plan={workVariantId:str(p.workVariantId,'Karta ish ID'),basisQuantity:p.basisQuantity===''?'':String(num(Number(p.basisQuantity),'Karta hajmi',1e9,-1e9)),note:draftText(p.note,'Karta asosi',1000)} as NonNullable<Asset['resourcePlan']>;for(const k of ['materials','machines'] as const)if(p[k]!==undefined){const g=p[k];if(!object(g)||!Array.isArray(g.items)||g.items.length>100)throw new Error('Karta guruhi yaroqsiz.');plan[k]={mode:one(g.mode,['REQUIRED','NONE'],'Resurs rejimi'),items:g.items.map((item:unknown)=>{if(!object(item))throw new Error('Resurs satri yaroqsiz.');return {key:draftText(item.key,'Resurs ID',250),quantity:item.quantity===''?'':String(num(Number(item.quantity),'Resurs sarfi',1e9,-1e9))};})};}parsed.resourcePlan=plan;}
   return parsed;
  });
  if(new Set(assets.map(a=>a.id)).size!==assets.length)throw new Error('Bir yo‘lda takroriy aktiv ID bor.');
  const road:Road={id:str(v.id,'Yo‘l ID',100),code:str(v.code,'Yo‘l kodi',50),name:str(v.name,'Yo‘l nomi'),importance:one(v.importance,['INTERNATIONAL','STATE','LOCAL'],'Ahamiyati'),category:one(v.category,['Ia','Ib','II','III','IV','V'],'Toifa'),lengthKm:num(v.lengthKm,'Uzunlik',10000,.001),carriagewayWidthM:num(v.carriagewayWidthM,'Qoplama kengligi',200,.1),condition:one(v.condition,['GOOD','FAIR','POOR','CRITICAL'],'Yo‘l holati'),assets};
  for(const a of assets)if((a.chainageStartM??0)>(a.chainageEndM??road.lengthKm*1000)||(a.chainageEndM??road.lengthKm*1000)>road.lengthKm*1000)throw new Error('Aktiv uchastkasi yo‘l chegarasidan tashqarida.');
  if(v.trafficPerDay!==undefined)road.trafficPerDay=num(v.trafficPerDay,'Harakat jadalligi',1000000);
  return road;
 });
 if(new Set(roads.map(r=>r.id)).size!==roads.length)throw new Error('Takroriy yo‘l ID bor.');
 return {schemaVersion:1,source:str(raw.source,'Manba'),observedAt,mode,roads};
}
