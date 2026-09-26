import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

async function demo(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roadops-demo-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  await build({entryPoints:{fixtures:'src/lib/api/fixtures.ts','resource-plan':'src/lib/iqn/resource-plan.ts'},outdir:dir,outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const storage=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  globalThis.window={sessionStorage:{getItem:(key)=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:(key)=>storage.delete(key)}};
  globalThis.document={cookie:''};
  const {handleFixtureRequest:request}=await import(pathToFileURL(path.join(dir,'fixtures.mjs')).href);
  const get=(route)=>request(route,{});
  const post=(route,body={})=>request(route,{method:'POST',body});
  await post('/auth/login',{email:'operator@example.uz',password:'e2e-password'});
  const options=await get('/planning/options?roadId=road-d001');
  const source=options.sourceDefects.find((item)=>item.suggestedWorkVariantIds?.includes('work-pothole'));
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tashkent'});
  const input={roadId:'road-d001',sourceDefectId:source.id,workVariantId:'work-pothole',exactQuantity:source.measuredQuantity.value,chainageStartM:source.location.chainageStartM,scheduledDate:today,scheduledEndDate:today,startTime:'08:00',endTime:'15:00',roadAccess:'PARTIAL'};
  const role=(role)=>post('/demo/role',{role});
  const publish=async(input)=>{
    await role('chief');
    const plan=await post('/planning/manual/preview',input);
    assert.equal(plan.resourcesReady,true,JSON.stringify(plan.blockers));
    await role('engineer');
    await assert.rejects(post(`/planning/plans/${plan.draftId}/approve`),{code:'PLAN_APPROVAL_REJECTED'});
    await role('chief');
    assert.equal((await get(`/planning/plans/${plan.draftId}`)).canApprove,true);
    await post(`/planning/plans/${plan.draftId}/approve`);
    await post(`/planning/plans/${plan.draftId}/publish`);
    const orders=(await get('/work-orders?page=1&pageSize=100')).items.filter((order)=>order.id.includes(plan.draftId));
    assert.ok(orders.length);
    return {plan,orders};
  };
  const finish=async(order,fraction=1)=>{
    await role('foreman'); await post(`/work-orders/${order.id}/start`);
    const payload={completedQuantity:String(Number(order.exactQuantity.value)*fraction),unit:order.exactQuantity.unit,laborEntries:order.executionResources.workers.map((w)=>({workerId:w.id,workDate:w.workDate,actualMinutes:w.plannedMinutes})),materialUsages:order.executionResources.materials.map((m)=>({materialReservationId:m.reservationId,quantity:String(Number(m.plannedQuantity)*fraction),usedAt:m.usedAt})),equipmentUsages:order.executionResources.equipment.map((e)=>({equipmentReservationId:e.reservationId,usageDate:e.usageDate,actualMachineMinutes:e.plannedMachineMinutes})),evidence:[],note:'Sinov ishi yakunlandi'};
    await post(`/work-orders/${order.id}/complete`,payload);
    await assert.rejects(post(`/work-orders/${order.id}/verify`),{code:'CHIEF_REQUIRED'});
    await role('chief'); await post(`/work-orders/${order.id}/verify`,{note:'Tekshirildi'});
    return payload;
  };
  const resources=await import(pathToFileURL(path.join(dir,'resource-plan.mjs')).href);
  return {get,post,role,publish,finish,input,today,options,resources};
}

test('new plan -> chief approval -> order -> actual timesheet -> consistent act/payroll',async(t)=>{
  const d=await demo(t),before=await d.get('/work-orders?pageSize=100');
  const {plan,orders}=await d.publish(d.input);
  assert.equal(orders.length,1);
  assert.equal((await d.get('/work-orders?pageSize=100')).total,before.total+1);
  await d.post(`/planning/plans/${plan.draftId}/publish`);
  assert.equal((await d.get('/work-orders?pageSize=100')).total,before.total+1,'repeat publication must not duplicate');
  const closures=await d.get('/demo/closures');assert.equal(closures.length,1);assert.equal(closures[0].externalSent,false);
  const payload=await d.finish(orders[0]);
  const [year,month]=d.today.split('-').map(Number),period=d.today.slice(0,7);
  const sheet=await d.get(`/timesheets/monthly?year=${year}&month=${month}`);
  for(const entry of payload.laborEntries)assert.equal(sheet.rows.find((r)=>r.workerId===entry.workerId).totalMinutes,entry.actualMinutes);
  assert.ok(sheet.rows.find((r)=>r.workerId==='w-6').totalMinutes>0,'mechanized work includes its qualified operator');
  const act=await d.post('/monthly-completion-acts',{divisionId:'e2e-division',actMonth:`${period}-01`});
  const payroll=await d.post('/payroll/preview',{divisionId:'e2e-division',period,policyReference:'Namuna',adjustments:[]});
  assert.ok(Math.abs(Number(act.laborAmountUzs)-Number(payroll.totals.grossAmountUzs))<.02,'act wage must match payroll wage');
  assert.equal(act.items[0].iqnLaborNorm.minutesPerUnit,'16');
  assert.equal((await d.get('/defects?state=CLOSED')).items.some((x)=>x.id===d.input.sourceDefectId),true);
  await d.post(`/monthly-completion-acts/${act.id}/submit`);
  await assert.rejects(d.post('/payroll/preview',{divisionId:'e2e-division',period,policyReference:'Oldingi hisobni o‘zgartirish',adjustments:[{workerId:'w-1',salaryCoefficient:'2'}]}),{code:'POSTED_PAYROLL_CONFLICT'});
  await assert.rejects(d.post(`/monthly-completion-acts/${act.id}/approve`),{code:'INDEPENDENT_APPROVER_REQUIRED'});
  await d.role('engineer');await d.post(`/monthly-completion-acts/${act.id}/approve`);
});

test('insufficient staff blocks and a request approval never manufactures warehouse stock',async(t)=>{
 const d=await demo(t);
 const noStaff=await d.post('/planning/manual/preview',{...d.input,workerIds:['w-1']});assert.equal(noStaff.workersReady,false);
 await assert.rejects(d.post(`/planning/plans/${noStaff.draftId}/resources/request`),{code:'STAFFING_INCOMPLETE'});
 // Create a measured large defect, then spread its workload over enough days.
 const newDefect=await d.post('/manual-inspections',{roadId:'road-d001',defectTypeId:'defect-pothole',observedIssue:'Katta maydondagi chuqurchalar',observedDate:d.today,chainageStartM:'0',chainageEndM:'67000',roadElementId:'d001-pavement',exactQuantity:'500.01',unit:'m2',evidence:[]});
 await d.post(`/manual-inspections/${newDefect.id}/submit`);await d.post(`/manual-inspections/${newDefect.id}/decision`,{decision:'VERIFIED',note:'O‘lchandi'});
 const end=new Date(Date.parse(d.today)+8*86400000).toISOString().slice(0,10);
 const plan=await d.post('/planning/manual/preview',{...d.input,sourceDefectId:`defect-${newDefect.id}`,chainageStartM:'0',chainageEndM:'67000',roadElementId:'d001-pavement',exactQuantity:'500.01',scheduledEndDate:end,roadAccess:'OPEN'});
 assert.equal(plan.workersReady,true);assert.equal(plan.resourcesReady,false);
 await d.post(`/planning/plans/${plan.draftId}/resources/request`);
 const req=(await d.get('/resource-requisitions')).items[0];assert.ok(Number(req.shortages[0].missingQuantity)>0);
 await assert.rejects(d.post(`/resource-requisitions/${req.id}/decision`,{decision:'APPROVE',note:'Ta’minlansin'}),{code:'ENGINEER_REQUIRED'});
 await d.role('engineer');await d.post(`/resource-requisitions/${req.id}/decision`,{decision:'APPROVE',note:'Ta’minlansin'});
 assert.equal((await d.post(`/planning/plans/${plan.draftId}/resources/recheck`)).resourcesReady,false);
 await d.post(`/demo/requisitions/${req.id}/receive`);
 assert.equal((await d.post(`/planning/plans/${plan.draftId}/resources/recheck`)).resourcesReady,true);
 await assert.rejects(d.post(`/demo/requisitions/${req.id}/receive`),{code:'RECEIPT_INVALID'});
});

test('partial completed work reopens only its remaining defect quantity',async(t)=>{
 const d=await demo(t);const {orders}=await d.publish({...d.input,roadAccess:'OPEN'});await d.finish(orders[0],.5);
 const options=await d.get('/planning/options?roadId=road-d001');const source=options.sourceDefects.find((s)=>s.id===d.input.sourceDefectId);
 assert.equal(Number(source.measuredQuantity.value),Number(d.input.exactQuantity)/2);
 const excessive=await d.post('/planning/manual/preview',d.input);assert.equal(excessive.resourcesReady,false);
});

test('separate plans keep unique identities; response mutation does not corrupt records; invalid equipment dates rejected',async(t)=>{
 const d=await demo(t);const a=await d.post('/planning/manual/preview',d.input),b=await d.post('/planning/manual/preview',d.input);
 assert.notEqual(a.draftId,b.draftId);a.jobs[0].workName='corrupt';assert.notEqual((await d.get(`/planning/plans/${a.draftId}`)).jobs[0].workName,'corrupt');
 await d.role('foreman');assert.equal((await d.get(`/planning/plans/${a.draftId}`)).canApprove,false);
 const card=await d.get('/workers/w-1/equipment');assert.equal(card.name,'Aziz Shermatov');
 await assert.rejects(d.post('/workers/w-1/equipment',{materialId:'ppe-material-1',stockLocationId:'ppe-stock-1',issuedOn:'2026-02-31',quantity:1}),{code:'ISSUED_ON_INVALID'});
 const issued=await d.post('/workers/w-1/equipment',{materialId:'ppe-material-1',stockLocationId:'ppe-stock-1',issuedOn:'2026-03-31',quantity:1});
 assert.equal((await d.get('/workers/w-1/equipment')).items.find((i)=>i.id===issued.id).expiresOn,'2026-09-30');
});

test('annual programs require budget approval instead of generating unrelated fixture rows',async(t)=>{const d=await demo(t);await assert.rejects(d.post('/annual-programs/generate',{year:Number(d.today.slice(0,4))}),{code:'BUDGET_APPROVAL_REQUIRED'});assert.ok(!(await d.get('/planning/candidates?pageSize=100')).items.some(c=>c.sourceKind==='ANNUAL_PROGRAM'));});

test('future months contain no invented attendance, pagination remains consistent',async(t)=>{
 const d=await demo(t);const sheet=await d.get('/timesheets/monthly?year=2028&month=2');
 assert.equal(sheet.daysInMonth,29);assert.ok(sheet.rows.every((row)=>row.totalMinutes===0&&row.entries.length===0));
 for(let i=0;i<27;i++)await d.post('/planning/manual/preview',d.input);
 const first=await d.get('/planning/plans?page=1&pageSize=25'),second=await d.get('/planning/plans?page=2&pageSize=25');
 assert.equal(first.total,27);assert.equal(first.items.length,25);assert.equal(second.items.length,2);
});

test('intervals prevent double assignment and impossible actual time; explicit zero attendance is retained',async(t)=>{
  const d=await demo(t);const input={...d.input,exactQuantity:'10',endTime:'09:00',roadAccess:'OPEN'};
  const {orders}=await d.publish(input),order=orders[0];
  await d.role('chief');const other=d.options.sourceDefects.find(s=>s.id!==input.sourceDefectId&&s.suggestedWorkVariantIds?.includes('work-pothole'));
  const blocked=await d.post('/planning/manual/preview',{...input,sourceDefectId:other.id,exactQuantity:other.measuredQuantity.value,chainageStartM:other.location.chainageStartM});assert.equal(blocked.workersReady,false);
  await d.role('foreman');await d.post(`/work-orders/${order.id}/start`);
  const payload={completedQuantity:'10',unit:'m2',laborEntries:order.executionResources.workers.map(w=>({workerId:w.id,workDate:w.workDate,actualMinutes:300})),materialUsages:order.executionResources.materials.map(m=>({materialReservationId:m.reservationId,quantity:m.plannedQuantity,usedAt:m.usedAt})),equipmentUsages:order.executionResources.equipment.map(e=>({equipmentReservationId:e.reservationId,usageDate:e.usageDate,actualMachineMinutes:30})),evidence:[]};
  await assert.rejects(d.post(`/work-orders/${order.id}/complete`,payload),{code:'LABOR_INVALID'});
  const absent=order.executionResources.workers.find(w=>w.role!=='OPERATOR').id;
  payload.laborEntries.forEach(entry=>entry.actualMinutes=entry.workerId===absent?0:50);
  const badDate=structuredClone(payload);badDate.materialUsages[0].usedAt='2099-01-01T08:00:00+05:00';await assert.rejects(d.post(`/work-orders/${order.id}/complete`,badDate),{code:'RESOURCE_DATE_INVALID'});
  const completed=await d.post(`/work-orders/${order.id}/complete`,payload);assert.equal(completed.completion.workerMinutes.find(w=>w.workerId===absent).minutes,0);
});

test('payroll overrides reconcile with act, frozen Excel and supplemental monthly acts',async(t)=>{
  const d=await demo(t),period=d.today.slice(0,7);const {orders}=await d.publish(d.input);await d.finish(orders[0]);
  const wage=await d.post('/payroll/preview',{divisionId:'e2e-division',period,policyReference:'Sinov hisobi',adjustments:[{workerId:'w-1',salaryCoefficient:'1.25',seniorityRateBps:1000,additionalRateBps:1500,mealAmountUzs:'25000.01',bonusRateBps:2500,trafficMonthlyBaseUzs:'2000000',holidayAmountUzs:'100000',incomeTaxAmountUzs:'1000',unionFeeAmountUzs:'100',advanceAmountUzs:'10000',otherDeductionAmountUzs:'0',deductionsConfirmed:true}]});
  const act=await d.post('/monthly-completion-acts',{divisionId:'e2e-division',actMonth:`${period}-01`});
  assert.equal(act.laborAmountUzs,wage.totals.grossAmountUzs);
  assert.equal((Number(act.laborAmountUzs)+Number(act.socialAmountUzs)).toFixed(2),wage.totals.employerCostAmountUzs);
  const payrollReport=await d.get(`/reports/excel-data?id=${wage.id}`);assert.equal(payrollReport.payroll.rows.find(r=>r.workerId==='w-1').deductionsAmountUzs,'11100.00');assert.equal((await d.get(`/reports/excel-data?period=${period}`)).payroll.totals.grossAmountUzs,wage.totals.grossAmountUzs);
  const report=await d.get(`/reports/excel-data?id=${act.id}`);assert.equal(report.works[0].quantity,Number(d.input.exactQuantity));assert.equal(report.works[0].normHours,16/60);
  const moduleDir=fs.mkdtempSync(path.join(os.tmpdir(),'roadops-excel-code-'));t.after(()=>fs.rmSync(moduleDir,{recursive:true,force:true}));
  await build({entryPoints:['src/lib/excel/export-workbook.ts'],outfile:path.join(moduleDir,'export.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});const {reportWorkbook}=await import(pathToFileURL(path.join(moduleDir,'export.mjs')).href);localStorage.setItem('roadops-script','cyrl');
  const bytes=reportWorkbook(report,'act');const entries=new Map();let offset=0;const view=new DataView(bytes.buffer);while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;entries.set(new TextDecoder().decode(bytes.slice(offset+30,offset+30+nameLength)),new TextDecoder().decode(bytes.slice(start,start+size)));offset=start+size;}
  const workbook=entries.get('xl/workbook.xml');for(const name of ['Харажат','ММФ','Материал','Ф2-Сақлаш','Умумий харажат','Табель'])assert.ok(workbook.includes(name));assert.ok(workbook.includes('activeTab="3"'));
  const f2=entries.get('xl/worksheets/sheet4.xml');assert.ok(f2.includes('E12*F12'));assert.ok(f2.includes('0.26666666666666666'));
  const pay=entries.get('xl/worksheets/sheet1.xml');assert.ok(pay.includes('SUMIF'));assert.equal(Number(pay.match(new RegExp(`<c r="R${11+report.payroll.rows.length}"[^>]*>.*?<v>([^<]+)</v>`))[1]),Number(wage.totals.grossAmountUzs));assert.ok(!pay.includes('I249'));assert.ok(pay.includes('Овқат пули'));assert.ok(pay.includes('AD2'));assert.ok(pay.includes('AE$2'));const basis=entries.get('xl/worksheets/sheet7.xml');assert.ok(basis.includes('G2*AD2*E2/F2'));assert.ok(basis.includes('SUM(N2:Y2,AE2)'));
  for(const xml of entries.values()){assert.ok(!xml.includes('__TITLE__'));assert.ok(!xml.includes('__CELL__'));assert.ok(!xml.includes('#REF!'));}
  assert.ok(entries.get('xl/workbook.xml').includes('_xlnm.Print_Titles'));
  assert.ok(entries.get('xl/worksheets/sheet4.xml').includes('s="36"'));
  assert.ok(entries.get('xl/worksheets/sheet4.xml').includes('headerFooter'));
  assert.ok(entries.get('xl/worksheets/sheet4.xml').includes('DAL-'));
  if(process.env.ROADOPS_EXCEL_TEST_OUTPUT){fs.mkdirSync(process.env.ROADOPS_EXCEL_TEST_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.ROADOPS_EXCEL_TEST_OUTPUT,'sample-act.xlsx'),bytes);fs.writeFileSync(path.join(process.env.ROADOPS_EXCEL_TEST_OUTPUT,'sample-payroll.xlsx'),reportWorkbook(payrollReport,'payroll'));fs.writeFileSync(path.join(process.env.ROADOPS_EXCEL_TEST_OUTPUT,'sample-report.json'),JSON.stringify(report));}
  await d.post(`/monthly-completion-acts/${act.id}/submit`);
  const source2=d.options.sourceDefects.find(s=>s.id!==d.input.sourceDefectId&&s.suggestedWorkVariantIds?.includes('work-pothole'));
  const second=await d.publish({...d.input,sourceDefectId:source2.id,exactQuantity:source2.measuredQuantity.value,chainageStartM:source2.location.chainageStartM,startTime:'16:00',endTime:'18:00'});await d.finish(second.orders[0]);
  const extra=await d.post('/monthly-completion-acts',{divisionId:'e2e-division',actMonth:`${period}-01`});assert.notEqual(extra.id,act.id);assert.equal(extra.items.length,1);assert.equal(extra.items[0].workOrderId,second.orders[0].id);
  const extraReport=await d.get(`/reports/excel-data?id=${extra.id}`);assert.equal(extraReport.payroll.rows.flatMap(r=>r.segments).reduce((sum,s)=>sum+s.holiday,0),0,'fixed monthly payment must not repeat in supplement');assert.equal(extraReport.payroll.rows.flatMap(r=>r.segments).reduce((sum,s)=>sum+s.meal,0),0,'meal payment must not repeat');
  assert.deepEqual((await d.get(`/reports/excel-data?id=${act.id}`)).payroll,report.payroll,'old act calculation must remain frozen');
  const whole=await d.get(`/reports/excel-data?period=${period}`);
  assert.equal(Number(whole.payroll.totals.grossAmountUzs).toFixed(2),(Number(act.laborAmountUzs)+Number(extra.laborAmountUzs)).toFixed(2));
  const ledger=await d.get(`/cost-ledger?period=${period}`);
  assert.equal(ledger.totals.labor,whole.payroll.totals.grossAmountUzs);
  assert.ok(ledger.rows.every(row=>row.workOrderId&&row.rateId&&row.source&&row.verifiedBy));
  assert.equal(whole.timesheet.length,d.options.workers.length,'Excel keeps workers with no attendance');
});

test('correction preserves old actuals and settles unused stock only once after verification',async(t)=>{
 const d=await demo(t),period=d.today.slice(0,7),{orders}=await d.publish({...d.input,roadAccess:'OPEN'}),order=orders[0];
 await d.role('foreman');await d.post(`/work-orders/${order.id}/start`);
 const payload={completedQuantity:order.exactQuantity.value,unit:order.exactQuantity.unit,laborEntries:order.executionResources.workers.map(w=>({workerId:w.id,workDate:w.workDate,actualMinutes:w.plannedMinutes})),materialUsages:order.executionResources.materials.map(m=>({materialReservationId:m.reservationId,quantity:String(Number(m.plannedQuantity)/2),usedAt:m.usedAt})),equipmentUsages:order.executionResources.equipment.map(e=>({equipmentReservationId:e.reservationId,usageDate:e.usageDate,actualMachineMinutes:e.plannedMachineMinutes})),evidence:[],note:'Haqiqiy sarf qaydi'};
 const operator=payload.laborEntries.find(e=>order.executionResources.workers.find(w=>w.id===e.workerId)?.role==='OPERATOR');
 const bad=structuredClone(payload);bad.laborEntries.find(e=>e.workerId===operator.workerId).actualMinutes=0;
 await assert.rejects(d.post(`/work-orders/${order.id}/complete`,bad),{code:'OPERATOR_TIME_REQUIRED'});
 await d.post(`/work-orders/${order.id}/complete`,payload);
 const pending=await d.get(`/cost-ledger?period=${period}`);assert.equal(pending.rows.length,0);assert.ok(pending.machines.some(m=>m.actualMinutes>0&&m.amount===null));
 await assert.rejects(d.post(`/work-orders/${order.id}/return`,{note:'Qayta o‘lchang'}),{code:'CHIEF_REQUIRED'});
 await d.role('chief');const returned=await d.post(`/work-orders/${order.id}/return`,{note:'Material qaydini aniqlashtiring'});
 assert.equal(returned.state,'IN_PROGRESS');assert.equal(returned.correctionHistory.length,1);assert.equal(returned.correctionHistory[0].completion.materials[0].quantity,payload.materialUsages[0].quantity);
 await d.role('foreman');payload.materialUsages[0].quantity='0';payload.note='Material sarflanmadi; avvalgi qayd xato';await d.post(`/work-orders/${order.id}/complete`,payload);
 await d.role('chief');await d.post(`/work-orders/${order.id}/verify`,{note:'Qayta tekshirildi'});
 const verified=await d.get(`/work-orders/${order.id}`);assert.equal(verified.correctionHistory.length,1);assert.equal(verified.materialReturnSettled,true);
 await assert.rejects(d.post(`/work-orders/${order.id}/return`,{note:'Yana tuzatish'}));
 const ledger=await d.get(`/cost-ledger?period=${period}`);assert.ok(!ledger.rows.some(r=>r.kind==='material'));assert.ok(ledger.audit.some(a=>a.action.includes('qaytardi')));
});

test('stale act requires recalculation while prior payroll adjustments remain retrievable',async(t)=>{
 const d=await demo(t),period=d.today.slice(0,7);const {orders}=await d.publish(d.input);await d.finish(orders[0]);
 const act=await d.post('/monthly-completion-acts',{divisionId:'e2e-division',actMonth:period+'-01'});
 const payroll=await d.post('/payroll/preview',{divisionId:'e2e-division',period,policyReference:'Yangilangan ustama',adjustments:[{workerId:'w-1',holidayAmountUzs:'50000'}]});
 await assert.rejects(d.post(`/monthly-completion-acts/${act.id}/submit`),{code:'ACT_STALE'});
 const history=await d.get(`/payroll/history?period=${period}`),saved=await d.get(`/payroll/${history.items[0].id}`);assert.equal(saved.rows.find(r=>r.workerId==='w-1').adjustments.holidayAmountUzs,'50000');
 const refreshed=await d.post('/monthly-completion-acts',{divisionId:'e2e-division',actMonth:period+'-01'});assert.equal(refreshed.id,act.id);assert.equal(refreshed.laborAmountUzs,payroll.totals.grossAmountUzs);
 await d.role('engineer');await assert.rejects(d.post(`/monthly-completion-acts/${act.id}/submit`),{code:'ACT_SUBMIT_FORBIDDEN'});await d.role('chief');await d.post(`/monthly-completion-acts/${act.id}/submit`);
});

test('financial and planning writes respect roles and invalid tariffs cannot enter calculations',async(t)=>{
 const d=await demo(t),period=d.today.slice(0,7);const rate=(await d.get('/cost-rates?pageSize=100')).items.find(r=>r.rateKind==='labor');
 const input={...rate,targetId:rate.target.id,divisionId:'e2e-division',sourceReference:'Sinov',effectiveFrom:period+'-01',effectiveUntil:'2030-01-01'};
 for(const patch of [{rateAmountUzs:'NaN'},{rateAmountUzs:'Infinity'},{effectiveUntil:period+'-01'},{effectiveFrom:'2026-02-30'},{bonusRateBps:-1},{divisionId:'another-division'},{pricingUnit:'kg'},{rateBasis:'machine_hour'}])await assert.rejects(d.post('/cost-rates',{...input,...patch}),{code:'INVALID_COST_RATE'});
 await assert.rejects(d.post('/monthly-completion-acts',{divisionId:'another-division',actMonth:period+'-01'}),{code:'INVALID_ACT_MONTH'});
 await assert.rejects(d.post('/monthly-work-time-norms',{divisionId:'e2e-division',workMonth:period+'-01',workingDays:NaN,normMinutes:9240,scheduleCode:'ROAD_7H',sourceReference:'Sinov'}),{code:'INVALID_MONTHLY_TIME_NORM'});
 const user=await d.role('foreman');assert.ok(!user.permissions.includes('system.all'));assert.ok(!user.permissions.includes('costs.manage'));
 await assert.rejects(d.post('/payroll/preview',{divisionId:'e2e-division',period,policyReference:'Sinov',adjustments:[]}),{code:'ROLE_FORBIDDEN'});
 await assert.rejects(d.post('/planning/preview',{candidateIds:[d.input.sourceDefectId],dateFrom:d.today,dateTo:d.today}),{code:'ROLE_FORBIDDEN'});
});

test('changed approved crew must be reviewed again and published assignments match that review',async(t)=>{
 const d=await demo(t);const source=d.options.sourceDefects.find(s=>s.id!==d.input.sourceDefectId&&s.suggestedWorkVariantIds?.includes('work-pothole'));
 const plan=await d.post('/planning/manual/preview',{...d.input,sourceDefectId:source.id,exactQuantity:source.measuredQuantity.value,chainageStartM:source.location.chainageStartM,startTime:'16:00',endTime:'18:00',roadAccess:'OPEN'});
 await d.role('chief');await d.post(`/planning/plans/${plan.draftId}/approve`);
 const {orders}=await d.publish(d.input),order=orders[0];await d.role('foreman');await d.post(`/work-orders/${order.id}/start`);
 await d.post(`/work-orders/${order.id}/complete`,{completedQuantity:order.exactQuantity.value,unit:order.exactQuantity.unit,laborEntries:order.executionResources.workers.map(w=>({workerId:w.id,workDate:w.workDate,actualMinutes:w.id==='w-1'?380:0})),materialUsages:order.executionResources.materials.map(m=>({materialReservationId:m.reservationId,usedAt:m.usedAt,quantity:m.plannedQuantity})),equipmentUsages:order.executionResources.equipment.map(e=>({equipmentReservationId:e.reservationId,usageDate:e.usageDate,actualMachineMinutes:0})),evidence:[]});
 await d.role('chief');await assert.rejects(d.post(`/planning/plans/${plan.draftId}/publish`),{code:'PLAN_REAPPROVAL_REQUIRED'});
 const changed=await d.get(`/planning/plans/${plan.draftId}`);assert.equal(changed.state,'AWAITING_APPROVAL');assert.notDeepEqual(changed.workerMinutesRemaining.map(w=>w.workerId),plan.workerMinutesRemaining.map(w=>w.workerId));
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 const generated=(await d.get('/work-orders?pageSize=100')).items.find(o=>o.id.includes(plan.draftId));assert.deepEqual(generated.executionResources.workers.map(w=>w.id).sort(),changed.workerMinutesRemaining.map(w=>w.workerId).sort());
});


test('employee worksheet is read-only; coefficient and separate monthly payments reconcile to saved payroll',async(t)=>{
 const d=await demo(t),period=d.today.slice(0,7);
 const empty=await d.get('/payroll/worksheet?period=2028-02');assert.equal(empty.snapshot,null);assert.equal(empty.workers.length,d.options.workers.length);
 assert.equal((await d.get('/payroll/history?period=2028-02')).items.length,0);
 const {orders}=await d.publish({...d.input,workSelectionSource:'ALGORITHM'});assert.equal(orders[0].sourceDefectId,d.input.sourceDefectId);await d.finish(orders[0]);
 const sheet=await d.get(`/payroll/worksheet?period=${period}`);assert.ok(sheet.snapshot);assert.equal((await d.get(`/payroll/history?period=${period}`)).items.length,0);
 const adjustments=[{workerId:'w-1',salaryCoefficient:'1.5',bonusRateBps:0,seniorityRateBps:1000,additionalRateBps:2000,trafficAllowanceRateBps:0,travelAllowanceRateBps:0,holidayAmountUzs:'50000',mealAmountUzs:'30000.01'}];
 const payroll=await d.post('/payroll/preview',{divisionId:'e2e-division',period,policyReference:'Boshliq buyrug‘i',adjustments});
 const row=payroll.rows.find(r=>r.workerId==='w-1'),segment=row.segments[0],round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const base=round(segment.monthlySalary*1.5*segment.minutes/segment.normMinutes);assert.equal(Number(row.baseWageAmountUzs),base);
 assert.equal(Number(row.grossAmountUzs),round(base+round(base*.1)+round(base*.2)+80000.01));
 assert.equal(segment.meal,30000.01);assert.equal(segment.salaryCoefficient,1.5);
 const stored=await d.get(`/payroll/${payroll.id}`);assert.equal(stored.rows.find(r=>r.workerId==='w-1').adjustments.mealAmountUzs,'30000.01');
 for(const coefficient of [0,-1,Infinity,'bad'])await assert.rejects(d.post('/payroll/preview',{divisionId:'e2e-division',period,policyReference:'Xato',adjustments:[{workerId:'w-1',salaryCoefficient:coefficient}]}),{code:'PAYROLL_AMOUNT_INVALID'});
});

test('foreman records, chief verifies and issues; a suggestion alone never creates an order',async(t)=>{
 const d=await demo(t);await d.role('foreman');
 const body={roadId:'road-d001',defectTypeId:'defect-pothole',observedIssue:'Sinov chuqurchasi',observedDate:d.today,chainageStartM:'0',chainageEndM:'67000',roadElementId:'d001-pavement',exactQuantity:'4',unit:'m2'};
 await assert.rejects(d.post('/manual-inspections',{...body,exactQuantity:'NaN'}),{code:'INSPECTION_INPUT_INVALID'});
 const record=await d.post('/manual-inspections',body);await d.post(`/manual-inspections/${record.id}/submit`);
 await assert.rejects(d.post(`/manual-inspections/${record.id}/decision`,{decision:'VERIFIED'}),{code:'CHIEF_REQUIRED'});
 await d.role('chief');await d.post(`/manual-inspections/${record.id}/decision`,{decision:'VERIFIED',note:'O‘lchov tekshirildi'});
 const source=(await d.get('/planning/options?roadId=road-d001')).sourceDefects.find(s=>s.id===`defect-${record.id}`);assert.equal(source.defectTypeId,'defect-pothole');assert.deepEqual(source.suggestedWorkVariantIds,[],'patch dimensions must be confirmed before choosing a source norm');
 const count=(await d.get('/work-orders?pageSize=100')).total;
 const plan=await d.post('/planning/manual/preview',{...d.input,sourceDefectId:source.id,chainageStartM:'0',chainageEndM:'67000',roadElementId:'d001-pavement',exactQuantity:'4',workSelectionSource:'ALGORITHM',roadAccess:'OPEN'});
 assert.equal((await d.get('/work-orders?pageSize=100')).total,count);assert.equal(plan.workSelectionSource,'ALGORITHM');
 await assert.rejects(d.post(`/planning/plans/${plan.draftId}/publish`),{code:'PLAN_PUBLISH_REJECTED'});
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 const order=(await d.get('/work-orders?pageSize=100')).items.find(o=>o.planId===plan.draftId);assert.ok(order);
 await assert.rejects(d.post(`/work-orders/${order.id}/start`),{code:'FOREMAN_REQUIRED'});await d.finish(order);
 assert.equal((await d.get('/defects?state=CLOSED')).items.some(x=>x.id===source.id),true);
});

test('full source catalog retains every section, unique row identities, base quantities and uncertainty',async(t)=>{
 const d=await demo(t),catalog=d.options.workVariants.filter(w=>w.catalogSeries);
 assert.equal(catalog.length,578);assert.equal(new Set(catalog.map(w=>w.id)).size,catalog.length);
 assert.equal(new Set(catalog.filter(w=>w.catalogSeries==='TIME').map(w=>w.iqnTopicId)).size,29);
 const wash=catalog.find(w=>w.id==='iqn02-t12-r23');assert.equal(wash.normBasisQuantity,100);assert.equal(wash.laborMinutesPerUnit,0.354);
 const patch=catalog.find(w=>w.id==='iqn02-t2-r4');assert.equal(patch.laborMinutesPerUnit,39.6);
 const plan=await d.post('/planning/manual/preview',{...d.input,workVariantId:'iqn02-t2-r6',exactQuantity:'4'});
 assert.equal(plan.canApprove,false,'unknown material demands must block manual as well as AI work');
 assert.equal(plan.resourcesReady,false);
 assert.ok(plan.blockers.some(b=>b.code==='RESOURCE_RECIPE_MISSING'));
 const unresolved=catalog.find(w=>w.normIssue);
 await assert.rejects(d.post('/planning/manual/preview',{...d.input,workVariantId:unresolved.id}),{code:'NORM_SELECTION_REQUIRED'});
});

test('source ranges require a chosen value and preserve it through publication',async(t)=>{
 const d=await demo(t),work=d.options.workVariants.find(w=>w.catalogSeries==='TIME'&&w.unit==='m2'&&w.normRange&&!w.normIssue);
 assert.ok(work);
 await assert.rejects(d.post('/planning/manual/preview',{...d.input,workVariantId:work.id}),{code:'NORM_SELECTION_REQUIRED'});
 await assert.rejects(d.post('/planning/manual/preview',{...d.input,workVariantId:work.id,selectedNormHours:work.normRange[1]+1}),{code:'NORM_SELECTION_REQUIRED'});
 const plan=await d.post('/planning/manual/preview',{...d.input,workVariantId:work.id,exactQuantity:'1',selectedNormHours:work.normRange[0],resourcePlan:{workVariantId:work.id,basisQuantity:'1',note:'Sinov: faqat mehnat me’yori oralig‘ini tekshirish',materials:{mode:'NONE',items:[]},machines:{mode:'NONE',items:[]}}});
 assert.equal(plan.resourcesReady,true,JSON.stringify(plan.blockers));
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 assert.equal((await d.get(`/planning/plans/${plan.draftId}`)).state,'PUBLISHED');
});

test('source resource estimate requests and assigns each exact material and machine',async(t)=>{
 const d=await demo(t),work=d.options.workVariants.find(w=>w.code==='27-14-023-01');
 assert.equal(work.laborMinutesPerUnit,55.944);
 const plan=await d.post('/planning/manual/preview',{...d.input,workVariantId:work.id,exactQuantity:'4',roadAccess:'OPEN'});
 assert.equal(plan.workersReady,true);assert.equal(plan.resourcesReady,false);
 await d.post(`/planning/plans/${plan.draftId}/resources/request`);
 const req=(await d.get('/resource-requisitions?pageSize=100')).items.find(r=>r.planId===plan.draftId);
 assert.equal(req.shortages.filter(s=>s.resourceKind==='MATERIAL').length,2);
 assert.equal(req.shortages.filter(s=>s.resourceKind==='EQUIPMENT').length,5);
 await d.role('engineer');await d.post(`/resource-requisitions/${req.id}/decision`,{decision:'APPROVE',note:'Ta’minlash'});
 await d.post(`/demo/requisitions/${req.id}/receive`);
 await d.role('chief');await d.post(`/planning/plans/${plan.draftId}/resources/recheck`);
 const ready=await d.get(`/planning/plans/${plan.draftId}`);assert.equal(ready.resourcesReady,true,JSON.stringify(ready.blockers));
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 const order=(await d.get('/work-orders?pageSize=100')).items.find(o=>o.planId===plan.draftId);
 assert.equal(order.executionResources.materials.length,2);assert.equal(order.executionResources.equipment.length,5);
 const asphalt=order.executionResources.materials.find(m=>m.name.toLowerCase().includes('asfalt'));assert.ok(asphalt);assert.equal(Number(asphalt.plannedQuantity),0.468);
});

test('small shoulder work is not blocked by a hardcoded crew of four',async(t)=>{
 const d=await demo(t),source=d.options.sourceDefects.find(s=>s.suggestedWorkVariantIds?.includes('work-shoulder'));
 const plan=await d.post('/planning/manual/preview',{...d.input,sourceDefectId:source.id,workVariantId:'work-shoulder',exactQuantity:source.measuredQuantity.value,chainageStartM:source.location.chainageStartM,roadAccess:'OPEN'});
 assert.equal(plan.workersReady,true,JSON.stringify(plan.blockers));
 assert.equal(plan.canApprove,true);
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 assert.equal((await d.get(`/planning/plans/${plan.draftId}`)).state,'PUBLISHED');
});

test('IQN defect taxonomy separates observations, fixes units, and preserves action-specific mappings',async(t)=>{
 const d=await demo(t),options=await d.get('/manual-inspections/options');
 const defects=options.defectTypes.filter(x=>x.observationKind==='DEFECT'),services=options.defectTypes.filter(x=>x.observationKind==='SERVICE_REQUEST');
 assert.equal(defects.length,53);assert.equal(services.length,4);
 assert.equal(new Set(options.defectTypes.map(x=>x.iqnTopicNumber)).size,29);
 for(const type of options.defectTypes)for(const id of type.candidateWorkIds){const work=d.options.workVariants.find(w=>w.id===id);assert.ok(work,id);assert.equal(work.unit,type.unit);}
 const dirty=defects.find(x=>x.id==='defect-sign-dirty'),damaged=defects.find(x=>x.id==='defect-sign');
 assert.equal(dirty.unit,'dona');assert.notDeepEqual(dirty.candidateWorkIds,damaged.candidateWorkIds);
 const record=await d.post('/manual-inspections',{roadId:'road-d001',defectTypeId:dirty.id,observedIssue:dirty.name,observedDate:d.today,chainageStartM:'0',chainageEndM:'67000',roadElementId:'d001-sign',exactQuantity:'2',unit:'dona'});
 await d.post(`/manual-inspections/${record.id}/submit`);await d.post(`/manual-inspections/${record.id}/decision`,{decision:'VERIFIED'});
 const proposal=await d.post('/planning/ai/recommendation',{sourceDefectId:`defect-${record.id}`,scheduledDate:d.today});
 assert.equal(proposal.input.workVariantId,'iqn02-t12-r23');assert.equal(proposal.preview.resourcesReady,false);
 assert.ok(proposal.preview.blockers.some(b=>b.code==='RESOURCE_RECIPE_MISSING'),'missing resource recipe cannot mean zero resource demand');
 const plan=await d.post('/planning/manual/preview',proposal.input);
 await assert.rejects(d.post(`/planning/plans/${plan.draftId}/approve`),{code:'PLAN_APPROVAL_REJECTED'});
});

test('AI demo prepares measured source work, duration, crew and resources without dispatching it',async(t)=>{
 const d=await demo(t),before=(await d.get('/work-orders?pageSize=100')).total;
 const record=await d.post('/manual-inspections',{roadId:'road-d001',defectTypeId:'defect-pothole',observedIssue:'4 m² chuqurchalar',observedDate:d.today,chainageStartM:'0',chainageEndM:'67000',roadElementId:'d001-pavement',exactQuantity:'4',unit:'m2'});
 await d.post(`/manual-inspections/${record.id}/submit`);await d.post(`/manual-inspections/${record.id}/decision`,{decision:'VERIFIED'});
 const request={sourceDefectId:`defect-${record.id}`,scheduledDate:d.today};
 const missing=await d.post('/planning/ai/recommendation',request);assert.equal(missing.status,'NEEDS_MEASUREMENT');assert.equal(missing.input,null);assert.equal(missing.missingFields.length,3);
 const impossible=await d.post('/planning/ai/recommendation',{...request,parameters:{repairThicknessMm:50,largestPatchAreaM2:5,removeOldPavement:true}});assert.equal(impossible.input,null);
 const params={repairThicknessMm:50,largestPatchAreaM2:1,removeOldPavement:true};
 const proposal=await d.post('/planning/ai/recommendation',{...request,parameters:params});
 assert.equal(proposal.mode,'DEMO_RULES');assert.equal(proposal.input.workVariantId,'iqn02-r-27-14-023-01-t45');assert.equal(proposal.input.workSelectionSource,'AI_DEMO');assert.deepEqual(proposal.input.defectParameters,params);
 assert.ok(proposal.preview.workersReady);assert.ok(proposal.preview.workerMinutesRemaining.length>0);assert.ok(proposal.preview.resourceChecks.some(c=>c.kind==='MATERIALS'));
 assert.equal((await d.get('/work-orders?pageSize=100')).total,before);
 const plan=await d.post('/planning/manual/preview',proposal.input);
 await assert.rejects(d.post(`/planning/plans/${plan.draftId}/publish`),{code:'PLAN_PUBLISH_REJECTED'});
 await d.post(`/planning/plans/${plan.draftId}/resources/request`);const req=(await d.get('/resource-requisitions')).items.find(r=>r.planId===plan.draftId);assert.ok(req);
 await d.role('engineer');await d.post(`/resource-requisitions/${req.id}/decision`,{decision:'APPROVE',note:'Namuna ta’minoti'});await d.post(`/demo/requisitions/${req.id}/receive`);
 await d.role('chief');assert.equal((await d.post(`/planning/plans/${plan.draftId}/resources/recheck`)).resourcesReady,true);
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 const orders=(await d.get('/work-orders?pageSize=100')).items.filter(o=>o.planId===plan.draftId);assert.ok(orders.length);assert.ok(orders.every(o=>o.state==='ASSIGNED'));
 await d.role('foreman');await assert.rejects(d.post('/planning/ai/recommendation',request),{code:'ROLE_FORBIDDEN'});
});

test('RoadVision intake is repeatable, keeps observations unmeasured and allows chief to correct type',async(t)=>{
 const d=await demo(t),before=(await d.get('/planning/options?roadId=road-d001')).sourceDefects.length;
 assert.deepEqual(await d.post('/roadvision/demo/import'),{added:6,duplicates:0});
 assert.deepEqual(await d.post('/roadvision/demo/import'),{added:0,duplicates:6});
 const findings=(await d.get('/roadvision/findings?state=PENDING_REVIEW')).items.filter(f=>f.id.startsWith('rv-demo-iqn-v1'));
 assert.equal(findings.length,6);assert.ok(findings.every(f=>f.simulation&&f.recordKind==='DEFECT_CANDIDATE'&&f.quantityStatus==='MISSING'&&!f.measuredQuantity&&!f.evidence.length));
 assert.equal((await d.get('/planning/options?roadId=road-d001')).sourceDefects.length,before);
 const item=findings.find(f=>f.defectTypeId==='defect-crack');
 await assert.rejects(d.post(`/roadvision/findings/${item.id}/decision`,{decision:'VERIFIED',measuredQuantity:{value:'2',unit:'m2'}}),{code:'DEFECT_UNIT_MISMATCH'});
 const inventory=await d.get('/asset-inventory');const sign=inventory.roads[0].assets.find(a=>a.id==='d001-sign');sign.quantity=2;sign.chainageStartM=item.chainageStartM;sign.chainageEndM=item.chainageEndM??item.chainageStartM;await d.post('/asset-inventory',inventory);
 const updated=await d.post(`/roadvision/findings/${item.id}/decision`,{decision:'VERIFIED',defectTypeId:'defect-sign-dirty',measuredQuantity:{value:'2',unit:'dona'},note:'Sinovda turi va o‘lchovi tuzatildi'});
 assert.equal(updated.quantityStatus,'FIELD_VERIFIED');assert.equal(updated.defectTypeId,'defect-sign-dirty');
 const source=(await d.get('/planning/options?roadId=road-d001')).sourceDefects.find(s=>s.id===`defect-${item.id}`);
 assert.equal(source.defectTypeId,'defect-sign-dirty');assert.equal(source.measuredQuantity.unit,'dona');
 assert.equal(source.observationText,item.attributeName);assert.equal(source.reviewerNote,'Sinovda turi va o‘lchovi tuzatildi');
 assert.deepEqual(source.suggestedWorkVariantIds,['iqn02-t12-r23']);
 await assert.rejects(d.post(`/roadvision/findings/${item.id}/decision`,{decision:'VERIFIED',measuredQuantity:{value:'2',unit:'dona'}}),{code:'REVIEW_STATE_INVALID'});
});

test('missing resource assessment resolves through supply and preserves exact machine time across days',async(t)=>{
 const d=await demo(t),work=d.options.workVariants.find(w=>w.id==='iqn02-t2-r6');
 const sample=d.options.workVariants.find(w=>w.code==='27-14-023-01'),material=sample.resources.find(r=>r.kind==='material'),machine=sample.resources.find(r=>r.kind==='machine');
 const normalize=u=>u.trim().toLowerCase().replaceAll('м','m').replace(/^тн?$/,'t');
 const profile={workVariantId:work.id,basisQuantity:'4',note:'Boshliq kiritgan sinov texnologik kartasi',materials:{mode:'REQUIRED',items:[{key:`material:${material.code}:${normalize(material.unit)}`,quantity:'0.1'}]},machines:{mode:'REQUIRED',items:[{key:`machine:${machine.code}:soat`,quantity:'2'}]}};
 const end=new Date(Date.parse(d.today)+86400000).toISOString().slice(0,10);
 const input={...d.input,workVariantId:work.id,exactQuantity:'4',scheduledEndDate:end,resourcePlan:profile,operatorHoursPerUnit:.5,operatorBasis:'Sinov texnologik kartasi: 2 operator-soat / 4 m2'};
 const invalid=await d.post('/planning/manual/preview',{...input,resourcePlan:{...profile,materials:{mode:'REQUIRED',items:[]}}});assert.equal(invalid.resourcesReady,false);
 const plan=await d.post('/planning/manual/preview',input);assert.ok(!plan.blockers.some(b=>b.code==='RESOURCE_RECIPE_MISSING'));assert.equal(plan.workersReady,true);
 await d.post(`/planning/plans/${plan.draftId}/resources/request`);const request=(await d.get('/resource-requisitions')).items.find(r=>r.planId===plan.draftId);
 assert.equal(request.shortages.filter(r=>r.resourceKind==='MATERIAL').length,1);assert.equal(Number(request.shortages[0].missingQuantity),.1);
 await d.role('engineer');await d.post(`/resource-requisitions/${request.id}/decision`,{decision:'APPROVE',note:'Ta’minlansin'});await d.post(`/demo/requisitions/${request.id}/receive`);
 const warehouse=(await d.get('/resources/warehouse')).items;assert.ok(warehouse.some(r=>r.id===request.shortages[0].resourceId&&r.detail.includes('0.100')));
 await d.role('chief');assert.equal((await d.post(`/planning/plans/${plan.draftId}/resources/recheck`)).resourcesReady,true);
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 const orders=(await d.get('/work-orders?pageSize=100')).items.filter(o=>o.planId===plan.draftId);assert.equal(orders.length,2);
 assert.equal(orders.reduce((s,o)=>s+o.executionResources.equipment[0].plannedMachineMinutes,0),120);
 assert.equal(orders.reduce((s,o)=>s+Number(o.executionResources.materials[0].plannedQuantity),0),.1);
 assert.deepEqual(await d.get(`/planning/plans/${plan.draftId}/input`),input);
});

test('editing a draft cancels its stale requisition and changing selection mode cannot bypass resource checks',async(t)=>{
 const d=await demo(t),work=d.options.workVariants.find(w=>w.code==='27-14-023-01');
 const input={...d.input,workVariantId:work.id,exactQuantity:'4'},plan=await d.post('/planning/manual/preview',input);
 await d.post(`/planning/plans/${plan.draftId}/resources/request`);const req=(await d.get('/resource-requisitions')).items.find(r=>r.planId===plan.draftId);
 await d.role('engineer');await d.post(`/resource-requisitions/${req.id}/decision`,{decision:'APPROVE',note:'Ta’minot'});
 await d.role('chief');await d.post('/planning/manual/preview',{...input,exactQuantity:'2',replacesDraftId:plan.draftId});
 assert.equal((await d.get('/resource-requisitions')).items.find(r=>r.id===req.id).status,'CANCELLED');
 await d.role('engineer');await assert.rejects(d.post(`/demo/requisitions/${req.id}/receive`),{code:'RECEIPT_INVALID'});
 await d.role('chief');await d.post(`/planning/plans/${plan.draftId}/resources/request`);
 const revised=(await d.get('/resource-requisitions')).items.find(r=>r.planId===plan.draftId&&r.status==='SUBMITTED');assert.ok(revised);assert.notEqual(revised.id,req.id);
 const timeWork=d.options.workVariants.find(w=>w.id==='iqn02-t2-r4');
 for(const mode of ['MANUAL','AI_DEMO'])assert.equal((await d.post('/planning/manual/preview',{...input,workVariantId:timeWork.id,workSelectionSource:mode})).resourcesReady,false);
});

test('AI searches a free later date and material inventory distinguishes mass from volume',async(t)=>{
 const d=await demo(t);
 await d.publish(d.input);
 const other=d.options.sourceDefects.find(s=>s.id!==d.input.sourceDefectId&&s.suggestedWorkVariantIds?.includes('work-pothole'));
 const rec=await d.post('/planning/ai/recommendation',{sourceDefectId:other.id,scheduledDate:d.today,parameters:{repairThicknessMm:50,largestPatchAreaM2:1,removeOldPavement:true}});
 assert.equal(rec.preview.workersReady,true);assert.ok(rec.input.scheduledDate>d.today);assert.ok(rec.explanation.includes(rec.input.scheduledDate));
 const materials=(await d.get('/resources/materials')).items.filter(r=>r.code==='43111');
 assert.equal(materials.length,2);assert.equal(new Set(materials.map(r=>r.id)).size,2);assert.deepEqual(new Set(materials.map(r=>r.detail)),new Set(['m3','t']));
});


test('automatic TIME resource recipe scales once and reaches requisition, warehouse and daily orders',async(t)=>{
 const d=await demo(t),work=d.options.workVariants.find(w=>w.id==='iqn02-t2-r4');
 const recipe=d.options.workVariants.find(w=>w.code==='27-14-023-01');
 assert.equal(d.resources.automaticResourceRecipe(work,d.options.workVariants).id,recipe.id);
 assert.deepEqual(d.resources.missingResourceScope(work,d.options.workVariants),{materials:false,machines:false});
 const rows=d.resources.plannedResources(work,undefined,d.options.workVariants);
 assert.equal(rows.filter(r=>r.kind==='material').length,2);
 assert.equal(rows.filter(r=>r.kind==='machine').length,5);
 const asphalt=rows.find(r=>r.code==='45059');assert.ok(Math.abs(asphalt.quantityPerUnit-.117)<1e-10);
 const end=new Date(Date.parse(d.today)+86400000).toISOString().slice(0,10);
 const input={...d.input,workVariantId:work.id,exactQuantity:'4',scheduledEndDate:end};
 const plan=await d.post('/planning/manual/preview',input);
 assert.ok(!plan.blockers.some(b=>b.code==='RESOURCE_RECIPE_MISSING'));
 assert.equal(plan.jobs.reduce((s,j)=>s+Number(j.laborHours),0),4*work.laborMinutesPerUnit/60,'resource labor must not replace the TIME labor');
 assert.equal(plan.jobs.flatMap(j=>j.materials).filter(m=>m.name===asphalt.name).reduce((s,m)=>s+Number(m.quantity),0),.468);
 const equipmentChecks=plan.resourceChecks.filter(c=>c.kind==='EQUIPMENT');assert.equal(equipmentChecks.length,5);assert.ok(equipmentChecks.every(c=>c.required.includes('0.311')));
 await d.post(`/planning/plans/${plan.draftId}/resources/request`);
 const req=(await d.get('/resource-requisitions')).items.find(r=>r.planId===plan.draftId);
 assert.equal(Number(req.shortages.find(r=>r.resourceId===d.resources.materialStockId(asphalt.code,asphalt.unit)).missingQuantity),.468);
 await d.role('engineer');await d.post(`/resource-requisitions/${req.id}/decision`,{decision:'APPROVE',note:'IQN bo‘yicha'});await d.post(`/demo/requisitions/${req.id}/receive`);
 await d.role('chief');assert.equal((await d.post(`/planning/plans/${plan.draftId}/resources/recheck`)).resourcesReady,true);
 await d.post(`/planning/plans/${plan.draftId}/approve`);await d.post(`/planning/plans/${plan.draftId}/publish`);
 const orders=(await d.get('/work-orders?pageSize=100')).items.filter(o=>o.planId===plan.draftId);assert.equal(orders.length,2);
 const materialTotal=orders.flatMap(o=>o.executionResources.materials).filter(m=>m.name===asphalt.name).reduce((s,m)=>s+Number(m.plannedQuantity),0);assert.equal(materialTotal,.468);
 const machines=orders.flatMap(o=>o.executionResources.equipment);
 assert.equal(new Set(machines.map(m=>m.id)).size,5);
 // Execution records whole minutes; each day's reservation rounds up once.
 assert.ok(machines.every(m=>m.plannedMachineMinutes===Math.ceil(.0777*2*60)));
 assert.equal(machines.reduce((s,m)=>s+m.plannedMachineMinutes,0),100);
});

test('automatic resources preserve source variants, leave unknown recipes unresolved and never mix units',async(t)=>{
 const d=await demo(t),{automaticResourceRecipe,plannedResources,missingResourceScope,resourcePlanIssue,resourceUnit}=d.resources;
 const get=id=>d.options.workVariants.find(w=>w.id===id);
 const works=['iqn02-t2-r4','iqn02-t2-r5','iqn02-t2-r7','iqn02-t2-r9','iqn02-t2-r15','iqn02-t2-r16','iqn02-t2-r18','iqn02-t2-r20','iqn02-t8-r15','iqn02-t8-r22','iqn02-t13-r6','iqn02-t15-r6'];
 for(const id of works){const w=get(id),original=JSON.stringify(w),recipe=automaticResourceRecipe(w,d.options.workVariants);assert.ok(recipe);assert.equal(recipe.unit,w.unit);assert.equal(resourcePlanIssue(w,undefined,d.options.workVariants),'');assert.deepEqual(plannedResources(w,undefined,d.options.workVariants),plannedResources(recipe,undefined,d.options.workVariants));assert.equal(JSON.stringify(w),original);}
 const noBreak=plannedResources(get('iqn02-t2-r15'),undefined,d.options.workVariants);assert.equal(noBreak.filter(r=>r.kind==='machine').length,3);assert.ok(!noBreak.some(r=>r.code==='01199'));
 const curb=plannedResources(get('iqn02-t13-r6'),undefined,d.options.workVariants);assert.equal(curb.find(r=>r.code==='44849').quantityPerUnit,.00632);assert.ok(!curb.some(r=>/бордюр|bordyur|bordyur/i.test(r.name)),'straightening does not purchase new curbs');
 assert.ok(get('iqn02-t8-r15').normRange,'resources do not choose a labor range');
 for(const id of ['iqn02-t2-r6','iqn02-t5-r9','iqn02-t11-r7','iqn02-t20-r2']){const w=get(id);assert.equal(automaticResourceRecipe(w,d.options.workVariants),undefined);assert.equal(missingResourceScope(w,d.options.workVariants).materials,true);assert.ok(resourcePlanIssue(w,undefined,d.options.workVariants));}
 assert.equal(automaticResourceRecipe({...get('iqn02-t2-r4'),unit:'m3'},d.options.workVariants),undefined);
 const leveling=d.options.workVariants.find(w=>w.id==='iqn02-r-27-14-026-01-t98');assert.deepEqual(missingResourceScope(leveling,d.options.workVariants),{materials:true,machines:true});assert.ok(resourcePlanIssue(leveling,undefined,d.options.workVariants),'labor-only asphalt table must not claim zero asphalt');
 const winter=d.options.workVariants.find(w=>w.code==='27-14-079-01');assert.deepEqual(missingResourceScope(winter,d.options.workVariants),{materials:true,machines:false});assert.equal(plannedResources(winter,undefined,d.options.workVariants).filter(r=>r.kind==='machine').length,2);assert.ok(resourcePlanIssue(winter,undefined,d.options.workVariants));
 const hand=d.options.workVariants.find(w=>w.code==='27-14-017-01');assert.deepEqual(missingResourceScope(hand,d.options.workVariants),{materials:false,machines:false});assert.deepEqual(plannedResources(hand,undefined,d.options.workVariants),[]);
 assert.equal(resourceUnit('д'),'dona');assert.equal(resourceUnit('т'),'t');assert.equal(resourceUnit('м3'),'m3');assert.notEqual(d.resources.materialStockId('43111','t'),d.resources.materialStockId('43111','m3'));
});
