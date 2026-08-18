<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Resources\MonthlyTimesheetReader;
use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\Request;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use stdClass;
use Symfony\Component\HttpFoundation\Response;

final class ReportController extends Controller
{
    public function __construct(private readonly MonthlyTimesheetReader $timesheetReader) {}

    public function timesheet(Request $request, ApiScope $scope): Response
    {
        $validated = $request->validate([
            'year' => ['required', 'integer', 'between:2020,2100'],
            'month' => ['required', 'integer', 'between:1,12'],
        ]);
        $timesheet = $this->timesheetReader->read(
            $scope->roadUnitIds($request),
            (int) $validated['year'],
            (int) $validated['month'],
        );

        return $this->xlsxResponse('timesheet', $timesheet);
    }

    public function roadVisionFindings(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('roadvision-findings', $request, $scope);
    }

    public function manualInspections(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('manual-inspections', $request, $scope);
    }

    public function confirmedDefects(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('confirmed-defects', $request, $scope);
    }

    public function plans(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('plans', $request, $scope);
    }

    public function workOrders(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('work-orders', $request, $scope);
    }

    public function annualProgram(Request $request, ApiScope $scope): Response
    {
        $validated = $request->validate([
            'year' => ['required', 'integer', 'between:2020,2100'],
        ]);

        return $this->xlsxResponse(
            'annual-program',
            null,
            $scope->pgUuidArray($scope->roadUnitIds($request)),
            (int) $validated['year'],
        );
    }

    public function workers(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('workers', $request, $scope);
    }

    public function equipment(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('equipment', $request, $scope);
    }

    public function warehouse(Request $request, ApiScope $scope): Response
    {
        return $this->scopedXlsxResponse('warehouse', $request, $scope);
    }

    public function auditLog(): Response
    {
        return $this->xlsxResponse('audit-log');
    }

    public function dailyBrief(Request $request, ApiScope $scope): Response
    {
        return $this->dailyBriefPdf(
            $scope->pgUuidArray($scope->roadUnitIds($request)),
        );
    }

    private function scopedXlsxResponse(string $report, Request $request, ApiScope $scope): Response
    {
        return $this->xlsxResponse(
            $report,
            null,
            $scope->pgUuidArray($scope->roadUnitIds($request)),
        );
    }

    /**
     * @param array{
     *   daysInMonth: int,
     *   rows: list<array{
     *     fullName: string,
     *     personnelNumber: string,
     *     positionName: string,
     *     entries: list<array{minutes: int, state: string}>,
     *     totalMinutes: int
     *   }>
     * }|null $timesheet
     */
    private function xlsxResponse(
        string $report,
        ?array $timesheet = null,
        ?string $divisionIds = null,
        ?int $year = null,
    ): Response {
        [$headers, $rows] = $this->xlsxData($report, $timesheet, $divisionIds, $year);
        $spreadsheet = $this->spreadsheet($report, $headers, $rows);

        return response()->streamDownload(
            static function () use ($spreadsheet): void {
                (new Xlsx($spreadsheet))->save('php://output');
                $spreadsheet->disconnectWorksheets();
            },
            $report.'-'.now('Asia/Tashkent')->format('Ymd-His').'.xlsx',
            ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        );
    }

    /**
     * @param array{
     *   daysInMonth: int,
     *   rows: list<array{
     *     fullName: string,
     *     personnelNumber: string,
     *     positionName: string,
     *     entries: list<array{minutes: int, state: string}>,
     *     totalMinutes: int
     *   }>
     * }|null $timesheet
     * @return array{list<string>, list<list<string>>}
     */
    private function xlsxData(
        string $report,
        ?array $timesheet = null,
        ?string $divisionIds = null,
        ?int $year = null,
    ): array {
        $scopedReports = [
            'roadvision-findings', 'manual-inspections', 'confirmed-defects', 'plans',
            'work-orders', 'annual-program', 'workers', 'equipment', 'warehouse',
        ];
        if (in_array($report, $scopedReports, true) && $divisionIds === null) {
            throw new \LogicException('A road-unit scope is required for this export.');
        }

        if ($report === 'roadvision-findings') {
            $rows = DbRows::select(
                <<<'SQL'
                    select c.external_candidate_id, c.observed_at, c.ingested_at,
                           rv.official_code, rv.name road_name, dv.name division_name,
                           lower(c.chainage_span) chainage_from, upper(c.chainage_span) chainage_to,
                           c.lane_label, coalesce(ac.external_name, dt.name, 'Moslanmagan atribut') finding_name,
                           c.status, verification.measured_quantity,
                           verification.measurement_unit, verification.note
                    from roadops.roadvision_candidates c
                    join roadops.road_versions rv on rv.road_id=c.road_id and rv.valid_until is null
                    cross join lateral (
                      select roadops.division_for_road_zone(c.road_id, c.chainage_span, c.observed_at) division_id
                    ) owner
                    join roadops.road_division_versions dv
                      on dv.division_id=owner.division_id and dv.valid_until is null
                    left join roadops.roadvision_attribute_catalog ac on ac.id=c.attribute_catalog_id
                    left join roadops.defect_types dt on dt.id=c.defect_type_id
                    left join roadops.roadvision_candidate_verifications verification
                      on verification.candidate_id=c.id
                    where owner.division_id=any(?::uuid[])
                    order by c.observed_at desc, c.id desc
                SQL,
                [$divisionIds],
            );

            return [[
                'RoadVision ID', 'Kuzatilgan vaqt', 'Qabul qilingan vaqt', 'Yo‘l kodi',
                'Yo‘l nomi', 'Bo‘lim', 'Boshlanish, m', 'Tugash, m', 'Yo‘lak',
                'Aniqlangan holat', 'Holat', 'Tasdiqlangan hajm', 'Birlik', 'Izoh',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->external_candidate_id, (string) $row->observed_at,
                (string) $row->ingested_at, (string) $row->official_code,
                (string) $row->road_name, (string) $row->division_name,
                $row->chainage_from === null ? '' : (string) $row->chainage_from,
                $row->chainage_to === null ? '' : (string) $row->chainage_to,
                $row->lane_label === null ? '' : (string) $row->lane_label,
                (string) $row->finding_name, (string) $row->status,
                $row->measured_quantity === null ? '' : (string) $row->measured_quantity,
                $row->measurement_unit === null ? '' : (string) $row->measurement_unit,
                $row->note === null ? '' : (string) $row->note,
            ], $rows)];
        }

        if ($report === 'manual-inspections') {
            $rows = DbRows::select(
                <<<'SQL'
                    select inspection.inspection_number, inspection.inspection_started_at,
                           inspection.status, inspector.full_name inspector_name,
                           rv.official_code, rv.name road_name, dv.name division_name,
                           lower(observation.chainage_span) chainage_from,
                           upper(observation.chainage_span) chainage_to,
                           observation.lane_label, defect.name defect_name,
                           observation.measured_quantity, observation.measurement_unit,
                           observation.review_status, observation.description,
                           observation.review_note
                    from roadops.inspections inspection
                    join roadops.inspection_observations observation
                      on observation.inspection_id=inspection.id
                    join roadops.app_users inspector on inspector.id=inspection.inspector_user_id
                    join roadops.road_versions rv on rv.road_id=inspection.road_id and rv.valid_until is null
                    join roadops.road_division_versions dv
                      on dv.division_id=inspection.division_id and dv.valid_until is null
                    join roadops.defect_types defect on defect.id=observation.defect_type_id
                    where inspection.division_id=any(?::uuid[])
                    order by inspection.inspection_started_at desc, inspection.id, observation.observed_at
                SQL,
                [$divisionIds],
            );

            return [[
                'Ko‘rik raqami', 'Ko‘rik vaqti', 'Ko‘rik holati', 'Inspektor', 'Yo‘l kodi',
                'Yo‘l nomi', 'Bo‘lim', 'Boshlanish, m', 'Tugash, m', 'Yo‘lak', 'Nuqson turi',
                'Aniq hajm', 'Birlik', 'Tekshiruv holati', 'Tavsif', 'Tekshiruvchi izohi',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->inspection_number, (string) $row->inspection_started_at,
                (string) $row->status, (string) $row->inspector_name,
                (string) $row->official_code, (string) $row->road_name,
                (string) $row->division_name, (string) $row->chainage_from,
                (string) $row->chainage_to,
                $row->lane_label === null ? '' : (string) $row->lane_label,
                (string) $row->defect_name, (string) $row->measured_quantity,
                (string) $row->measurement_unit, (string) $row->review_status,
                $row->description === null ? '' : (string) $row->description,
                $row->review_note === null ? '' : (string) $row->review_note,
            ], $rows)];
        }

        if ($report === 'confirmed-defects') {
            $rows = DbRows::select(
                <<<'SQL'
                    select defect.id, defect.source_kind, defect.observed_at, defect.verified_at,
                           rv.official_code, rv.name road_name, dv.name division_name,
                           lower(defect.chainage_span) chainage_from,
                           upper(defect.chainage_span) chainage_to,
                           kind.name defect_name, defect.measured_quantity,
                           defect.measurement_unit, defect.status, defect.description
                    from roadops.defect_cases defect
                    join roadops.road_versions rv on rv.road_id=defect.road_id and rv.valid_until is null
                    join roadops.defect_types kind on kind.id=defect.defect_type_id
                    cross join lateral (
                      select roadops.division_for_road_zone(
                        defect.road_id, defect.chainage_span, defect.observed_at
                      ) division_id
                    ) owner
                    join roadops.road_division_versions dv
                      on dv.division_id=owner.division_id and dv.valid_until is null
                    where owner.division_id=any(?::uuid[])
                    order by defect.verified_at desc, defect.id
                SQL,
                [$divisionIds],
            );

            return [[
                'Nuqson ID', 'Manba', 'Kuzatilgan vaqt', 'Tasdiqlangan vaqt', 'Yo‘l kodi',
                'Yo‘l nomi', 'Bo‘lim', 'Boshlanish, m', 'Tugash, m', 'Nuqson turi',
                'Aniq hajm', 'Birlik', 'Holat', 'Tavsif',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->id, (string) $row->source_kind, (string) $row->observed_at,
                (string) $row->verified_at, (string) $row->official_code,
                (string) $row->road_name, (string) $row->division_name,
                (string) $row->chainage_from, (string) $row->chainage_to,
                (string) $row->defect_name, (string) $row->measured_quantity,
                (string) $row->measurement_unit, (string) $row->status,
                $row->description === null ? '' : (string) $row->description,
            ], $rows)];
        }

        if ($report === 'plans') {
            $rows = DbRows::select(
                <<<'SQL'
                    select run.id, lower(run.planning_window) date_from,
                           upper(run.planning_window) - 1 date_to, run.planning_mode,
                           run.status, division.name division_name, creator.full_name creator_name,
                           count(distinct item.id) item_count,
                           count(distinct blocker.id) filter (where blocker.resolved_at is null) blocker_count,
                           run.created_at, run.approved_at, run.published_at
                    from roadops.planning_runs run
                    join roadops.road_division_versions division
                      on division.division_id=run.division_id and division.valid_until is null
                    join roadops.app_users creator on creator.id=run.created_by
                    left join roadops.plan_items item on item.planning_run_id=run.id
                    left join roadops.planning_blockers blocker on blocker.planning_run_id=run.id
                    where run.division_id=any(?::uuid[])
                    group by run.id, division.name, creator.full_name
                    order by run.created_at desc, run.id
                SQL,
                [$divisionIds],
            );

            return [[
                'Reja ID', 'Boshlanish sanasi', 'Tugash sanasi', 'Rejalash turi', 'Holat',
                'Bo‘lim', 'Tuzuvchi', 'Ishlar soni', 'Ochiq to‘siqlar', 'Tuzilgan vaqt',
                'Tasdiqlangan vaqt', 'E’lon qilingan vaqt',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->id, (string) $row->date_from, (string) $row->date_to,
                (string) $row->planning_mode, (string) $row->status,
                (string) $row->division_name, (string) $row->creator_name,
                (string) $row->item_count, (string) $row->blocker_count,
                (string) $row->created_at,
                $row->approved_at === null ? '' : (string) $row->approved_at,
                $row->published_at === null ? '' : (string) $row->published_at,
            ], $rows)];
        }

        if ($report === 'workers') {
            $rows = DbRows::select(
                <<<'SQL'
                    select worker.id, version.personnel_number, version.full_name,
                           coalesce(version.position_name, assignment.job_title, '') position_name,
                           division.name division_name, version.employment_state
                    from roadops.workers worker
                    join roadops.worker_versions version
                      on version.worker_id=worker.id and version.valid_until is null
                    join roadops.worker_division_assignments assignment
                      on assignment.worker_id=worker.id
                     and assignment.valid_from <= current_date
                     and (assignment.valid_until is null or assignment.valid_until > current_date)
                    join roadops.road_division_versions division
                      on division.division_id=assignment.division_id and division.valid_until is null
                    where assignment.division_id=any(?::uuid[]) and worker.retired_at is null
                    order by division.name, version.full_name, worker.id
                SQL,
                [$divisionIds],
            );

            return [[
                'Xodim ID', 'Tabel raqami', 'F.I.Sh.', 'Lavozim', 'Bo‘lim', 'Bandlik holati',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->id, (string) $row->personnel_number,
                (string) $row->full_name, (string) $row->position_name,
                (string) $row->division_name, (string) $row->employment_state,
            ], $rows)];
        }

        if ($report === 'equipment') {
            $rows = DbRows::select(
                <<<'SQL'
                    select equipment.id, equipment.inventory_code, equipment.name,
                           coalesce(equipment.attributes->>'model', '') model,
                           division.name division_name, equipment.state,
                           equipment.effective_from, equipment.effective_until
                    from roadops.equipment_units equipment
                    join roadops.road_division_versions division
                      on division.division_id=equipment.division_id and division.valid_until is null
                    where equipment.division_id=any(?::uuid[])
                    order by division.name, equipment.name, equipment.id
                SQL,
                [$divisionIds],
            );

            return [[
                'Texnika ID', 'Inventar raqami', 'Nomi', 'Model', 'Bo‘lim', 'Holat',
                'Amal boshlanishi', 'Amal tugashi',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->id, (string) $row->inventory_code, (string) $row->name,
                (string) $row->model, (string) $row->division_name, (string) $row->state,
                (string) $row->effective_from,
                $row->effective_until === null ? '' : (string) $row->effective_until,
            ], $rows)];
        }

        if ($report === 'warehouse') {
            $rows = DbRows::select(
                <<<'SQL'
                    select material.code, material.name, material.unit,
                           stock.on_hand_quantity, location.code location_code,
                           location.name location_name, division.name division_name
                    from roadops.current_stock_balances stock
                    join roadops.stock_locations location on location.id=stock.stock_location_id
                    join roadops.materials material on material.id=stock.material_id
                    join roadops.road_division_versions division
                      on division.division_id=location.division_id and division.valid_until is null
                    where location.division_id=any(?::uuid[])
                    order by division.name, location.name, material.name, material.id
                SQL,
                [$divisionIds],
            );

            return [[
                'Material kodi', 'Material', 'Birlik', 'Mavjud qoldiq',
                'Ombor kodi', 'Ombor', 'Bo‘lim',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->code, (string) $row->name, (string) $row->unit,
                (string) $row->on_hand_quantity, (string) $row->location_code,
                (string) $row->location_name, (string) $row->division_name,
            ], $rows)];
        }

        if ($report === 'work-orders') {
            $rows = DbRows::select(
                <<<'SQL'
                    select wo.order_number, coalesce(wi.normalized_name, dt.name, 'Ish turi ko‘rsatilmagan') work_name,
                           rv.official_code, rv.name road_name,
                           lower(pi.chainage_span) chainage_from, upper(pi.chainage_span) chainage_to,
                           (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date scheduled_date,
                           pi.work_quantity planned_quantity, pi.work_unit planned_unit,
                           case when wo.status='verified' and cr.verified_at is not null
                             then cr.completed_quantity end verified_quantity,
                           case when wo.status='verified' and cr.verified_at is not null
                             then cr.work_unit end verified_unit,
                           case when wo.status='verified' and cr.verified_at is not null then coalesce((
                             select sum(te.actual_minutes)
                             from roadops.time_entries te
                             where te.work_order_id=wo.id
                               and te.approved_at is not null and te.approved_by is not null
                           ),0) end verified_labor_minutes,
                           case when wo.status='verified' and cr.verified_at is not null
                             then wo.completed_at end completed_at,
                           case when wo.status='verified' and cr.verified_at is not null
                             then cr.verified_at end verified_at,
                           wo.status
                    from roadops.work_orders wo
                    join roadops.plan_items pi on pi.id = wo.plan_item_id
                    join roadops.planning_runs run on run.id = pi.planning_run_id
                    join roadops.road_versions rv on rv.road_id = pi.road_id and rv.valid_until is null
                    left join roadops.iqn_work_variants v on v.id = pi.work_variant_id
                    left join roadops.iqn_work_items wi on wi.id = v.work_item_id
                    left join roadops.defect_cases dc on dc.id = pi.defect_case_id
                    left join roadops.defect_types dt on dt.id = dc.defect_type_id
                    left join roadops.work_completion_records cr on cr.work_order_id=wo.id
                    where run.division_id=any(?::uuid[])
                    order by coalesce(lower(pi.scheduled_window), wo.issued_at), wo.order_number
                SQL,
                [$divisionIds],
            );

            return [[
                'Topshiriq', 'Ish turi', 'Yo‘l kodi', 'Yo‘l nomi', 'Boshlanish, m',
                'Tugash, m', 'Reja sanasi', 'Reja hajmi', 'Reja birligi',
                'Tasdiqlangan haqiqiy hajm', 'Haqiqiy birlik',
                'Tasdiqlangan mehnat, daqiqa', 'Bajarilgan vaqt', 'Tasdiqlangan vaqt', 'Holat',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->order_number, (string) $row->work_name,
                (string) $row->official_code, (string) $row->road_name,
                (string) $row->chainage_from, (string) $row->chainage_to,
                $row->scheduled_date === null ? '' : (string) $row->scheduled_date,
                $row->planned_quantity === null ? '' : (string) $row->planned_quantity,
                $row->planned_unit === null ? '' : (string) $row->planned_unit,
                $row->verified_quantity === null ? '' : (string) $row->verified_quantity,
                $row->verified_unit === null ? '' : (string) $row->verified_unit,
                $row->verified_labor_minutes === null ? '' : (string) $row->verified_labor_minutes,
                $row->completed_at === null ? '' : (string) $row->completed_at,
                $row->verified_at === null ? '' : (string) $row->verified_at,
                (string) $row->status,
            ], $rows)];
        }

        if ($report === 'annual-program') {
            if ($year === null) {
                throw new \LogicException('A year is required for the annual-program export.');
            }
            $rows = DbRows::select(
                <<<'SQL'
                    select ap.program_year, rv.official_code, rv.name road_name,
                           wi.normalized_name work_name,
                           concat(doc.code, coalesce(' · ' || nullif(wi.raw_code, ''), '')) norm_reference,
                           api.planned_quantity, api.work_unit, ap.status
                    from roadops.annual_program_items api
                    join roadops.annual_programs ap on ap.id = api.annual_program_id
                    join roadops.road_versions rv on rv.road_id = api.road_id and rv.valid_until is null
                    join roadops.iqn_work_variants v on v.id = api.work_variant_id
                    join roadops.iqn_work_items wi on wi.id = v.work_item_id
                    join roadops.iqn_documents doc on doc.id = wi.document_id
                    where ap.division_id=any(?::uuid[]) and ap.program_year=?
                    order by ap.program_year desc, rv.official_code, wi.normalized_name
                SQL,
                [$divisionIds, $year],
            );

            return [[
                'Yil', 'Yo‘l kodi', 'Yo‘l nomi', 'Ish turi', 'IQN manbasi',
                'Reja hajmi', 'Birlik', 'Holat',
            ], array_map(static fn (stdClass $row): array => [
                (string) $row->program_year, (string) $row->official_code,
                (string) $row->road_name, (string) $row->work_name,
                (string) $row->norm_reference, (string) $row->planned_quantity,
                (string) $row->work_unit, (string) $row->status,
            ], $rows)];
        }

        if ($report === 'timesheet') {
            if ($timesheet === null) {
                throw new \LogicException('Timesheet data is required for export.');
            }
            $headers = ['Xodim', 'Tabel raqami', 'Lavozim'];
            for ($day = 1; $day <= $timesheet['daysInMonth']; $day++) {
                $headers[] = (string) $day;
            }
            $headers[] = 'Jami, soat';
            $rows = array_values(array_map(static function (array $worker): array {
                $values = [
                    (string) $worker['fullName'],
                    (string) $worker['personnelNumber'],
                    (string) $worker['positionName'],
                ];
                foreach ($worker['entries'] as $entry) {
                    $values[] = match ($entry['state']) {
                        'LEAVE' => 'T',
                        'SICK' => 'K',
                        'ABSENT' => 'Y',
                        'REST' => 'D',
                        'OUTSIDE_ASSIGNMENT' => '—',
                        default => rtrim(rtrim(number_format($entry['minutes'] / 60, 1, '.', ''), '0'), '.'),
                    };
                }
                $values[] = rtrim(rtrim(number_format($worker['totalMinutes'] / 60, 1, '.', ''), '0'), '.');

                return $values;
            }, $timesheet['rows']));

            return [$headers, $rows];
        }

        $rows = DbRows::select(
            <<<'SQL'
                select ae.occurred_at, coalesce(u.full_name, 'Tizim') actor,
                       ae.action, ae.entity_type, ae.entity_id, ae.request_id
                from roadops.audit_events ae
                left join roadops.app_users u on u.id = ae.actor_user_id
                order by ae.occurred_at desc, ae.id desc
            SQL,
        );

        return [[
            'Vaqt', 'Bajaruvchi', 'Harakat', 'Yozuv turi', 'Yozuv ID', 'So‘rov ID',
        ], array_map(static fn (stdClass $row): array => [
            (string) $row->occurred_at, (string) $row->actor, (string) $row->action,
            (string) $row->entity_type, $row->entity_id === null ? '' : (string) $row->entity_id,
            $row->request_id === null ? '' : (string) $row->request_id,
        ], $rows)];
    }

    /**
     * @param  list<string>  $headers
     * @param  list<list<string>>  $rows
     */
    private function spreadsheet(string $title, array $headers, array $rows): Spreadsheet
    {
        $spreadsheet = new Spreadsheet;
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle(mb_substr(str_replace('-', ' ', $title), 0, 31));
        foreach ($headers as $index => $header) {
            $cell = Coordinate::stringFromColumnIndex($index + 1).'1';
            $sheet->setCellValueExplicit($cell, $header, DataType::TYPE_STRING);
        }
        foreach ($rows as $rowIndex => $values) {
            foreach ($values as $columnIndex => $value) {
                $cell = Coordinate::stringFromColumnIndex($columnIndex + 1).($rowIndex + 2);
                // External source values are always written as text to prevent spreadsheet formula injection.
                $sheet->setCellValueExplicit($cell, $value, DataType::TYPE_STRING);
            }
        }
        $lastColumn = Coordinate::stringFromColumnIndex(count($headers));
        $sheet->getStyle('A1:'.$lastColumn.'1')->getFont()->setBold(true)->getColor()->setARGB('FFFFFFFF');
        $sheet->getStyle('A1:'.$lastColumn.'1')->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF073451');
        foreach (range(1, count($headers)) as $column) {
            $sheet->getColumnDimension(Coordinate::stringFromColumnIndex($column))->setAutoSize(true);
        }
        $sheet->freezePane('A2');
        $sheet->setAutoFilter('A1:'.$lastColumn.max(1, count($rows) + 1));

        return $spreadsheet;
    }

    private function dailyBriefPdf(string $divisionIds): Response
    {
        $counts = DbRows::selectOne(
            <<<'SQL'
                select
                  (select count(*) from roadops.roadvision_candidates candidate
                    join roadops.road_versions candidate_road
                      on candidate_road.road_id=candidate.road_id and candidate_road.valid_until is null
                    where candidate.status in ('received', 'unmatched', 'awaiting_verification')
                      and roadops.division_for_road_zone(
                        candidate.road_id, candidate.chainage_span, candidate.observed_at
                      ) = any(?::uuid[])) review_queue,
                  (select count(*) from roadops.work_orders work_order
                    join roadops.plan_items item on item.id=work_order.plan_item_id
                    join roadops.planning_runs run on run.id=item.planning_run_id
                    join roadops.road_versions order_road
                      on order_road.road_id=item.road_id and order_road.valid_until is null
                    where work_order.status in ('issued', 'accepted', 'in_progress', 'paused')
                      and run.division_id=any(?::uuid[])) open_orders,
                  (select count(*) from roadops.sync_runs
                    where status in ('failed', 'partially_succeeded')
                      and started_at >= now() - interval '7 days') failed_syncs
            SQL,
            [$divisionIds, $divisionIds],
        );
        if ($counts === null) {
            throw new \RuntimeException('Daily report counters could not be read.');
        }
        $lines = [
            'YAGONA YOL - KUNLIK OPERATIV MALUMOTNOMA',
            'Sana: '.now('Asia/Tashkent')->format('Y-m-d H:i'),
            '',
            'Korib chiqiladigan RoadVision yozuvlari: '.(int) $counts->review_queue,
            'Ochiq ish topshiriqlari: '.(int) $counts->open_orders,
            'Tekshiriladigan integratsiya almashinuvlari: '.(int) $counts->failed_syncs,
            '',
            'Eslatma: ushbu hisobot narx yoki pul hisob-kitobini oz ichiga olmaydi.',
        ];
        $pdf = $this->simplePdf($lines);

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="daily-brief-'.now('Asia/Tashkent')->format('Ymd-His').'.pdf"',
            'Content-Length' => (string) strlen($pdf),
        ]);
    }

    /** @param list<string> $lines */
    private function simplePdf(array $lines): string
    {
        $content = "BT\n/F1 11 Tf\n50 790 Td\n";
        foreach ($lines as $position => $line) {
            if ($position > 0) {
                $content .= "0 -20 Td\n";
            }
            $ascii = str_replace(
                ['‘', '’', '“', '”', '–', '—', 'o‘', 'O‘', 'g‘', 'G‘'],
                ["'", "'", '"', '"', '-', '-', "o'", "O'", "g'", "G'"],
                $line,
            );
            $ascii = preg_replace('/[^\x20-\x7E]/u', '?', $ascii) ?? '';
            $escaped = str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $ascii);
            $content .= '('.$escaped.") Tj\n";
        }
        $content .= "ET\n";

        $objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            '<< /Length '.strlen($content)." >>\nstream\n".$content.'endstream',
        ];
        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        foreach ($objects as $index => $object) {
            $offsets[] = strlen($pdf);
            $pdf .= ($index + 1)." 0 obj\n".$object."\nendobj\n";
        }
        $xref = strlen($pdf);
        $pdf .= "xref\n0 6\n0000000000 65535 f \n";
        for ($index = 1; $index <= 5; $index++) {
            $pdf .= str_pad((string) $offsets[$index], 10, '0', STR_PAD_LEFT)." 00000 n \n";
        }
        $pdf .= "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF\n";

        return $pdf;
    }
}
