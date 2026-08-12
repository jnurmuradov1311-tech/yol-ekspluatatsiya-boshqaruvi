<?php

namespace Tests\Unit\Http;

use App\Support\Pagination;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class PaginationTest extends TestCase
{
    public function test_it_uses_the_contract_defaults(): void
    {
        $pagination = Pagination::from(Request::create('/items', 'GET'));

        self::assertSame(1, $pagination->page);
        self::assertSame(25, $pagination->pageSize);
        self::assertSame(0, $pagination->offset());
    }

    public function test_it_calculates_a_bounded_sql_offset(): void
    {
        $pagination = Pagination::from(Request::create('/items?page=3&pageSize=100', 'GET'));

        self::assertSame(3, $pagination->page);
        self::assertSame(100, $pagination->pageSize);
        self::assertSame(200, $pagination->offset());
    }

    /** @param array<string, int|string> $query */
    #[DataProvider('invalidQueries')]
    public function test_it_rejects_invalid_pagination_values(array $query): void
    {
        $request = Request::create('/items', 'GET', $query);

        $this->expectException(ValidationException::class);
        Pagination::from($request);
    }

    /** @return iterable<string, array{array<string, int|string>}> */
    public static function invalidQueries(): iterable
    {
        yield 'page zero' => [['page' => 0]];
        yield 'negative page' => [['page' => -1]];
        yield 'decimal page' => [['page' => '1.5']];
        yield 'non-numeric page' => [['page' => 'next']];
        yield 'page size zero' => [['pageSize' => 0]];
        yield 'page size over maximum' => [['pageSize' => 101]];
        yield 'overflowing offset' => [['page' => (string) PHP_INT_MAX, 'pageSize' => 2]];
    }
}
