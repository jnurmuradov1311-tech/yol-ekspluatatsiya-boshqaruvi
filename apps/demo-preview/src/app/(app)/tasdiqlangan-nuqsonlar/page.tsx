"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { defectTypes } from "@/lib/iqn/defects";
import { DefectNavigation } from "@/components/defect-navigation";
import { useAuth } from "@/components/auth-provider";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame, TextArea, TextInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import { formatChainage } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

type ReviewItem={id:string;defectTypeId?:string;source:"AI"|"HUMAN";name:string;reference:string;roadCode:string;location:string;quantity:string;unit:string;observedAt:string;evidence:Array<{url:string;contentType:string}>};
type Stage="review"|"ready"|"progress"|"done";
export default function DefectsPage() {
  const {user}=useAuth(),router=useRouter();
  const canDecide=user?.id==="demo-chief"||(!api.fixturesEnabled&&Boolean(user?.permissions.includes("defects.verify")||user?.permissions.includes("system.all")));
  const [stage,setStage]=useState<Stage>("review");
  const [selected,setSelected]=useState<ReviewItem|null>(null);
  const inventory=useApiResource(api.manualInspectionOptions,"review-inventory");
  const [elementId,setElementId]=useState("");
  const [reviewTypeId,setReviewTypeId]=useState("");
  const [quantity,setQuantity]=useState(""),[unit,setUnit]=useState("m2"),[note,setNote]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const resource=useApiResource(async()=>{
    const [ai,manual,open,planned,active,closed,resolved]=await Promise.all([api.findings("PENDING_REVIEW"),api.manualInspections("PENDING_REVIEW"),api.confirmedDefects("OPEN"),api.confirmedDefects("PLANNED"),api.confirmedDefects("IN_PROGRESS"),api.confirmedDefects("CLOSED"),api.confirmedDefects("RESOLVED")]);
    const review:ReviewItem[]=[...manual.items.map(item=>({id:item.id,source:"HUMAN" as const,name:item.observations[0]?.observedIssue??"Nuqson",reference:item.inspectionNumber,roadCode:item.road.code,location:item.observations[0]?.locationLabel??"",quantity:item.observations[0]?.exactQuantity.value??"",unit:item.observations[0]?.exactQuantity.unit??"m2",observedAt:item.observedDate,evidence:item.observations.flatMap(o=>o.evidence)})),...ai.items.map(item=>({id:item.id,defectTypeId:item.defectTypeId,source:"AI" as const,name:item.attributeName,reference:item.vendorReference,roadCode:item.road.code,location:formatChainage(item.chainageStartM),quantity:item.measuredQuantity?.value??"",unit:defectTypes.find(t=>t.id===item.defectTypeId)?.unit??item.measuredQuantity?.unit.replace("²","2").replace("³","3")??"m2",observedAt:item.observedAt,evidence:item.evidence}))];
    return {review,ready:open.items,progress:[...planned.items,...active.items],done:[...closed.items,...resolved.items]};
  },"defect-workflow");
  function select(item:ReviewItem){setSelected(item);setElementId("");setReviewTypeId(item.defectTypeId??"");setQuantity(item.quantity);setUnit(item.unit);setNote("");setError("");}
  async function decide(approved:boolean){
    if(!selected)return;
    if(!approved&&!note.trim()){setError("Rad etish sababini yozing.");return;}
    if(approved&&(!Number.isFinite(Number(quantity))||Number(quantity)<=0)){setError("Musbat hajm kiriting.");return;}
    setBusy(true);setError("");
    try {
      if(selected.source==="AI")await api.decideFinding(selected.id,approved?"VERIFIED":"REJECTED",note,approved?{value:quantity,unit}:undefined,undefined,approved?reviewTypeId:undefined,elementId||undefined);
      else await api.decideManualInspection(selected.id,approved?"VERIFIED":"REJECTED",note);
      if(approved){
        const defects=await api.confirmedDefects("OPEN");
        const defect=defects.items.find(d=>d.sourceReference===selected.reference);
        if(defect){router.push(`/rejalashtirish?defect=${encodeURIComponent(defect.id)}&roadCode=${encodeURIComponent(defect.road.code)}`);return;}
        setStage("ready");
      }
      setSelected(null);await resource.reload();
    }catch(e){setError(e instanceof Error?e.message:"Qaror saqlanmadi.");}finally{setBusy(false);}
  }
  const data=resource.data;
  return <div className="page-stack"><DefectNavigation/><PageHeader title="Nuqsonlar" description="Boshliq nuqsonni tekshiradi va undan topshiriq yaratadi." actions={<Link className="button button--primary" href="/malumot-kiritish">+ Nuqson kiritish</Link>}/>
    <div className="tabs" role="tablist" aria-label="Nuqson jarayoni">{([["review","Tekshirish"],["ready","Topshiriq yaratish"],["progress","Ijroda"],["done","Yakunlangan"]] as const).map(([key,label])=><button key={key} role="tab" aria-selected={stage===key} disabled={busy} onClick={()=>{setStage(key);setSelected(null);setError("");}}>{label}{data?` (${data[key].length})`:""}</button>)}</div>
    {resource.loading?<LoadingState/>:resource.error?<ErrorState error={resource.error} retry={resource.reload}/>:data?stage==="review"?
      data.review.length?<Card><TableFrame label="Tekshiriladigan nuqsonlar"><table><thead><tr><th>Manba</th><th>Nuqson</th><th>Joy</th><th>Hajm</th><th/></tr></thead><tbody>{data.review.map(item=><Fragment key={item.id}><tr><td><Badge tone={item.source==="AI"?"info":"neutral"}>{item.source==="AI"?"RoadVision · namuna":"Yo‘l ustasi qaydi"}</Badge></td><td><strong>{item.name}</strong><small>{item.reference}</small></td><td>{item.roadCode}<small>{item.location}</small></td><td>{item.quantity?`${item.quantity} ${item.unit}`:"O‘lchov kerak"}</td><td><Button disabled={busy} variant="secondary" onClick={()=>select(item)}>Tekshirish</Button></td></tr>{selected?.id===item.id?<tr className="review-row"><td colSpan={5}><div className="decision-panel decision-panel--human"><div><Badge tone="success">Boshliq qarori</Badge><p>{item.source==="AI"?"RoadVision namuna qaydi. Joy va taxminiy hajmni o‘lchab tasdiqlang.":"Ustaning joy va hajm haqidagi qaydini tekshiring."}</p></div>{item.evidence.length?<div className="button-row">{item.evidence.map((e,i)=><a className="text-link" key={i} href={e.url} target="_blank" rel="noreferrer">{e.contentType.startsWith("video")?"Video":"Foto"} {i+1}</a>)}</div>:null}
        <div className="data-form">{item.source==="AI"?<SelectInput label="Yo‘l elementi" name="reviewAsset" value={elementId} onChange={e=>setElementId(e.target.value)}><option value="">Mos element avtomatik tekshiriladi</option>{inventory.data?.roadElements?.filter(a=>inventory.data?.roads.find(r=>r.id===a.roadId)?.code===item.roadCode).map(a=><option key={a.id} value={a.id}>{a.name} · {a.quantity} {a.unit}</option>)}</SelectInput>:null}{item.source==="AI"?<SelectInput label="Tasdiqlanadigan nuqson turi" name="reviewDefectType" value={reviewTypeId} disabled={busy||!canDecide} onChange={e=>{setReviewTypeId(e.target.value);const type=defectTypes.find(t=>t.id===e.target.value);if(type){setUnit(type.unit);setQuantity("");}}}><option value="">Turni tanlang</option>{defectTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</SelectInput>:null}<TextInput label="Nuqson hajmi" name="reviewQuantity" type="number" min="0.000001" step="any" value={quantity} disabled={busy||item.source==="HUMAN"||!canDecide} onChange={e=>setQuantity(e.target.value)}/><SelectInput label="Birlik" name="reviewUnit" value={unit} disabled={busy||item.source==="HUMAN"||Boolean(reviewTypeId)||!canDecide} onChange={e=>setUnit(e.target.value)}>{["m2","m3","m","dona","km"].map(u=><option key={u}>{u}</option>)}</SelectInput><TextArea label="Izoh (rad etishda majburiy)" name="reviewNote" rows={2} value={note} disabled={busy||!canDecide} onChange={e=>setNote(e.target.value)}/></div>
        {error?<p role="alert" className="inline-error">{error}</p>:null}<div className="button-row">{canDecide?<><Button busy={busy} onClick={()=>decide(true)}>Tasdiqlash va topshiriq yaratish</Button><Button disabled={busy} variant="danger" onClick={()=>decide(false)}>Rad etish</Button></>:<Badge tone="warning">Boshliq tekshirishi kutilmoqda</Badge>}<Button disabled={busy} variant="ghost" onClick={()=>setSelected(null)}>Yopish</Button></div></div></td></tr>:null}</Fragment>)}</tbody></table></TableFrame></Card>:<EmptyState title="Tekshirish uchun yangi nuqson yo‘q" detail="Tasdiqlangan nuqsonlardan topshiriq yaratishingiz mumkin." action={<Button onClick={()=>setStage("ready")}>Topshiriq yaratish</Button>}/>:
      data[stage].length?<Card><TableFrame label="Nuqsonlar holati"><table><thead><tr><th>Nuqson</th><th>Manba</th><th>Joy</th><th>Hajm</th><th>Holat</th><th/></tr></thead><tbody>{data[stage].map(d=><tr key={d.id}><td><strong>{d.defectName}</strong><small>{d.sourceReference}</small></td><td><Badge tone={d.sourceKind==="ROADVISION"?"info":"neutral"}>{d.sourceKind==="ROADVISION"?"RoadVision · namuna":"Yo‘l ustasi qaydi"}</Badge><small>Boshliq tasdiqlagan</small></td><td>{d.road.code}<small>{d.locationLabel}</small></td><td>{d.exactQuantity.value} {d.exactQuantity.unit}</td><td><Badge tone={stage==="done"?"success":stage==="ready"?"warning":"info"}>{stage==="done"?"Yakunlangan":stage==="ready"?"Topshiriq kerak":"Ijroda"}</Badge></td><td>{stage==="ready"&&canDecide?<Link className="button button--primary" href={`/rejalashtirish?defect=${encodeURIComponent(d.id)}&roadCode=${encodeURIComponent(d.road.code)}`}>Topshiriq yaratish</Link>:stage!=="ready"?<Link className="button button--secondary" href={`/topshiriqlar?defect=${encodeURIComponent(d.id)}`}>Topshiriqlarni ko‘rish</Link>:null}</td></tr>)}</tbody></table></TableFrame></Card>:<EmptyState title="Bu bosqichda nuqson yo‘q" detail="Yozuvlar jarayon davomida shu yerda ko‘rinadi."/>:null}
    <details className="workflow-details"><summary>Manbalar tarixi</summary><div className="button-row"><Link className="text-link" href="/nuqsonlar">Road AI qaydlari</Link><Link className="text-link" href="/malumot-kiritish">Yo‘l ustasi qaydlari</Link></div><p className="field__hint">RoadVision qaydlari — namuna. Ish tanlashda AI ulanish holati alohida ko‘rsatiladi.</p></details>
  </div>;
}
