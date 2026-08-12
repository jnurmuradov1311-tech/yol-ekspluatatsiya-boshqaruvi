<?php

namespace App\Http\Middleware;

use App\Security\AuthContext;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

final class AuthenticateRoadOpsSession
{
    public function handle(Request $request, Closure $next): Response
    {
        $cookieName = (string) config('roadops.session_cookie');
        $token = $request->cookie($cookieName, '');
        if (! is_string($token)) {
            return $this->unauthorized();
        }
        if ($token === '' || strlen($token) < 32) {
            return $this->unauthorized();
        }

        $rows = DB::select(
            'select * from roadops.authenticate_session(?)',
            [hash('sha256', $token)],
        );
        if ($rows === []) {
            return $this->unauthorized();
        }

        $row = $rows[0];
        $permissions = $this->pgArray($row->permissions ?? '{}');
        $roadUnitIds = $this->pgArray($row->road_unit_ids ?? '{}');

        $context = new AuthContext(
            (string) $row->session_id,
            (string) $row->user_id,
            (string) $row->email,
            (string) $row->full_name,
            (string) $row->csrf_hash,
            $permissions,
            $roadUnitIds,
        );

        $request->attributes->set(AuthContext::class, $context);
        app()->instance(AuthContext::class, $context);

        $requestId = (string) $request->header('X-Request-ID', '');
        if (! Str::isUuid($requestId)) {
            $requestId = (string) Str::uuid();
        }
        $request->headers->set('X-Request-ID', $requestId);

        return DB::transaction(function () use ($context, $requestId, $request, $next): Response {
            if ($this->requiresSerializablePrimaryRoadLock($request)) {
                DB::statement('set transaction isolation level serializable');
                DB::select('select * from roadops.lock_primary_road_invariant()');
            }
            DB::select("select set_config('roadops.actor_id', ?, true)", [$context->userId]);
            DB::select("select set_config('roadops.session_id', ?, true)", [$context->sessionId]);
            DB::select("select set_config('roadops.request_id', ?, true)", [$requestId]);
            DB::statement(
                'update roadops.auth_sessions set last_seen_at = now() where id = ? and last_seen_at < now() - interval \'5 minutes\'',
                [$context->sessionId],
            );
            $response = $next($request);
            $response->headers->set('X-Request-ID', $requestId);

            return $response;
        });
    }

    private function requiresSerializablePrimaryRoadLock(Request $request): bool
    {
        return $request->is(
            'api/v1/planning/plans/*/approve',
            'api/v1/planning/plans/*/publish',
        );
    }

    private function unauthorized(): JsonResponse
    {
        return response()->json([
            'error' => [
                'code' => 'AUTHENTICATION_REQUIRED',
                'message' => 'Tizimga qayta kiring.',
            ],
        ], 401);
    }

    /** @return list<string> */
    private function pgArray(mixed $value): array
    {
        if (is_array($value)) {
            $items = [];
            foreach ($value as $item) {
                if (! is_string($item)) {
                    return [];
                }
                $items[] = $item;
            }

            return $items;
        }
        if (! is_string($value)) {
            return [];
        }

        $text = trim($value);
        if ($text === '' || $text === '{}') {
            return [];
        }

        $items = [];
        foreach (str_getcsv(trim($text, '{}'), ',', '"', '\\') as $item) {
            if ($item !== null) {
                $items[] = $item;
            }
        }

        return $items;
    }
}
