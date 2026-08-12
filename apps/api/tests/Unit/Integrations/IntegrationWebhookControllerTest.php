<?php

namespace Tests\Unit\Integrations;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Tests\TestCase;

final class IntegrationWebhookControllerTest extends TestCase
{
    public function test_signed_webhook_does_not_disclose_internal_failures(): void
    {
        $secret = str_repeat('s', 32);
        config()->set('roadops.integrations.ytp.webhook_secret', $secret);
        config()->set('session.driver', 'array');

        $body = (string) file_get_contents(
            base_path('../../packages/contracts/external/ytp/samples/road-upserted.json'),
        );
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$body, $secret);
        $exception = new RuntimeException(
            'SQLSTATE[42P01]: roadops.integration_inbox password=do-not-leak',
        );

        DB::shouldReceive('connection')
            ->once()
            ->with('pgsql_sync')
            ->andThrow($exception);
        Log::spy();

        $response = $this->call(
            'POST',
            '/api/v1/integrations/ytp/webhook',
            server: [
                'CONTENT_TYPE' => 'application/json',
                'HTTP_X_REQUEST_ID' => 'request-webhook-123',
                'HTTP_X_ROADOPS_TIMESTAMP' => $timestamp,
                'HTTP_X_ROADOPS_SIGNATURE' => 'sha256='.$signature,
            ],
            content: $body,
        );

        $response
            ->assertStatus(503)
            ->assertExactJson([
                'error' => [
                    'code' => 'INTEGRATION_NOT_READY',
                    'message' => 'Integratsiya hodisasini hozir qabul qilib bo\'lmadi.',
                ],
            ]);
        self::assertStringNotContainsString('SQLSTATE', (string) $response->getContent());
        self::assertStringNotContainsString('do-not-leak', (string) $response->getContent());

        Log::shouldHaveReceived('error')
            ->once()
            ->withArgs(static function (string $message, array $context) use ($exception): bool {
                return $message === 'Integration webhook processing failed.'
                    && ($context['source'] ?? null) === 'road_repair'
                    && ($context['request_id'] ?? null) === 'request-webhook-123'
                    && ($context['external_event_id'] ?? null) === 'ytp-event-2026-08-12-000184'
                    && ($context['exception'] ?? null) === $exception;
            });
    }
}
