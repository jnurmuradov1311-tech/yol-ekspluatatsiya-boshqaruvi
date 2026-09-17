import type { ManualResourcePlan, PlanningWorkOption } from '../api/types';
import { iqnWorkCatalog, normalizeUnit } from './catalog';

export type ResourceChoice = { key:string; code:string; name:string; unit:string; kind:'material'|'machine' };
export function resourceUnit(raw:string) {
 return raw.trim().toLowerCase().replace('²','2').replace('³','3').replaceAll('м','m').replace(/^тн?$|^тонна$/,'t').replace(/^кг$/,'kg').replace(/^л$/,'l').replace(/^дона$|^д$|^pcs$/,'dona');
}
export function materialStockId(code:string,unit:string){return `iqn-material-${code}-${resourceUnit(unit)}`;}
export function resourceChoices(catalog:PlanningWorkOption[]):ResourceChoice[] {
 const choices=new Map<string,ResourceChoice>();
 for(const work of catalog)for(const r of work.resources??[]){
  if(r.kind!=='material'&&r.kind!=='machine')continue;
  const unit=r.kind==='machine'?'soat':resourceUnit(r.unit),key=`${r.kind}:${r.code}:${unit}`;
  if(!choices.has(key))choices.set(key,{key,code:r.code,name:r.name,unit,kind:r.kind});
 }
 return [...choices.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
// Verified against the supplied DOCX (SHA in source-audit.json). Only resource
// components transfer: the selected work's labor norm and range remain unchanged.
// A 70 mm patch of <=1 or <=2 m2 is within the RESOURCE <=3 m2 condition.
const resourceCrosswalk: Record<string,string> = {
 'iqn02-t2-r4':'iqn02-r-27-14-023-01-t45',
 'iqn02-t2-r5':'iqn02-r-27-14-023-02-t45',
 'iqn02-t2-r7':'iqn02-r-27-14-023-02-t45',
 'iqn02-t2-r9':'iqn02-r-27-14-023-02-t45',
 'iqn02-t2-r15':'iqn02-r-27-14-024-01-t46',
 'iqn02-t2-r16':'iqn02-r-27-14-024-02-t46',
 'iqn02-t2-r18':'iqn02-r-27-14-024-02-t46',
 'iqn02-t2-r20':'iqn02-r-27-14-024-02-t46',
 'iqn02-t8-r15':'iqn02-r-27-14-054-01-t68',
 'iqn02-t8-r22':'iqn02-r-27-14-061-01-t74',
 'iqn02-t13-r6':'iqn02-r-27-14-061-01-t74',
 'iqn02-t15-r6':'iqn02-r-27-14-061-01-t74',
};
export function automaticResourceRecipe(work:PlanningWorkOption,catalog:PlanningWorkOption[]=iqnWorkCatalog):PlanningWorkOption|undefined {
 if(work.catalogSeries==='RESOURCE')return work;
 const id=resourceCrosswalk[work.id];
 const recipe=id?catalog.find(w=>w.id===id):undefined;
 // Never transfer a recipe to a different measurement base or a broken source row.
 return recipe?.catalogSeries==='RESOURCE'&&!recipe.normIssue&&normalizeUnit(recipe.unit)===normalizeUnit(work.unit)?recipe:undefined;
}
export function missingResourceScope(work:PlanningWorkOption,catalog:PlanningWorkOption[]=iqnWorkCatalog){
 const recipe=automaticResourceRecipe(work,catalog);
 const unresolved=(kind:string)=>(recipe?.resources??[]).some(r=>r.kind===kind&&(r.quantityPerUnit===null||!Number.isFinite(r.quantityPerUnit)||r.quantityPerUnit<0));
 const laborOnly=recipe?.code.startsWith('27-14-026-')||recipe?.code==='27-14-036-01';
 return {materials:(!recipe&&work.catalogSeries==='TIME')||Boolean(laborOnly)||recipe?.code==='27-14-079-01'||unresolved('material'),machines:(!recipe&&work.catalogSeries==='TIME')||Boolean(laborOnly)||unresolved('machine')};
}
export function resourcePlanIssue(work:PlanningWorkOption,plan:ManualResourcePlan|undefined,catalog:PlanningWorkOption[]):string {
 const scope=missingResourceScope(work,catalog);
 if(!scope.materials&&!scope.machines)return '';
 if(!plan)return 'Material va texnika tarkibini belgilang.';
 if(plan.workVariantId!==work.id)return 'Ish o‘zgargan. Resurs tarkibini yangilang.';
 if(!Number.isFinite(Number(plan.basisQuantity))||Number(plan.basisQuantity)<=0)return 'Resurs hisobi uchun musbat ish hajmini kiriting.';
 if(typeof plan.note!=='string'||!plan.note.trim())return 'Resurs hisobi asosini yozing.';
 const choices=resourceChoices(catalog);
 for(const kind of ['materials','machines'] as const){
  const group=plan[kind];
  if(!scope[kind]){if(group?.items?.length)return 'Mavjud IQN resurslarini o‘zgartirmang.';continue;}
  if(!group||!['REQUIRED','NONE'].includes(group.mode))return `${kind==='materials'?'Material':'Texnika'} ehtiyojini belgilang.`;
  if(!Array.isArray(group.items))return 'Resurslar ro‘yxati yaroqsiz.';
  if(group.mode==='NONE'&&group.items.length)return 'Kerak emas deb belgilangan turda resurslar bor.';
  if(group.mode==='REQUIRED'&&!group.items.length)return 'Kamida bitta resurs kiriting.';
  if(new Set(group.items.map(r=>r.key)).size!==group.items.length)return 'Bir resursni ikki marta kiritmang.';
  for(const item of group.items){
   if(!choices.some(c=>c.key===item.key&&c.kind===(kind==='materials'?'material':'machine')))return 'Ro‘yxatdan mos resursni tanlang.';
   if(!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0)return 'Har bir resurs miqdori musbat bo‘lsin.';
  }
 }
 return '';
}
// Human estimates supplement missing recipes; the IQN source catalog remains unchanged.
export function additionalPlanResources(work:PlanningWorkOption,plan:ManualResourcePlan|undefined,catalog:PlanningWorkOption[]) {
 if(!plan||resourcePlanIssue(work,plan,catalog))return [];
 const scope=missingResourceScope(work,catalog),choices=resourceChoices(catalog),basis=Number(plan.basisQuantity);
 return (['materials','machines'] as const).flatMap(kind=>scope[kind]?(plan[kind]?.items??[]).map(item=>{
  const choice=choices.find(c=>c.key===item.key)!;
  return {code:choice.code,name:choice.name,unit:choice.unit,kind:choice.kind,quantityRaw:item.quantity,quantityPerUnit:Number(item.quantity)/basis};
 }):[]);
}

// Single calculation path for the work-selection display, warehouse demand,
// requisitions, daily reservations and actual execution resources.
export function plannedResources(work:PlanningWorkOption,plan:ManualResourcePlan|undefined,catalog:PlanningWorkOption[]=iqnWorkCatalog) {
 const recipe=automaticResourceRecipe(work,catalog);
 const combined=[...(recipe?.resources??work.resources??[]),...additionalPlanResources(work,plan,catalog)];
 const rows=new Map<string,NonNullable<PlanningWorkOption['resources']>[number]>();
 for(const resource of combined){
  if(resource.kind!=='material'&&resource.kind!=='machine')continue;
  if(resource.quantityPerUnit===null||!Number.isFinite(resource.quantityPerUnit)||resource.quantityPerUnit<=0)continue;
  const unit=resource.kind==='machine'?'soat':resourceUnit(resource.unit);
  const key=`${resource.kind}:${resource.code}:${unit}`,previous=rows.get(key);
  rows.set(key,{...resource,unit,quantityPerUnit:resource.quantityPerUnit+(previous?.quantityPerUnit??0)});
 }
 return [...rows.values()];
}
