<?php

namespace Tests\Unit\Security;

use App\Security\AuthContext;
use PHPUnit\Framework\TestCase;

final class AuthContextTest extends TestCase
{
    public function test_system_all_is_an_application_permission_wildcard(): void
    {
        $context = $this->context(['system.all'], []);

        self::assertTrue($context->can('system.all'));
        self::assertTrue($context->can('reports.read'));
        self::assertTrue($context->can('planning.approve'));
        self::assertFalse($context->canGlobally('system.all'));
    }

    public function test_only_a_global_membership_grants_global_administration(): void
    {
        $context = $this->context(['system.all'], ['system.all']);

        self::assertTrue($context->canGlobally('system.all'));
        self::assertTrue($context->canGlobally('reports.read'));
    }

    public function test_an_ordinary_permission_is_not_a_wildcard(): void
    {
        $context = $this->context(['reports.read'], []);

        self::assertTrue($context->can('reports.read'));
        self::assertFalse($context->can('system.all'));
        self::assertFalse($context->can('planning.approve'));
    }

    /**
     * @param  list<string>  $permissions
     * @param  list<string>  $globalPermissions
     */
    private function context(array $permissions, array $globalPermissions): AuthContext
    {
        return new AuthContext(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            'admin@example.test',
            'Test Administrator',
            str_repeat('a', 64),
            $permissions,
            $globalPermissions,
            ['*'],
        );
    }
}
