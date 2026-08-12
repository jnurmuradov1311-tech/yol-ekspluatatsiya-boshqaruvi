<?php

namespace App\Domain\Integrations;

final class ExternalEventContractValidator
{
    /** @param array<string, mixed> $envelope */
    public function validate(string $systemKind, array $envelope): void
    {
        $this->exact($envelope, ['event_id', 'event_type', 'schema_version', 'occurred_at', 'payload'], [], '$');
        $this->string($envelope['event_id'], '$.event_id', 1, 200);
        $this->string($envelope['event_type'], '$.event_type', 1, 100);
        $this->oneOf($envelope['schema_version'], ['1.0.0'], '$.schema_version');
        $this->dateTime($envelope['occurred_at'], '$.occurred_at');
        $payload = $this->object($envelope['payload'], '$.payload');

        match ($systemKind) {
            SourceSystem::YTP->value => $this->ytp((string) $envelope['event_type'], $payload),
            SourceSystem::ROADVISION->value => $this->roadVision((string) $envelope['event_type'], $payload),
            default => throw new ContractViolation('SOURCE_KIND_UNSUPPORTED', 'Unsupported integration source kind.'),
        };
    }

    /** @param array<string, mixed> $payload */
    private function ytp(string $eventType, array $payload): void
    {
        $this->oneOf($eventType, ['ytp.master_data.upserted', 'ytp.master_data.retired'], '$.event_type');
        $this->exact(
            $payload,
            ['source_revision', 'operation', 'effective_from', 'entity'],
            ['effective_to'],
            '$.payload',
        );
        $this->string($payload['source_revision'], '$.payload.source_revision', 1, 1000);
        $this->oneOf($payload['operation'], ['UPSERT', 'RETIRE'], '$.payload.operation');
        $this->dateTime($payload['effective_from'], '$.payload.effective_from');
        if (array_key_exists('effective_to', $payload) && $payload['effective_to'] !== null) {
            $this->dateTime($payload['effective_to'], '$.payload.effective_to');
            if (strtotime((string) $payload['effective_to']) <= strtotime((string) $payload['effective_from'])) {
                $this->fail('PERIOD_INVALID', '$.payload.effective_to must be later than effective_from.');
            }
        }
        $expectedOperation = $eventType === 'ytp.master_data.upserted' ? 'UPSERT' : 'RETIRE';
        if ($payload['operation'] !== $expectedOperation) {
            $this->fail('EVENT_OPERATION_MISMATCH', 'YTP event_type and operation disagree.');
        }

        $entity = $this->object($payload['entity'], '$.payload.entity');
        $kind = $entity['kind'] ?? null;
        $this->oneOf($kind, [
            'ROAD_UNIT', 'ROAD', 'ROAD_ASSIGNMENT', 'ROAD_ELEMENT', 'WORKER',
            'WORKER_ASSIGNMENT', 'WORKER_QUALIFICATION', 'WORKER_AVAILABILITY',
        ], '$.payload.entity.kind');

        match ($kind) {
            'ROAD_UNIT' => $this->roadUnit($entity),
            'ROAD' => $this->road($entity),
            'ROAD_ASSIGNMENT' => $this->roadAssignment($entity),
            'ROAD_ELEMENT' => $this->roadElement($entity),
            'WORKER' => $this->worker($entity),
            'WORKER_ASSIGNMENT' => $this->workerAssignment($entity),
            'WORKER_QUALIFICATION' => $this->workerQualification($entity),
            'WORKER_AVAILABILITY' => $this->workerAvailability($entity),
            default => throw new ContractViolation(
                'ENTITY_KIND_UNSUPPORTED',
                'Unsupported YTP entity kind.',
            ),
        };
    }

    /** @param array<string, mixed> $entity */
    private function roadUnit(array $entity): void
    {
        $this->exact($entity, ['kind', 'external_id', 'code', 'name', 'profile'], [], '$.payload.entity');
        $this->externalId($entity['external_id'], 'external_id');
        $this->string($entity['code'], '$.payload.entity.code', 1, 1000);
        $this->string($entity['name'], '$.payload.entity.name', 1, 1000);
        $profile = $this->object($entity['profile'], '$.payload.entity.profile');
        if (! array_key_exists('timezone', $profile)) {
            $this->fail('REQUIRED_PROPERTY_MISSING', '$.payload.entity.profile.timezone is required.');
        }
        $this->oneOf($profile['timezone'], ['Asia/Tashkent'], '$.payload.entity.profile.timezone');
        foreach (['address' => 2000, 'phone' => 100, 'manager_full_name' => 500] as $key => $max) {
            if (array_key_exists($key, $profile)) {
                $this->string($profile[$key], '$.payload.entity.profile.'.$key, 0, $max);
            }
        }
    }

    /** @param array<string, mixed> $entity */
    private function road(array $entity): void
    {
        $this->exact(
            $entity,
            ['kind', 'external_id', 'code', 'name', 'length_m', 'geometry'],
            ['chainage_origin_m'],
            '$.payload.entity',
        );
        $this->externalId($entity['external_id'], 'external_id');
        $this->string($entity['code'], '$.payload.entity.code', 1, 1000);
        $this->string($entity['name'], '$.payload.entity.name', 1, 1000);
        $this->integer($entity['length_m'], '$.payload.entity.length_m', 1);
        if (array_key_exists('chainage_origin_m', $entity)) {
            $this->integer($entity['chainage_origin_m'], '$.payload.entity.chainage_origin_m', 0);
        }
        $this->lineString($entity['geometry'], '$.payload.entity.geometry');
    }

    /** @param array<string, mixed> $entity */
    private function roadAssignment(array $entity): void
    {
        $this->exact($entity, [
            'kind', 'external_id', 'road_external_id', 'road_unit_external_id',
            'chainage_from_m', 'chainage_to_m',
        ], [], '$.payload.entity');
        foreach (['external_id', 'road_external_id', 'road_unit_external_id'] as $key) {
            $this->externalId($entity[$key], $key);
        }
        $this->integer($entity['chainage_from_m'], '$.payload.entity.chainage_from_m', 0);
        $this->integer($entity['chainage_to_m'], '$.payload.entity.chainage_to_m', 1);
        if ($entity['chainage_to_m'] <= $entity['chainage_from_m']) {
            $this->fail('CHAINAGE_SPAN_INVALID', 'ROAD_ASSIGNMENT chainage_to_m must be greater than chainage_from_m.');
        }
    }

    /** @param array<string, mixed> $entity */
    private function roadElement(array $entity): void
    {
        $this->exact($entity, [
            'kind', 'external_id', 'road_external_id', 'element_type_code',
            'chainage_from_m', 'location', 'properties',
        ], ['element_type_name', 'chainage_to_m'], '$.payload.entity');
        foreach (['external_id', 'road_external_id'] as $key) {
            $this->externalId($entity[$key], $key);
        }
        $this->string($entity['element_type_code'], '$.payload.entity.element_type_code', 1, 1000);
        if (array_key_exists('element_type_name', $entity)) {
            $this->string($entity['element_type_name'], '$.payload.entity.element_type_name', 1, 1000);
        }
        $this->integer($entity['chainage_from_m'], '$.payload.entity.chainage_from_m', 0);
        if (array_key_exists('chainage_to_m', $entity) && $entity['chainage_to_m'] !== null) {
            $this->integer($entity['chainage_to_m'], '$.payload.entity.chainage_to_m', 0);
            if ($entity['chainage_to_m'] < $entity['chainage_from_m']) {
                $this->fail('CHAINAGE_SPAN_INVALID', 'ROAD_ELEMENT chainage_to_m cannot be less than chainage_from_m.');
            }
        }
        $this->point($entity['location'], '$.payload.entity.location');
        $this->object($entity['properties'], '$.payload.entity.properties');
    }

    /** @param array<string, mixed> $entity */
    private function worker(array $entity): void
    {
        $this->exact($entity, [
            'kind', 'external_id', 'personnel_number', 'full_name', 'employment_state',
        ], [], '$.payload.entity');
        $this->externalId($entity['external_id'], 'external_id');
        $this->string($entity['personnel_number'], '$.payload.entity.personnel_number', 1, 1000);
        $this->string($entity['full_name'], '$.payload.entity.full_name', 1, 1000);
        $this->oneOf($entity['employment_state'], ['ACTIVE', 'LEAVE', 'SUSPENDED', 'TERMINATED'], '$.payload.entity.employment_state');
    }

    /** @param array<string, mixed> $entity */
    private function workerAssignment(array $entity): void
    {
        $this->exact($entity, [
            'kind', 'external_id', 'worker_external_id', 'road_unit_external_id', 'assigned_from',
        ], ['assigned_to', 'job_title'], '$.payload.entity');
        foreach (['external_id', 'worker_external_id', 'road_unit_external_id'] as $key) {
            $this->externalId($entity[$key], $key);
        }
        $this->date($entity['assigned_from'], '$.payload.entity.assigned_from');
        if (array_key_exists('assigned_to', $entity) && $entity['assigned_to'] !== null) {
            $this->date($entity['assigned_to'], '$.payload.entity.assigned_to');
            if ($entity['assigned_to'] <= $entity['assigned_from']) {
                $this->fail('PERIOD_INVALID', 'WORKER_ASSIGNMENT assigned_to must be later than assigned_from.');
            }
        }
        if (array_key_exists('job_title', $entity)) {
            $this->string($entity['job_title'], '$.payload.entity.job_title', 0, 500);
        }
    }

    /** @param array<string, mixed> $entity */
    private function workerQualification(array $entity): void
    {
        $this->exact($entity, [
            'kind', 'external_id', 'worker_external_id', 'qualification_code', 'valid_from',
        ], ['qualification_name', 'valid_to'], '$.payload.entity');
        foreach (['external_id', 'worker_external_id'] as $key) {
            $this->externalId($entity[$key], $key);
        }
        $this->string($entity['qualification_code'], '$.payload.entity.qualification_code', 1, 1000);
        if (array_key_exists('qualification_name', $entity)) {
            $this->string($entity['qualification_name'], '$.payload.entity.qualification_name', 1, 1000);
        }
        $this->date($entity['valid_from'], '$.payload.entity.valid_from');
        if (array_key_exists('valid_to', $entity) && $entity['valid_to'] !== null) {
            $this->date($entity['valid_to'], '$.payload.entity.valid_to');
            if ($entity['valid_to'] <= $entity['valid_from']) {
                $this->fail('PERIOD_INVALID', 'WORKER_QUALIFICATION valid_to must be later than valid_from.');
            }
        }
    }

    /** @param array<string, mixed> $entity */
    private function workerAvailability(array $entity): void
    {
        $this->exact($entity, [
            'kind', 'external_id', 'worker_external_id', 'local_date', 'available_minutes',
        ], ['reason_code'], '$.payload.entity');
        foreach (['external_id', 'worker_external_id'] as $key) {
            $this->externalId($entity[$key], $key);
        }
        $this->date($entity['local_date'], '$.payload.entity.local_date');
        $this->integer($entity['available_minutes'], '$.payload.entity.available_minutes', 0, 420);
        if (array_key_exists('reason_code', $entity)) {
            $this->string($entity['reason_code'], '$.payload.entity.reason_code', 0, 100);
        }
    }

    /** @param array<string, mixed> $payload */
    private function roadVision(string $eventType, array $payload): void
    {
        $this->oneOf($eventType, ['roadvision.finding.observed', 'roadvision.finding.withdrawn'], '$.event_type');
        if ($eventType === 'roadvision.finding.withdrawn') {
            $this->exact($payload, ['vendor_finding_id', 'source_revision', 'withdrawn_at', 'reason'], [], '$.payload');
            $this->externalId($payload['vendor_finding_id'], 'vendor_finding_id', '$.payload');
            $this->externalId($payload['source_revision'], 'source_revision', '$.payload');
            $this->dateTime($payload['withdrawn_at'], '$.payload.withdrawn_at');
            $this->string($payload['reason'], '$.payload.reason', 1, 2000);

            return;
        }

        $this->exact($payload, [
            'vendor_finding_id', 'source_revision', 'attribute_code', 'attribute_revision',
            'observed_at', 'location', 'media', 'measurements',
        ], [
            'capture_id', 'ytp_road_external_id', 'vendor_road_reference',
            'chainage_from_m', 'chainage_to_m', 'direction', 'lane_label', 'source_model',
        ], '$.payload');
        foreach (['vendor_finding_id', 'source_revision', 'attribute_revision'] as $key) {
            $this->externalId($payload[$key], $key, '$.payload');
        }
        $this->string($payload['attribute_code'], '$.payload.attribute_code', 1, 100);
        if (array_key_exists('capture_id', $payload)) {
            $this->externalId($payload['capture_id'], 'capture_id', '$.payload');
        }
        $this->dateTime($payload['observed_at'], '$.payload.observed_at');
        $this->point($payload['location'], '$.payload.location');
        foreach (['ytp_road_external_id' => 200, 'vendor_road_reference' => 500, 'direction' => 50, 'lane_label' => 100] as $key => $max) {
            if (array_key_exists($key, $payload) && $payload[$key] !== null) {
                $this->string($payload[$key], '$.payload.'.$key, 1, $max);
            }
        }
        foreach (['chainage_from_m', 'chainage_to_m'] as $key) {
            if (array_key_exists($key, $payload) && $payload[$key] !== null) {
                $this->integer($payload[$key], '$.payload.'.$key, 0);
            }
        }
        if (isset($payload['chainage_from_m'], $payload['chainage_to_m'])
            && $payload['chainage_to_m'] <= $payload['chainage_from_m']) {
            $this->fail('CHAINAGE_SPAN_INVALID', 'RoadVision chainage_to_m must be greater than chainage_from_m.');
        }

        $media = $this->list($payload['media'], '$.payload.media', 1, 100);
        foreach ($media as $index => $item) {
            $item = $this->object($item, '$.payload.media['.$index.']');
            $this->exact($item, ['media_id', 'object_uri', 'content_type', 'sha256', 'captured_at'], [], '$.payload.media['.$index.']');
            $this->externalId($item['media_id'], 'media_id', '$.payload.media['.$index.']');
            $this->string($item['object_uri'], '$.payload.media['.$index.'].object_uri', 1, 2048);
            if (filter_var($item['object_uri'], FILTER_VALIDATE_URL) === false
                && ! preg_match('#^s3://[^/]+/.+$#', (string) $item['object_uri'])) {
                $this->fail('URI_INVALID', '$.payload.media['.$index.'].object_uri is not an absolute URI.');
            }
            $this->oneOf($item['content_type'], ['image/jpeg', 'image/png', 'video/mp4'], '$.payload.media['.$index.'].content_type');
            if (! is_string($item['sha256']) || ! preg_match('/^[a-f0-9]{64}$/', $item['sha256'])) {
                $this->fail('SHA256_INVALID', '$.payload.media['.$index.'].sha256 must be lowercase SHA-256.');
            }
            $this->dateTime($item['captured_at'], '$.payload.media['.$index.'].captured_at');
        }

        $measurements = $this->list($payload['measurements'], '$.payload.measurements', 0, 20);
        foreach ($measurements as $index => $measurement) {
            $measurement = $this->object($measurement, '$.payload.measurements['.$index.']');
            $this->exact($measurement, ['name', 'value', 'unit'], ['method'], '$.payload.measurements['.$index.']');
            $this->oneOf($measurement['name'], ['length', 'width', 'depth', 'area', 'volume', 'count'], '$.payload.measurements['.$index.'].name');
            if (! is_string($measurement['value']) || ! preg_match('/^[0-9]+(?:\.[0-9]+)?$/', $measurement['value'])) {
                $this->fail('MEASUREMENT_VALUE_INVALID', '$.payload.measurements['.$index.'].value is invalid.');
            }
            $this->oneOf($measurement['unit'], ['mm', 'cm', 'm', 'm2', 'm3', 'count'], '$.payload.measurements['.$index.'].unit');
            if (array_key_exists('method', $measurement)) {
                $this->string($measurement['method'], '$.payload.measurements['.$index.'].method', 0, 200);
            }
        }
        if (array_key_exists('source_model', $payload)) {
            $model = $this->object($payload['source_model'], '$.payload.source_model');
            $this->exact($model, ['name', 'version'], [], '$.payload.source_model');
            $this->string($model['name'], '$.payload.source_model.name', 0, 200);
            $this->string($model['version'], '$.payload.source_model.version', 0, 200);
        }
    }

    private function externalId(mixed $value, string $key, string $base = '$.payload.entity'): void
    {
        $this->string($value, $base.'.'.$key, 1, 200);
    }

    private function point(mixed $value, string $path): void
    {
        $point = $this->object($value, $path);
        $this->exact($point, ['type', 'coordinates'], [], $path);
        $this->oneOf($point['type'], ['Point'], $path.'.type');
        $coordinates = $this->list($point['coordinates'], $path.'.coordinates', 2, 2);
        $this->number($coordinates[0], $path.'.coordinates[0]', -180, 180);
        $this->number($coordinates[1], $path.'.coordinates[1]', -90, 90);
    }

    private function lineString(mixed $value, string $path): void
    {
        $line = $this->object($value, $path);
        $this->exact($line, ['type', 'coordinates'], [], $path);
        $this->oneOf($line['type'], ['LineString'], $path.'.type');
        $coordinates = $this->list($line['coordinates'], $path.'.coordinates', 2);
        foreach ($coordinates as $index => $coordinate) {
            $coordinate = $this->list($coordinate, $path.'.coordinates['.$index.']', 2, 2);
            $this->number($coordinate[0], $path.'.coordinates['.$index.'][0]', -180, 180);
            $this->number($coordinate[1], $path.'.coordinates['.$index.'][1]', -90, 90);
        }
    }

    /**
     * @param  array<string, mixed>  $object
     * @param  list<string>  $required
     * @param  list<string>  $optional
     */
    private function exact(array $object, array $required, array $optional, string $path): void
    {
        foreach ($required as $key) {
            if (! array_key_exists($key, $object)) {
                $this->fail('REQUIRED_PROPERTY_MISSING', $path.'.'.$key.' is required.');
            }
        }
        $allowed = array_flip([...$required, ...$optional]);
        foreach (array_keys($object) as $key) {
            if (! is_string($key) || ! array_key_exists($key, $allowed)) {
                $this->fail('ADDITIONAL_PROPERTY_FORBIDDEN', $path.'.'.(string) $key.' is not allowed.');
            }
        }
    }

    /** @return array<string, mixed> */
    private function object(mixed $value, string $path): array
    {
        if (! is_array($value) || ($value !== [] && array_is_list($value))) {
            $this->fail('TYPE_INVALID', $path.' must be an object.');
        }

        return $value;
    }

    /** @return list<mixed> */
    private function list(mixed $value, string $path, int $min, ?int $max = null): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            $this->fail('TYPE_INVALID', $path.' must be an array.');
        }
        if (count($value) < $min || ($max !== null && count($value) > $max)) {
            $this->fail('ARRAY_SIZE_INVALID', $path.' has an invalid number of items.');
        }

        return $value;
    }

    private function string(mixed $value, string $path, int $min, int $max): void
    {
        if (! is_string($value) || mb_strlen($value) < $min || mb_strlen($value) > $max) {
            $this->fail('STRING_INVALID', $path.' has an invalid string value or length.');
        }
    }

    /** @param list<string> $allowed */
    private function oneOf(mixed $value, array $allowed, string $path): void
    {
        if (! is_string($value) || ! in_array($value, $allowed, true)) {
            $this->fail('ENUM_INVALID', $path.' is outside the approved enumeration.');
        }
    }

    private function integer(mixed $value, string $path, int $min, ?int $max = null): void
    {
        if (! is_int($value) || $value < $min || ($max !== null && $value > $max)) {
            $this->fail('INTEGER_INVALID', $path.' is outside the approved integer range.');
        }
    }

    private function number(mixed $value, string $path, float $min, float $max): void
    {
        if ((! is_int($value) && ! is_float($value)) || $value < $min || $value > $max) {
            $this->fail('NUMBER_INVALID', $path.' is outside the approved numeric range.');
        }
    }

    private function dateTime(mixed $value, string $path): void
    {
        if (! is_string($value)
            || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $value)) {
            $this->fail('DATETIME_INVALID', $path.' must be RFC 3339 date-time with a timezone.');
        }
        try {
            new \DateTimeImmutable($value);
        } catch (\Throwable) {
            $this->fail('DATETIME_INVALID', $path.' is not a valid date-time.');
        }
        $errors = \DateTimeImmutable::getLastErrors();
        if (is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) {
            $this->fail('DATETIME_INVALID', $path.' is not a real calendar date-time.');
        }
    }

    private function date(mixed $value, string $path): void
    {
        if (! is_string($value) || ! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts)
            || ! checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])) {
            $this->fail('DATE_INVALID', $path.' must be a real YYYY-MM-DD date.');
        }
    }

    private function fail(string $code, string $message): never
    {
        throw new ContractViolation($code, $message);
    }
}
