"use client";
import {createContext,useContext,useEffect,useState,useRef,type ReactNode} from 'react';
import {currentScript,scriptText,type WritingScript} from '@/lib/script';
const Context=createContext<{script:WritingScript;setScript:(v:WritingScript)=>void}>({script:'latn',setScript:()=>{}});
export function ScriptProvider({children}:{children:ReactNode}){
 const [script,set]=useState<WritingScript>('latn');
 const textCache=useRef(new WeakMap<Node,{source:string;shown:string}>()),attrCache=useRef(new WeakMap<Element,Map<string,{source:string;shown:string}>>());
 useEffect(()=>set(currentScript()),[]);
 useEffect(()=>{
  document.documentElement.lang=script==='cyrl'?'uz-Cyrl':'uz-Latn';
  const nodes=textCache.current;
  const attrs=attrCache.current;
  const update=()=>{
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node:Node|null;
   while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,textarea,code,pre,[data-no-translit]'))continue;
    if(parent.tagName==='OPTION'&&!parent.hasAttribute('value'))parent.setAttribute('value',parent.textContent??'');
    const previous=nodes.get(node),source=previous&&node.nodeValue===previous.shown?previous.source:node.nodeValue??'';const shown=scriptText(source,script);nodes.set(node,{source,shown});if(node.nodeValue!==shown)node.nodeValue=shown;
   }
   document.querySelectorAll('[aria-label],[placeholder],[title]').forEach(el=>{if(el.closest('[data-no-translit]'))return;const map=attrs.get(el)??new Map();for(const key of ['aria-label','placeholder','title']){const raw=el.getAttribute(key);if(raw===null)continue;const old=map.get(key),source=old&&raw===old.shown?old.source:raw,shown=scriptText(source,script);map.set(key,{source,shown});if(raw!==shown)el.setAttribute(key,shown);}attrs.set(el,map);});
  };
  let active=true,queued=false;const observer=new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{if(!active)return;queued=false;observer.disconnect();update();observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','placeholder','title']});});}});
  update();observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','placeholder','title']});return()=>{active=false;observer.disconnect();};
 },[script]);
 const setScript=(v:WritingScript)=>{try{localStorage.setItem('roadops-script',v);}catch{}set(v);};
 return <Context.Provider value={{script,setScript}}>{children}</Context.Provider>;
}
export function ScriptSwitch(){const {script,setScript}=useContext(Context);return <label className="script-switch" data-no-translit>Yozuv <select aria-label="Yozuv / Ёзув" value={script} onChange={e=>setScript(e.target.value as WritingScript)}><option value="latn">Lotin</option><option value="cyrl">Кирилл</option></select></label>;}
