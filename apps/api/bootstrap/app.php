<?php

use App\Http\Middleware\AuthenticateRoadOpsSession;
use App\Http\Middleware\EnsureCsrfToken;
use App\Http\Middleware\EnsureGlobalPermission;
use App\Http\Middleware\EnsurePermission;
use App\Http\Middleware\RequireIdempotencyKey;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\HandleCors;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        apiPrefix: 'api',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $configuredProxies = getenv('TRUSTED_PROXIES');
        $trustedProxies = array_values(array_filter(
            array_map('trim', explode(',', $configuredProxies === false ? '127.0.0.1,::1' : $configuredProxies)),
            static function (string $proxy): bool {
                if ($proxy === '' || str_contains($proxy, '*')) {
                    return false;
                }

                $parts = explode('/', $proxy, 2);
                $address = $parts[0];
                $prefix = $parts[1] ?? null;
                if (filter_var($address, FILTER_VALIDATE_IP) === false) {
                    return false;
                }

                if ($prefix === null) {
                    return true;
                }

                $maximumPrefix = str_contains($address, ':') ? 128 : 32;

                return ctype_digit($prefix) && (int) $prefix <= $maximumPrefix;
            },
        ));
        if ($trustedProxies === []) {
            $trustedProxies = ['127.0.0.1', '::1'];
        }
        $middleware->trustProxies(
            at: $trustedProxies,
            headers: Request::HEADER_X_FORWARDED_FOR
                | Request::HEADER_X_FORWARDED_HOST
                | Request::HEADER_X_FORWARDED_PROTO,
        );
        $middleware->prepend(HandleCors::class);
        $middleware->alias([
            'roadops.auth' => AuthenticateRoadOpsSession::class,
            'roadops.csrf' => EnsureCsrfToken::class,
            'roadops.global-permission' => EnsureGlobalPermission::class,
            'roadops.permission' => EnsurePermission::class,
            'roadops.idempotency' => RequireIdempotencyKey::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            static fn (Request $request): bool => $request->is('api/*'),
        );
    })
    ->create();
