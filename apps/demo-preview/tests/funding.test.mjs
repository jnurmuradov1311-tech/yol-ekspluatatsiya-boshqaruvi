import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roadops-funding-'));
await build({entryPoints:{assets:'src/lib/funding/assets.ts',calculate:'src/lib/funding/calculate.ts',worker:'worker/funding.ts'},outdir:dir,outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'node',logLevel:'silent'});
const {demoSnapshot,defaultPolicy,parseAssetSnapshot}=await import(pathToFileURL(path.join(dir,'assets.mjs')));
const {calculateFunding,assetWorkSpecs,fleetRequirements}=await import(pathToFileURL(path.join(dir,'calculate.mjs')));
const {handleFundingRequest}=await import(pathToFileURL(path.join(dir,'worker.mjs')));
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
const setup=()=>{const s=demoSnapshot();return {s,p:defaultPolicy(s)};};
const close=(a,b)=>assert.ok(Math.abs(a-b)<.02,`${a} != ${b}`);
test('annual quantities, pooled payroll, costs and road allocations reconcile',()=>{
 const {s,p}=setup();p.roadSelection=s.roads.map(r=>r.id);p.employerTaxPercent=12;p.overheadPercent=5;p.contingencyPercent=3;p.otherAnnual=500000;p.mealPerMonth=200000;p.holidayPerYear=1200000;
 const r=calculateFunding(s,p);
 const grass=r.lines.find(l=>l.assetId==='d001-grass');close(grass.quantity,134000/2000*2);close(grass.workerHours,37.52);close(grass.operatorHours,37.52);
 const patch=r.lines.find(l=>l.assetId==='d001-pavement');close(patch.quantity,938000*.007*2);close(patch.workerHours,patch.quantity*.6993);close(patch.operatorHours,patch.quantity*.2331);
 assert.equal(r.workers,Math.ceil(r.workerHours/p.annualHours));assert.equal(r.operators,Math.ceil(r.operatorHours/p.annualHours));
 close(r.labor,r.payrollRows.reduce((t,x)=>t+x.annual,0));close(r.labor,(r.workers*(3500000+300000)+r.operators*(4500000+300000)+Math.ceil(87/20)*(5500000+300000))*12);
 close(r.total,r.labor+r.materials+r.machinery+r.ppe+r.employerTax+r.overhead+r.contingency+r.other);close(r.roads.reduce((n,x)=>n+x.amount,0),r.total);
 assert.equal(r.complete,false,'unknown sign washing water/machinery remain unresolved');assert.ok(r.gaps.some(g=>g.includes('Material va texnika')));
});
test('one-off repairs never multiply by recurring frequency and source classification is required',()=>{
 const {p}=setup();const base={id:'x',name:'x',quantity:100,unit:'m',condition:'FAIR',defectQuantity:5,annualFrequency:14,frequencyBasis:'Rahbar qarori',repairMethod:'STRAIGHTEN'};
 const barrier=assetWorkSpecs({...base,kind:'BARRIER'},p);assert.equal(barrier[0].frequency,14);assert.equal(barrier[1].frequency,1);
 const light=assetWorkSpecs({...base,kind:'LIGHTING',unit:'dona',repairMethod:'REPLACE_FIXTURE'},p);assert.equal(light[1].frequency,1);
 assert.equal(assetWorkSpecs({...base,kind:'CURB'},p)[0].frequency,1);
 assert.ok(assetWorkSpecs({...base,kind:'LIGHTING',repairMethod:undefined},p)[1].gap);
 const pav=assetWorkSpecs({...base,kind:'PAVILION',unit:'m2'},p);assert.ok(pav[0].gap);assert.equal(pav[1].frequency,2);
 const sign={...base,kind:'SIGN',annualFrequency:undefined};assert.equal(assetWorkSpecs({...sign,industrialZone:true},p)[0].frequency,14);assert.equal(assetWorkSpecs({...sign,industrialZone:false},p)[0].frequency,10);assert.ok(assetWorkSpecs(sign,p)[0].gap);
});
test('condition forecast does not add measured backlog twice and disputed branches stay blocked',()=>{
 const {s,p}=setup();const a=s.roads[0].assets[0];a.defectQuantity=15000;assert.equal(assetWorkSpecs(a,p)[0].quantity,15000);
 a.condition='POOR';assert.ok(assetWorkSpecs(a,p)[0].gap);p.conditionIIIRepeats=3;p.conditionBasis='Rahbarning aniqlashtirilgan davriyligi';assert.equal(assetWorkSpecs(a,p)[0].gap,'');close(assetWorkSpecs(a,p)[0].quantity,938000*.015*3);
 a.annualFrequency=4;a.frequencyBasis=undefined;assert.ok(assetWorkSpecs(a,p)[0].gap);
 assert.ok(assetWorkSpecs({...a,workId:'iqn02-t2-r4',annualFrequency:2,frequencyBasis:undefined},p)[0].gap);
});
test('PPE lives, roles, division scope and annualized inventory are respected',()=>{
 const {s,p}=setup(),r=calculateFunding(s,p),all=r.workers+r.operators+r.payrollRows[2].count;
 close(r.ppeRows.find(x=>x.id==='vest').quantity,all*2);close(r.ppeRows.find(x=>x.id==='gloves').quantity,all*12);close(r.ppeRows.find(x=>x.id==='soap').quantity,all*2.4);
 close(r.ppeRows.find(x=>x.id==='rain').quantity,(r.workers+r.payrollRows[2].count)/3);
 close(r.ppeRows.find(x=>x.id==='hoe').quantity,4*12/24);
 p.divisionCount=2;const next=calculateFunding(s,p);close(next.ppeRows.find(x=>x.id==='hoe').quantity,4);assert.equal(next.ppeRows.find(x=>x.id==='vest').quantity,r.ppeRows.find(x=>x.id==='vest').quantity);
});
test('wrong units, missing or driver-inclusive prices cannot become complete costs',()=>{
 const {s,p}=setup();const initial=calculateFunding(s,p),machine=initial.resources.find(r=>r.kind==='machine');p.rates[machine.key].includesOperator=true;let r=calculateFunding(s,p);assert.equal(r.resources.find(x=>x.key===machine.key).amount,null);assert.ok(r.gaps.some(g=>g.includes('haydovchi')));
 const material=initial.resources.find(r=>r.kind==='material');p.rates[material.key].unit='WRONG';r=calculateFunding(s,p);assert.equal(r.resources.find(x=>x.key===material.key).amount,null);
 s.roads[0].assets.find(a=>a.kind==='DRAIN').unit='dona';r=calculateFunding(s,p);assert.ok(r.gaps.some(g=>g.includes('Aktiv birligi')));
 p.annualHours=0;assert.throws(()=>calculateFunding(s,p));p.annualHours=1976;p.workerMonthly=Infinity;assert.throws(()=>calculateFunding(s,p));
});
test('RAMS validates IDs, quantities, dates and source without silently merging duplicates',()=>{
 const {s}=setup();const parsed=parseAssetSnapshot(s);assert.equal(parsed.mode,'IMPORT');assert.equal(parsed.roads.length,2);
 const duplicate=structuredClone(s);duplicate.roads.push(duplicate.roads[0]);assert.throws(()=>parseAssetSnapshot(duplicate),/Takroriy/);
 const invalid=structuredClone(s);invalid.roads[0].assets[0].defectQuantity=1e9;assert.throws(()=>parseAssetSnapshot(invalid),/Nuqson/);
 invalid.roads[0].assets[0].defectQuantity=0;invalid.observedAt='2026-02-30';assert.throws(()=>parseAssetSnapshot(invalid),/sanasi/);
});
test('technical category changes fleet capacity only; shared fleet rounds once',()=>{
 const {s}=setup();const road=s.roads[0];road.lengthKm=50;road.category='II';const two=fleetRequirements([road,{...road,id:'other'}]);const whole=fleetRequirements([{...road,lengthKm:100}]);close(two[0].quantity,whole[0].quantity);assert.equal(two[0].quantity,2);
 road.category='V';assert.equal(fleetRequirements([road])[0].quantity,.8);
});
test('RAMS server bridge authenticates, validates actual responses and never falls back to demo',async()=>{
 const env={RAMS_ASSETS_URL:'https://rams.example.test/assets',RAMS_API_TOKEN:'test-only'};let calls=0;
 const req=(path='/api/funding/assets',auth=true)=>new Request(`https://site.example.test${path}`,{headers:auth?{'oai-authenticated-user-id':'owner'}:{}});
 const mock=async(url,options)=>{calls++;assert.equal(String(url),env.RAMS_ASSETS_URL);assert.equal(options.headers.Authorization,'Bearer test-only');return Response.json(demoSnapshot());};
 assert.equal((await handleFundingRequest(req(undefined,false),env,mock)).status,401);assert.equal(calls,0);
 assert.equal((await handleFundingRequest(req(),{},mock)).status,503);assert.equal(calls,0);
 const success=await handleFundingRequest(req(),env,mock);assert.equal(success.status,200);assert.equal((await success.json()).data.mode,'RAMS');
 assert.equal((await handleFundingRequest(req(),env,async()=>Response.json({roads:[]}))).status,502);
 assert.equal((await handleFundingRequest(req(),env,async()=>{throw new Error('upstream');})).status,502);
 assert.equal((await handleFundingRequest(req(),{RAMS_ASSETS_URL:'http://bad'},mock)).status,503);
});
test('incomplete resource drafts survive serialization; manual work requires its own quantity',()=>{
 const {s,p}=setup(),a=s.roads[0].assets[0];a.workId='iqn02-t2-r4';a.workUnit='m2';a.annualFrequency=1;a.frequencyBasis='';
 a.resourcePlan={workVariantId:a.workId,basisQuantity:'',note:'',materials:{mode:'REQUIRED',items:[{key:'',quantity:''}]},machines:{mode:'NONE',items:[]}};
 const roundtrip=parseAssetSnapshot(JSON.parse(JSON.stringify(s)));assert.deepEqual(roundtrip.roads[0].assets[0].resourcePlan,a.resourcePlan);
 let spec=assetWorkSpecs(a,p)[0];assert.equal(spec.quantity,0);assert.ok(spec.gap.includes('alohida hajm'));
 a.workQuantity=4;a.frequencyBasis='Topshiriq rejasi';a.operatorHoursPerUnit=.2331;a.operatorBasis='IQN02 023-01 mashinist normasi';delete a.resourcePlan;
 const r=calculateFunding(s,p),line=r.lines.find(l=>l.assetId===a.id);close(line.quantity,4);close(line.workerHours,4*.66);close(line.operatorHours,4*.2331);
});
test('damaged signs cannot disappear behind routine washing coverage',()=>{
 const {s,p}=setup();s.roads[0].assets.find(a=>a.kind==='SIGN').defectQuantity=5;
 assert.ok(calculateFunding(s,p).gaps.some(g=>g.includes('nuqsonni bartaraf etish uchun alohida')));
});
test('empty selection is rejected and missing assets belong to the correct road ID',()=>{
 const {s,p}=setup();p.roadSelection=[];p.supervisors=2;p.otherAnnual=1000000;assert.throws(()=>calculateFunding(s,p),/kamida bitta/);
 p.roadSelection=s.roads.map(r=>r.id);s.roads[1].code=s.roads[0].code;s.roads[1].assets=[];
 const r=calculateFunding(s,p);assert.equal(r.roads.find(x=>x.id===s.roads[1].id).missing,1);assert.ok(r.roads.find(x=>x.id===s.roads[0].id).missing>1);
});
test('cent rounding never allocates negative money to an empty road',()=>{
 const {s,p}=setup();s.roads=[19/13,21/13,0].map((q,i)=>({...s.roads[0],id:`round-${i}`,code:`R${i}`,lengthKm:1,assets:q?[{id:`grass-${i}`,kind:'GRASS',name:'Grass',quantity:q,unit:'m2',condition:'GOOD'}]:[]}));p.roadSelection=s.roads.map(r=>r.id);p.workerMonthly=1;p.operatorMonthly=1;p.supervisorMonthly=1;p.otherAnnual=2/3;p.overheadPercent=1.3;p.contingencyPercent=2.7;
 const r=calculateFunding(s,p);r.roads.forEach(x=>assert.ok(x.amount>=0));assert.equal(r.roads[2].amount,0);close(r.roads.reduce((n,x)=>n+x.amount,0),r.total);
});
