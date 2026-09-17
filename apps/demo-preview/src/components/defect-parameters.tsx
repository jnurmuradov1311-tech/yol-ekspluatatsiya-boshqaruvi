"use client";
import type { DefectParameters } from '@/lib/api/types';
import { SelectInput, TextInput } from './ui';

export function DefectParameterFields({value,onChange}:{value:DefectParameters;onChange:(value:DefectParameters)=>void}) {
 return <div className="data-form">
  <SelectInput label="Ta’mir qalinligi, mm" name="repairThicknessMm" value={value.repairThicknessMm??''} onChange={e=>onChange({...value,repairThicknessMm:e.target.value?Number(e.target.value):undefined})}><option value="">Joyida aniqlanadi</option><option value="50">50 mm</option><option value="70">70 mm</option></SelectInput>
  <TextInput label="Eng katta bitta chuqurcha, m²" name="largestPatchAreaM2" type="number" min="0.000001" step="any" value={value.largestPatchAreaM2??''} onChange={e=>onChange({...value,largestPatchAreaM2:e.target.value?Number(e.target.value):undefined})} hint="Jami hajmdan alohida o‘lchanadi."/>
  <SelectInput label="Eski qoplamani buzish" name="removeOldPavement" value={value.removeOldPavement===undefined?'':String(value.removeOldPavement)} onChange={e=>onChange({...value,removeOldPavement:e.target.value===''?undefined:e.target.value==='true'})}><option value="">Usulni tanlang</option><option value="true">Buzib olib ta’mirlash</option><option value="false">Buzmasdan ta’mirlash</option></SelectInput>
 </div>;
}
