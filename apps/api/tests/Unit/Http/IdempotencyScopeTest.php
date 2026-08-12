<?php

namespace Tests\Unit\Http;

use App\Http\Middleware\IdempotencyScope;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use PHPUnit\Framework\TestCase;

final class IdempotencyScopeTest extends TestCase
{
    public function test_parameterized_mutation_scope_stays_within_the_database_contract(): void
    {
        $request = $this->request(
            '/api/v1/roadvision/findings/0191e2b8-5ac0-7f38-a214-71b93d641c55/decision',
            'api/v1/roadvision/findings/{finding}/decision',
        );

        $scope = IdempotencyScope::for($request, '0191e2b8-5ac0-7f38-a214-71b93d641c56');

        self::assertLessThanOrEqual(96, strlen($scope));
        self::assertMatchesRegularExpression('/^request\.[a-f0-9]{64}$/', $scope);
    }

    public function test_scope_uses_the_route_contract_instead_of_the_actual_uuid_path(): void
    {
        $first = $this->request(
            '/api/v1/planning/runs/0191e2b8-5ac0-7f38-a214-71b93d641c55/publish',
            'api/v1/planning/runs/{run}/publish',
        );
        $second = $this->request(
            '/api/v1/planning/runs/0191e2b8-5ac0-7f38-a214-71b93d641c99/publish',
            'api/v1/planning/runs/{run}/publish',
        );
        $actor = '0191e2b8-5ac0-7f38-a214-71b93d641c56';

        self::assertSame(
            IdempotencyScope::for($first, $actor),
            IdempotencyScope::for($second, $actor),
        );
        self::assertNotSame(
            IdempotencyScope::for($first, $actor),
            IdempotencyScope::for($first, '0191e2b8-5ac0-7f38-a214-71b93d641c57'),
        );
    }

    public function test_unmatched_long_path_cannot_overflow_the_scope_column(): void
    {
        $request = Request::create('/api/v1/'.str_repeat('segment-', 80), 'POST');

        $scope = IdempotencyScope::for(
            $request,
            '0191e2b8-5ac0-7f38-a214-71b93d641c56',
        );

        self::assertLessThanOrEqual(96, strlen($scope));
        self::assertMatchesRegularExpression('/^request\.[a-f0-9]{64}$/', $scope);
    }

    private function request(string $path, string $template): Request
    {
        $request = Request::create($path, 'POST');
        $route = new Route(['POST'], $template, static fn (): null => null);
        $request->setRouteResolver(static fn (): Route => $route);

        return $request;
    }
}
