import type { DefectParameters, PlanningSourceDefect, PlanningWorkOption } from '../api/types';
import { iqnWorkCatalog, normalizeUnit, workNormMinutes } from './catalog';
import { inspectionTypes, iqnTopicId, selectDefectWork } from './defects';

export type AISelectionRequest = {
  defectTypeId: string;
  observedIssue: string;
  measuredQuantity: { value: string; unit: string };
  parameters: DefectParameters;
  inspectionNote: string;
  reviewNote?: string;
};
export type AISelectionResult = {
  mode: 'OPENAI' | 'VALIDATION';
  workVariantId: string | null;
  explanation: string;
  missingFields: string[];
  checks: string[];
  model?: string;
  analysisId?: string;
  createdAt: string;
};

export function selectionContext(input: AISelectionRequest, catalog = iqnWorkCatalog) {
  const type = inspectionTypes.find(item => item.id === input.defectTypeId);
  if (!type) throw new Error('Nuqson turi IQN katalogiga bog‘lanmagan.');
  if (!Number.isFinite(Number(input.measuredQuantity.value)) || Number(input.measuredQuantity.value) <= 0)
    throw new Error('Nuqson hajmi musbat son bo‘lsin.');
  if (normalizeUnit(input.measuredQuantity.unit) !== normalizeUnit(type.unit))
    throw new Error('O‘lchov birligi nuqson turiga mos emas.');
  const source: PlanningSourceDefect = {
    id: 'selection', defectTypeId: type.id, sourceReference: '',
    iqnTopic: { id: iqnTopicId(type.iqnTopicNumber), name: input.observedIssue },
    location: { chainageStartM: '0', chainageEndM: '0' },
    measuredQuantity: input.measuredQuantity,
  };
  const match = selectDefectWork(source, catalog, input.parameters);
  const hardMissing = type.patchParameters ? match.missing : [];
  // Explicit mappings take precedence. Unmapped types are scoped to their own IQN table.
  const candidates = (type.patchParameters ? match.alternatives : type.candidateWorkIds.length
    ? catalog.filter(work => type.candidateWorkIds.includes(work.id))
    : catalog.filter(work => work.iqnTopicId === iqnTopicId(type.iqnTopicNumber)))
    .filter(work => !work.normIssue && normalizeUnit(work.unit) === normalizeUnit(type.unit)
      && Number.isFinite(workNormMinutes(work, { selectedNormHours: work.normRange?.[1] })));
  if (type.requiredContext && !input.inspectionNote.trim() && !input.reviewNote?.trim()) hardMissing.push(type.requiredContext);
  if (!candidates.length && !hardMissing.length) hardMissing.push('Mos me’yor aniqlanmadi. Boshliq ish usulini tanlashi kerak.');
  return { type, candidates, hardMissing: [...new Set(hardMissing)] };
}

export function validateSelection(value: unknown, candidates: PlanningWorkOption[]) {
  if (!value || typeof value !== 'object') throw new Error('AI javobi yaroqsiz.');
  const result = value as Record<string, unknown>;
  const keys = ['status', 'workId', 'explanation', 'questions'];
  if (Object.keys(result).some(key => !keys.includes(key))
    || !['SELECTED', 'NEEDS_CONTEXT', 'NO_MATCH'].includes(String(result.status))
    || typeof result.explanation !== 'string' || !result.explanation.trim() || result.explanation.length > 1600
    || !Array.isArray(result.questions) || result.questions.length > 5
    || result.questions.some(q => typeof q !== 'string' || !q.trim() || q.length > 400))
    throw new Error('AI javobi tekshiruvdan o‘tmadi.');
  if (result.status === 'SELECTED') {
    if (typeof result.workId !== 'string' || !candidates.some(work => work.id === result.workId) || result.questions.length)
      throw new Error('AI tanlagan ish mos IQN me’yorlari ro‘yxatida yo‘q.');
  } else if (result.workId !== null || !result.questions.length) {
    throw new Error('AI yetishmagan ma’lumotni aniqlashtirishi kerak.');
  }
  return result as { status: 'SELECTED' | 'NEEDS_CONTEXT' | 'NO_MATCH'; workId: string | null; explanation: string; questions: string[] };
}
