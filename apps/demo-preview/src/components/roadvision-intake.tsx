"use client";
import Link from 'next/link';
import {useState} from 'react';
import {api} from '@/lib/api/client';
import {Badge,Button,Card} from './ui';

export function RoadVisionIntake({onImported}:{onImported?:()=>Promise<unknown>}) {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function importDemo(){setBusy(true);setError('');try{const result=await api.importRoadVisionDemo();setMessage(`${result.added} ta namuna qo‘shildi${result.duplicates?`; ${result.duplicates} ta takror yozuv o‘tkazib yuborildi`:''}.`);await onImported?.();}catch(e){setError(e instanceof Error?e.message:'Qaydlar olinmadi.');}finally{setBusy(false);}}
 return <Card><div className="card-heading"><h2>RoadVision AI</h2><Badge tone="warning">Namuna rejimi</Badge></div>
  <p>Chuqurcha, yoriq, o‘chgan chiziq, shikastlangan belgi va to‘siq, tiqilgan suv yo‘li yoki ko‘rinishni to‘sgan o‘simlik — tekshirish uchun qayd.</p>
  <details className="workflow-details"><summary>AI va boshliq vazifasi</summary><p>AI aniqlagan joy va dalil boshliqqa keladi. Boshliq nuqson turini, hajmini va ta’mir shartlarini tekshiradi. Oddiy belgi yoki daraxt mavjudligi nuqson hisoblanmaydi.</p><p>Kameradan ta’mir qalinligi, ichki shikast va aniq hajm taxmin bilan to‘ldirilmaydi. Haqiqiy RoadVision ulanishi hali yo‘q; quyidagi tugma faqat sinov qaydlarini yaratadi.</p></details>
  {api.fixturesEnabled?<div className="button-row"><Button variant="secondary" busy={busy} onClick={importDemo}>6 ta RoadVision namunasini olish</Button><Link className="text-link" href="/tasdiqlangan-nuqsonlar?stage=review">Qaydlarni tekshirish</Link></div>:null}
  {message?<p role="status">{message}</p>:null}{error?<p className="inline-error" role="alert">{error}</p>:null}
 </Card>;
}
