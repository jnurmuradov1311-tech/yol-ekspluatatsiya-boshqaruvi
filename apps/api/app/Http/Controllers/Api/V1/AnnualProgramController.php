<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use stdClass;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class AnnualProgramController extends Controller
{
    public function generate(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate(['year' => ['required', 'integer', 'between:2000,2200']]);
        $divisionId = $scope->roadUnitIds($request)[0] ?? null;
        if ($divisionId === null) {
            abort(403);
        }
        try {
            $row = DbRows::selectOneOrFail('select roadops.generate_annual_program(?::uuid, ?::integer)::text result',
                [$divisionId, (int) $validated['year']], false);
        } catch (QueryException $exception) {
            return $this->annualError($exception);
        }

        return response()->json(['data' => json_decode((string) $row->result, true, 512, JSON_THROW_ON_ERROR)], 201);
    }

    public function approve(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        if (! Str::isUuid($id) || ! DB::scalar(
            'select exists(select 1 from roadops.annual_programs where id = ?::uuid and division_id = any(?::uuid[]))',
            [$id, $scope->pgUuidArray($scope->roadUnitIds($request))], false,
        )) {
            abort(404);
        }
        try {
            DbRows::selectOneOrFail('select roadops.approve_annual_program(?::uuid) id', [$id], false);
        } catch (QueryException $exception) {
            return $this->annualError($exception);
        }

        return response()->json(['data' => ['programId' => $id, 'state' => 'APPROVED']]);
    }

    public function rules(): JsonResponse
    {
        $rows = DbRows::select(<<<'SQL'
            select rule.*, to_json(rule.allowed_months)::text months, work.normalized_name work_name,
                   concat(document.code, ' · ', coalesce(work.raw_code, work.source_sequence::text)) norm_reference
            from roadops.annual_maintenance_rules rule
            join roadops.iqn_work_variants variant on variant.id = rule.work_variant_id
            join roadops.iqn_work_items work on work.id = variant.work_item_id
            join roadops.iqn_documents document on document.id = work.document_id
            order by rule.element_type, work.normalized_name, rule.id
            SQL);

        return response()->json(['data' => array_map(static fn (stdClass $row): array => [
            'id' => (string) $row->id,
            'workVariantId' => (string) $row->work_variant_id,
            'workName' => (string) $row->work_name,
            'normReference' => (string) $row->norm_reference,
            'elementType' => (string) $row->element_type,
            'quantityMethod' => (string) $row->quantity_method,
            'quantityAttribute' => $row->quantity_attribute,
            'inventoryUnit' => (string) $row->inventory_unit,
            'conversionFactor' => (string) $row->conversion_factor,
            'annualOccurrences' => (int) $row->annual_occurrences,
            'allowedMonths' => json_decode((string) $row->months, true, 512, JSON_THROW_ON_ERROR),
            'sourceReference' => (string) $row->source_reference,
            'schedulingNote' => (string) $row->scheduling_note,
            'effectiveFrom' => (string) $row->effective_from,
            'effectiveUntil' => $row->effective_until,
            'state' => strtoupper((string) $row->status),
        ], $rows)]);
    }

    public function storeRule(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'workVariantId' => ['required', 'uuid'],
            'elementType' => ['required', 'string', 'max:100'],
            'quantityMethod' => ['required', 'in:count,length_m,attribute'],
            'quantityAttribute' => ['nullable', 'required_if:quantityMethod,attribute', 'prohibited_unless:quantityMethod,attribute', 'regex:/^[A-Za-z][A-Za-z0-9_]{0,79}$/'],
            'inventoryUnit' => ['required', 'string', 'max:50'],
            'conversionFactor' => ['required', 'numeric', 'gt:0', 'max:1000000000'],
            'annualOccurrences' => ['required', 'integer', 'between:1,366'],
            'allowedMonths' => ['required', 'array', 'min:1', 'max:12'],
            'allowedMonths.*' => ['required', 'integer', 'between:1,12', 'distinct'],
            'sourceReference' => ['required', 'string', 'max:1000'],
            'schedulingNote' => ['required', 'string', 'max:1000'],
            'effectiveFrom' => ['required', 'date_format:Y-m-d'],
            'effectiveUntil' => ['nullable', 'date_format:Y-m-d', 'after:effectiveFrom'],
            'approvedBy' => ['prohibited'],
            'state' => ['prohibited'],
        ]);
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        if (! $context->canGlobally('catalog.manage')) {
            abort(403);
        }
        try {
            $row = DbRows::selectOneOrFail(<<<'SQL'
                insert into roadops.annual_maintenance_rules
                  (work_variant_id, element_type, quantity_method, quantity_attribute, inventory_unit,
                   conversion_factor, annual_occurrences, allowed_months, source_reference, scheduling_note,
                   effective_from, effective_until, created_by)
                values (?::uuid, ?, ?, ?, ?, ?::numeric, ?::integer, ?::integer[], ?, ?, ?::date, ?::date, ?::uuid)
                returning id
                SQL, [
                $validated['workVariantId'], $validated['elementType'], $validated['quantityMethod'],
                $validated['quantityAttribute'] ?? null, $validated['inventoryUnit'],
                $validated['conversionFactor'], (int) $validated['annualOccurrences'],
                '{'.implode(',', array_map('intval', $validated['allowedMonths'])).'}',
                $validated['sourceReference'], $validated['schedulingNote'], $validated['effectiveFrom'],
                $validated['effectiveUntil'] ?? null, $context->userId,
            ], false);
        } catch (QueryException $exception) {
            return $this->annualError($exception);
        }

        return response()->json(['data' => ['id' => (string) $row->id, 'state' => 'DRAFT']], 201);
    }

    public function approveRule(string $id): JsonResponse
    {
        if (! Str::isUuid($id)) {
            abort(404);
        }
        try {
            DbRows::selectOneOrFail('select roadops.approve_annual_maintenance_rule(?::uuid) id', [$id], false);
        } catch (QueryException $exception) {
            return $this->annualError($exception);
        }

        return response()->json(['data' => ['id' => $id, 'state' => 'APPROVED']]);
    }

    private function annualError(QueryException $exception): JsonResponse
    {
        $messages = [
            'INVENTORY_UNIT_MISMATCH' => 'Dona hisobidagi bitta yo‘l elementi koeffitsiyent bilan ko‘paytirilmaydi. O‘lchov bog‘lanishini tuzating.',
            'ANNUAL_INVENTORY_SNAPSHOT_STALE' => 'Inventar ma’lumotlari o‘zgargan. Yillik reja qoralamasini qayta shakllantiring.',
            'ANNUAL_INVENTORY_COVERAGE_INCOMPLETE' => 'Barcha yo‘l elementlari tasdiqlangan me’yorlarga bog‘lanmaguncha rejani tasdiqlab bo‘lmaydi.',
            'ANNUAL_APPROVED_RULES_OR_INVENTORY_MISSING' => 'Yo‘l elementlari, miqdori yoki tasdiqlangan IQN davriylik qoidalari yetishmayapti. Me’yorlar mutaxassis tomonidan bir marta kiritiladi.',
            'ANNUAL_IQN_DOCUMENT_CONFLICT' => 'Tanlangan yil uchun bir nechta IQN hujjati aniqlandi. Me’yorlar moslashtirilishi kerak.',
            'ANNUAL_GENERATION_FORBIDDEN' => 'Yillik reja yaratishga ruxsat yo‘q.',
            'ANNUAL_APPROVAL_FORBIDDEN' => 'Yillik rejani tasdiqlashga ruxsat yo‘q.',
            'ANNUAL_RULE_APPROVAL_FORBIDDEN' => 'Davriylik me’yorini tasdiqlash vakolati yo‘q.',
            'ANNUAL_RULE_NOT_DRAFT' => 'Davriylik qoidasi topilmadi yoki oldin tasdiqlangan.',
            'ANNUAL_RULE_IQN_NOT_APPROVED' => 'Ish turi uchun tasdiqlangan IQN 02-24 me’yorlari kerak.',
            'ANNUAL_PROGRAM_NOT_READY' => 'Rejada ishlar mavjud emas yoki holati tasdiqlashga mos emas.',
            'ANNUAL_YEAR_INVALID' => 'Reja yili noto‘g‘ri.',
        ];
        foreach ($messages as $code => $message) {
            if (str_contains($exception->getMessage(), $code)) {
                return response()->json(['error' => ['code' => $code, 'message' => $message]],
                    str_ends_with($code, 'FORBIDDEN') ? 403 : 409);
            }
        }
        if (in_array((string) $exception->getCode(), ['23505', '23P01'], true)) {
            return response()->json(['error' => ['code' => 'ANNUAL_RULE_OVERLAP', 'message' => 'Shu davr uchun qoida allaqachon mavjud.']], 409);
        }
        throw $exception;
    }

    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $validated = $request->validate([
            'year' => ['nullable', 'integer', 'min:2000', 'max:2200'],
        ]);
        $year = (int) ($validated['year'] ?? now()->year);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $rows = $this->rows($divisionIds, $year, $pagination);
        $total = (int) DB::scalar(
            'select count(*) from ('.$this->baseSql().' and ap.division_id = any(?::uuid[]) and ap.program_year = ?) scoped_annual_lines',
            [$divisionIds, $year],
        );

        return PagedResponse::make(
            array_map(fn (stdClass $row): array => $this->payload($row), $rows),
            $pagination->page,
            $pagination->pageSize,
            $total,
        );
    }

    public function export(Request $request, ApiScope $scope, string $id): StreamedResponse
    {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
        $program = DbRows::selectOne(
            <<<'SQL'
                select ap.program_year
                from roadops.annual_programs ap
                where ap.id = ? and ap.division_id = any(?::uuid[])
            SQL,
            [$id, $scope->pgUuidArray($scope->roadUnitIds($request))],
        );
        if ($program === null) {
            abort(404);
        }
        $rows = DbRows::select($this->baseSql().' and ap.id = ? order by rv.official_code, wi.normalized_name', [$id]);
        $spreadsheet = $this->spreadsheet($rows, (int) $program->program_year);

        return response()->streamDownload(
            static function () use ($spreadsheet): void {
                (new Xlsx($spreadsheet))->save('php://output');
                $spreadsheet->disconnectWorksheets();
            },
            'yillik-saqlash-dasturi-'.$program->program_year.'.xlsx',
            ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        );
    }

    /** @return list<stdClass> */
    private function rows(string $divisionIds, int $year, Pagination $pagination): array
    {
        return DbRows::select(
            $this->baseSql().' and ap.division_id = any(?::uuid[]) and ap.program_year = ? order by rv.official_code, wi.normalized_name, api.id limit ? offset ?',
            [$divisionIds, $year, $pagination->pageSize, $pagination->offset()],
        );
    }

    private function baseSql(): string
    {
        return <<<'SQL'
            select api.id, ap.id program_id, ap.program_year, ap.status,
                   lower(api.planned_period) period_start, upper(api.planned_period) period_end,
                   ap.generation_snapshot::text generation_snapshot,
                   rv.official_code road_code, rv.name road_name,
                   wi.normalized_name work_name,
                   concat(doc.code, coalesce(' · ' || nullif(wi.raw_code, ''), '')) norm_reference,
                   api.planned_quantity, api.work_unit,
                   coalesce((
                       select sum(cr.completed_quantity)
                       from roadops.plan_items pi
                       join roadops.work_orders wo on wo.plan_item_id=pi.id and wo.status='verified'
                       join roadops.work_completion_records cr on cr.work_order_id=wo.id
                         and cr.verified_at is not null
                       where pi.annual_program_item_id = api.id
                   ), 0) completed_quantity,
                   coalesce((
                       select sum(pr.required_minutes)
                       from roadops.plan_items pi
                       join roadops.plan_resource_requirements pr on pr.plan_item_id = pi.id
                       where pi.annual_program_item_id = api.id and pr.resource_kind = 'labor'
                   ), 0) required_minutes,
                   coalesce((
                       select sum(te.actual_minutes)
                       from roadops.plan_items pi
                       join roadops.work_orders wo on wo.plan_item_id = pi.id and wo.status='verified'
                       join roadops.time_entries te on te.work_order_id = wo.id
                         and te.approved_at is not null and te.approved_by is not null
                       where pi.annual_program_item_id = api.id
                   ), 0) completed_minutes
            from roadops.annual_program_items api
            join roadops.annual_programs ap on ap.id = api.annual_program_id
            join roadops.road_versions rv on rv.road_id = api.road_id and rv.valid_until is null
            join roadops.iqn_work_variants v on v.id = api.work_variant_id
            join roadops.iqn_work_items wi on wi.id = v.work_item_id
            join roadops.iqn_documents doc on doc.id = wi.document_id
            where true
        SQL;
    }

    /** @return array<string, mixed> */
    private function payload(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'programId' => (string) $row->program_id,
            'year' => (int) $row->program_year,
            'plannedFrom' => (string) $row->period_start,
            'plannedUntil' => (string) $row->period_end,
            'generation' => $row->generation_snapshot === null ? null : json_decode((string) $row->generation_snapshot, true, 512, JSON_THROW_ON_ERROR),
            'road' => ['code' => (string) $row->road_code, 'name' => (string) $row->road_name],
            'workName' => (string) $row->work_name,
            'normReference' => (string) $row->norm_reference,
            'quantity' => [
                'planned' => (string) $row->planned_quantity,
                'completed' => (string) $row->completed_quantity,
                'unit' => (string) $row->work_unit,
            ],
            'laborHours' => [
                'required' => number_format((int) $row->required_minutes / 60, 2, '.', ''),
                'completed' => number_format((int) $row->completed_minutes / 60, 2, '.', ''),
            ],
            'approvalState' => match ((string) $row->status) {
                'approved' => 'APPROVED',
                'closed', 'cancelled' => 'CLOSED',
                default => 'DRAFT',
            },
        ];
    }

    /** @param list<stdClass> $rows */
    private function spreadsheet(array $rows, int $year): Spreadsheet
    {
        $spreadsheet = new Spreadsheet;
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle((string) $year);
        $headers = [
            'Yo‘l kodi', 'Yo‘l nomi', 'Ish turi', 'IQN manbasi',
            'Reja hajmi', 'Bajarilgan hajm', 'Birlik',
            'Talab etilgan mehnat, soat', 'Bajarilgan mehnat, soat', 'Holat',
            'Davr boshlanishi', 'Davr yakuni (kirmaydi)',
        ];
        foreach ($headers as $index => $header) {
            $sheet->setCellValueExplicit(
                Coordinate::stringFromColumnIndex($index + 1).'1',
                $header,
                DataType::TYPE_STRING,
            );
        }
        $sheet->getStyle('A1:L1')->getFont()->setBold(true)->getColor()->setARGB('FFFFFFFF');
        $sheet->getStyle('A1:L1')->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF073451');
        foreach ($rows as $position => $row) {
            $payload = $this->payload($row);
            $values = [
                $payload['road']['code'], $payload['road']['name'], $payload['workName'],
                $payload['normReference'], $payload['quantity']['planned'],
                $payload['quantity']['completed'], $payload['quantity']['unit'],
                $payload['laborHours']['required'], $payload['laborHours']['completed'],
                $payload['approvalState'],
                $payload['plannedFrom'], $payload['plannedUntil'],
            ];
            foreach ($values as $index => $value) {
                // Integration-provided values are text, never spreadsheet formulas.
                $sheet->setCellValueExplicit(
                    Coordinate::stringFromColumnIndex($index + 1).($position + 2),
                    (string) $value,
                    DataType::TYPE_STRING,
                );
            }
        }
        foreach (range('A', 'L') as $column) {
            $sheet->getColumnDimension($column)->setAutoSize(true);
        }
        $sheet->freezePane('A2');
        $sheet->setAutoFilter('A1:L'.max(1, count($rows) + 1));

        return $spreadsheet;
    }
}
