<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

final class IqnReviewApprovalTest extends TestCase
{
    public function test_review_approval_route_requires_an_authenticated_global_catalog_expert(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())
            ->first(static fn ($candidate): bool => $candidate->uri()
                === 'api/v1/admin/iqn/import-batches/{batch}/review-approval');

        self::assertNotNull($route);
        self::assertSame(['POST'], $route->methods());
        $middleware = $route->gatherMiddleware();
        self::assertContains('roadops.auth', $middleware);
        self::assertContains('roadops.global-permission:catalog.manage', $middleware);
        self::assertNotContains('roadops.permission:catalog.manage', $middleware);
        self::assertContains('roadops.csrf', $middleware);
        self::assertContains('roadops.idempotency', $middleware);
        self::assertContains('throttle:10,1', $middleware);
    }
}
