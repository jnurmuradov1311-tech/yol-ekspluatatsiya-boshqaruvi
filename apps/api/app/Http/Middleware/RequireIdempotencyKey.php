<?php

namespace App\Http\Middleware;

use App\Security\AuthContext;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class RequireIdempotencyKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = trim((string) $request->header('Idempotency-Key', ''));
        if (strlen($key) < 8 || strlen($key) > 128) {
            return new JsonResponse([
                'error' => [
                    'code' => 'IDEMPOTENCY_KEY_REQUIRED',
                    'message' => "Yozuvchi so'rovda yaroqli Idempotency-Key bo'lishi shart.",
                ],
            ], 400);
        }

        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $requestHash = hash('sha256', implode('|', [
            $request->method(),
            '/'.$request->path(),
            (string) $request->getQueryString(),
            (string) $request->getContent(),
            $context->userId,
        ]));

        // The schema deliberately bounds scope to 96 characters. A stable
        // route-template digest avoids UUID path parameters overflowing it and
        // still isolates operations by actor, method, and endpoint contract.
        $scope = IdempotencyScope::for($request, $context->userId);
        // Expiry is part of the key contract, not merely an index hint. Remove
        // this exact expired key before attempting its atomic re-registration.
        DB::delete(
            'delete from roadops.idempotency_keys where scope = ? and idempotency_key = ? and expires_at <= now()',
            [$scope, $key],
        );
        $inserted = DB::selectOne(
            <<<'SQL'
                insert into roadops.idempotency_keys
                    (scope, actor_user_id, idempotency_key, request_hash, state, expires_at)
                values (?, ?, ?, decode(?, 'hex'), 'processing', now() + interval '24 hours')
                on conflict (scope, idempotency_key) do nothing
                returning id
            SQL,
            [$scope, $context->userId, $key, $requestHash],
        );

        if ($inserted === null) {
            $existing = DB::selectOne(
                "select encode(request_hash, 'hex') as request_hash, state, response_status, response_body from roadops.idempotency_keys where scope = ? and idempotency_key = ?",
                [$scope, $key],
            );
            if ($existing === null || ! hash_equals((string) $existing->request_hash, $requestHash)) {
                return new JsonResponse([
                    'error' => [
                        'code' => 'IDEMPOTENCY_KEY_REUSED',
                        'message' => "Bu kalit boshqa so'rov uchun ishlatilgan.",
                    ],
                ], 422);
            }
            if ($existing->state === 'completed') {
                $payload = is_string($existing->response_body)
                    ? json_decode($existing->response_body, true, 512, JSON_THROW_ON_ERROR)
                    : (array) $existing->response_body;

                return new JsonResponse($payload, (int) $existing->response_status, ['Idempotency-Key' => $key]);
            }

            // A failed first execution was not committed by the surrounding
            // request transaction. If a deployment ever changes that boundary,
            // fail closed instead of reporting a permanently in-progress key.
            if ($existing->state === 'failed') {
                return new JsonResponse([
                    'error' => [
                        'code' => 'PREVIOUS_REQUEST_FAILED',
                        'message' => "Bu kalit bilan oldingi so'rov muvaffaqiyatsiz tugagan.",
                    ],
                ], (int) ($existing->response_status ?? 500), ['Idempotency-Key' => $key]);
            }

            return new JsonResponse([
                'error' => [
                    'code' => 'REQUEST_IN_PROGRESS',
                    'message' => "Xuddi shu so'rov hali bajarilmoqda.",
                ],
            ], 409, ['Retry-After' => '2']);
        }

        try {
            $response = $next($request);
            $body = $response->getContent();
            $decoded = is_string($body) ? json_decode($body, true) : null;
            if (! is_array($decoded)) {
                $decoded = ['result' => $body];
            }
            DB::update(
                <<<'SQL'
                    update roadops.idempotency_keys
                    set state = 'completed', response_status = ?, response_body = ?::jsonb, completed_at = now()
                    where scope = ? and idempotency_key = ?
                SQL,
                [$response->getStatusCode(), json_encode($decoded, JSON_THROW_ON_ERROR), $scope, $key],
            );
            $response->headers->set('Idempotency-Key', $key);

            return $response;
        } catch (\Throwable $exception) {
            DB::update(
                "update roadops.idempotency_keys set state = 'failed', response_status = 500, response_body = '{\"error\":{\"code\":\"REQUEST_FAILED\"}}'::jsonb, completed_at = now() where scope = ? and idempotency_key = ?",
                [$scope, $key],
            );
            throw $exception;
        }
    }
}
