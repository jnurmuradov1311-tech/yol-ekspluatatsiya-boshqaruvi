<?php

namespace Tests\Unit\Support;

use App\Support\HttpByteRange;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class HttpByteRangeTest extends TestCase
{
    public function test_missing_range_means_full_response(): void
    {
        self::assertNull(HttpByteRange::parse(null, 100));
        self::assertNull(HttpByteRange::parse(' ', 100));
    }

    #[DataProvider('validRanges')]
    public function test_parses_one_satisfiable_range(
        string $header,
        int $start,
        int $end,
        string $contentRange,
    ): void {
        $range = HttpByteRange::parse($header, 100);

        self::assertNotNull($range);
        self::assertSame($start, $range->start);
        self::assertSame($end, $range->end);
        self::assertSame($end - $start + 1, $range->length());
        self::assertSame($contentRange, $range->contentRange());
        self::assertSame("bytes={$start}-{$end}", $range->s3Range());
    }

    /** @return iterable<string, array{string, int, int, string}> */
    public static function validRanges(): iterable
    {
        yield 'closed' => ['bytes=10-19', 10, 19, 'bytes 10-19/100'];
        yield 'open ended' => ['bytes=90-', 90, 99, 'bytes 90-99/100'];
        yield 'end is clamped' => ['bytes=90-999', 90, 99, 'bytes 90-99/100'];
        yield 'suffix' => ['bytes=-8', 92, 99, 'bytes 92-99/100'];
        yield 'oversized suffix' => ['bytes=-200', 0, 99, 'bytes 0-99/100'];
    }

    #[DataProvider('invalidRanges')]
    public function test_rejects_invalid_or_multiple_ranges(string $header): void
    {
        $this->expectException(\InvalidArgumentException::class);

        HttpByteRange::parse($header, 100);
    }

    /** @return iterable<string, array{string}> */
    public static function invalidRanges(): iterable
    {
        yield 'wrong unit' => ['items=0-1'];
        yield 'multiple' => ['bytes=0-1,4-5'];
        yield 'empty' => ['bytes=-'];
        yield 'zero suffix' => ['bytes=-0'];
        yield 'past end' => ['bytes=100-'];
        yield 'reversed' => ['bytes=20-10'];
        yield 'overflow' => ['bytes=999999999999999999999-'];
    }
}
