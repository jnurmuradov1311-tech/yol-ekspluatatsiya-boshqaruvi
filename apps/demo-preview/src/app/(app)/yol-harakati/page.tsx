"use client";
import Link from 'next/link';
import {useState} from 'react';
import {api} from '@/lib/api/client';
import {useApiResource} from '@/lib/use-api-resource';
import {formatDateTime} from '@/lib/format';
import {Badge,Card,EmptyState,ErrorState,LoadingState,PageHeader,SelectInput,TextInput} from '@/components/ui';
const directions:Record<string,string>={INCREASING:'Kilometr oshishi bo‘yicha',DECREASING:'Kilometr kamayishi bo‘yicha',BOTH:'Ikkala yo‘nalishda'};
const lanes:Record<string,string>={RIGHT:'O‘ng polosa',LEFT:'Chap polosa',MIDDLE:'O‘rta polosa',SHOULDER:'Yo‘l yoqasi'};
export default function RoadAccessPage(){
 const [filter,setFilter]=useState('active'),[date,setDate]=useState('');
 const data=useApiResource(api.demoClosures,'traffic-register');
 const items=data.data?.filter(r=>(!date||r.date===date)&&(filter==='all'||!['COMPLETED','VERIFIED','CANCELLED'].includes(r.state)))??[];
 return <div className="page-stack"><PageHeader title="Yo‘l harakati" actions={<Link className="button button--secondary" href="/xarita">Xaritada ko‘rish</Link>}/><Card><div className="data-form"><SelectInput label="Holat" value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Rejalangan va amaldagi yopilishlar</option><option value="all">Barcha yozuvlar</option></SelectInput><TextInput label="Sana" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div></Card>
 {data.loading?<LoadingState/>:data.error?<ErrorState error={data.error} retry={data.reload}/>:items.length?<div className="closure-cards">{items.map(item=>{const opened=['COMPLETED','VERIFIED'].includes(item.state),cancelled=item.state==='CANCELLED',overdue=!opened&&!cancelled&&Boolean(item.to)&&Date.parse(item.to!)<Date.now();return <Card key={item.id}><div className="card-heading"><h2>{item.roadCode} · {item.location}</h2><Badge tone={opened?'success':cancelled?'neutral':overdue?'danger':'warning'}>{opened?'Yo‘l ochilgan':cancelled?'Bekor qilingan':overdue?'Muddat o‘tgan — holatni tekshiring':item.access==='CLOSED'?'To‘liq yopiladi':'Qisman yopiladi'}</Badge></div><dl className="closure-detail"><div><dt>Boshlanish</dt><dd>{item.from?formatDateTime(item.from):item.date}</dd></div><div><dt>Tugash</dt><dd>{item.to?formatDateTime(item.to):'—'}</dd></div><div><dt>Yo‘nalish</dt><dd>{directions[item.direction??'']??item.direction??'Avvalgi qaydda kiritilmagan'}</dd></div><div><dt>Polosa</dt><dd>{item.access==='CLOSED'?'Barcha polosalar':lanes[item.laneLabel??'']??item.laneLabel??'Avvalgi qaydda kiritilmagan'}</dd></div><div><dt>Topshiriq</dt><dd><Link href={`/topshiriqlar/${item.id}`}>{item.number}</Link></dd></div><div><dt>YTPga uzatish</dt><dd>{item.externalSent?'Yuborilgan':'Demo — tashqi uzatish yoqilmagan'}</dd></div></dl></Card>})}</div>:<EmptyState title="Bu holatda yopilish yo‘q" detail="Topshiriq ijroga berilgach shu yerda ko‘rinadi."/>}</div>;
}
