<?php

namespace Tests\Feature;

use App\Domain\Guides\WorkGuideFileStore;
use App\Http\Controllers\Api\V1\WorkGuideController;
use App\Security\AuthContext;
use App\Support\ApiScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Mockery;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class WorkGuideControllerTest extends TestCase
{
    private const DIVISION = '81000000-0000-4000-8000-000000000001';

    private const VARIANT = '81000000-0000-4000-8000-000000000002';

    private const USER = '81000000-0000-4000-8000-000000000003';

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('session.driver', 'array');
    }

    public function test_foreman_can_read_without_receiving_private_storage_paths(): void
    {
        DB::shouldReceive('scalar')->with(Mockery::any(), ['planning.read', self::DIVISION])->andReturn(false);
        DB::shouldReceive('scalar')->with(Mockery::any(), ['execution.read', self::DIVISION])->andReturn(true);
        DB::shouldReceive('scalar')->with(Mockery::any(), ['planning.write', self::DIVISION])->andReturn(false);
        DB::shouldReceive('scalar')->with(Mockery::any(), ['catalog.manage', self::DIVISION])->andReturn(false);
        DB::shouldReceive('select')->once()->with(Mockery::any(), [self::VARIANT, self::DIVISION], true, [])
            ->andReturn([$this->row()]);

        $response = (new WorkGuideController(new WorkGuideFileStore))->index($this->request('GET'), new ApiScope);
        $data = $response->getData(true)['data'];
        self::assertFalse($data['canManage']);
        self::assertSame('/api/v1/work-guides/81000000-0000-4000-8000-000000000004/content?roadUnitId='.self::DIVISION, $data['items'][0]['url']);
        self::assertArrayNotHasKey('storage_path', $data['items'][0]);
        self::assertStringNotContainsString('work-guides/private.pdf', json_encode($data, JSON_THROW_ON_ERROR));
    }

    public function test_foreman_cannot_upload_a_guide(): void
    {
        DB::shouldReceive('scalar')->andReturn(false);
        $this->expectException(HttpException::class);
        (new WorkGuideController(new WorkGuideFileStore))->store($this->request('POST'));
    }

    public function test_retry_of_saved_link_returns_the_same_guide_without_new_insert(): void
    {
        DB::shouldReceive('scalar')->andReturn(true);
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        DB::shouldReceive('select')->once()->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'pg_advisory_xact_lock')), Mockery::any())->andReturn([]);
        $row = $this->row();
        $row->source_type = 'LINK';
        $row->external_url = 'https://example.com/guide.pdf';
        $row->request_hash = hash('sha256', json_encode([
            self::DIVISION, self::VARIANT, 'Ish tartibi', 'DOCUMENT', 'LINK', $row->external_url, null,
        ], JSON_THROW_ON_ERROR));
        DB::shouldReceive('selectOne')->once()->with(Mockery::any(), [self::USER, 'guide-save-001'], false)->andReturn($row);

        $response = (new WorkGuideController(new WorkGuideFileStore))->store($this->request('POST'));
        self::assertSame(200, $response->getStatusCode());
        self::assertSame($row->id, $response->getData(true)['data']['id']);
    }

    public function test_reused_key_for_different_payload_is_rejected(): void
    {
        DB::shouldReceive('scalar')->andReturn(true);
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        DB::shouldReceive('select')->once()->andReturn([]);
        $row = $this->row();
        $row->request_hash = str_repeat('a', 64);
        DB::shouldReceive('selectOne')->once()->andReturn($row);
        $this->expectException(HttpException::class);
        (new WorkGuideController(new WorkGuideFileStore))->store($this->request('POST'));
    }

    private function request(string $method): Request
    {
        $request = Request::create('/api/v1/work-guides', $method, [
            'roadUnitId' => self::DIVISION, 'workVariantId' => self::VARIANT,
            'title' => 'Ish tartibi', 'kind' => 'DOCUMENT', 'url' => 'https://example.com/guide.pdf',
        ]);
        $request->headers->set('Idempotency-Key', 'guide-save-001');
        $request->attributes->set(AuthContext::class, new AuthContext('session', self::USER, 'guide@test.invalid', 'Guide tester',
            'csrf', ['execution.read'], [], [self::DIVISION]));

        return $request;
    }

    private function row(): \stdClass
    {
        return (object) [
            'id' => '81000000-0000-4000-8000-000000000004', 'division_id' => self::DIVISION,
            'work_variant_id' => self::VARIANT, 'title' => 'Ish tartibi', 'kind' => 'DOCUMENT',
            'source_type' => 'FILE', 'external_url' => null, 'storage_path' => 'work-guides/private.pdf',
            'file_name' => 'guide.pdf', 'content_type' => 'application/pdf', 'byte_size' => 100,
            'created_at' => '2026-09-28T10:00:00Z', 'deleted_at' => null,
        ];
    }
}
