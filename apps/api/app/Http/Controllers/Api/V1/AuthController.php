<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Security\Totp;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

final class AuthController extends Controller
{
    public function __construct(private readonly Totp $totp) {}

    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', 'min:12', 'max:1024'],
            'totpCode' => ['nullable', 'string', 'regex:/^\d{6}$/'],
        ]);

        $user = DB::selectOne(
            'select * from roadops.lookup_login_identity(?)',
            [$validated['email']],
        );

        $credentialsValid = $user !== null
            && $user->status === 'active'
            && ($user->locked_until === null || now()->greaterThan($user->locked_until))
            && Hash::check($validated['password'], $user->password_hash);
        if (! $credentialsValid) {
            if ($user === null) {
                password_verify(
                    $validated['password'],
                    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.',
                );
            }
            DB::selectOne(
                'select * from roadops.record_login_failure(?, ?, ?::inet, ?, ?::uuid)',
                [
                    $validated['email'],
                    'credentials_invalid',
                    $request->ip(),
                    mb_substr((string) $request->userAgent(), 0, 500),
                    $this->requestId($request),
                ],
            );

            return response()->json([
                'error' => ['code' => 'CREDENTIALS_INVALID', 'message' => "Email yoki parol noto'g'ri."],
            ], 422);
        }

        if ((bool) $user->mfa_required) {
            if ($user->totp_factor_id === null || $user->totp_secret_ciphertext === null) {
                return response()->json([
                    'error' => [
                        'code' => 'MFA_ENROLLMENT_REQUIRED',
                        'message' => 'Administrator MFA qurilmasini ulashi kerak.',
                    ],
                ], 403);
            }
            if (! isset($validated['totpCode'])) {
                return response()->json([
                    'data' => ['mfaRequired' => true, 'factorType' => 'totp'],
                ], 202);
            }
            try {
                $ciphertext = is_resource($user->totp_secret_ciphertext)
                    ? stream_get_contents($user->totp_secret_ciphertext)
                    : (string) $user->totp_secret_ciphertext;
                $secret = Crypt::decryptString($ciphertext);
            } catch (\Throwable) {
                return response()->json([
                    'error' => ['code' => 'MFA_CONFIGURATION_INVALID', 'message' => 'MFA konfiguratsiyasi yaroqsiz.'],
                ], 503);
            }
            $acceptedCounter = $this->totp->verify(
                $secret,
                $validated['totpCode'],
                $user->totp_last_used_counter === null ? null : (int) $user->totp_last_used_counter,
            );
            if ($acceptedCounter === null) {
                DB::selectOne(
                    'select * from roadops.record_login_failure(?, ?, ?::inet, ?, ?::uuid)',
                    [
                        $validated['email'],
                        'mfa_code_invalid',
                        $request->ip(),
                        mb_substr((string) $request->userAgent(), 0, 500),
                        $this->requestId($request),
                    ],
                );

                return response()->json([
                    'error' => ['code' => 'MFA_CODE_INVALID', 'message' => 'Bir martalik kod noto‘g‘ri yoki ishlatilgan.'],
                ], 422);
            }
        } else {
            $acceptedCounter = null;
        }

        $sessionToken = $this->token();
        $csrfToken = $this->token();
        $expiresAt = now()->addMinutes((int) config('roadops.session_ttl_minutes'));
        $absoluteExpiresAt = now()->addHours(24);

        try {
            DB::selectOne(
                <<<'SQL'
                    select roadops.complete_login(
                        ?::uuid, ?, ?, ?::timestamptz, ?::timestamptz,
                        ?::uuid, ?::bigint, ?::inet, ?, ?::uuid
                    ) as session_id
                SQL,
                [
                    $user->user_id,
                    hash('sha256', $sessionToken),
                    hash('sha256', $csrfToken),
                    $expiresAt,
                    $absoluteExpiresAt,
                    $user->totp_factor_id,
                    $acceptedCounter,
                    $request->ip(),
                    mb_substr((string) $request->userAgent(), 0, 500),
                    $this->requestId($request),
                ],
            );
        } catch (\Throwable) {
            return response()->json([
                'error' => ['code' => 'LOGIN_STATE_CHANGED', 'message' => 'Kirish holati o‘zgardi. Qayta urinib ko‘ring.'],
            ], 409);
        }

        $minutes = (int) config('roadops.session_ttl_minutes');
        $secure = (bool) config('roadops.session_secure');
        $sessionCookie = Cookie::make(
            (string) config('roadops.session_cookie'),
            $sessionToken,
            $minutes,
            '/',
            null,
            $secure,
            true,
            false,
            'strict',
        );
        $csrfCookie = Cookie::make('roadops_csrf', $csrfToken, $minutes, '/', null, $secure, false, false, 'strict');

        $payload = DB::transaction(function () use ($request, $user): array {
            DB::select("select set_config('roadops.actor_id', ?, true)", [(string) $user->user_id]);
            DB::select("select set_config('roadops.request_id', ?, true)", [$this->requestId($request)]);

            return $this->userPayload((string) $user->user_id);
        });

        return response()->json(['data' => $payload])
            ->withCookie($sessionCookie)
            ->withCookie($csrfCookie);
    }

    public function me(Request $request): JsonResponse
    {
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);

        return response()->json(['data' => $this->userPayload($context->userId)]);
    }

    public function csrf(Request $request): JsonResponse
    {
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $csrfToken = $this->token();
        DB::update(
            "update roadops.auth_sessions set csrf_token_hash = decode(?, 'hex') where id = ? and revoked_at is null",
            [hash('sha256', $csrfToken), $context->sessionId],
        );
        $minutes = min(60, (int) config('roadops.session_ttl_minutes'));
        $cookie = Cookie::make(
            'roadops_csrf',
            $csrfToken,
            $minutes,
            '/',
            null,
            (bool) config('roadops.session_secure'),
            false,
            false,
            'strict',
        );

        return response()->json(['data' => ['csrfToken' => $csrfToken]])->withCookie($cookie);
    }

    public function logout(Request $request): JsonResponse
    {
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        DB::selectOne(
            'select roadops.logout_session(?::uuid, ?::inet, ?, ?::uuid) as logged_out',
            [
                $context->sessionId,
                $request->ip(),
                mb_substr((string) $request->userAgent(), 0, 500),
                $this->requestId($request),
            ],
        );

        return response()->json(['data' => ['loggedOut' => true]])
            ->withCookie(Cookie::forget((string) config('roadops.session_cookie')))
            ->withCookie(Cookie::forget('roadops_csrf'));
    }

    private function token(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    }

    private function requestId(Request $request): string
    {
        $candidate = (string) $request->header('X-Request-ID', '');

        return Str::isUuid($candidate) ? $candidate : (string) Str::uuid();
    }

    /** @return array<string, mixed> */
    private function userPayload(string $userId): array
    {
        $row = DB::selectOne(
            <<<'SQL'
                select jsonb_build_object(
                    'id', u.id,
                    'fullName', u.full_name,
                    'roleLabel', coalesce((
                        select string_agg(distinct r.name, ', ' order by r.name)
                        from roadops.user_role_memberships m
                        join roadops.roles r on r.id = m.role_id
                        where m.user_id = u.id and m.valid_from <= now()
                          and (m.valid_until is null or m.valid_until > now())
                    ), 'Rolsiz'),
                    'division', (
                        select jsonb_build_object('id', d.id, 'name', dv.name)
                        from roadops.user_role_memberships m
                        join roadops.road_divisions d on d.id = m.division_id and d.retired_at is null
                        join roadops.road_division_versions dv on dv.division_id = d.id and dv.valid_until is null
                        where m.user_id = u.id and m.valid_from <= now()
                          and (m.valid_until is null or m.valid_until > now())
                        order by dv.name
                        limit 1
                    ),
                    'permissions', coalesce((
                        select jsonb_agg(code order by code)
                        from (
                            select distinct p.code
                            from roadops.user_role_memberships m
                            join roadops.role_permissions rp on rp.role_id = m.role_id
                            join roadops.permissions p on p.id = rp.permission_id
                            where m.user_id = u.id and m.valid_from <= now()
                              and (m.valid_until is null or m.valid_until > now())
                        ) permission_codes
                    ), '[]'::jsonb)
                ) as payload
                from roadops.app_users u where u.id = ?
            SQL,
            [$userId],
        );
        if ($row === null) {
            throw new \RuntimeException('Authenticated user disappeared.');
        }

        return is_string($row->payload)
            ? json_decode($row->payload, true, 64, JSON_THROW_ON_ERROR)
            : (array) $row->payload;
    }
}
