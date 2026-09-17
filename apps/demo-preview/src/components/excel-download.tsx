"use client";
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from './ui';
export function ExcelDownload({id,period,kind='act'}:{id?:string;period?:string;kind?:'act'|'payroll'|'timesheet'}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function download(){setBusy(true);setError('');try{const [report,module]=await Promise.all([api.excelReport(id?{id}:{period}),import('@/lib/excel/export-workbook')]);module.downloadReport(report,kind);}catch(e){setError(e instanceof Error?e.message:'Excel yuklanmadi.');}finally{setBusy(false);}}
  return <span className="excel-action"><Button variant="secondary" busy={busy} onClick={download}><Download size={16} aria-hidden="true" /> Excel — sizning shaklingiz</Button>{error?<span className="inline-error" role="alert">{error}</span>:null}</span>;
}
