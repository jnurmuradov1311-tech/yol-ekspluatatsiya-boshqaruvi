<?php

namespace Tests\Unit\Guides;

use App\Domain\Guides\WorkGuideLink;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class WorkGuideLinkTest extends TestCase
{
    public function test_https_video_query_and_timestamp_are_preserved(): void
    {
        $url = 'https://www.youtube.com/watch?v=example&t=10#chapter';
        self::assertSame($url, WorkGuideLink::validate($url));
    }

    #[DataProvider('unsafeLinks')]
    public function test_non_https_and_credential_links_are_rejected(string $url): void
    {
        $this->expectException(ValidationException::class);
        WorkGuideLink::validate($url);
    }

    /** @return iterable<string, array{string}> */
    public static function unsafeLinks(): iterable
    {
        yield 'script' => ['javascript:alert(1)'];
        yield 'data' => ['data:text/html,hello'];
        yield 'plain http' => ['http://example.com/guide'];
        yield 'relative' => ['/some/guide'];
        yield 'credentials' => ['https://user:password@example.com/guide'];
        yield 'control character' => ["https://example.com/guide\nHeader: value"];
        yield 'backslash' => ['https://example.com\\@evil.example/guide'];
    }
}
