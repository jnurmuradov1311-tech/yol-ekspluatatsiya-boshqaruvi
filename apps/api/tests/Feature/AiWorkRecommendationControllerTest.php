<?php

namespace Tests\Feature;

use App\Domain\Planning\AiWorkRecommendation;
use App\Http\Controllers\Api\V1\AiWorkRecommendationController;
use App\Security\AuthContext;
use App\Support\ApiScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

final class AiWorkRecommendationControllerTest extends TestCase
{
    private const SOURCE = '94000000-0000-4000-8000-000000000001';

    private const DIVISION = '94000000-0000-4000-8000-000000000002';

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('session.driver', 'array');
        Http::preventStrayRequests();
        Http::fake();
    }

    public function test_outside_scope_or_unverified_defect_does_not_reach_provider_or_catalog(): void
    {
        DB::shouldReceive('selectOne')->once()->withArgs(static function (string $sql, array $bindings, bool $read): bool {
            return str_contains($sql, "dc.status = 'open' and dc.verified_at is not null")
                && str_contains($sql, 'roadops.division_for_road_zone')
                && $bindings === [self::SOURCE, '2026-09-28', '{'.self::DIVISION.'}', '2026-09-28', '2026-09-28']
                && $read;
        })->andReturn(null);
        DB::shouldReceive('select')->never();
        $response = (new AiWorkRecommendationController)($this->request(), new ApiScope, new AiWorkRecommendation);
        self::assertSame(422, $response->getStatusCode());
        self::assertSame('SOURCE_DEFECT_NOT_ACCESSIBLE', $response->getData(true)['error']['code']);
        Http::assertNothingSent();
    }

    public function test_unconfigured_result_is_explicit_and_audited_without_changing_defect_or_plan(): void
    {
        config()->set('work_recommendation.enabled', false);
        DB::shouldReceive('selectOne')->once()->andReturn((object) [
            'id' => self::SOURCE, 'source_version' => '2026-09-28T08:00:00+05:00',
            'defect_type_id' => '94000000-0000-4000-8000-000000000003', 'topic_id' => null,
            'topic_name' => 'Chuqurcha', 'observed_issue' => 'Sensitive observation text',
            'quantity' => '2.000000', 'unit' => 'm2', 'chainage_start_m' => '1000', 'chainage_end_m' => '1002',
        ]);
        DB::shouldReceive('select')->once()->with(
            Mockery::on(static fn (string $sql): bool => str_contains($sql, "v.interpretation_status = 'approved'")
                && str_contains($sql, "v.planning_status = 'automatic'")
                && str_contains($sql, "ns.status = 'approved'")
                && str_contains($sql, 'mapping.effective_until > p.scheduled_date')),
            [null, '94000000-0000-4000-8000-000000000003', '2026-09-28'], true, [],
        )->andReturn([]);
        DB::shouldReceive('insert')->never();
        DB::shouldReceive('update')->never();
        Log::spy();

        $response = (new AiWorkRecommendationController)($this->request(), new ApiScope, new AiWorkRecommendation);
        $payload = $response->getData(true)['data'];
        self::assertSame(200, $response->getStatusCode());
        self::assertSame('UNAVAILABLE', $payload['status']);
        self::assertSame([], $payload['candidates']);
        self::assertTrue($payload['requiresHumanApproval']);
        self::assertSame(self::SOURCE, $payload['sourceDefectId']);
        self::assertArrayNotHasKey('model', $payload);
        self::assertArrayNotHasKey('providerResponseId', $payload);
        Log::shouldHaveReceived('info')->once()->withArgs(static function (string $message, array $context) use ($payload): bool {
            return $message === 'AI work recommendation assessed.'
                && $context['recommendation_id'] === $payload['recommendationId']
                && $context['source_defect_id'] === self::SOURCE
                && $context['status'] === 'UNAVAILABLE'
                && strlen($context['source_catalog_sha256']) === 64
                && ! str_contains(json_encode($context), 'Sensitive observation text');
        });
        Http::assertNothingSent();
    }

    private function request(): Request
    {
        $request = Request::create('/api/v1/planning/ai-work-recommendation', 'POST', [
            'sourceDefectId' => self::SOURCE, 'scheduledDate' => '2026-09-28',
        ]);
        $request->attributes->set(AuthContext::class, new AuthContext(
            '94000000-0000-4000-8000-000000000004', '94000000-0000-4000-8000-000000000005',
            'chief@example.uz', 'Bo‘lim boshlig‘i', '', ['planning.write'], [], [self::DIVISION],
        ));

        return $request;
    }
}
