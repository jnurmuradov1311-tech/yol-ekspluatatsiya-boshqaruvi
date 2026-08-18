<?php

namespace Tests\Unit\Http;

use App\Security\AuthContext;
use App\Support\ApiScope;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class ApiScopeTest extends TestCase
{
    private const ALLOWED_ID = '11111111-1111-4111-8111-111111111111';

    public function test_documented_road_unit_filter_restricts_to_an_authorized_unit(): void
    {
        $request = $this->request(['roadUnitId' => self::ALLOWED_ID]);

        self::assertSame([self::ALLOWED_ID], (new ApiScope)->roadUnitIds($request));
    }

    public function test_missing_filter_uses_the_same_single_division_shown_by_the_ui(): void
    {
        $second = '22222222-2222-4222-8222-222222222222';
        $request = $this->request([], [self::ALLOWED_ID, $second]);

        self::assertSame([self::ALLOWED_ID], (new ApiScope)->roadUnitIds($request));
    }

    public function test_invalid_road_unit_filter_is_a_validation_error_on_the_documented_field(): void
    {
        try {
            (new ApiScope)->roadUnitIds($this->request(['roadUnitId' => 'not-a-uuid']));
            self::fail('The invalid road-unit ID was accepted.');
        } catch (ValidationException $exception) {
            self::assertArrayHasKey('roadUnitId', $exception->errors());
        }
    }

    public function test_valid_but_unauthorized_road_unit_filter_is_forbidden(): void
    {
        $request = $this->request([
            'roadUnitId' => '22222222-2222-4222-8222-222222222222',
        ]);

        try {
            (new ApiScope)->roadUnitIds($request);
            self::fail('An out-of-scope road unit was accepted.');
        } catch (HttpException $exception) {
            self::assertSame(403, $exception->getStatusCode());
        }
    }

    /**
     * @param  array<string, string>  $query
     * @param  list<string>  $roadUnitIds
     */
    private function request(array $query, array $roadUnitIds = [self::ALLOWED_ID]): Request
    {
        $request = Request::create('/items', 'GET', $query);
        $request->attributes->set(AuthContext::class, new AuthContext(
            '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444',
            'user@example.test',
            'Test User',
            str_repeat('a', 64),
            [],
            [],
            $roadUnitIds,
        ));

        return $request;
    }
}
