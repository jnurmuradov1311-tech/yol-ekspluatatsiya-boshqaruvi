import type { DefectTypeOption, DefectParameters, PlanningSourceDefect, PlanningWorkOption } from '../api/types';
import { normalizeUnit, searchText } from './catalog';
// Application defect taxonomy derived from IQN work tables; these are not official IQN defect codes.
type Row=[string,string,number,string,string[],boolean,string?,boolean?];
const rows:Row[]=[
 ['shoulder-eroded','Yo‘l yoqasi yoki qiyalik yuvilgan',1,'m2',['iqn02-t1-r4'],true],
 ['shoulder-settled','Yo‘l yoqasi cho‘kkan',1,'m3',['iqn02-t1-r5'],true],
 ['ditch-silt','Kyuvet loy va chiqindi bilan to‘lgan',1,'m3',['iqn02-t1-r31'],true],
 ['drainage','Beton lotok tiqilgan',1,'m',['iqn02-r-27-14-017-01-t41'],true],
 ['ditch-profile','Kyuvet profili buzilgan',1,'m',['iqn02-t1-r32'],true],
 ['vegetation','Yo‘l yoqasini o‘t bosgan',1,'m2',['iqn02-t1-r14'],true],
 ['roadside-debris','Yo‘l mintaqasida chiqindi bor',1,'km',['iqn02-t1-r20'],true],
 ['bush-obstruction','Butalar ko‘rinishni to‘smoqda',1,'dona',['iqn02-t1-r19'],true],
 ['pothole','Asfaltbeton qoplamada chuqurcha',2,'m2',[],true,undefined,true],
 ['crack','Asfaltbeton qoplamada yoriq',2,'m',['iqn02-r-27-14-027-01-t48'],true],
 ['marking-worn','Yo‘l o‘qi yoki chet chizig‘i o‘chgan',2,'m',['iqn02-t2-r35'],true],
 ['crosswalk-worn','Piyodalar o‘tish chizig‘i o‘chgan',2,'m2',['iqn02-t2-r42'],true,'Chiziq materiali va chizish usulini tanlang'],
 ['concrete-damaged','Sementbeton qoplama mahalliy shikastlangan',3,'m2',['iqn02-t3-r4'],true,'Ta’mir texnologiyasi, maydon va qalinlikni aniqlang'],
 ['concrete-joint','Sementbeton chok to‘ldirgichi buzilgan',3,'m',['iqn02-r-27-14-030-01-t51'],true],
 ['black-gravel-pothole','Qora-shag‘al qoplamada chuqurcha',4,'m2',['iqn02-r-27-14-031-01-t52'],true,'Ta’mir qalinligi va texnologiyasini tekshiring'],
 ['gravel-pothole','Shag‘al qoplamada chuqurcha',5,'m2',['iqn02-t5-r7'],true,'Chuqurcha chuqurligini o‘lchang'],
 ['crushed-stone-pothole','Chaqiqtosh qoplamada chuqurcha',5,'m2',['iqn02-t5-r10'],true,'Chuqurcha chuqurligini o‘lchang'],
 ['earth-profile','Tuproq yo‘l profili buzilgan',6,'km',['iqn02-t6-r2'],true,'Yo‘l kengligi va texnika turini tekshiring'],
 ['culvert-blocked','Suv o‘tkazuvchi quvur tiqilgan',7,'m3',['iqn02-t7-r4'],true],
 ['culvert-head','Quvur kallagi shikastlangan',7,'m2',['iqn02-r-27-14-042-01-t61'],true,'Mahalliy yoriq yoki kovak ekanini, konstruksiya yaxlitligini tekshiring'],
 ['bridge-drain','Ko‘prik suv ketkazish tizimi tiqilgan',7,'m',['iqn02-t7-r16'],true],
 ['bridge-rail','Ko‘prik metall yondori shikastlangan',7,'m',['iqn02-t7-r18'],true],
 ['post-missing','Yo‘naltiruvchi ustuncha yo‘q',8,'dona',['iqn02-t8-r5'],true,'Ustuncha joyini yo‘l reyestri bilan solishtiring'],
 ['post-broken','Yo‘naltiruvchi ustuncha singan',8,'dona',['iqn02-t8-r6'],true],
 ['post-reflector','Ustuncha nur qaytaruvchi tasmasi shikastlangan',8,'dona',['iqn02-r-27-14-066-01-t78'],true],
 ['barrier-bent','Metall to‘siq bukilgan',8,'m',['iqn02-r-27-14-054-01-t68'],true],
 ['barrier-broken','Metall to‘siq qismi yaroqsiz',8,'m',['iqn02-t8-r14'],true],
 ['concrete-barrier','Temirbeton to‘siq siljigan yoki yiqilgan',8,'m',['iqn02-t8-r18'],true],
 ['curb-shifted','Bordyur siljigan yoki qiyshaygan',8,'m',['iqn02-r-27-14-061-01-t74'],true],
 ['parking-dirty','Avtoturargoh ifloslangan',9,'m2',['iqn02-t9-r3'],true],
 ['rest-area-dirty','Dam olish maydoni ifloslangan',10,'m2',['iqn02-t10-r4'],true],
 ['busstop-plaster','Avtobekat devori suvog‘i ko‘chgan',11,'m2',['iqn02-t11-r2'],true],
 ['busstop-roof','Avtobekat tomi mahalliy shikastlangan',11,'m2',['iqn02-t11-r6'],true],
 ['busstop-dirty','Avtobekat devorlari ifloslangan',11,'m2',['iqn02-r-27-14-059-01-t72'],true],
 ['sign-dirty','Yo‘l belgisi ifloslangan',12,'dona',['iqn02-t12-r23'],true],
 ['sign','Yo‘l belgisi shikastlangan',12,'dona',['iqn02-t12-r8'],true],
 ['sign-film','Yo‘l belgisi tasviri eskirgan',12,'m2',['iqn02-t12-r15'],true],
 ['walkway-damaged','Piyodalar yo‘lagi qoplamasi buzilgan',13,'m2',['iqn02-t13-r3'],true],
 ['debris','Piyodalar yo‘lagida chiqindi bor',13,'m2',['iqn02-t13-r2'],true],
 ['paved-shoulder','Asfalt bilan mustahkamlangan yo‘l yoqasi buzilgan',14,'m2',['iqn02-t14-r2'],true,'Qoplama ta’miri shartlarini aniqlang'],
 ['junction-damage','Tutashuvchi yo‘l qoplamasi shikastlangan',15,'m2',[],true,'Qoplama turi va ta’mir o‘lchovlarini aniqlang'],
 ['snow-fence','Qordan himoyalovchi taxta to‘siq shikastlangan',16,'dona',['iqn02-r-27-14-083-01-t93'],true,'Taxta to‘siqni ta’mirlash joyi va usulini tanlang'],
 ['lamp-off','Ko‘cha chirog‘i yonmayapti',17,'dona',['iqn02-t17-r7'],false,'Lampa nosozligini elektr ta’minoti uzilishidan ajrating'],
 ['facility-damage','Xizmat binosi yoki inshooti shikastlangan',18,'m2',[],false,'Shikast turi va ta’mir usulini ko‘rikda aniqlang'],
 ['flowerbed-weeds','Gulzor egatlarini begona o‘t bosgan',19,'m2',['iqn02-t19-r3'],true],
 ['snow','Qatnov qismini qor bosgan',20,'m2',['iqn02-r-27-14-075-01-t86'],true],
 ['ice','Qatnov qismida yaxmalak bor',20,'m2',['iqn02-r-27-14-079-01-t89'],true],
 ['well-blocked','Suv qudug‘i tiqilgan',23,'dona',['iqn02-t23-r2'],false],
 ['grate-broken','Suv qabul qiluvchi panjara singan',23,'dona',['iqn02-t23-r6'],true],
 ['sewer-damage','Kanalizatsiya quvuri shikastlangan',24,'m',[],false,'Quvur diametri va ulanish turini aniqlang'],
 ['heating-leak','Isitish quvurida sizib chiqish bor',25,'m',[],false,'Quvur diametri, ulanishi va ta’mir usulini aniqlang'],
 ['water-leak','Suv ta’minoti quvurida sizib chiqish bor',26,'m',[],false,'Quvur materiali va diametrini aniqlang'],
 ['tunnel-drain','Tunnel drenaj kanali tiqilgan',27,'m3',['iqn02-t27-r6'],false],
];
export const defectTypes:DefectTypeOption[]=rows.map(([id,name,n,unit,candidates,visible,requiredContext,patchParameters])=>({id:`defect-${id}`,code:`field.${id}`,name,iqnTopicNumber:n,unit,candidateWorkIds:candidates,roadvision:visible?'VISIBLE_CANDIDATE':'FIELD_CHECK',observationKind:'DEFECT',roadAccess:[2,3,4,5,6,7,8,14,15,20,27].includes(n)?'PARTIAL':'OPEN',requiredContext,patchParameters}));
const services:Array<[string,string,number,string[]]>=[['technical-inspection','Yo‘l holatini texnik ko‘rikdan o‘tkazish',21,[]],['loading','Yuklash yoki tushirish ishiga ehtiyoj',22,[]],['diagnostics','Yo‘l diagnostikasi talab etiladi',28,['iqn02-t28-r24']],['safety-audit','Yo‘l harakati xavfsizligi auditi talab etiladi',29,['iqn02-t29-r3']]];
export const serviceTypes:DefectTypeOption[]=services.map(([id,name,n,ids])=>({id:`request-${id}`,code:`request.${id}`,name,iqnTopicNumber:n,unit:'km',candidateWorkIds:ids,roadvision:'FIELD_CHECK',observationKind:'SERVICE_REQUEST',roadAccess:'OPEN',requiredContext:'Ko‘rik yoki xizmatning aniq hajmi va usulini belgilang'}));
export const inspectionTypes=[...defectTypes,...serviceTypes];
export function iqnTopicId(n:number){return `02000000-0000-4000-8000-${String(n).padStart(12,'0')}`;}
export function defectTypeForSource(source:PlanningSourceDefect) {
 const direct=inspectionTypes.find(t=>t.id===source.defectTypeId);if(direct)return direct;
 if(source.suggestedWorkVariantIds?.includes('work-pothole'))return defectTypes.find(t=>t.id==='defect-pothole');
 if(source.suggestedWorkVariantIds?.includes('work-shoulder'))return defectTypes.find(t=>t.id==='defect-shoulder-settled');
 if(source.suggestedWorkVariantIds?.includes('work-ditch'))return defectTypes.find(t=>t.id==='defect-drainage');
 if(source.suggestedWorkVariantIds?.includes('work-sign-wash'))return defectTypes.find(t=>t.id==='defect-sign-dirty');
 return inspectionTypes.find(t=>searchText(t.name)===searchText(source.iqnTopic.name));
}
export function selectDefectWork(source:PlanningSourceDefect,catalog:PlanningWorkOption[],parameters:DefectParameters={}) {
 const type=defectTypeForSource(source),missing:string[]=[];
 let ids=type?.candidateWorkIds??source.suggestedWorkVariantIds??[];
 if(type?.patchParameters){
  if(![50,70].includes(parameters.repairThicknessMm??0))missing.push('Ta’mir qalinligi: 50 yoki 70 mm');
  if(!Number.isFinite(parameters.largestPatchAreaM2)||parameters.largestPatchAreaM2!<=0)missing.push('Bitta chuqurchaning eng katta maydoni');
  if(Number.isFinite(parameters.largestPatchAreaM2)&&parameters.largestPatchAreaM2!>Number(source.measuredQuantity.value))missing.push('Bitta chuqurcha maydoni jami o‘lchangan maydondan oshmasin');
  if(typeof parameters.removeOldPavement!=='boolean')missing.push('Eski qoplama buzilishi yoki buzilmasligi');
  if(!missing.length){
   const depth=parameters.repairThicknessMm!,area=parameters.largestPatchAreaM2!,remove=parameters.removeOldPavement!;
   if(area>25)missing.push('25 m² dan katta joy uchun ta’mir texnologiyasini tanlang');
   else if((depth===50&&area<=1)||(depth===70&&area<=3))ids=[`iqn02-r-27-14-${remove?'023':'024'}-${depth===50?'01':'02'}-t${remove?'45':'46'}`];
   else {const index=[1,2,3,10,25].findIndex(limit=>area<=limit);ids=[`iqn02-t2-r${(remove?4:15)+index*2+(depth===70?1:0)}`];}
  }
 }
 if(type?.requiredContext)missing.push(type.requiredContext);
 const alternatives=ids.map(id=>catalog.find(w=>w.id===id)).filter((w):w is PlanningWorkOption=>Boolean(w)&&normalizeUnit(w!.unit)===normalizeUnit(source.measuredQuantity.unit));
 const work=alternatives.find(w=>!w.normIssue);
 if(!type&&!work)missing.push('Nuqsonni IQN ishiga bog‘lash kerak');
 if(!work&&!missing.length)missing.push('Aniq ish usuli va me’yorini tanlang');
 return {type,work:missing.length?undefined:work,missing,alternatives};
}
