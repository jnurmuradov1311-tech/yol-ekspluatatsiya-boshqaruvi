<?php

namespace Tests\Feature;

use App\Domain\Norms\IqnReviewManifestValidator;
use App\Http\Controllers\Api\V1\ManualInspectionController;
use App\Security\AuthContext;
use App\Support\ApiScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery;
use ReflectionClass;
use Tests\TestCase;

final class ManualInspectionIqnTopicTest extends TestCase
{
    private const DIVISION = '81000000-0000-4000-8000-000000000001';

    private const ROAD = '81000000-0000-4000-8000-000000000002';

    private const DEFECT = '81000000-0000-4000-8000-000000000003';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('session.driver', 'array');
        DB::shouldReceive('scalar')->with(
            'select inventory_resolution from roadops.inspection_observations where id = ?',
            Mockery::type('array'),
        )->andReturn('REVIEW_REQUIRED')->byDefault();
    }

    public function test_field_options_remain_available_without_published_iqn_topics(): void
    {
        DB::shouldReceive('select')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'from roadops.roads r')), Mockery::any(), true, [])
            ->andReturn([]);
        DB::shouldReceive('select')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'with active_document')), [], true, [])
            ->andReturn([]);
        DB::shouldReceive('select')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'from roadops.defect_types')), [], true, [])
            ->andReturn([(object) [
                'id' => self::DEFECT, 'code' => 'field.pavement.pothole',
                'name' => 'Qoplamadagi chuqurcha', 'measurement_unit' => 'm2',
            ]]);

        DB::shouldReceive('select')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'from roadops.road_elements e')), Mockery::any(), true, [])
            ->andReturn([]);

        $response = (new ManualInspectionController)->options($this->request([]), new ApiScope);
        $data = $response->getData(true)['data'];

        self::assertSame(200, $response->getStatusCode());
        self::assertFalse($data['iqnTopicsReady']);
        self::assertSame([], $data['workTopics']);
        self::assertSame(self::DEFECT, $data['defectTypes'][0]['id']);
        self::assertSame('m2', $data['defectTypes'][0]['unit']);
    }

    public function test_capture_keeps_the_physical_defect_and_measurement_without_iqn(): void
    {
        $this->expectRoad();
        $this->expectDefect('m2');
        $inserts = [];
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        DB::shouldReceive('insert')->times(3)->andReturnUsing(
            static function (string $sql, array $bindings) use (&$inserts): bool {
                $inserts[] = [$sql, $bindings];

                return true;
            },
        );

        $response = (new ManualInspectionController)->store($this->request($this->capture()));

        self::assertSame(201, $response->getStatusCode());
        $observation = $inserts[1][1];
        self::assertSame(self::DEFECT, $observation[2]);
        self::assertNull($observation[3]);
        self::assertSame(25.5, $observation[7]);
        self::assertSame('m2', $observation[8]);
        self::assertSame('Ko‘rik izohi', $observation[11]);
        self::assertSame('Qoplamada o‘lchangan chuqurchalar', $observation[12]);
        $source = [
            'inspection_id' => $observation[1], 'iqn_topic_work_item_id' => null,
            'observed_issue' => $observation[12], 'description' => $observation[11],
            'defect_type_id' => self::DEFECT, 'chainage_start_m' => 100,
            'road_element_id' => null, 'chainage_end_m' => 110, 'quantity' => '25.5', 'unit' => 'm2', 'evidence' => [],
        ];
        self::assertSame(
            hash('sha256', json_encode($source, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)),
            $observation[14],
        );
    }

    public function test_legacy_topic_capture_is_still_accepted_without_a_defect_type_field(): void
    {
        $this->expectRoad();
        $topicId = '81000000-0000-4000-8000-000000000008';
        DB::shouldReceive('selectOne')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'from roadops.iqn_work_items item')), [$topicId, '2026-01-15', '2026-01-15'], true)
            ->andReturn((object) ['id' => $topicId, 'name' => 'Asfaltbeton qoplama']);
        DB::shouldReceive('selectOne')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'from roadops.defect_types')), ['manual.unclassified.m2', '2026-01-15', '2026-01-15'], true)
            ->andReturn((object) ['id' => self::DEFECT, 'name' => 'Tasniflanmagan', 'measurement_unit' => 'm2']);
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        $observation = [];
        DB::shouldReceive('insert')->times(3)->andReturnUsing(
            static function (string $sql, array $bindings) use (&$observation): bool {
                if (str_contains($sql, 'insert into roadops.inspection_observations')) {
                    $observation = $bindings;
                }

                return true;
            },
        );
        $payload = $this->capture();
        unset($payload['defectTypeId'], $payload['observedIssue']);
        $payload['iqnTopicId'] = $topicId;

        $response = (new ManualInspectionController)->store($this->request($payload));

        self::assertSame(201, $response->getStatusCode());
        self::assertSame($topicId, $observation[3]);
        self::assertSame('Asfaltbeton qoplama', $observation[12]);
    }

    public function test_capture_rejects_the_wrong_physical_unit_before_writing(): void
    {
        $this->expectRoad();
        $this->expectDefect('m');
        DB::shouldReceive('transaction')->never();
        DB::shouldReceive('insert')->never();

        $response = (new ManualInspectionController)->store($this->request($this->capture()));

        self::assertSame(422, $response->getStatusCode());
        self::assertSame('DEFECT_UNIT_MISMATCH', $response->getData(true)['error']['code']);
    }

    public function test_count_capture_can_be_sent_for_review_without_forcing_an_asset_choice(): void
    {
        $this->expectRoad();
        $this->expectDefect('unit');
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        DB::shouldReceive('insert')->times(3)->andReturnTrue();
        DB::shouldReceive('select')->once()
            ->with('select roadops.submit_inspection(?)', Mockery::type('array'))
            ->andReturn([]);
        $payload = $this->capture();
        $payload['unit'] = 'unit';
        $payload['exactQuantity'] = 1;
        $payload['submitForReview'] = true;

        $response = (new ManualInspectionController)->store($this->request($payload));

        self::assertSame(201, $response->getStatusCode());
        self::assertSame('PENDING_REVIEW', $response->getData(true)['data']['state']);
        self::assertSame('REVIEW_REQUIRED', $response->getData(true)['data']['inventoryResolution']);
    }

    public function test_measured_capture_requires_its_actual_section_end(): void
    {
        DB::shouldReceive('insert')->never();
        $payload = $this->capture();
        unset($payload['chainageEndM']);
        $this->expectException(ValidationException::class);

        (new ManualInspectionController)->store($this->request($payload));
    }

    public function test_fractional_count_is_rejected_before_writing(): void
    {
        DB::shouldReceive('insert')->never();
        $payload = $this->capture();
        $payload['unit'] = 'unit';
        $payload['exactQuantity'] = 1.5;
        $this->expectException(ValidationException::class);

        (new ManualInspectionController)->store($this->request($payload));
    }

    public function test_capture_preserves_asset_and_selected_section_in_the_source_hash(): void
    {
        $this->expectRoad();
        $this->expectDefect('m2');
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        $observation = [];
        DB::shouldReceive('insert')->times(3)->andReturnUsing(
            static function (string $sql, array $bindings) use (&$observation): bool {
                if (str_contains($sql, 'insert into roadops.inspection_observations')) {
                    $observation = $bindings;
                }

                return true;
            },
        );
        $payload = $this->capture();
        $payload['roadElementId'] = '81000000-0000-4000-8000-000000000007';
        $payload['chainageEndM'] = 110;

        $response = (new ManualInspectionController)->store($this->request($payload));

        self::assertSame(201, $response->getStatusCode());
        self::assertSame(110, $observation[5]);
        self::assertSame($payload['roadElementId'], $observation[15]);
    }

    public function test_capture_requires_a_physical_defect_when_iqn_is_omitted(): void
    {
        DB::shouldReceive('insert')->never();
        $payload = $this->capture();
        unset($payload['defectTypeId']);
        $this->expectException(ValidationException::class);

        (new ManualInspectionController)->store($this->request($payload));
    }

    public function test_iqn_publication_still_requires_all_top_level_topic_markers(): void
    {
        $path = (new ReflectionClass(IqnReviewManifestValidator::class))->getFileName();
        self::assertIsString($path);
        $validator = (string) file_get_contents($path);

        self::assertStringContainsString('manual_inspection_topic', $validator);
        self::assertStringContainsString('range(1, 29)', $validator);
    }

    private function expectRoad(): void
    {
        DB::shouldReceive('select')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'with parameters as')), Mockery::any(), true, [])
            ->andReturn([(object) [
                'id' => self::ROAD, 'official_code' => 'D001', 'name' => 'Halqa yo‘li',
                'length_m' => 67000, 'division_id' => self::DIVISION,
            ]]);
    }

    private function expectDefect(string $unit): void
    {
        DB::shouldReceive('selectOne')->once()
            ->with(
                Mockery::on(static fn (string $sql): bool => str_contains($sql, 'from roadops.defect_types')),
                [self::DEFECT, '2026-01-15', '2026-01-15'],
                true,
            )
            ->andReturn((object) ['id' => self::DEFECT, 'name' => 'Chuqurcha', 'measurement_unit' => $unit]);
    }

    /** @return array<string, mixed> */
    private function capture(): array
    {
        return [
            'roadId' => self::ROAD, 'defectTypeId' => self::DEFECT,
            'observedIssue' => 'Qoplamada o‘lchangan chuqurchalar',
            'observedDate' => '2026-01-15', 'chainageStartM' => 100, 'chainageEndM' => 110,
            'exactQuantity' => 25.5, 'unit' => 'm2', 'note' => 'Ko‘rik izohi',
        ];
    }

    /** @param array<string, mixed> $payload */
    private function request(array $payload): Request
    {
        $request = Request::create('/api/v1/manual-inspections', 'POST', $payload);
        $request->attributes->set(AuthContext::class, new AuthContext(
            '81000000-0000-4000-8000-000000000010',
            '81000000-0000-4000-8000-000000000011',
            'inspector@test.invalid', 'Yo‘l ustasi', '', ['defects.capture'], [], [self::DIVISION],
        ));

        return $request;
    }
}
