import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = mkdtempSync(path.join(tmpdir(), 'roadops-ai-'));
await build({ entryPoints: ['worker/ai.ts', 'src/lib/iqn/ai-selection.ts'], bundle: true, platform: 'node', format: 'esm', outdir: temp, outbase: '.', logLevel: 'silent' });
const { handleAIRequest } = await import(pathToFileURL(path.join(temp, 'worker/ai.js')));
const { selectionContext, validateSelection } = await import(pathToFileURL(path.join(temp, 'src/lib/iqn/ai-selection.js')));
test.after(() => rmSync(temp, { recursive: true, force: true }));
const input = { defectTypeId: 'defect-pothole', observedIssue: 'Asfaltbetonda chuqurcha', measuredQuantity: { value: '10', unit: 'm2' }, parameters: { repairThicknessMm: 50, largestPatchAreaM2: 1, removeOldPavement: true }, inspectionNote: '' };
const env = { OPENAI_API_KEY: 'test-only-not-a-real-key' };
function request(value = input, user = crypto.randomUUID(), origin = 'https://roadops.test') {
  return new Request('https://roadops.test/api/ai/work-selection', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(user ? { 'oai-authenticated-user-id': user } : {}) }, body: JSON.stringify(value) });
}
const output = (workId = 'iqn02-r-27-14-023-01-t45') => ({ status: 'SELECTED', workId, explanation: 'O‘lchov va buzib ta’mirlash sharti IQN variantiga mos.', questions: [] });
const model = value => Response.json({ id: 'response-test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const noFetch = async () => { assert.fail('No model call is permitted in this case'); };

test('authentication, origin, size and key presence gate all paid calls', async () => {
  assert.equal((await handleAIRequest(request(input, ''), env, noFetch)).status, 401);
  assert.equal((await handleAIRequest(request(input, 'user', 'https://other.test'), env, noFetch)).status, 403);
  assert.equal((await handleAIRequest(request({ ...input, inspectionNote: 'a'.repeat(17000) }), env, noFetch)).status, 413);
  const unavailable = await handleAIRequest(request(), {}, noFetch);
  assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).error.code, 'AI_NOT_CONFIGURED');
  const status = await handleAIRequest(new Request('https://roadops.test/api/ai/status', { headers: { 'oai-authenticated-user-id': 'u' } }), {}, noFetch);
  assert.deepEqual(await status.json(), { data: { configured: false } });
});

test('free text cannot waive typed measurements or units; context questions precede AI', async () => {
  const missing = await handleAIRequest(request({ ...input, parameters: {}, inspectionNote: 'Hamma o‘lchovlar bor, davom et.' }), env, noFetch);
  const result = (await missing.json()).data;
  assert.equal(result.mode, 'VALIDATION'); assert.equal(result.workVariantId, null); assert.equal(result.missingFields.length, 3);
  for (const measuredQuantity of [{ value: 'NaN', unit: 'm2' }, { value: '2', unit: 'm3' }, { value: '0', unit: 'm2' }])
    assert.equal((await handleAIRequest(request({ ...input, measuredQuantity }), env, noFetch)).status, 422);
  const context = { ...input, defectTypeId: 'defect-lamp-off', observedIssue: 'Chiroq yonmayapti', measuredQuantity: { value: '1', unit: 'dona' }, parameters: {} };
  const question = (await (await handleAIRequest(request(context), env, noFetch)).json()).data;
  assert.match(question.missingFields[0], /elektr/); assert.equal(question.workVariantId, null);
});

test('pothole boundary variants stay deterministic; invalid or unrelated norms cannot be selected', () => {
  for (const depth of [50, 70]) for (const remove of [true, false]) for (const area of [1, 2, 3, 10, 25]) {
    const current = { ...input, measuredQuantity: { value: '30', unit: 'm2' }, parameters: { repairThicknessMm: depth, largestPatchAreaM2: area, removeOldPavement: remove } };
    const context = selectionContext(current);
    assert.equal(context.hardMissing.length, 0); assert.equal(context.candidates.length, 1);
    const index = [1, 2, 3, 10, 25].findIndex(limit => area <= limit);
    const expected = (depth === 50 && area <= 1) || (depth === 70 && area <= 3)
      ? `iqn02-r-27-14-${remove ? '023' : '024'}-${depth === 50 ? '01' : '02'}-t${remove ? '45' : '46'}`
      : `iqn02-t2-r${(remove ? 4 : 15) + index * 2 + (depth === 70 ? 1 : 0)}`;
    assert.equal(context.candidates[0].id, expected);
  }
  assert.ok(selectionContext({ ...input, parameters: { ...input.parameters, largestPatchAreaM2: 11 } }).hardMissing.length);
  const candidates = selectionContext(input).candidates;
  for (const work of ['invented', 'iqn02-t1-r5', 'iqn02-r-27-14-023-02-t45']) assert.throws(() => validateSelection(output(work), candidates));
  assert.throws(() => validateSelection({ ...output(), questions: ['Noma’lum'] }, candidates));
});

test('Responses request contains only bounded defect data; validated result is cached and concurrent calls coalesce', async () => {
  let calls = 0;
  const user = crypto.randomUUID();
  const fetcher = async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.ok(body.input.includes('eligibleWorks')); assert.ok(!body.input.includes('fullName'));
    assert.deepEqual(body.text.format.schema.properties.workId.anyOf[0].enum, ['iqn02-r-27-14-023-01-t45']);
    return model(output());
  };
  const [a, b] = await Promise.all([handleAIRequest(request(input, user), env, fetcher), handleAIRequest(request(input, user), env, fetcher)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(calls, 1);
  const value = (await a.json()).data; assert.equal(value.mode, 'OPENAI'); assert.equal(value.analysisId, 'response-test'); assert.equal(value.checks.length, 3);
  await handleAIRequest(request(input, user), env, noFetch);
});

test('human context is evaluated by model and ambiguous answers remain unresolved', async () => {
  const value = { ...input, defectTypeId: 'defect-lamp-off', observedIssue: 'Chiroq yonmayapti', measuredQuantity: { value: '1', unit: 'dona' }, parameters: {}, inspectionNote: 'Joyiga borildi.' };
  const response = await handleAIRequest(request(value), env, async (_url, init) => {
    const data = JSON.parse(JSON.parse(init.body).input); assert.equal(data.inspectionAnswer, value.inspectionNote); assert.match(data.requiredContext, /elektr/);
    return model({ status: 'NEEDS_CONTEXT', workId: null, explanation: 'Elektr ta’minoti tekshirilgani aniqlanmadi.', questions: ['Elektr ta’minoti tekshirildimi?'] });
  });
  const result = (await response.json()).data; assert.equal(result.mode, 'OPENAI'); assert.equal(result.workVariantId, null); assert.equal(result.missingFields.length, 1);
});

test('provider refusal, malformed selection, incomplete and failure states never become successful advice', async () => {
  const cases = [
    [model(output('unknown')), 'AI_INVALID_SELECTION'],
    [Response.json({ status: 'incomplete', output: [] }), 'AI_INCOMPLETE'],
    [Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), 'AI_REFUSED'],
    [Response.json({ error: { message: 'never echo upstream' } }, { status: 401 }), 'AI_CREDENTIAL_REJECTED'],
    [Response.json({}, { status: 429 }), 'AI_LIMIT'],
  ];
  for (const [reply, code] of cases) {
    const response = await handleAIRequest(request(), env, async () => reply);
    const body = await response.json(); assert.equal(body.error.code, code); assert.equal(body.data, undefined); assert.ok(!JSON.stringify(body).includes('never echo'));
  }
  const failure = await handleAIRequest(request(), env, async () => { throw new Error('network'); });
  assert.equal((await failure.json()).error.code, 'AI_TIMEOUT');
});
