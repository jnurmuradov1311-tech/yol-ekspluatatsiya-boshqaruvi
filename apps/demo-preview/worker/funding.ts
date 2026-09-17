import {parseAssetSnapshot} from '../src/lib/funding/assets';
export type FundingEnvironment={RAMS_ASSETS_URL?:string;RAMS_API_TOKEN?:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleFundingRequest(request:Request,env:FundingEnvironment,fetcher:typeof fetch=fetch):Promise<Response>{
 if(!request.headers.get('oai-authenticated-user-id'))return json({error:'Tizimga kiring.'},401);
 if(request.method!=='GET')return json({error:'Bu manzil faqat o‘qish uchun.'},405);
 const url=new URL(request.url);
 if(request.headers.get('sec-fetch-site')==='cross-site')return json({error:'So‘rov manbasi mos emas.'},403);
 if(url.pathname==='/api/funding/status')return json({configured:Boolean(env.RAMS_ASSETS_URL),mode:env.RAMS_ASSETS_URL?'RAMS':'NOT_CONFIGURED'});
 if(url.pathname!=='/api/funding/assets')return json({error:'Manzil topilmadi.'},404);
 if(!env.RAMS_ASSETS_URL)return json({error:'RAMS API hali ulanmagan. RAMS eksport faylini yuklashingiz mumkin.'},503);
 try{
  const target=new URL(env.RAMS_ASSETS_URL);
  if(target.protocol!=='https:'||target.username||target.password)return json({error:'RAMS manzilini administrator tekshirishi kerak.'},503);
  const response=await fetcher(target,{headers:{Accept:'application/json',...(env.RAMS_API_TOKEN?{Authorization:`Bearer ${env.RAMS_API_TOKEN}`}:{})},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)return json({error:'RAMS ma’lumot bermadi. Oxirgi hisob saqlanadi.'},502);
  const reader=response.body?.getReader();if(!reader)return json({error:'RAMS javobi bo‘sh.'},502);
  const parts:Uint8Array[]=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>5_000_000){await reader.cancel();return json({error:'RAMS javobi 5 MB dan katta. Yo‘llar bo‘yicha cheklang.'},413);}parts.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const parsed=parseAssetSnapshot(JSON.parse(new TextDecoder().decode(bytes)),'RAMS');return json({data:parsed});
 }catch{return json({error:'RAMS javobi kelmadi yoki aktivlar formati yaroqsiz. Oxirgi hisob saqlanadi.'},502);}
}
