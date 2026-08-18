<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use stdClass;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class AnnualProgramController extends Controller
{
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
        ];
        foreach ($headers as $index => $header) {
            $sheet->setCellValueExplicit(
                Coordinate::stringFromColumnIndex($index + 1).'1',
                $header,
                DataType::TYPE_STRING,
            );
        }
        $sheet->getStyle('A1:J1')->getFont()->setBold(true)->getColor()->setARGB('FFFFFFFF');
        $sheet->getStyle('A1:J1')->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB('FF073451');
        foreach ($rows as $position => $row) {
            $payload = $this->payload($row);
            $values = [
                $payload['road']['code'], $payload['road']['name'], $payload['workName'],
                $payload['normReference'], $payload['quantity']['planned'],
                $payload['quantity']['completed'], $payload['quantity']['unit'],
                $payload['laborHours']['required'], $payload['laborHours']['completed'],
                $payload['approvalState'],
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
        foreach (range('A', 'J') as $column) {
            $sheet->getColumnDimension($column)->setAutoSize(true);
        }
        $sheet->freezePane('A2');
        $sheet->setAutoFilter('A1:J'.max(1, count($rows) + 1));

        return $spreadsheet;
    }
}
