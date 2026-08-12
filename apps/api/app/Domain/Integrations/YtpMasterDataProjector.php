<?php

namespace App\Domain\Integrations;

use Illuminate\Database\Connection;
use stdClass;

final class YtpMasterDataProjector
{
    /**
     * @param  array<string, mixed>  $envelope
     */
    public function apply(Connection $db, stdClass $inbox, array $envelope): void
    {
        /** @var array<string, mixed> $payload */
        $payload = $envelope['payload'];
        /** @var array<string, mixed> $entity */
        $entity = $payload['entity'];
        $operation = (string) $payload['operation'];
        $effectiveFrom = (string) $payload['effective_from'];
        $effectiveTo = isset($payload['effective_to']) ? (string) $payload['effective_to'] : null;
        $sourceVersion = (string) $payload['source_revision'];
        $sourceUpdatedAt = (string) $envelope['occurred_at'];
        $sourceId = (string) $inbox->source_system_id;
        $hash = (string) $inbox->payload_hash;

        match ((string) $entity['kind']) {
            'ROAD_UNIT' => $this->roadUnit(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $effectiveTo, $sourceUpdatedAt, $hash, $entity,
            ),
            'ROAD' => $this->road(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $effectiveTo, $sourceUpdatedAt, $hash, $entity,
            ),
            'ROAD_ASSIGNMENT' => $this->roadAssignment(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $effectiveTo, $sourceUpdatedAt, $hash, $entity,
            ),
            'ROAD_ELEMENT' => $this->roadElement(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $effectiveTo, $sourceUpdatedAt, $hash, $entity,
            ),
            'WORKER' => $this->worker(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $effectiveTo, $sourceUpdatedAt, $hash, $entity,
            ),
            'WORKER_ASSIGNMENT' => $this->workerAssignment(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $sourceUpdatedAt, $hash, $entity,
            ),
            'WORKER_QUALIFICATION' => $this->workerQualification(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $sourceUpdatedAt, $hash, $entity,
            ),
            'WORKER_AVAILABILITY' => $this->workerAvailability(
                $db, $sourceId, $sourceVersion, $operation, $effectiveFrom,
                $sourceUpdatedAt, $hash, $entity,
            ),
            default => throw new ContractViolation(
                'ENTITY_KIND_UNSUPPORTED',
                'Unsupported YTP entity kind.',
            ),
        };
    }

    /** @param array<string, mixed> $entity */
    private function roadUnit(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $from,
        ?string $until,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $divisionId = $this->baseId($db, 'road_divisions', $sourceId, $externalId, $operation);
        if ($operation === 'RETIRE') {
            $this->retire($db, 'road_division_versions', 'division_id', $divisionId, $from, $externalId);
            $this->retire($db, 'road_division_profile_versions', 'division_id', $divisionId, $from, $externalId);
            $db->update('update roadops.road_divisions set retired_at = ?::timestamptz where id = ?', [$from, $divisionId]);

            return;
        }

        if ($this->prepareVersion($db, 'road_division_versions', 'division_id', $divisionId, $revision, $from, $until, $hash, $externalId)) {
            $db->statement(
                <<<'SQL'
                    insert into roadops.road_division_versions
                      (division_id, source_version, code, name, valid_from, valid_until,
                       source_updated_at, payload_hash)
                    values (?, ?, ?, ?, ?::timestamptz, ?::timestamptz,
                            ?::timestamptz, decode(?, 'hex'))
                SQL,
                [$divisionId, $revision, $entity['code'], $entity['name'], $from, $until, $sourceUpdatedAt, $hash],
            );
        }

        /** @var array<string, mixed> $profile */
        $profile = $entity['profile'];
        if ($this->prepareVersion($db, 'road_division_profile_versions', 'division_id', $divisionId, $revision, $from, $until, $hash, $externalId)) {
            $db->statement(
                <<<'SQL'
                    insert into roadops.road_division_profile_versions
                      (division_id, source_version, address, phone, profile_data,
                       valid_from, valid_until, source_updated_at, payload_hash)
                    values (?, ?, ?, ?, ?::jsonb, ?::timestamptz, ?::timestamptz,
                            ?::timestamptz, decode(?, 'hex'))
                SQL,
                [
                    $divisionId, $revision, $profile['address'] ?? null,
                    $profile['phone'] ?? null,
                    json_encode($profile, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    $from, $until, $sourceUpdatedAt, $hash,
                ],
            );
        }
    }

    /** @param array<string, mixed> $entity */
    private function road(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $from,
        ?string $until,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $roadId = $this->baseId($db, 'roads', $sourceId, $externalId, $operation);
        if ($operation === 'RETIRE') {
            $this->retire($db, 'road_versions', 'road_id', $roadId, $from, $externalId);
            $db->update('update roadops.roads set retired_at = ?::timestamptz where id = ?', [$from, $roadId]);

            return;
        }

        if (! $this->prepareVersion($db, 'road_versions', 'road_id', $roadId, $revision, $from, $until, $hash, $externalId)) {
            return;
        }
        $attributes = [
            'chainage_origin_m' => $entity['chainage_origin_m'] ?? 0,
            'geometry' => $entity['geometry'],
        ];
        $db->statement(
            <<<'SQL'
                insert into roadops.road_versions
                  (road_id, division_id, source_version, official_code, name, length_m,
                   attributes, valid_from, valid_until, source_updated_at, payload_hash)
                values (?, null, ?, ?, ?, ?, ?::jsonb, ?::timestamptz, ?::timestamptz,
                        ?::timestamptz, decode(?, 'hex'))
            SQL,
            [
                $roadId, $revision, $entity['code'], $entity['name'], $entity['length_m'],
                json_encode($attributes, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                $from, $until, $sourceUpdatedAt, $hash,
            ],
        );
        $this->refreshRoadProjection($db, $roadId);
    }

    /** @param array<string, mixed> $entity */
    private function roadAssignment(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $from,
        ?string $until,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $existing = $db->selectOne(
            <<<'SQL'
                select id, road_id, encode(payload_hash, 'hex') payload_hash
                from roadops.road_division_assignments
                where source_system_id = ? and external_id = ? and source_version = ?
            SQL,
            [$sourceId, $externalId, $revision],
        );
        if ($existing !== null) {
            $this->assertSameHash($existing, $hash, 'ROAD_ASSIGNMENT', $externalId);

            return;
        }
        $current = $db->selectOne(
            <<<'SQL'
                select id, road_id, valid_from
                from roadops.road_division_assignments
                where source_system_id = ? and external_id = ? and valid_until is null
                order by valid_from desc limit 1 for update
            SQL,
            [$sourceId, $externalId],
        );
        if ($operation === 'RETIRE') {
            if ($current === null) {
                $this->dependency('ROAD_ASSIGNMENT_NOT_FOUND', 'ROAD_ASSIGNMENT', $externalId, $entity);
            }
            $this->closeAssignment($db, 'road_division_assignments', $current, $from, $externalId);
            $this->refreshRoadProjection($db, (string) $current->road_id);

            return;
        }

        $road = $this->sourceEntity($db, 'roads', $sourceId, (string) $entity['road_external_id'], 'ROAD');
        $division = $this->sourceEntity($db, 'road_divisions', $sourceId, (string) $entity['road_unit_external_id'], 'ROAD_UNIT');
        $this->requireEffectiveVersion(
            $db, 'road_versions', 'road_id', (string) $road->id, $from,
            'ROAD', (string) $entity['road_external_id'],
        );
        $this->requireEffectiveVersion(
            $db, 'road_division_versions', 'division_id', (string) $division->id, $from,
            'ROAD_UNIT', (string) $entity['road_unit_external_id'],
        );
        if ($current !== null) {
            $this->closeAssignment($db, 'road_division_assignments', $current, $from, $externalId);
        }
        try {
            $db->statement(
                <<<'SQL'
                    insert into roadops.road_division_assignments
                      (source_system_id, external_id, road_id, division_id, source_version,
                       chainage_span, valid_from, valid_until, source_updated_at, payload_hash)
                    values (?, ?, ?, ?, ?, numrange(?::numeric, ?::numeric, '[)'),
                            ?::timestamptz, ?::timestamptz, ?::timestamptz, decode(?, 'hex'))
                SQL,
                [
                    $sourceId, $externalId, $road->id, $division->id, $revision,
                    $entity['chainage_from_m'], $entity['chainage_to_m'], $from, $until,
                    $sourceUpdatedAt, $hash,
                ],
            );
        } catch (\Throwable $exception) {
            if ($this->isConstraintConflict($exception)) {
                throw new IntegrationApplyConflict(
                    'ROAD_ASSIGNMENT_OVERLAP', 'ROAD_ASSIGNMENT', $externalId,
                    'YTP road assignment overlaps another effective source assignment.',
                    $entity,
                );
            }
            throw $exception;
        }
        $this->refreshRoadProjection($db, (string) $road->id);
        if ($current !== null && (string) $current->road_id !== (string) $road->id) {
            $this->refreshRoadProjection($db, (string) $current->road_id);
        }
    }

    /** @param array<string, mixed> $entity */
    private function roadElement(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $from,
        ?string $until,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $elementId = $this->baseId($db, 'road_elements', $sourceId, $externalId, $operation);
        if ($operation === 'RETIRE') {
            $this->retire($db, 'road_element_versions', 'road_element_id', $elementId, $from, $externalId);
            $db->update('update roadops.road_elements set retired_at = ?::timestamptz where id = ?', [$from, $elementId]);

            return;
        }
        $road = $this->sourceEntity($db, 'roads', $sourceId, (string) $entity['road_external_id'], 'ROAD');
        $this->requireEffectiveVersion(
            $db, 'road_versions', 'road_id', (string) $road->id, $from,
            'ROAD', (string) $entity['road_external_id'],
        );
        if (! $this->prepareVersion($db, 'road_element_versions', 'road_element_id', $elementId, $revision, $from, $until, $hash, $externalId)) {
            return;
        }
        $to = $entity['chainage_to_m'] ?? null;
        $isPoint = $to === null || (float) $to === (float) $entity['chainage_from_m'];
        $attributes = [
            'location' => $entity['location'],
            'properties' => $entity['properties'],
        ];
        $db->statement(
            <<<'SQL'
                insert into roadops.road_element_versions
                  (road_element_id, road_id, source_version, element_type, name,
                   chainage_span, chainage_point_m, attributes, valid_from, valid_until,
                   source_updated_at, payload_hash)
                values (?, ?, ?, ?, ?,
                        case when ? then null else numrange(?::numeric, ?::numeric, '[)') end,
                        case when ? then ?::numeric else null end,
                        ?::jsonb, ?::timestamptz, ?::timestamptz,
                        ?::timestamptz, decode(?, 'hex'))
            SQL,
            [
                $elementId, $road->id, $revision, $entity['element_type_code'],
                $entity['element_type_name'] ?? null,
                $isPoint, $entity['chainage_from_m'], $to, $isPoint,
                $entity['chainage_from_m'],
                json_encode($attributes, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                $from, $until, $sourceUpdatedAt, $hash,
            ],
        );
    }

    /** @param array<string, mixed> $entity */
    private function worker(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $from,
        ?string $until,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $workerId = $this->baseId($db, 'workers', $sourceId, $externalId, $operation);
        if ($operation === 'RETIRE') {
            $this->retire($db, 'worker_versions', 'worker_id', $workerId, $from, $externalId);
            $db->update('update roadops.workers set retired_at = ?::timestamptz where id = ?', [$from, $workerId]);

            return;
        }
        if (! $this->prepareVersion($db, 'worker_versions', 'worker_id', $workerId, $revision, $from, $until, $hash, $externalId)) {
            return;
        }
        $divisionId = $db->scalar(
            'select roadops.division_for_worker_assignment(?, (?::timestamptz at time zone \'Asia/Tashkent\')::date)',
            [$workerId, $from],
        );
        $db->statement(
            <<<'SQL'
                insert into roadops.worker_versions
                  (worker_id, division_id, source_version, personnel_number, full_name,
                   employment_state, valid_from, valid_until, source_updated_at, payload_hash)
                values (?, ?::uuid, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz,
                        ?::timestamptz, decode(?, 'hex'))
            SQL,
            [
                $workerId, $divisionId, $revision, $entity['personnel_number'],
                $entity['full_name'], $this->employmentState((string) $entity['employment_state']),
                $from, $until, $sourceUpdatedAt, $hash,
            ],
        );
    }

    /** @param array<string, mixed> $entity */
    private function workerAssignment(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $effectiveFrom,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $from = (string) $entity['assigned_from'];
        $until = isset($entity['assigned_to']) ? (string) $entity['assigned_to'] : null;
        $existing = $db->selectOne(
            <<<'SQL'
                select id, worker_id, encode(payload_hash, 'hex') payload_hash
                from roadops.worker_division_assignments
                where source_system_id = ? and external_id = ? and source_version = ?
            SQL,
            [$sourceId, $externalId, $revision],
        );
        if ($existing !== null) {
            $this->assertSameHash($existing, $hash, 'WORKER_ASSIGNMENT', $externalId);

            return;
        }
        $current = $db->selectOne(
            <<<'SQL'
                select id, worker_id, valid_from
                from roadops.worker_division_assignments
                where source_system_id = ? and external_id = ? and valid_until is null
                order by valid_from desc limit 1 for update
            SQL,
            [$sourceId, $externalId],
        );
        if ($operation === 'RETIRE') {
            if ($current === null) {
                $this->dependency('WORKER_ASSIGNMENT_NOT_FOUND', 'WORKER_ASSIGNMENT', $externalId, $entity);
            }
            $retiredOn = (new \DateTimeImmutable($effectiveFrom))
                ->setTimezone(new \DateTimeZone('Asia/Tashkent'))
                ->format('Y-m-d');
            $this->closeAssignment($db, 'worker_division_assignments', $current, $retiredOn, $externalId);
            $this->refreshWorkerProjection($db, (string) $current->worker_id);

            return;
        }

        $worker = $this->sourceEntity($db, 'workers', $sourceId, (string) $entity['worker_external_id'], 'WORKER');
        $division = $this->sourceEntity($db, 'road_divisions', $sourceId, (string) $entity['road_unit_external_id'], 'ROAD_UNIT');
        $assignmentAt = $this->dateAtTashkent($from);
        $this->requireEffectiveVersion(
            $db, 'worker_versions', 'worker_id', (string) $worker->id, $assignmentAt,
            'WORKER', (string) $entity['worker_external_id'],
        );
        $this->requireEffectiveVersion(
            $db, 'road_division_versions', 'division_id', (string) $division->id, $assignmentAt,
            'ROAD_UNIT', (string) $entity['road_unit_external_id'],
        );
        if ($current !== null) {
            $this->closeAssignment($db, 'worker_division_assignments', $current, $from, $externalId);
        }
        try {
            $db->statement(
                <<<'SQL'
                    insert into roadops.worker_division_assignments
                      (source_system_id, external_id, worker_id, division_id, source_version,
                       job_title, valid_from, valid_until, source_updated_at, payload_hash)
                    values (?, ?, ?, ?, ?, ?, ?::date, ?::date, ?::timestamptz, decode(?, 'hex'))
                SQL,
                [
                    $sourceId, $externalId, $worker->id, $division->id, $revision,
                    $entity['job_title'] ?? null, $from, $until, $sourceUpdatedAt, $hash,
                ],
            );
        } catch (\Throwable $exception) {
            if ($this->isConstraintConflict($exception)) {
                throw new IntegrationApplyConflict(
                    'WORKER_ASSIGNMENT_OVERLAP', 'WORKER_ASSIGNMENT', $externalId,
                    'YTP worker has overlapping effective division assignments.',
                    $entity,
                );
            }
            throw $exception;
        }
        $this->refreshWorkerProjection($db, (string) $worker->id);
        if ($current !== null && (string) $current->worker_id !== (string) $worker->id) {
            $this->refreshWorkerProjection($db, (string) $current->worker_id);
        }
    }

    /** @param array<string, mixed> $entity */
    private function workerQualification(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $effectiveFrom,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $existing = $db->selectOne(
            <<<'SQL'
                select id, encode(payload_hash, 'hex') payload_hash
                from roadops.worker_qualification_versions
                where source_system_id = ? and external_id = ? and source_version = ?
            SQL,
            [$sourceId, $externalId, $revision],
        );
        if ($existing !== null) {
            $this->assertSameHash($existing, $hash, 'WORKER_QUALIFICATION', $externalId);

            return;
        }
        $worker = $this->sourceEntity($db, 'workers', $sourceId, (string) $entity['worker_external_id'], 'WORKER');
        if ($operation === 'RETIRE') {
            $from = $this->dateAtTashkent($effectiveFrom);
            $updated = $db->update(
                <<<'SQL'
                    update roadops.worker_qualification_versions
                    set valid_until = ?::timestamptz
                    where source_system_id = ? and external_id = ? and valid_until is null
                      and valid_from < ?::timestamptz
                SQL,
                [$from, $sourceId, $externalId, $from],
            );
            if ($updated !== 1) {
                $this->dependency('WORKER_QUALIFICATION_NOT_FOUND', 'WORKER_QUALIFICATION', $externalId, $entity);
            }

            return;
        }
        $from = $this->dateAtTashkent((string) $entity['valid_from']);
        $until = isset($entity['valid_to']) ? $this->dateAtTashkent((string) $entity['valid_to']) : null;
        $this->requireEffectiveVersion(
            $db, 'worker_versions', 'worker_id', (string) $worker->id, $from,
            'WORKER', (string) $entity['worker_external_id'],
        );
        // The approved proposal makes qualification_name optional while the
        // mirror column is non-null. Preserve the supplied source code as the
        // deterministic display value instead of rejecting a contract-valid row.
        $qualificationName = trim((string) ($entity['qualification_name'] ?? ''));
        if ($qualificationName === '') {
            $qualificationName = (string) $entity['qualification_code'];
        }
        try {
            $db->statement(
                <<<'SQL'
                    insert into roadops.worker_qualification_versions
                      (worker_id, source_system_id, external_id, source_version,
                       qualification_code, qualification_name, valid_from, valid_until,
                       source_updated_at, payload_hash)
                    values (?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz,
                            ?::timestamptz, decode(?, 'hex'))
                SQL,
                [
                    $worker->id, $sourceId, $externalId, $revision,
                    $entity['qualification_code'],
                    $qualificationName,
                    $from, $until, $sourceUpdatedAt, $hash,
                ],
            );
        } catch (\Throwable $exception) {
            if ($this->isConstraintConflict($exception)) {
                throw new IntegrationApplyConflict(
                    'WORKER_QUALIFICATION_OVERLAP', 'WORKER_QUALIFICATION', $externalId,
                    'YTP worker qualification overlaps an effective qualification with the same code.',
                    $entity,
                );
            }
            throw $exception;
        }
    }

    /** @param array<string, mixed> $entity */
    private function workerAvailability(
        Connection $db,
        string $sourceId,
        string $revision,
        string $operation,
        string $effectiveFrom,
        string $sourceUpdatedAt,
        string $hash,
        array $entity,
    ): void {
        $externalId = (string) $entity['external_id'];
        $existing = $db->selectOne(
            <<<'SQL'
                select id, encode(payload_hash, 'hex') payload_hash
                from roadops.worker_availability
                where source_system_id = ? and external_id = ? and source_version = ?
            SQL,
            [$sourceId, $externalId, $revision],
        );
        if ($existing !== null) {
            $this->assertSameHash($existing, $hash, 'WORKER_AVAILABILITY', $externalId);

            return;
        }
        $worker = $this->sourceEntity($db, 'workers', $sourceId, (string) $entity['worker_external_id'], 'WORKER');
        if ($operation === 'RETIRE') {
            $updated = $db->update(
                <<<'SQL'
                    update roadops.worker_availability
                    set retired_at = ?::timestamptz
                    where source_system_id = ? and external_id = ? and retired_at is null
                SQL,
                [$effectiveFrom, $sourceId, $externalId],
            );
            if ($updated !== 1) {
                $this->dependency('WORKER_AVAILABILITY_NOT_FOUND', 'WORKER_AVAILABILITY', $externalId, $entity);
            }

            return;
        }
        $this->requireEffectiveVersion(
            $db, 'worker_versions', 'worker_id', (string) $worker->id,
            $this->dateAtTashkent((string) $entity['local_date']),
            'WORKER', (string) $entity['worker_external_id'],
        );
        $db->statement(
            <<<'SQL'
                insert into roadops.worker_availability
                  (worker_id, work_date, available_minutes, availability_code,
                   source_system_id, external_id, source_reason_code, source_version,
                   source_updated_at, payload_hash)
                values (?, ?::date, ?, ?, ?, ?, ?, ?,
                        ?::timestamptz, decode(?, 'hex'))
            SQL,
            [
                $worker->id, $entity['local_date'], $entity['available_minutes'],
                $this->availabilityCode(
                    (int) $entity['available_minutes'],
                    isset($entity['reason_code']) ? (string) $entity['reason_code'] : null,
                ),
                $sourceId, $externalId, $entity['reason_code'] ?? null, $revision,
                $sourceUpdatedAt, $hash,
            ],
        );
    }

    private function baseId(
        Connection $db,
        string $table,
        string $sourceId,
        string $externalId,
        string $operation,
    ): string {
        $this->assertIdentifier($table);
        if ($operation === 'RETIRE') {
            $row = $db->selectOne(
                "select id from roadops.{$table} where source_system_id = ? and external_id = ? for update",
                [$sourceId, $externalId],
            );
            if ($row === null) {
                $this->dependency(strtoupper($table).'_NOT_FOUND', strtoupper($table), $externalId, []);
            }

            return (string) $row->id;
        }
        $row = $db->selectOne(
            "insert into roadops.{$table} (source_system_id, external_id, retired_at) "
            .'values (?, ?, null) on conflict (source_system_id, external_id) '
            .'do update set retired_at = null returning id',
            [$sourceId, $externalId],
        );

        return (string) $row->id;
    }

    private function prepareVersion(
        Connection $db,
        string $table,
        string $foreignKey,
        string $entityId,
        string $revision,
        string $from,
        ?string $until,
        string $hash,
        string $externalId,
    ): bool {
        $this->assertIdentifier($table);
        $this->assertIdentifier($foreignKey);
        $existing = $db->selectOne(
            "select encode(payload_hash, 'hex') payload_hash from roadops.{$table} where {$foreignKey} = ? and source_version = ?",
            [$entityId, $revision],
        );
        if ($existing !== null) {
            $this->assertSameHash($existing, $hash, strtoupper($table), $externalId);

            return false;
        }
        $current = $db->selectOne(
            "select id, valid_from, valid_until from roadops.{$table} where {$foreignKey} = ? order by valid_from desc limit 1 for update",
            [$entityId],
        );
        if ($current !== null) {
            if (strtotime((string) $current->valid_from) >= strtotime($from)) {
                throw new IntegrationApplyConflict(
                    'SOURCE_REVISION_OUT_OF_ORDER', strtoupper($table), $externalId,
                    'Source revision begins before or at the current effective version.',
                    ['source_version' => $revision, 'valid_from' => $from],
                    ['valid_from' => (string) $current->valid_from],
                );
            }
            if ($current->valid_until === null) {
                $db->update(
                    "update roadops.{$table} set valid_until = ?::timestamptz where id = ?",
                    [$from, $current->id],
                );
            } elseif (strtotime((string) $current->valid_until) > strtotime($from)) {
                throw new IntegrationApplyConflict(
                    'SOURCE_VERSION_PERIOD_OVERLAP', strtoupper($table), $externalId,
                    'Source version overlaps the latest effective-dated version.',
                    ['source_version' => $revision, 'valid_from' => $from, 'valid_until' => $until],
                    [
                        'valid_from' => (string) $current->valid_from,
                        'valid_until' => (string) $current->valid_until,
                    ],
                );
            }
        }

        return true;
    }

    private function retire(
        Connection $db,
        string $table,
        string $foreignKey,
        string $entityId,
        string $from,
        string $externalId,
    ): void {
        $this->assertIdentifier($table);
        $this->assertIdentifier($foreignKey);
        $current = $db->selectOne(
            "select id, valid_from from roadops.{$table} where {$foreignKey} = ? and valid_until is null order by valid_from desc limit 1 for update",
            [$entityId],
        );
        if ($current === null) {
            $this->dependency(strtoupper($table).'_CURRENT_NOT_FOUND', strtoupper($table), $externalId, []);
        }
        if (strtotime((string) $current->valid_from) >= strtotime($from)) {
            throw new IntegrationApplyConflict(
                'RETIRE_EFFECTIVE_TIME_INVALID', strtoupper($table), $externalId,
                'Retirement must be later than the active source version start.',
            );
        }
        $db->update("update roadops.{$table} set valid_until = ?::timestamptz where id = ?", [$from, $current->id]);
    }

    private function closeAssignment(
        Connection $db,
        string $table,
        stdClass $current,
        string $from,
        string $externalId,
    ): void {
        $this->assertIdentifier($table);
        if (strtotime((string) $current->valid_from) >= strtotime($from)) {
            throw new IntegrationApplyConflict(
                'ASSIGNMENT_REVISION_OUT_OF_ORDER', strtoupper($table), $externalId,
                'Assignment revision must begin after the active source assignment.',
            );
        }
        $cast = $table === 'worker_division_assignments' ? 'date' : 'timestamptz';
        $db->update("update roadops.{$table} set valid_until = ?::{$cast} where id = ?", [$from, $current->id]);
    }

    private function sourceEntity(
        Connection $db,
        string $table,
        string $sourceId,
        string $externalId,
        string $entityType,
    ): stdClass {
        $this->assertIdentifier($table);
        $row = $db->selectOne(
            "select id from roadops.{$table} where source_system_id = ? and external_id = ? and retired_at is null",
            [$sourceId, $externalId],
        );
        if ($row === null) {
            $this->dependency($entityType.'_DEPENDENCY_MISSING', $entityType, $externalId, []);
        }

        return $row;
    }

    private function requireEffectiveVersion(
        Connection $db,
        string $table,
        string $foreignKey,
        string $entityId,
        string $effectiveAt,
        string $entityType,
        string $externalId,
    ): void {
        $this->assertIdentifier($table);
        $this->assertIdentifier($foreignKey);
        $exists = (int) $db->scalar(
            "select count(*) from roadops.{$table} where {$foreignKey} = ? "
            .'and valid_from <= ?::timestamptz '
            .'and (valid_until is null or valid_until > ?::timestamptz)',
            [$entityId, $effectiveAt, $effectiveAt],
        ) > 0;
        if (! $exists) {
            $this->dependency(
                $entityType.'_EFFECTIVE_VERSION_MISSING',
                $entityType,
                $externalId,
                ['effective_at' => $effectiveAt],
            );
        }
    }

    private function refreshRoadProjection(Connection $db, string $roadId): void
    {
        $divisionId = $db->scalar(
            <<<'SQL'
                select min(a.division_id::text)::uuid
                from roadops.road_division_assignments a
                join roadops.road_versions rv on rv.road_id = a.road_id
                  and rv.valid_from <= clock_timestamp()
                  and (rv.valid_until is null or rv.valid_until > clock_timestamp())
                where a.road_id = ? and a.valid_from <= clock_timestamp()
                  and (a.valid_until is null or a.valid_until > clock_timestamp())
                  and a.chainage_span @> numrange(0, rv.length_m, '[)')
                having count(*) = 1
            SQL,
            [$roadId],
        );
        $db->update(
            <<<'SQL'
                update roadops.road_versions
                set division_id = ?::uuid
                where id = (
                  select id from roadops.road_versions
                  where road_id = ? and valid_from <= clock_timestamp()
                    and (valid_until is null or valid_until > clock_timestamp())
                  order by valid_from desc limit 1
                )
            SQL,
            [$divisionId, $roadId],
        );
    }

    private function refreshWorkerProjection(Connection $db, string $workerId): void
    {
        $divisionId = $db->scalar(
            'select roadops.division_for_worker_assignment(?, current_date)',
            [$workerId],
        );
        $position = $db->scalar(
            <<<'SQL'
                select a.job_title from roadops.worker_division_assignments a
                where a.worker_id = ? and a.valid_from <= current_date
                  and (a.valid_until is null or a.valid_until > current_date)
                order by a.valid_from desc limit 1
            SQL,
            [$workerId],
        );
        $db->update(
            <<<'SQL'
                update roadops.worker_versions
                set division_id = ?::uuid, position_name = ?
                where id = (
                  select id from roadops.worker_versions
                  where worker_id = ? and valid_from <= clock_timestamp()
                    and (valid_until is null or valid_until > clock_timestamp())
                  order by valid_from desc limit 1
                )
            SQL,
            [$divisionId, $divisionId === null ? null : $position, $workerId],
        );
    }

    private function assertSameHash(stdClass $existing, string $hash, string $entityType, string $externalId): void
    {
        if (! hash_equals((string) $existing->payload_hash, $hash)) {
            throw new IntegrationApplyConflict(
                'SOURCE_REVISION_REUSED_WITH_DIFFERENT_PAYLOAD', $entityType, $externalId,
                'A source revision/idempotency key was reused with different bytes.',
                ['payload_hash' => $hash],
                ['payload_hash' => (string) $existing->payload_hash],
            );
        }
    }

    /** @param array<string, mixed> $source */
    private function dependency(
        string $code,
        string $entityType,
        string $externalId,
        array $source,
    ): never {
        throw new IntegrationApplyConflict(
            $code, $entityType, $externalId,
            'A referenced YTP source master row or effective version is missing.',
            $source,
        );
    }

    private function employmentState(string $state): string
    {
        return match ($state) {
            'ACTIVE' => 'active',
            'LEAVE' => 'leave',
            'SUSPENDED' => 'suspended',
            'TERMINATED' => 'ended',
            default => throw new ContractViolation(
                'EMPLOYMENT_STATE_UNSUPPORTED',
                'Unsupported YTP employment state.',
            ),
        };
    }

    private function availabilityCode(int $minutes, ?string $reasonCode): string
    {
        $sourceCode = strtolower(trim((string) $reasonCode));

        return match ($sourceCode) {
            'leave' => 'leave',
            'sick' => 'sick',
            'training' => 'training',
            'not_scheduled' => 'not_scheduled',
            default => $minutes > 0 ? 'available' : 'source_reported',
        };
    }

    private function dateAtTashkent(string $date): string
    {
        return str_contains($date, 'T') ? $date : $date.'T00:00:00+05:00';
    }

    private function assertIdentifier(string $identifier): void
    {
        if (! preg_match('/^[a-z][a-z0-9_]*$/', $identifier)) {
            throw new \LogicException('Unsafe internal SQL identifier.');
        }
    }

    private function isConstraintConflict(\Throwable $exception): bool
    {
        $code = (string) $exception->getCode();

        return in_array($code, ['23P01', '23505'], true)
            || str_contains($exception->getMessage(), 'exclusion constraint');
    }
}
