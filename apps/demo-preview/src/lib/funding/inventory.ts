import {normalizeUnit} from '../iqn/catalog';
import type {AssetSnapshot,Asset} from './types';
import type {WorkOrderDetail} from '../api/types';

export type AssetLimit={roadId:string;assetId:string;assetName:string;quantity:number;unit:string;chainageStartM:number;chainageEndM:number;workId?:string};
export function inventoryRows(snapshot:AssetSnapshot){return snapshot.roads.flatMap(road=>road.assets.map(asset=>({...asset,roadId:road.id,chainageStartM:asset.chainageStartM??0,chainageEndM:asset.chainageEndM??road.lengthKm*1000})));}
export function assetCapacity(asset:Asset,unit:string){
 const target=normalizeUnit(unit),source=normalizeUnit(asset.unit);
 if(target===source)return asset.quantity;
 if(target==='dona'&&asset.physicalCount!==undefined)return asset.physicalCount;
 if(target==='m'&&source==='km')return asset.quantity*1000;
 if(target==='km'&&source==='m')return asset.quantity/1000;
 if(target==='km'&&source==='m2'&&asset.kind==='GRASS')return asset.quantity/2000;
 return null;
}
export function inspectionLimit(snapshot:AssetSnapshot,input:{roadId:string;roadElementId?:string;chainageStartM:string;chainageEndM?:string;unit:string;exactQuantity:string},topic?:number):AssetLimit{
 const kinds:Record<number,string[]>={1:['GRASS','DRAIN','OTHER'],2:['PAVEMENT'],3:['PAVEMENT'],4:['PAVEMENT'],5:['PAVEMENT'],6:['PAVEMENT'],7:['CULVERT','BARRIER','DRAIN','OTHER'],8:['BARRIER','CURB','OTHER'],12:['SIGN'],11:['PAVILION'],17:['LIGHTING']};
 const from=Number(input.chainageStartM),to=Number(input.chainageEndM??input.chainageStartM);
 const candidates=inventoryRows(snapshot).filter(a=>a.roadId===input.roadId&&(!input.roadElementId||a.id===input.roadElementId)&&(!topic||!kinds[topic]||kinds[topic]!.includes(a.kind))&&from>=a.chainageStartM&&to<=a.chainageEndM&&assetCapacity(a,input.unit)!==null);
 if(candidates.length!==1)throw new Error('Joylashuvga mos aktivni aniqlab bo‘lmadi. Boshliq aktivlar bazasini aniqlashtiradi.');
 const a=candidates[0]!,capacity=assetCapacity(a,input.unit)!,q=Number(input.exactQuantity);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<from||!Number.isFinite(q)||q<=0||q>capacity+1e-6)throw new Error(`${a.name}: hajm bazadagi ${capacity} ${input.unit} dan oshmasin.`);
 if(normalizeUnit(input.unit)==='dona'&&!Number.isInteger(q))throw new Error('Elementlar sonini butun kiriting.');
 // A field observation may be a point or a subset of an inventory section.
 // The authoritative asset total remains the daily cap; no uniform-density estimate is invented.
 if(normalizeUnit(input.unit)==='m'&&to>from&&q>to-from+1e-6)throw new Error('Hajm ko‘rsatilgan uchastka uzunligidan oshmasin.');
 if(normalizeUnit(input.unit)==='km'&&to>from&&q>(to-from)/1000+1e-6)throw new Error('Hajm ko‘rsatilgan uchastka uzunligidan oshmasin.');
 return {roadId:a.roadId,assetId:a.id,assetName:a.name,quantity:capacity,unit:input.unit,chainageStartM:a.chainageStartM,chainageEndM:a.chainageEndM};
}
export function checkInventoryOrders(newOrders:WorkOrderDetail[],orders:WorkOrderDetail[]){
 const all=[...orders.filter(o=>!newOrders.some(n=>n.id===o.id)),...newOrders];
 for(const order of newOrders){const ref=order.assetLimit;if(!ref||order.state==='CANCELLED')continue;
  const used=all.filter(o=>o.state!=='CANCELLED'&&o.scheduledDate===order.scheduledDate&&o.assetLimit?.roadId===ref.roadId&&o.assetLimit.assetId===ref.assetId&&o.assetLimit.workId===ref.workId&&normalizeUnit(o.exactQuantity.unit)===normalizeUnit(ref.unit)).reduce((s,o)=>s+Number(o.completion?.state==='VERIFIED'?o.completion.actualQuantity.value:o.exactQuantity.value),0);
  if(used>ref.quantity+1e-6)throw new Error(`${ref.assetName}: shu kundagi bajarilgan va band hajm ${ref.quantity} ${ref.unit} dan oshadi. Takroriy ishni boshqa kunga ajrating.`);
 }
}
