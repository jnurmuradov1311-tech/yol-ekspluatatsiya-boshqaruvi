"use client";
import {useState} from 'react';
import {readBrowserFile} from '@/lib/browser-files';
export function EvidenceLink({url, label}:{url:string;label:string}) {
 const [error,setError]=useState('');
 async function open(){setError('');try{const blob=await readBrowserFile(url),href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener';a.click();setTimeout(()=>URL.revokeObjectURL(href),60000);}catch(e){setError((e as Error).message);}}
 return <span>{url.startsWith('browser-file:')?<button type="button" className="text-link" onClick={()=>void open()}>{label}</button>:<a className="text-link" href={url} target="_blank" rel="noreferrer">{label}</a>}{error?<small role="alert">{error}</small>:null}</span>;
}
