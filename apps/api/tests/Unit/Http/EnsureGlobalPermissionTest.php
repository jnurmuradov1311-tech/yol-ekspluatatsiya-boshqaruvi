<?php

namespace Tests\Unit\Http;

use App\Http\Middleware\EnsureGlobalPermission;
use App\Security\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

final class EnsureGlobalPermissionTest extends TestCase
{
    public function test_division_scoped_system_all_is_rejected(): void
    {
        $response = $this->handle(['system.all'], []);

        if (! $response instanceof JsonResponse) {
            self::fail('A scoped administrator must receive a JSON denial.');
        }
        self::assertSame(403, $response->getStatusCode());
        self::assertSame('PERMISSION_DENIED', $response->getData(true)['error']['code']);
    }

    public function test_global_system_all_is_accepted(): void
    {
        $response = $this->handle(['system.all'], ['system.all']);

        self::assertSame(204, $response->getStatusCode());
    }

    /**
     * @param  list<string>  $permissions
     * @param  list<string>  $globalPermissions
     */
    private function handle(array $permissions, array $globalPermissions): Response
    {
        $request = Request::create('/api/v1/admin/network-summary');
        $request->attributes->set(AuthContext::class, new AuthContext(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'admin@example.test',
            'Test Administrator',
            str_repeat('a', 64),
            $permissions,
            $globalPermissions,
            ['33333333-3333-4333-8333-333333333333'],
        ));

        return (new EnsureGlobalPermission)->handle(
            $request,
            static fn (): Response => new Response(status: 204),
            'system.all',
        );
    }
}
