<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;

final class IdempotencyScope
{
    public static function for(Request $request, string $actorUserId): string
    {
        $routeTemplate = (string) ($request->route()?->uri() ?? $request->path());
        $digest = hash('sha256', implode('|', [
            strtoupper($request->method()),
            $routeTemplate,
            $actorUserId,
        ]));

        return 'request.'.$digest;
    }
}
