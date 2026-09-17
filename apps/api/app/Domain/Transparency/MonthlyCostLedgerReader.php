<?php

namespace App\Domain\Transparency;

use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\Pagination;
use RuntimeException;

/**
 * Read-only source trace. Currency is calculated in PostgreSQL NUMERIC and is
 * returned as decimal strings. Approved acts are recognized costs, not evidence
 * of a bank payment. Draft/submitted amounts never enter approved totals.
 */
final class MonthlyCostLedgerReader
{
    /**
     * @param  list<string>  $divisionIds
     * @return array<string, mixed>
     */
    public function costs(
        array $divisionIds,
        string $month,
        ?string $roadId,
        ?string $kind,
        ?string $state,
        Pagination $pagination,
    ): array {
        // One SQL statement gives rows and totals the same MVCC snapshot.
        $row = DbRows::selectOneOrFail(
            <<<'SQL'
                with params as (
                  select ?::uuid[] divisions, ?::date month_start, ?::uuid road_id,
                         ?::text kind, ?::text state, ?::integer page_size, ?::bigint row_offset
                ), filtered as materialized (
                  select l.*, a.status act_status, a.id act_id, a.act_number,
                         encode(a.snapshot_hash, 'hex') snapshot_hash,
                         i.work_order_id, i.order_number_snapshot, i.road_id_snapshot,
                         i.road_code_snapshot, i.road_name_snapshot,
                         i.work_code_snapshot, i.work_name_snapshot, i.norm_reference_snapshot,
                         coalesce(te.work_date, mu.used_at::timestamptz at time zone 'Asia/Tashkent',
                                  eu.usage_date)::date source_date,
                         coalesce(te.worker_id, mu.material_id, eu.equipment_unit_id) resource_id,
                         mu.inventory_transaction_id,
                         rate.version_no rate_version, rate.source_reference rate_reference,
                         norm.source_reference time_norm_reference
                  from roadops.monthly_completion_act_cost_lines l
                  join roadops.monthly_completion_act_items i on i.id=l.act_item_id
                  join roadops.monthly_completion_acts a on a.id=i.act_id
                  join roadops.cost_rate_versions rate on rate.id=l.cost_rate_version_id
                  left join roadops.monthly_work_time_norms norm on norm.id=l.monthly_work_time_norm_id
                  left join roadops.time_entries te on te.id=l.time_entry_id
                  left join roadops.work_order_material_usages mu on mu.id=l.material_usage_id
                  left join roadops.equipment_usage_entries eu on eu.id=l.equipment_usage_entry_id
                  cross join params p
                  where a.division_id=any(p.divisions) and a.act_month=p.month_start
                    and (p.road_id is null or i.road_id_snapshot=p.road_id)
                    and (p.kind is null or l.line_kind=p.kind)
                    and (p.state is null or a.status=p.state)
                ), totals as (
                  select count(*) total,
                         coalesce(sum(amount_uzs) filter (where act_status='approved'),0)::numeric(24,2)::text approved,
                         coalesce(sum(amount_uzs) filter (where act_status='submitted'),0)::numeric(24,2)::text submitted,
                         coalesce(sum(amount_uzs) filter (where act_status='draft'),0)::numeric(24,2)::text draft,
                         coalesce(sum(amount_uzs-social_amount_uzs) filter (where act_status='approved' and line_kind='labor'),0)::numeric(24,2)::text labor,
                         coalesce(sum(social_amount_uzs) filter (where act_status='approved'),0)::numeric(24,2)::text social,
                         coalesce(sum(amount_uzs) filter (where act_status='approved' and line_kind='material'),0)::numeric(24,2)::text material,
                         coalesce(sum(amount_uzs) filter (where act_status='approved' and line_kind='equipment'),0)::numeric(24,2)::text equipment
                  from filtered
                ), page_rows as (
                  select * from filtered order by source_date, order_number_snapshot, line_kind, id
                  limit (select page_size from params) offset (select row_offset from params)
                ), uncosted as (
                  select count(*) total
                  from roadops.work_orders wo
                  join roadops.plan_items pi on pi.id=wo.plan_item_id
                  join roadops.planning_runs run on run.id=pi.planning_run_id
                  join roadops.work_completion_records cr on cr.work_order_id=wo.id
                  cross join params p
                  where run.division_id=any(p.divisions)
                    and wo.status='verified' and cr.verified_at is not null
                    and (wo.completed_at at time zone 'Asia/Tashkent')::date>=p.month_start
                    and (wo.completed_at at time zone 'Asia/Tashkent')::date<(p.month_start+interval '1 month')::date
                    and (p.road_id is null or pi.road_id=p.road_id)
                    and not exists (select 1 from roadops.monthly_completion_act_items i where i.work_order_id=wo.id)
                )
                select jsonb_build_object(
                  'summary', jsonb_build_object(
                    'approvedAmountUzs', t.approved, 'submittedAmountUzs', t.submitted, 'draftAmountUzs', t.draft,
                    'laborAmountUzs', t.labor, 'socialAmountUzs', t.social,
                    'materialAmountUzs', t.material, 'equipmentAmountUzs', t.equipment,
                    'verifiedUncostedOrderCount', (select total from uncosted)
                  ),
                  'total', t.total,
                  'rows', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', f.id, 'kind', f.line_kind, 'state', upper(f.act_status), 'date', f.source_date,
                    'workOrderId', f.work_order_id, 'orderNumber', f.order_number_snapshot,
                    'road', jsonb_build_object('id', f.road_id_snapshot, 'code', f.road_code_snapshot, 'name', f.road_name_snapshot),
                    'work', jsonb_build_object('code', f.work_code_snapshot, 'name', f.work_name_snapshot, 'normReference', f.norm_reference_snapshot),
                    'act', jsonb_build_object('id', f.act_id, 'number', f.act_number, 'snapshotHash', f.snapshot_hash),
                    'resource', jsonb_build_object('id', f.resource_id, 'code', f.resource_code_snapshot, 'name', f.resource_name_snapshot, 'detail', f.resource_detail_snapshot),
                    'quantity', jsonb_build_object('value', f.source_quantity::text, 'unit', f.source_unit),
                    'rate', jsonb_build_object('id', f.cost_rate_version_id, 'version', f.rate_version,
                      'reference', f.rate_reference, 'basis', f.rate_basis_snapshot, 'amountUzs', f.rate_amount_uzs::text,
                      'denominatorQuantity', f.rate_denominator_quantity::text, 'unitRateUzs', f.unit_rate_uzs::text),
                    'source', jsonb_build_object('timeEntryId', f.time_entry_id, 'materialUsageId', f.material_usage_id,
                      'equipmentUsageEntryId', f.equipment_usage_entry_id, 'inventoryTransactionId', f.inventory_transaction_id,
                      'payrollSnapshotId', f.payroll_snapshot_id, 'monthlyWorkTimeNormId', f.monthly_work_time_norm_id,
                      'normReference', f.time_norm_reference),
                    'components', jsonb_build_object('baseWageAmountUzs', f.base_wage_amount_uzs::text,
                      'bonusAmountUzs', f.bonus_amount_uzs::text, 'trafficAllowanceAmountUzs', f.traffic_allowance_amount_uzs::text,
                      'travelAllowanceAmountUzs', f.travel_allowance_amount_uzs::text,
                      'payrollExtraAmountUzs', f.payroll_extra_amount_uzs::text, 'socialAmountUzs', f.social_amount_uzs::text),
                    'payrollAllocation', f.payroll_source_allocation, 'amountUzs', f.amount_uzs::text
                  ) order by f.source_date, f.order_number_snapshot, f.line_kind, f.id) from page_rows f), '[]'::jsonb)
                )::text payload from totals t
                SQL,
            [(new ApiScope)->pgUuidArray($divisionIds), $month.'-01', $roadId, $kind, $state,
                $pagination->pageSize, $pagination->offset()],
            false,
        );

        return $this->payload((string) $row->payload, $month, $pagination, 'ACT_SNAPSHOT');
    }

    /**
     * @param  list<string>  $divisionIds
     * @return array<string, mixed>
     */
    public function machines(
        array $divisionIds,
        string $month,
        ?string $roadId,
        ?string $equipmentId,
        Pagination $pagination,
    ): array {
        $row = DbRows::selectOneOrFail(
            <<<'SQL'
                with params as (
                  select ?::uuid[] divisions, ?::date month_start, ?::uuid road_id,
                         ?::uuid equipment_id, ?::integer page_size, ?::bigint row_offset
                ), filtered as materialized (
                  select er.id, er.equipment_unit_id,
                         coalesce(l.resource_code_snapshot, e.inventory_code) inventory_code,
                         coalesce(l.resource_name_snapshot, e.name) name,
                         er.status reservation_status, lower(er.reserved_window) reserved_from,
                         upper(er.reserved_window) reserved_until, er.allocated_quantity, er.unit,
                         case when er.status='cancelled' then 0 else
                           greatest(0, extract(epoch from (
                             least(upper(er.reserved_window), ((p.month_start+interval '1 month')::timestamp at time zone 'Asia/Tashkent'))
                             - greatest(lower(er.reserved_window), (p.month_start::timestamp at time zone 'Asia/Tashkent'))
                           ))/60)::integer end reserved_minutes,
                         wo.id work_order_id, wo.order_number, wo.status work_status,
                         pi.road_id, coalesce(i.road_code_snapshot, rv.code) road_code,
                         coalesce(i.road_name_snapshot, rv.name) road_name,
                         coalesce(u.usage_date, greatest(p.month_start, (lower(er.reserved_window) at time zone 'Asia/Tashkent')::date)) usage_date,
                         u.id usage_id, nu.id nonuse_id,
                         case when nu.id is not null then 0 else u.actual_machine_minutes end actual_machine_minutes,
                         u.started_at, u.ended_at, coalesce(u.note, nu.reason) note,
                         case when nu.id is not null then 'NOT_USED' when u.id is null then 'NOT_RECORDED'
                              when u.status='approved' and wo.status='verified' then 'VERIFIED' else 'RECORDED' end usage_state,
                         l.id cost_line_id, a.id act_id, a.act_number, a.act_month, upper(a.status) act_state,
                         case when a.status='approved' then l.amount_uzs else null end approved_amount,
                         rate.source_reference rate_reference
                  from roadops.equipment_reservations er
                  join roadops.equipment_units e on e.id=er.equipment_unit_id
                  join roadops.plan_items pi on pi.id=er.plan_item_id
                  join roadops.planning_runs run on run.id=pi.planning_run_id
                  join roadops.work_orders wo on wo.plan_item_id=pi.id
                  cross join params p
                  left join roadops.equipment_usage_entries u on u.equipment_reservation_id=er.id
                    and u.usage_date>=p.month_start and u.usage_date<(p.month_start+interval '1 month')::date
                  left join roadops.execution_nonuse_records nu on nu.work_order_id=wo.id
                    and nu.resource_kind='equipment' and nu.resource_id=er.id
                  left join roadops.monthly_completion_act_cost_lines l on l.equipment_usage_entry_id=u.id
                  left join roadops.monthly_completion_act_items i on i.id=l.act_item_id
                  left join roadops.monthly_completion_acts a on a.id=i.act_id
                  left join roadops.cost_rate_versions rate on rate.id=l.cost_rate_version_id
                  left join lateral (
                    select v.official_code code, v.name from roadops.road_versions v
                    where v.road_id=pi.road_id
                      and v.valid_from<=coalesce(u.started_at, lower(er.reserved_window))
                      and (v.valid_until is null or v.valid_until>coalesce(u.started_at, lower(er.reserved_window)))
                    order by v.valid_from desc, v.id limit 1
                  ) rv on true
                  where run.division_id=any(p.divisions)
                    and (p.road_id is null or pi.road_id=p.road_id)
                    and (p.equipment_id is null or er.equipment_unit_id=p.equipment_id)
                    and (u.id is not null or er.reserved_window && tstzrange(
                      p.month_start::timestamp at time zone 'Asia/Tashkent',
                      (p.month_start+interval '1 month')::timestamp at time zone 'Asia/Tashkent', '[)'))
                ), by_asset as (
                  select equipment_unit_id,
                         (array_agg(inventory_code order by usage_date desc, id))[1] inventory_code,
                         (array_agg(name order by usage_date desc, id))[1] name, sum(reserved_minutes) reserved,
                         coalesce(sum(actual_machine_minutes) filter (where usage_state='RECORDED'),0) recorded,
                         coalesce(sum(actual_machine_minutes) filter (where usage_state='VERIFIED'),0) verified,
                         coalesce(sum(approved_amount),0)::numeric(24,2)::text amount,
                         count(*) filter (where usage_state='VERIFIED' and cost_line_id is null) unpriced
                  from filtered group by equipment_unit_id
                ), page_rows as (
                  select * from filtered order by usage_date, inventory_code, order_number, id
                  limit (select page_size from params) offset (select row_offset from params)
                )
                select jsonb_build_object(
                  'total', (select count(*) from filtered),
                  'summary', jsonb_build_object(
                    'reservedMinutes', coalesce((select sum(reserved) from by_asset),0),
                    'recordedMinutes', coalesce((select sum(recorded) from by_asset),0),
                    'verifiedMinutes', coalesce((select sum(verified) from by_asset),0),
                    'approvedAmountUzs', coalesce((select sum(amount::numeric) from by_asset),0)::numeric(24,2)::text,
                    'unpricedVerifiedCount', coalesce((select sum(unpriced) from by_asset),0)
                  ),
                  'assets', coalesce((select jsonb_agg(jsonb_build_object(
                    'equipmentId', equipment_unit_id, 'inventoryCode', inventory_code, 'name', name,
                    'reservedMinutes', reserved, 'recordedMinutes', recorded, 'verifiedMinutes', verified,
                    'approvedAmountUzs', amount, 'unpricedVerifiedCount', unpriced
                  ) order by inventory_code, equipment_unit_id) from by_asset), '[]'::jsonb),
                  'rows', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', f.id, 'reservationId', f.id, 'equipmentId', f.equipment_unit_id,
                    'inventoryCode', f.inventory_code, 'name', f.name, 'date', f.usage_date,
                    'workOrderId', f.work_order_id, 'orderNumber', f.order_number, 'workState', upper(f.work_status),
                    'road', jsonb_build_object('id', f.road_id, 'code', f.road_code, 'name', f.road_name),
                    'reservationState', upper(f.reservation_status), 'reservedFrom', f.reserved_from,
                    'reservedUntil', f.reserved_until, 'reservedMinutes', f.reserved_minutes,
                    'plannedQuantity', jsonb_build_object('value', f.allocated_quantity::text, 'unit', f.unit),
                    'usageId', f.usage_id, 'nonuseId', f.nonuse_id, 'usageState', f.usage_state, 'actualMinutes', f.actual_machine_minutes,
                    'startedAt', f.started_at, 'endedAt', f.ended_at, 'note', f.note,
                    'costLineId', f.cost_line_id, 'actId', f.act_id, 'actNumber', f.act_number, 'actState', f.act_state,
                    'actMonth', to_char(f.act_month, 'YYYY-MM'),
                    'approvedAmountUzs', f.approved_amount::text, 'rateReference', f.rate_reference
                  ) order by f.usage_date, f.inventory_code, f.order_number, f.id) from page_rows f), '[]'::jsonb)
                )::text payload
                SQL,
            [(new ApiScope)->pgUuidArray($divisionIds), $month.'-01', $roadId, $equipmentId,
                $pagination->pageSize, $pagination->offset()],
            false,
        );

        return $this->payload((string) $row->payload, $month, $pagination, 'RECORDED_USAGE');
    }

    /** @return array<string, mixed> */
    private function payload(string $json, string $month, Pagination $pagination, string $basis): array
    {
        $data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($data) || ! isset($data['total'], $data['summary'], $data['rows'])) {
            throw new RuntimeException('Cost ledger query returned an invalid report.');
        }
        $data['month'] = $month;
        $data['currency'] = 'UZS';
        $data['basis'] = $basis;
        $data['periodBasis'] = $basis === 'ACT_SNAPSHOT' ? 'ACT_MONTH' : 'USAGE_DATE';
        $data['paymentTracking'] = 'NOT_CONNECTED';
        $data['pagination'] = ['page' => $pagination->page, 'pageSize' => $pagination->pageSize, 'total' => $data['total']];
        unset($data['total']);

        return $data;
    }
}
