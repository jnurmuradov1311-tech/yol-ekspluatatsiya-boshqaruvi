import { iqnCatalogData } from './catalog-data';
import type { ManualPlanInput, PlanningWorkOption } from '../api/types';
export const iqnWorkCatalog: PlanningWorkOption[] = iqnCatalogData;
const cyrillic: Record<string,string> = Object.fromEntries([..."абвгдеёжзийклмнопрстуфхцчшъьэюяўқғҳ"].map((c,i)=>[c,['a','b','v','g','d','e','yo','j','z','i','y','k','l','m','n','o','p','r','s','t','u','f','x','ts','ch','sh','','','e','yu','ya','o','q','g','h'][i]!]));
export function searchText(text:string) {return [...text.toLowerCase()].map(c=>cyrillic[c]??c).join('').replace(/[‘’ʻʼ`'"\s-]+/g,'');}
export function normalizeUnit(unit:string) {return unit.toLowerCase().replace('²','2').replace('³','3').replace('м','m').replace(/^unit$|^pcs$|^psc$|^дона$/,'dona').trim();}
export function workNormMinutes(work:PlanningWorkOption,input:Pick<ManualPlanInput,'selectedNormHours'>):number {
  if(work.normIssue) return NaN;
  if(work.normRange){const value=input.selectedNormHours;return value!==undefined && Number.isFinite(value) && value>=work.normRange[0]! && value<=work.normRange[1]! && work.normBasisQuantity ? value*60/work.normBasisQuantity : NaN;}
  return work.laborMinutesPerUnit>0 ? work.laborMinutesPerUnit : NaN;
}
