<?php

namespace App\Http\Middleware;

use App\Security\AuthContext;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureCsrfToken
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var AuthContext|null $context */
        $context = $request->attributes->get(AuthContext::class);
        $provided = (string) $request->header('X-CSRF-Token', '');

        if ($context === null || $provided === '' || ! hash_equals($context->csrfHash, hash('sha256', $provided))) {
            return new JsonResponse([
                'error' => [
                    'code' => 'CSRF_TOKEN_INVALID',
                    'message' => "So'rov himoya belgisi yaroqsiz. Sahifani yangilang.",
                ],
            ], 419);
        }

        return $next($request);
    }
}
