"use client";
import {matchesSearch} from "@/lib/search";
import {useState} from 'react';
import {api} from '@/lib/api/client';
import {useApiResource} from '@/lib/use-api-resource';
import {WorkGuides} from '@/components/work-guides';
import {Card,PageHeader,LoadingState,ErrorState,TextInput,SelectInput} from '@/components/ui';
export default function WorkInstructionsPage(){
 const [roadId,setRoadId]=useState(''),[search,setSearch]=useState(''),[workId,setWorkId]=useState('');
 const roads=useApiResource(api.roads,'guide-roads'),selectedRoad=roadId||roads.data?.items[0]?.id||'';
 const options=useApiResource(()=>selectedRoad?api.planningOptions(selectedRoad):Promise.resolve(null),`guide-work-options:${selectedRoad}`);

 const works=options.data?.workVariants.filter(w=>matchesSearch(search,w.name,w.code))??[];
 const work=options.data?.workVariants.find(w=>w.id===workId);
 return <div className="page-stack"><PageHeader title="Ish yo‘riqnomalari"/>{roads.loading?<LoadingState/>:roads.error?<ErrorState error={roads.error} retry={roads.reload}/>:<Card><div className="data-form"><SelectInput label="Yo‘l" value={selectedRoad} onChange={e=>{setRoadId(e.target.value);setWorkId('');}}>{roads.data?.items.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</SelectInput><TextInput label="Ish nomi yoki kodi" type="search" placeholder="Masalan: belgi" value={search} onChange={e=>setSearch(e.target.value)}/><SelectInput label="Ish turi" value={workId} onChange={e=>setWorkId(e.target.value)}><option value="">Ish turini tanlang</option>{work&&!works.some(w=>w.id===work.id)?<option value={work.id}>{work.name}</option>:null}{works.map(w=><option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</SelectInput></div>{options.error?<ErrorState error={options.error} retry={options.reload}/>:null}{search&&!works.length?<p role="status">Bu qidiruvga mos ish topilmadi.</p>:null}{work?<WorkGuides key={work.id} workVariantId={work.id} workName={work.name}/>:null}</Card>}</div>;
}
