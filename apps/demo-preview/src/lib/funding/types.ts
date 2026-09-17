export type Importance = 'INTERNATIONAL' | 'STATE' | 'LOCAL';
export type AssetKind = 'PAVEMENT' | 'GRASS' | 'DRAIN' | 'CULVERT' | 'SIGN' | 'PAVILION' | 'BARRIER' | 'CURB' | 'LIGHTING' | 'OTHER';
export type Asset = { id:string; kind:AssetKind; name:string; quantity:number; unit:string; condition:'GOOD'|'FAIR'|'POOR'|'CRITICAL'; defectQuantity?:number; industrialZone?:boolean; selectedNormHours?:number; operatorHoursPerUnit?:number; operatorBasis?:string; repairMethod?:'STRAIGHTEN'|'REPLACE_FIXTURE'; workId?:string; workQuantity?:number; workUnit?:string; annualFrequency?:number; frequencyBasis?:string; resourcePlan?:import('../api/types').ManualResourcePlan; parameters?:{thicknessMm?:number; largestPatchM2?:number; removeOld?:boolean}; };
export type Road = { id:string; code:string; name:string; importance:Importance; category:'Ia'|'Ib'|'II'|'III'|'IV'|'V'; lengthKm:number; carriagewayWidthM:number; condition:'GOOD'|'FAIR'|'POOR'|'CRITICAL'; trafficPerDay?:number; assets:Asset[]; };
export type AssetSnapshot = { schemaVersion:1; source:string; observedAt:string; mode:'DEMO'|'IMPORT'|'RAMS'; roads:Road[] };
export type Rate = { unit:string; price:number|null; source:string; includesOperator?:boolean };
export type FundingPolicy = {
 coverage?:Record<string,{state:'INCLUDED'|'NOT_APPLICABLE';reason:string;lineIds?:string[]}>;
 staff?:Array<{role:string;heads:number;fte:number;monthly:number;basis:string}>;
 otherCosts?:Array<{id:string;name:string;amount:number;basis:string}>;
 worksiteCount?:number; equipmentStock?:Record<string,number>; equipmentIssueQuantity?:Record<string,number>;
 year:number; annualHours:number; workerMonthly:number; operatorMonthly:number; supervisorMonthly:number; supervisors:number|null; divisionCount:number; conditionIIIRepeats:number|null; conditionIVRepeats:number|null; conditionBasis:string;
 wageCoefficient:number; allowancePercent:number; holidayPerYear:number; mealPerMonth:number;
 employerTaxPercent:number; overheadPercent:number; contingencyPercent:number; otherAnnual:number;
 reference:string; roadSelection:string[]; rates:Record<string,Rate>; equipmentPrices:Record<string,number|null>;
};
export type ResourceCost = { key:string; code:string; name:string; kind:'material'|'machine'; unit:string; quantity:number; price:number|null; amount:number|null; source:string };
export type FundingLine = { id:string; roadId:string; assetId:string; assetName:string; workId:string; workName:string; quantity:number; unit:string; frequency:number; frequencySource:string; normReference:string; workerHours:number; operatorHours:number; directCost:number; resources:ResourceCost[]; gaps:string[]; priority:number; resourcePlan?:import("../api/types").ManualResourcePlan; selectedNormHours?:number; };
export type FundingResult = { lines:FundingLine[]; gaps:string[]; warnings:string[]; complete:boolean; workerHours:number; operatorHours:number; workers:number; operators:number; labor:number; payrollRows:{name:string; count:number; heads?:number; role?:string; base?:number; monthly:number; annual:number}[]; materials:number; machinery:number; ppe:number; ppeRows:{id:string; name:string; quantity:number; unit:string; months:number|null; heads?:number; basisQuantity?:number; stock?:number; scope?:string; price:number|null; amount:number|null; source:string}[]; employerTax:number; overhead:number; contingency:number; other:number; total:number; roads:{id:string; code:string; amount:number; priority:number; lineCount:number; missing:number}[]; resources:ResourceCost[]; };
