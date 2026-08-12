<?php

namespace Tests\Unit\Integrations;

use App\Domain\Integrations\ContractViolation;
use App\Domain\Integrations\ExternalEventContractValidator;
use App\Domain\Integrations\SourceSystem;
use PHPUnit\Framework\TestCase;

final class ExternalEventContractValidatorTest extends TestCase
{
    public function test_valid_ytp_event_is_accepted(): void
    {
        $this->expectNotToPerformAssertions();
        (new ExternalEventContractValidator)->validate(SourceSystem::YTP->value, $this->ytpEvent());
    }

    public function test_unknown_ytp_property_is_rejected_without_coercion(): void
    {
        $event = $this->ytpEvent();
        $event['payload']['entity']['local_priority_score'] = 100;

        try {
            (new ExternalEventContractValidator)->validate(SourceSystem::YTP->value, $event);
            self::fail('The validator accepted an unapproved source property.');
        } catch (ContractViolation $exception) {
            self::assertSame('ADDITIONAL_PROPERTY_FORBIDDEN', $exception->contractCode);
        }
    }

    public function test_valid_roadvision_event_is_accepted(): void
    {
        $this->expectNotToPerformAssertions();
        (new ExternalEventContractValidator)->validate(
            SourceSystem::ROADVISION->value,
            $this->roadVisionEvent(),
        );
    }

    public function test_ytp_event_type_and_operation_must_agree(): void
    {
        $event = $this->ytpEvent();
        $event['event_type'] = 'ytp.master_data.retired';

        try {
            (new ExternalEventContractValidator)->validate(SourceSystem::YTP->value, $event);
            self::fail('The validator accepted a mismatched event type and operation.');
        } catch (ContractViolation $exception) {
            self::assertSame('EVENT_OPERATION_MISMATCH', $exception->contractCode);
        }
    }

    public function test_equal_road_element_chainage_is_an_exact_point(): void
    {
        $event = $this->ytpEvent();
        $event['payload']['entity'] = [
            'kind' => 'ROAD_ELEMENT',
            'external_id' => 'element-1',
            'road_external_id' => 'road-1',
            'element_type_code' => 'SIGN',
            'chainage_from_m' => 125,
            'chainage_to_m' => 125,
            'location' => ['type' => 'Point', 'coordinates' => [69.4381, 41.2064]],
            'properties' => [],
        ];

        $this->expectNotToPerformAssertions();
        (new ExternalEventContractValidator)->validate(SourceSystem::YTP->value, $event);
    }

    public function test_invalid_calendar_date_time_is_rejected(): void
    {
        $event = $this->ytpEvent();
        $event['occurred_at'] = '2026-02-31T10:00:00+05:00';

        try {
            (new ExternalEventContractValidator)->validate(SourceSystem::YTP->value, $event);
            self::fail('The validator accepted an impossible calendar date-time.');
        } catch (ContractViolation $exception) {
            self::assertSame('DATETIME_INVALID', $exception->contractCode);
        }
    }

    /** @return array<string, mixed> */
    private function ytpEvent(): array
    {
        return [
            'event_id' => 'ytp-event-1',
            'event_type' => 'ytp.master_data.upserted',
            'schema_version' => '1.0.0',
            'occurred_at' => '2026-08-12T08:15:30+05:00',
            'payload' => [
                'source_revision' => '18442',
                'operation' => 'UPSERT',
                'effective_from' => '2026-08-12T08:15:00+05:00',
                'effective_to' => null,
                'entity' => [
                    'kind' => 'ROAD_ASSIGNMENT',
                    'external_id' => 'assignment-1',
                    'road_external_id' => 'road-1',
                    'road_unit_external_id' => 'unit-1',
                    'chainage_from_m' => 0,
                    'chainage_to_m' => 1000,
                ],
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function roadVisionEvent(): array
    {
        return [
            'event_id' => 'rv-event-1',
            'event_type' => 'roadvision.finding.observed',
            'schema_version' => '1.0.0',
            'occurred_at' => '2026-08-12T09:37:18+05:00',
            'payload' => [
                'vendor_finding_id' => 'finding-1',
                'source_revision' => '3',
                'attribute_code' => 'PAVEMENT_POTHOLE',
                'attribute_revision' => 'catalog-2026-07',
                'observed_at' => '2026-08-12T09:22:04+05:00',
                'location' => ['type' => 'Point', 'coordinates' => [69.4381, 41.2064]],
                'media' => [[
                    'media_id' => 'media-1',
                    'object_uri' => 's3://roadvision-results/results/2026/08/12/media-1.jpg',
                    'content_type' => 'image/jpeg',
                    'sha256' => str_repeat('a', 64),
                    'captured_at' => '2026-08-12T09:22:04+05:00',
                ]],
                'measurements' => [[
                    'name' => 'area',
                    'value' => '12.4',
                    'unit' => 'm2',
                    'method' => 'vendor-model',
                ]],
            ],
        ];
    }
}
