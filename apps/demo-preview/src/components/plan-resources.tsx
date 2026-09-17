"use client";
import {useMemo} from 'react';
import type {ManualResourcePlan,PlanningWorkOption} from '@/lib/api/types';
import {automaticResourceRecipe,missingResourceScope,plannedResources,resourceChoices,resourcePlanIssue} from '@/lib/iqn/resource-plan';
import {Badge,Button,SelectInput,TextInput} from './ui';

export function PlanResources({work,catalog,quantity,value,onChange}:{work:PlanningWorkOption;catalog:PlanningWorkOption[];quantity:string;value?:ManualResourcePlan;onChange:(value:ManualResourcePlan)=>void}) {
 const choices=useMemo(()=>resourceChoices(catalog),[catalog]);
 const scope=missingResourceScope(work,catalog);
 const recipe=automaticResourceRecipe(work,catalog);
 const resources=plannedResources(work,value,catalog);
 const total=Number(quantity),validQuantity=Number.isFinite(total)&&total>0;
 const format=(n:number)=>new Intl.NumberFormat('uz-UZ',{maximumSignificantDigits:8}).format(n);
 const plan=value?.workVariantId===work.id?value:{workVariantId:work.id,basisQuantity:quantity,note:''};

 const issue=value?resourcePlanIssue(work,value,catalog):'';
 const manualValid=Boolean(value)&&!issue;
 const hybrid=recipe&&manualValid&&(scope.materials||scope.machines);
 return <div className="wizard-callout" aria-label="Resurs tarkibi">
  <div className="card-heading"><h3>Kerakli resurslar</h3><Badge tone="info">{hybrid?'IQN + boshliq hisobi':recipe?'IQN 02-24 · avtomatik':manualValid?'Boshliq hisobi':'Resurs me’yori kerak'}</Badge></div>
  <p className="field__hint">{validQuantity?`${format(total)} ${work.unit} ish uchun jami talab`:'Jami talabni ko‘rish uchun ish hajmini kiriting.'}</p>
  <div className="resource-summary">
   {(['materials','machines'] as const).map(kind=>{
    const items=resources.filter(r=>r.kind===(kind==='materials'?'material':'machine'));
    const title=kind==='materials'?'Materiallar':'Mashina-mexanizmlar';
    return <section key={kind} aria-label={title} className="resource-summary__group">
     <h4>{title}</h4>
     {scope[kind]&&manualValid?<p className="field__hint">Boshliq hisobi · {value!.basisQuantity} {work.unit} uchun</p>:null}
     {items.length?<ul className="resource-summary__items">{items.map(r=><li key={`${r.kind}:${r.code}:${r.unit}`}>
      <span>{r.name}<small>{r.code}</small></span>
      <strong>{validQuantity?format(total*r.quantityPerUnit!):'—'} {kind==='machines'?'mashina-soat':r.unit}</strong>
     </li>)}</ul>:<p className="field__hint">{scope[kind]?(manualValid&&value?.[kind]?.mode==='NONE'?'Boshliq: talab qilinmaydi.':'Sarf me’yori kiritilmagan.'):recipe?'IQN jadvalida alohida sarf belgilanmagan.':'Namuna hisobi resurslarni tekshirish qadamida chiqadi.'}</p>}
     {items.length>0&&scope[kind]&&issue?<p className="field__hint">Qo‘shimcha sarfni aniqlashtiring.</p>:null}
    </section>;
   })}
  </div>
  {recipe?<details className="resource-source"><summary>Me’yor manbasi</summary><p className="field__hint">{recipe.normReference} · {recipe.name}</p><p className="field__hint">Jami sarf = 1 {work.unit} uchun me’yor × ish hajmi. Texnika vaqti mashina-soatda hisoblanadi; kunlik biriktirishda butun daqiqagacha yaxlitlanadi.</p></details>:null}
  {(scope.materials||scope.machines)?<details className="resource-source" open={!resources.length||Boolean(issue)}>
  <summary>Yetishmagan resurs me’yorini kiritish</summary>
  <p className="field__hint">Bu ish uchun {scope.materials&&scope.machines?'material va texnika':scope.materials?'material':'texnika'} sarfi manbada to‘liq berilmagan. Boshliq texnologik karta asosida to‘ldiradi.</p>
  <TextInput label={`Resurslar hisoblangan ish hajmi, ${work.unit}`} name="resourceBasis" type="number" min="0.000001" step="any" value={plan.basisQuantity} onChange={e=>onChange({...plan,basisQuantity:e.target.value})}/>
  {(['materials','machines'] as const).map(kind=>scope[kind]?<div key={kind}>
   <SelectInput label={kind==='materials'?'Material ehtiyoji':'Texnika ehtiyoji'} name={`resourceMode-${kind}`} value={plan[kind]?.mode??''} onChange={e=>onChange({...plan,[kind]:e.target.value?{mode:e.target.value,items:e.target.value==='REQUIRED'?[{key:'',quantity:''}]:[]}:undefined})}><option value="">Belgilang</option><option value="REQUIRED">Talab qilinadi</option><option value="NONE">Talab qilinmaydi</option></SelectInput>
   {plan[kind]?.mode==='REQUIRED'?<>
    {plan[kind]!.items.map((item,index)=><div className="resource-entry" key={index}>
     <SelectInput label={`${kind==='materials'?'Material':'Texnika'} ${index+1}`} name={`resource-${kind}-${index}`} value={item.key} onChange={e=>onChange({...plan,[kind]:{...plan[kind]!,items:plan[kind]!.items.map((r,i)=>i===index?{...r,key:e.target.value}:r)}})}><option value="">Ro‘yxatdan tanlang</option>{choices.filter(c=>c.kind===(kind==='materials'?'material':'machine')).map(c=><option key={c.key} value={c.key}>{c.name} · {c.unit} · {c.code}</option>)}</SelectInput>
     <TextInput label={`${kind==='machines'?'Mashina-soat':'Miqdor'} ${index+1}${kind==='materials'&&item.key?`, ${choices.find(c=>c.key===item.key)?.unit}`:''}`} name={`resource-quantity-${kind}-${index}`} type="number" min="0.000001" step="any" value={item.quantity} onChange={e=>onChange({...plan,[kind]:{...plan[kind]!,items:plan[kind]!.items.map((r,i)=>i===index?{...r,quantity:e.target.value}:r)}})}/>
     <Button type="button" variant="ghost" aria-label={`${kind==='materials'?'Material':'Texnika'} ${index+1} ni olib tashlash`} onClick={()=>onChange({...plan,[kind]:{...plan[kind]!,items:plan[kind]!.items.filter((_,i)=>i!==index)}})}>Olib tashlash</Button>
    </div>)}
    <Button type="button" variant="secondary" onClick={()=>onChange({...plan,[kind]:{...plan[kind]!,items:[...plan[kind]!.items,{key:'',quantity:''}]}})}>+ {kind==='materials'?'Material':'Texnika'}</Button>
   </>:null}
  </div>:null)}
  <TextInput label="Resurs hisobi asosi" name="resourceNote" value={plan.note} placeholder="Masalan: joyidagi o‘lchov va texnologik karta" onChange={e=>onChange({...plan,note:e.target.value})}/>
  {issue?<p role="status" className="field__hint">{issue}</p>:null}
  </details>:null}
  <p className="field__hint">Hajm o‘zgarsa sarf qayta hisoblanadi. Omborda yetishmagani talabnomaga o‘tadi.</p>
 </div>;
}
