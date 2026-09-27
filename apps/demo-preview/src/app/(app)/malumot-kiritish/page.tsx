"use client";
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState,type FormEvent} from 'react';
import {Camera,Check,Search} from 'lucide-react';
import {api} from '@/lib/api/client';
import type {ManualInspectionInput} from '@/lib/api/types';
import {iqnTopicId} from '@/lib/iqn/defects';
import {searchText} from '@/lib/iqn/catalog';
import {useApiResource} from '@/lib/use-api-resource';
import {Button,Card,EmptyState,ErrorState,LoadingState,PageHeader,SelectInput,TextArea,TextInput} from '@/components/ui';
export default function ManualEntryPage(){
 const router=useRouter();
 const options=useApiResource(api.manualInspectionOptions,'capture-options');
 const [roadId,setRoadId]=useState(''),[typeId,setTypeId]=useState(''),[search,setSearch]=useState(''),[showAll,setShowAll]=useState(false);
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[section,setSection]=useState(false),[quantity,setQuantity]=useState(''),[note,setNote]=useState('');
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tashkent'}),[date,setDate]=useState(today);
 const road=options.data?.roads.find(r=>r.id===roadId)??options.data?.roads[0];
 const type=options.data?.defectTypes?.find(t=>t.id===typeId);
 const allTypes=options.data?.defectTypes??[];
 const matches=allTypes.filter(t=>!search.trim()||search.trim().split(/\s+/).every(word=>searchText(t.name).includes(searchText(word))));
 const visible=search.trim()||showAll?matches:matches.slice(0,8);
 async function submit(event:FormEvent){
  event.preventDefault();if(!road||!type)return;
  const start=Number(from)*1000,end=section?Number(to)*1000:start,q=Number(quantity);
  if(!from||!Number.isFinite(start)||start<0||start>=road.lengthM||!Number.isFinite(end)||end<start||end>road.lengthM||(section&&(!to||end<=start))){setError('Joylashuvni yo‘l uzunligi doirasida kiriting.');return;}
  if(!Number.isFinite(q)||q<=0||(type.unit==='dona'&&!Number.isInteger(q))){setError(type.unit==='dona'?'Soni musbat butun bo‘lsin.':'O‘lchangan hajmni kiriting.');return;}
  setBusy(true);setError('');
  try{
   const evidence=file?[await api.uploadInspectionEvidence(file)]:undefined;
   const payload:ManualInspectionInput={roadId:road.id,defectTypeId:type.id,iqnTopicId:iqnTopicId(type.iqnTopicNumber),observedIssue:type.name,observedDate:date,chainageStartM:String(start),chainageEndM:String(end),exactQuantity:quantity,unit:type.unit,note:note.trim()||undefined,evidence,submitForReview:true};
   await api.submitInspection(payload);router.push('/tasdiqlangan-nuqsonlar?stage=review&saved=1');
  }catch(e){setError(e instanceof Error?e.message:'Nuqson yuborilmadi. Qayta urinib ko‘ring.');}finally{setBusy(false);}
 }
 return <div className="page-stack capture-page"><PageHeader title="Nuqson kiritish" actions={<Link className="button button--secondary" href="/tasdiqlangan-nuqsonlar">Nuqsonlar ro‘yxati</Link>}/>
 {options.loading?<LoadingState/>:options.error?<ErrorState error={options.error} retry={options.reload}/>:!road?<EmptyState title="Yo‘l biriktirilmagan" detail="Bo‘limingizga yo‘l biriktirish kerak."/>:<Card className="capture-card"><form onSubmit={submit}>
 <fieldset disabled={busy} className="capture-fields"><legend className="sr-only">Yo‘l ustasi qaydi</legend>
 <SelectInput label="Yo‘l" value={road.id} onChange={e=>{setRoadId(e.target.value);setFrom('');setTo('');}}>{options.data?.roads.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</SelectInput>
 <div className="capture-location"><TextInput label={section?"Boshlanish, km":"Joylashuv, km"} name="locationKm" type="number" min="0" max={road.lengthM/1000} step="0.001" placeholder="Masalan: 12.500" required value={from} onChange={e=>setFrom(e.target.value)}/>{section?<TextInput label="Uchastka oxiri, km" type="number" min={from||0} max={road.lengthM/1000} step="0.001" required value={to} onChange={e=>setTo(e.target.value)}/>:null}</div>
 
 <div className="defect-picker"><label htmlFor="defect-search">Nuqson turi</label>{type?<div className="chosen-defect"><Check size={18}/><strong>{type.name}</strong><Button type="button" variant="ghost" onClick={()=>{setTypeId('');setSearch('');}}>O‘zgartirish</Button></div>:<><div className="search-field"><Search size={18}/><input id="defect-search" type="search" className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Chuqurcha, yoriq, belgi…" aria-label="Nuqson turini topish" autoComplete="off"/></div><div className="defect-options" aria-label="Nuqson turlari">{visible.map(t=><button type="button" key={t.id} onClick={()=>{setTypeId(t.id);setQuantity(t.unit==='dona'?'1':'');setSection(t.unit!=='dona');}}>{t.name}</button>)}</div>{!matches.length?<p role="status">Bu nom topilmadi. Masalan, «chuqurcha», «belgi» yoki «quvur» deb yozing.</p>:!search&&!showAll?<Button type="button" variant="ghost" onClick={()=>setShowAll(true)}>Barcha turlar ({allTypes.length})</Button>:<small role="status">{matches.length} ta mos tur</small>}</>}</div>
 {type?<TextInput label={type.unit==='dona'?'Soni, dona':`O‘lchangan hajm, ${type.unit.replace('2','²').replace('3','³')}`} name="exactQuantity" type="number" min={type.unit==='dona'?'1':'0.000001'} step={type.unit==='dona'?'1':'any'} required value={quantity} onChange={e=>setQuantity(e.target.value)}/>:null}
 <label className="capture-photo"><Camera size={22}/><span><strong>Foto yoki video qo‘shish</strong><small>{file?file.name:'Ixtiyoriy · 20 MB gacha'}</small></span><input type="file" name="evidenceFile" accept="image/jpeg,image/png,video/mp4" capture="environment" onChange={e=>{const f=e.target.files?.[0]??null;if(f&&f.size>20*1024*1024){setError('Fayl 20 MB dan oshmasin.');e.target.value='';setFile(null);}else{setError('');setFile(f);}}}/></label>
 <details className="workflow-details"><summary>Izoh va ko‘rik sanasi</summary><TextArea label="Izoh" rows={2} value={note} onChange={e=>setNote(e.target.value)}/><TextInput label="Ko‘rik sanasi" type="date" max={today} required value={date} onChange={e=>setDate(e.target.value)}/></details>
 </fieldset>{error?<p role="alert" className="inline-error">{error}</p>:null}<div className="wizard-footer"><Link className="button button--secondary" href="/tasdiqlangan-nuqsonlar">Orqaga</Link><Button type="submit" busy={busy} disabled={!type||!from||!quantity}>Boshliqqa yuborish</Button></div>
 </form></Card>}</div>;
}
