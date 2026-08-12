<?php

namespace App\Domain\Resources;

use App\Support\DbRows;
use stdClass;

final class MonthlyTimesheetReader
{
    /**
     * @param  list<string>  $divisionIds
     * @return array{
     *   year: int,
     *   month: int,
     *   daysInMonth: int,
     *   divisionName: string,
     *   rows: list<array{
     *     workerId: string,
     *     fullName: string,
     *     personnelNumber: string,
     *     positionName: string,
     *     entries: list<array{day: int, minutes: int, state: string}>,
     *     totalMinutes: int
     *   }>
     * }
     */
    public function read(array $divisionIds, int $year, int $month): array
    {
        $monthStart = sprintf('%04d-%02d-01', $year, $month);
        $monthEnd = (new \DateTimeImmutable($monthStart))->modify('+1 month')->format('Y-m-d');
        $daysInMonth = (int) (new \DateTimeImmutable($monthStart))->format('t');
        $pgDivisionIds = '{'.implode(',', $divisionIds).'}';

        $divisionNames = DbRows::select(
            <<<'SQL'
                select dv.name
                from roadops.road_division_versions dv
                where dv.division_id = any(?::uuid[]) and dv.valid_until is null
                order by dv.name, dv.division_id
            SQL,
            [$pgDivisionIds],
        );
        $workers = DbRows::select(
            <<<'SQL'
                select distinct on (w.id)
                       w.id, profile.personnel_number, profile.full_name,
                       coalesce(profile.position_name, assignment.job_title, 'Lavozim kiritilmagan') position_name
                from roadops.workers w
                join roadops.worker_division_assignments assignment
                  on assignment.worker_id = w.id
                 and assignment.division_id = any(?::uuid[])
                 and daterange(assignment.valid_from, coalesce(assignment.valid_until, 'infinity'::date), '[)')
                     && daterange(?::date, ?::date, '[)')
                join lateral (
                  select wv.personnel_number, wv.full_name, wv.position_name,
                         wv.valid_from, wv.valid_until
                  from roadops.worker_versions wv
                  where wv.worker_id = w.id
                    and wv.employment_state = 'active'
                    and tstzrange(wv.valid_from, coalesce(wv.valid_until, 'infinity'::timestamptz), '[)')
                        && tstzrange(?::date::timestamptz, ?::date::timestamptz, '[)')
                  order by wv.valid_from desc, wv.id
                  limit 1
                ) profile on true
                where w.retired_at is null or w.retired_at >= ?::date::timestamptz
                order by w.id, assignment.valid_from desc, profile.valid_from desc, assignment.id
            SQL,
            [$pgDivisionIds, $monthStart, $monthEnd, $monthStart, $monthEnd, $monthStart],
        );

        $workerIds = array_map(static fn (stdClass $worker): string => (string) $worker->id, $workers);
        $minutesByWorkerDay = [];
        $availabilityByWorkerDay = [];
        $activeByWorkerDay = [];
        if ($workerIds !== []) {
            $pgWorkerIds = '{'.implode(',', $workerIds).'}';
            $activeRows = DbRows::select(
                <<<'SQL'
                    select distinct assignment.worker_id, day.work_date::date work_date
                    from generate_series(?::date, ?::date - 1, interval '1 day')
                         as day(work_date)
                    join roadops.worker_division_assignments assignment
                      on assignment.worker_id = any(?::uuid[])
                     and assignment.division_id = any(?::uuid[])
                     and assignment.valid_from <= day.work_date::date
                     and (assignment.valid_until is null
                          or assignment.valid_until > day.work_date::date)
                    join roadops.workers worker on worker.id = assignment.worker_id
                     and (worker.retired_at is null
                          or worker.retired_at > day.work_date::date::timestamptz)
                    where exists (
                      select 1
                      from roadops.worker_versions profile
                      where profile.worker_id = assignment.worker_id
                        and profile.employment_state = 'active'
                        and profile.valid_from < (day.work_date::date + 1)::timestamptz
                        and (profile.valid_until is null
                             or profile.valid_until > day.work_date::date::timestamptz)
                    )
                    order by assignment.worker_id, work_date
                SQL,
                [$monthStart, $monthEnd, $pgWorkerIds, $pgDivisionIds],
            );
            foreach ($activeRows as $row) {
                $activeByWorkerDay[(string) $row->worker_id][(string) $row->work_date] = true;
            }

            $timeRows = DbRows::select(
                <<<'SQL'
                    select te.worker_id, te.work_date,
                           least(sum(te.actual_minutes), 420)::integer actual_minutes
                    from roadops.time_entries te
                    join roadops.work_orders wo on wo.id = te.work_order_id
                    join roadops.plan_items pi on pi.id = wo.plan_item_id
                    join roadops.planning_runs run on run.id = pi.planning_run_id
                    where te.worker_id = any(?::uuid[])
                      and run.division_id = any(?::uuid[])
                      and te.work_date >= ?::date and te.work_date < ?::date
                    group by te.worker_id, te.work_date
                    order by te.worker_id, te.work_date
                SQL,
                [$pgWorkerIds, $pgDivisionIds, $monthStart, $monthEnd],
            );
            foreach ($timeRows as $row) {
                $minutesByWorkerDay[(string) $row->worker_id][(string) $row->work_date] = (int) $row->actual_minutes;
            }

            $availabilityRows = DbRows::select(
                <<<'SQL'
                    select distinct on (wa.worker_id, wa.work_date)
                           wa.worker_id, wa.work_date, wa.availability_code
                    from roadops.worker_availability wa
                    where wa.worker_id = any(?::uuid[])
                      and wa.work_date >= ?::date and wa.work_date < ?::date
                      and wa.retired_at is null
                    order by wa.worker_id, wa.work_date,
                             wa.source_updated_at desc nulls last,
                             wa.recorded_at desc, wa.id desc
                SQL,
                [$pgWorkerIds, $monthStart, $monthEnd],
            );
            foreach ($availabilityRows as $row) {
                $availabilityByWorkerDay[(string) $row->worker_id][(string) $row->work_date]
                    = (string) $row->availability_code;
            }
        }

        $rows = [];
        foreach ($workers as $worker) {
            $workerId = (string) $worker->id;
            $entries = [];
            $totalMinutes = 0;
            for ($day = 1; $day <= $daysInMonth; $day++) {
                $date = sprintf('%04d-%02d-%02d', $year, $month, $day);
                $minutes = min(420, max(0, (int) ($minutesByWorkerDay[$workerId][$date] ?? 0)));
                $availability = $availabilityByWorkerDay[$workerId][$date] ?? null;
                $active = $activeByWorkerDay[$workerId][$date] ?? false;
                $state = $active
                    ? $this->dayState($date, $minutes, $availability)
                    : 'OUTSIDE_ASSIGNMENT';
                if (! $active) {
                    $minutes = 0;
                }
                $entries[] = ['day' => $day, 'minutes' => $minutes, 'state' => $state];
                $totalMinutes += $minutes;
            }
            $rows[] = [
                'workerId' => $workerId,
                'fullName' => (string) $worker->full_name,
                'personnelNumber' => (string) $worker->personnel_number,
                'positionName' => (string) $worker->position_name,
                'entries' => $entries,
                'totalMinutes' => $totalMinutes,
            ];
        }
        usort($rows, static fn (array $left, array $right): int => [
            $left['fullName'], $left['personnelNumber'], $left['workerId'],
        ] <=> [
            $right['fullName'], $right['personnelNumber'], $right['workerId'],
        ]);

        return [
            'year' => $year,
            'month' => $month,
            'daysInMonth' => $daysInMonth,
            'divisionName' => implode(', ', array_map(
                static fn (stdClass $division): string => (string) $division->name,
                $divisionNames,
            )),
            'rows' => $rows,
        ];
    }

    private function dayState(string $date, int $minutes, ?string $availability): string
    {
        if ($minutes > 0) {
            return 'WORK';
        }

        return match ($availability) {
            'leave' => 'LEAVE',
            'sick' => 'SICK',
            'available', 'source_reported' => 'ABSENT',
            'not_scheduled', 'training' => 'REST',
            default => in_array((int) (new \DateTimeImmutable($date))->format('N'), [6, 7], true)
                ? 'REST'
                : 'ABSENT',
        };
    }
}
