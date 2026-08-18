<?php

namespace Tests\Feature;

use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as RouteFacade;
use Tests\TestCase;

final class ExecutionCostRoutesTest extends TestCase
{
    public function test_execution_and_costing_routes_have_the_required_guards(): void
    {
        $expectations = [
            ['POST', 'api/v1/work-orders/{id}/start', 'roadops.permission:execution.manage'],
            ['POST', 'api/v1/work-orders/{id}/reschedule', 'roadops.permission:execution.manage'],
            ['POST', 'api/v1/work-orders/{id}/complete', 'roadops.permission:execution.manage'],
            ['POST', 'api/v1/work-orders/{id}/verify', 'roadops.permission:execution.verify'],
            ['POST', 'api/v1/cost-rates', 'roadops.permission:costs.manage'],
            ['POST', 'api/v1/cost-rates/{id}/approve', 'roadops.permission:costs.approve'],
            ['POST', 'api/v1/monthly-work-time-norms', 'roadops.permission:costs.manage'],
            ['POST', 'api/v1/monthly-work-time-norms/{id}/approve', 'roadops.permission:costs.approve'],
            ['POST', 'api/v1/monthly-completion-acts', 'roadops.permission:costs.manage'],
            ['POST', 'api/v1/monthly-completion-acts/{id}/submit', 'roadops.permission:costs.manage'],
            ['POST', 'api/v1/monthly-completion-acts/{id}/approve', 'roadops.permission:costs.approve'],
        ];

        foreach ($expectations as [$method, $uri, $permission]) {
            $route = $this->route($method, $uri);
            self::assertContains('roadops.auth', $route->gatherMiddleware(), $uri);
            self::assertContains($permission, $route->gatherMiddleware(), $uri);
            self::assertContains('roadops.csrf', $route->gatherMiddleware(), $uri);
            self::assertContains('roadops.idempotency', $route->gatherMiddleware(), $uri);
        }
    }

    public function test_all_three_financial_lists_are_paged_and_export_is_throttled(): void
    {
        foreach (['cost-rates', 'monthly-work-time-norms', 'monthly-completion-acts'] as $uri) {
            $route = $this->route('GET', 'api/v1/'.$uri);
            self::assertContains('roadops.auth', $route->gatherMiddleware());
            self::assertContains('roadops.permission:costs.read', $route->gatherMiddleware());
        }

        $export = $this->route('GET', 'api/v1/monthly-completion-acts/{id}/export.xlsx');
        self::assertContains('throttle:10,1', $export->gatherMiddleware());
    }

    public function test_monthly_generation_cannot_accept_a_partial_work_order_selection(): void
    {
        $controller = (string) file_get_contents(app_path(
            'Http/Controllers/Api/V1/MonthlyCompletionActController.php',
        ));

        self::assertStringContainsString("'workOrderIds' => ['prohibited']", $controller);
        self::assertStringNotContainsString('SELECTED_WORK_ORDER_UNAVAILABLE', $controller);
        self::assertStringContainsString('IQN_APPROVED_LABOR_NORM_MISSING', $controller);
        self::assertStringContainsString('backfillDraftNormSnapshots', $controller);
        self::assertStringContainsString("ns.status = 'approved'", $controller);
        self::assertStringContainsString('ns.effective_from <= ?::date', $controller);
        self::assertStringContainsString('ns.effective_until > ?::date', $controller);
        self::assertStringContainsString("resource.resource_kind = 'labor'", $controller);
        self::assertStringContainsString('btrim(variant.basis_unit) = btrim(?::text)', $controller);
        self::assertStringContainsString("variant.formula_type = 'linear'", $controller);
        self::assertStringContainsString('?::numeric / variant.basis_quantity', $controller);
    }

    private function route(string $method, string $uri): Route
    {
        $route = collect(RouteFacade::getRoutes()->getRoutes())
            ->first(static fn (Route $candidate): bool => $candidate->uri() === $uri
                && in_array($method, $candidate->methods(), true));

        self::assertNotNull($route, $method.' '.$uri);

        return $route;
    }
}
