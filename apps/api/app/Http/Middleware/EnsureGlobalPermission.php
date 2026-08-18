<?php

namespace App\Http\Middleware;

use App\Security\AuthContext;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsureGlobalPermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        /** @var AuthContext|null $context */
        $context = $request->attributes->get(AuthContext::class);

        if ($context === null || ! $context->canGlobally($permission)) {
            return new JsonResponse([
                'error' => [
                    'code' => 'PERMISSION_DENIED',
                    'message' => 'Bu amal uchun global administrator ruxsati kerak.',
                ],
            ], 403);
        }

        return $next($request);
    }
}
