<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Integrations\ContractViolation;
use App\Domain\Integrations\IntegrationInbox;
use App\Domain\Integrations\WebhookSignature;
use App\Http\Controllers\Controller;
use App\Jobs\ProcessIntegrationInboxJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

final class IntegrationWebhookController extends Controller
{
    public function __construct(
        private readonly WebhookSignature $signature,
        private readonly IntegrationInbox $inbox,
    ) {}

    public function roadVision(Request $request): JsonResponse
    {
        return $this->receive($request, 'roadvision', 'roadvision.webhook_secret');
    }

    public function ytp(Request $request): JsonResponse
    {
        return $this->receive($request, 'road_repair', 'ytp.webhook_secret');
    }

    private function receive(Request $request, string $source, string $secretPath): JsonResponse
    {
        $body = (string) $request->getContent();
        $timestamp = (string) $request->header('X-RoadOps-Timestamp', '');
        $signature = (string) $request->header('X-RoadOps-Signature', '');
        $secret = (string) config("roadops.integrations.{$secretPath}", '');
        $envelope = null;

        if (! $this->signature->verify($body, $timestamp, $signature, $secret)) {
            return response()->json([
                'error' => ['code' => 'SIGNATURE_INVALID', 'message' => 'Webhook imzosi yaroqsiz.'],
            ], 401);
        }

        try {
            /** @var array<string, mixed> $envelope */
            $envelope = json_decode($body, true, 128, JSON_THROW_ON_ERROR);
            if (! is_array($envelope) || ($envelope !== [] && array_is_list($envelope))) {
                throw new \InvalidArgumentException('Integration event envelope must be a JSON object.');
            }
            $result = $this->inbox->receive(
                $source,
                $envelope,
                hash('sha256', $body),
                null,
                [
                    'transport' => 'webhook',
                    'request_id' => (string) $request->header('X-Request-ID', ''),
                ],
            );
        } catch (ContractViolation $exception) {
            return response()->json([
                'error' => [
                    'code' => $exception->contractCode,
                    'message' => $exception->getMessage(),
                    'details' => $exception->details,
                ],
            ], 422);
        } catch (\JsonException|\InvalidArgumentException $exception) {
            return response()->json([
                'error' => ['code' => 'PAYLOAD_INVALID', 'message' => $exception->getMessage()],
            ], 422);
        } catch (\DomainException $exception) {
            return response()->json([
                'error' => ['code' => 'EVENT_ID_CONFLICT', 'message' => $exception->getMessage()],
            ], 409);
        } catch (\Throwable $exception) {
            $requestId = trim((string) $request->header('X-Request-ID', ''));
            $eventId = is_array($envelope) && is_string($envelope['event_id'] ?? null)
                ? trim($envelope['event_id'])
                : null;

            Log::error('Integration webhook processing failed.', [
                'source' => $source,
                'request_id' => $requestId !== '' ? mb_substr($requestId, 0, 128) : null,
                'external_event_id' => $eventId !== null && $eventId !== '' ? mb_substr($eventId, 0, 200) : null,
                'exception' => $exception,
            ]);

            return response()->json([
                'error' => [
                    'code' => 'INTEGRATION_NOT_READY',
                    'message' => 'Integratsiya hodisasini hozir qabul qilib bo\'lmadi.',
                ],
            ], 503);
        }

        ProcessIntegrationInboxJob::dispatch($result['id'])->afterCommit();

        return response()->json(['data' => $result], $result['duplicate'] ? 200 : 202);
    }
}
