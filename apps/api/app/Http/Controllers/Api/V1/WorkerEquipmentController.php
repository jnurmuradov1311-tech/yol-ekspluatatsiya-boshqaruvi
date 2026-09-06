<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Resources\WorkerEquipmentLifecycle;
use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;

final class WorkerEquipmentController extends Controller
{
    public function __construct(private readonly WorkerEquipmentLifecycle $lifecycle) {}

    public function show(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $validated = $request->validate(['asOf' => ['nullable', 'date_format:Y-m-d']]);
        $asOf = (string) ($validated['asOf'] ?? now('Asia/Tashkent')->format('Y-m-d'));
        $worker = $this->worker($request, $scope, $id);
        $norms = DbRows::select(<<<'SQL'
            select n.*, to_json(n.eligible_occupation_codes)::text occupation_codes,
                   roadops.worker_equipment_published_document(n.code, ?::date) is not null published
            from roadops.worker_equipment_norms n order by n.code
            SQL, [$asOf]);
        $items = DbRows::select(<<<'SQL'
            select i.*, m.name, m.unit, s.name stock_location_name
            from roadops.worker_equipment_issues i
            join roadops.materials m on m.id = i.material_id
            join roadops.stock_locations s on s.id = i.stock_location_id
            where i.worker_id = ?::uuid and i.division_id = ?::uuid and i.issued_on <= ?::date
            order by i.issued_on desc, i.id
            SQL, [$id, $worker->division_id, $asOf]);
        $stock = DbRows::select(<<<'SQL'
            select m.id material_id, m.name, m.unit, m.worker_equipment_norm_code,
                   s.id stock_location_id, s.name stock_location_name,
                   greatest(0, coalesce(b.on_hand_quantity, 0) - coalesce(r.quantity, 0)) available_quantity
            from roadops.materials m
            cross join roadops.stock_locations s
            left join roadops.current_stock_balances b on b.material_id = m.id and b.stock_location_id = s.id
            left join lateral (
              select sum(reservation.quantity) quantity from roadops.material_reservations reservation
              where reservation.material_id = m.id and reservation.stock_location_id = s.id
                and reservation.status = 'reserved'
            ) r on true
            where m.active and m.worker_equipment_norm_code is not null
              and s.active and s.division_id = ?::uuid
            order by m.name, s.name
            SQL, [$worker->division_id]);

        return response()->json(['data' => [
            'workerId' => $id,
            'name' => (string) $worker->full_name,
            'personnelNumber' => (string) $worker->personnel_number,
            'positionName' => (string) $worker->position_name,
            'occupationCode' => $worker->occupation_code,
            'divisionId' => (string) $worker->division_id,
            'asOf' => $asOf,
            'reminderDays' => 30,
            'canIssue' => (bool) DB::scalar('select roadops.has_permission(?, ?::uuid)', ['resources.manage', $worker->division_id]),
            'items' => array_map(fn (stdClass $item): array => $this->item($item, $asOf), $items),
            'norms' => array_map(static fn (stdClass $norm): array => [
                'code' => (string) $norm->code,
                'name' => (string) $norm->name,
                'serviceMonths' => (int) $norm->service_months,
                'sourceReference' => (string) $norm->source_reference,
                'allocationScope' => (string) $norm->allocation_scope,
                'departmentQuantity' => $norm->department_quantity === null ? null : (int) $norm->department_quantity,
                'eligibleOccupationCodes' => json_decode((string) $norm->occupation_codes, true, 512, JSON_THROW_ON_ERROR),
                'published' => (bool) $norm->published,
            ], $norms),
            'stockOptions' => array_map(static fn (stdClass $row): array => [
                'materialId' => (string) $row->material_id,
                'normCode' => (string) $row->worker_equipment_norm_code,
                'stockLocationId' => (string) $row->stock_location_id,
                'stockLocationName' => (string) $row->stock_location_name,
                'name' => (string) $row->name,
                'availableQuantity' => (float) $row->available_quantity,
                'unit' => (string) $row->unit,
            ], $stock),
        ]]);
    }

    public function store(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $validated = $request->validate([
            'materialId' => ['required', 'uuid'],
            'stockLocationId' => ['required', 'uuid'],
            'issuedOn' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.now('Asia/Tashkent')->format('Y-m-d')],
            'quantity' => ['required', 'integer', 'between:1,10000'],
            'occupationCode' => ['prohibited'],
            'note' => ['nullable', 'string', 'max:1000'],
            'serviceMonths' => ['prohibited'],
            'expiresOn' => ['prohibited'],
            'issuedBy' => ['prohibited'],
            'normCode' => ['prohibited'],
        ]);
        $this->worker($request, $scope, $id, false);
        $occupationCode = DB::scalar('select roadops.worker_equipment_occupation(?::uuid, ?::date)',
            [$id, $validated['issuedOn']], false);
        try {
            $row = DbRows::selectOneOrFail(<<<'SQL'
                select roadops.issue_worker_equipment(?::uuid, ?::uuid, ?::uuid, ?::date, ?::integer, ?::text, ?::text) id
                SQL, [
                $id, $validated['stockLocationId'], $validated['materialId'],
                $validated['issuedOn'], (int) $validated['quantity'],
                $occupationCode, $validated['note'] ?? null,
            ], false);
        } catch (QueryException $exception) {
            $messages = [
                'EQUIPMENT_ISSUE_FORBIDDEN' => 'Ushbu bo‘lim omboridan buyum biriktirishga ruxsat yo‘q.',
                'EQUIPMENT_WORKER_UNAVAILABLE' => 'Xodim ushbu bo‘limda faol emas yoki biriktirish sanasi mos kelmadi.',
                'EQUIPMENT_NORM_MISSING' => 'Buyum uchun IQN 03-24 me’yori kiritilmagan.',
                'EQUIPMENT_OCCUPATION_NOT_ELIGIBLE' => 'Tanlangan lavozimga ushbu buyum ajratilishi IQN 03-24 da belgilanmagan.',
                'EQUIPMENT_WORKER_OCCUPATION_UNCLASSIFIED' => 'Xodimning YTP tizimidagi lavozimi IQN 03-24 kasblariga moslashtirilmagan. Kadrlar ma’lumotini aniqlashtiring.',
                'EQUIPMENT_OCCUPATION_MISMATCH' => 'Buyum biriktirishdagi kasb xodimning tasdiqlangan lavozimiga mos emas.',
                'EQUIPMENT_IQN03_PUBLICATION_REQUIRED' => 'IQN 03-24 manbasi ekspert tomonidan tasdiqlanib katalogga kiritilishi kerak.',
                'EQUIPMENT_STOCK_INSUFFICIENT' => 'Omborda band qilinmagan buyum yetarli emas.',
                'EQUIPMENT_ISSUE_INPUT_INVALID' => 'Buyum soni yoki biriktirish sanasi noto‘g‘ri.',
            ];
            foreach ($messages as $code => $message) {
                if (str_contains($exception->getMessage(), $code)) {
                    return response()->json(['error' => ['code' => $code, 'message' => $message]],
                        $code === 'EQUIPMENT_ISSUE_FORBIDDEN' ? 403 : 409);
                }
            }
            throw $exception;
        }

        return response()->json(['data' => ['id' => (string) $row->id]], 201);
    }

    private function worker(Request $request, ApiScope $scope, string $id, bool $useReadPdo = true): stdClass
    {
        if (! Str::isUuid($id)) {
            abort(404);
        }
        $row = DbRows::selectOne(<<<'SQL'
            select w.id, v.full_name, v.personnel_number,
                   coalesce(a.job_title, v.position_name, '') position_name, a.division_id,
                   roadops.worker_equipment_occupation(w.id, (statement_timestamp() at time zone 'Asia/Tashkent')::date) occupation_code
            from roadops.workers w
            join roadops.worker_versions v on v.worker_id = w.id and v.valid_until is null
            join roadops.worker_division_assignments a on a.worker_id = w.id
              and a.valid_from <= (statement_timestamp() at time zone 'Asia/Tashkent')::date
              and (a.valid_until is null or a.valid_until > (statement_timestamp() at time zone 'Asia/Tashkent')::date)
            where w.id = ?::uuid and w.retired_at is null and a.division_id = any(?::uuid[])
            SQL, [$id, $scope->pgUuidArray($scope->roadUnitIds($request))], $useReadPdo);
        if ($row === null) {
            abort(404);
        }

        return $row;
    }

    /** @return array<string,mixed> */
    private function item(stdClass $row, string $asOf): array
    {
        return [
            'id' => (string) $row->id,
            'materialId' => (string) $row->material_id,
            'name' => (string) $row->name,
            'unit' => (string) $row->unit,
            'quantity' => (int) $row->quantity,
            'issuedOn' => (string) $row->issued_on,
            'serviceMonths' => (int) $row->service_months,
            'sourceReference' => (string) $row->source_reference,
            'allocationScope' => (string) $row->allocation_scope,
            'occupationCode' => (string) $row->occupation_code,
            'stockLocationName' => (string) $row->stock_location_name,
            ...$this->lifecycle->snapshot((string) $row->issued_on, (int) $row->service_months, $asOf),
        ];
    }
}
