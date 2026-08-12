<?php

namespace Tests\Unit\Support;

use App\Support\HttpsEndpoint;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class HttpsEndpointTest extends TestCase
{
    public function test_vendor_base_url_is_normalized_without_changing_its_path(): void
    {
        self::assertSame(
            'https://vendor.example.test/root/api',
            HttpsEndpoint::baseApi('https://vendor.example.test/root/api///'),
        );
    }

    #[DataProvider('invalidVendorUrls')]
    public function test_vendor_base_url_rejects_unsafe_or_ambiguous_values(mixed $url): void
    {
        $this->expectException(\InvalidArgumentException::class);

        HttpsEndpoint::baseApi($url);
    }

    /** @return iterable<string, array{mixed}> */
    public static function invalidVendorUrls(): iterable
    {
        yield 'missing' => [null];
        yield 'relative' => ['/vendor/api'];
        yield 'plain HTTP' => ['http://vendor.example.test'];
        yield 'userinfo' => ['https://client:secret@vendor.example.test'];
        yield 'query' => ['https://vendor.example.test/api?tenant=one'];
        yield 'empty query' => ['https://vendor.example.test/api?'];
        yield 'fragment' => ['https://vendor.example.test/api#token'];
        yield 'empty fragment' => ['https://vendor.example.test/api#'];
        yield 'leading whitespace' => [' https://vendor.example.test'];
        yield 'backslash ambiguity' => ['https://vendor.example.test\\@attacker.example'];
    }

    public function test_slack_accepts_only_official_webhook_origins(): void
    {
        self::assertSame(
            'https://hooks.slack.com/services/T000/B000/secret',
            HttpsEndpoint::slackWebhook('https://hooks.slack.com/services/T000/B000/secret'),
        );
        self::assertSame(
            'https://hooks.slack-gov.com/services/T000/B000/secret',
            HttpsEndpoint::slackWebhook('https://hooks.slack-gov.com/services/T000/B000/secret'),
        );
    }

    #[DataProvider('invalidSlackUrls')]
    public function test_slack_rejects_non_webhook_origins_and_url_metadata(string $url): void
    {
        $this->expectException(\InvalidArgumentException::class);

        HttpsEndpoint::slackWebhook($url);
    }

    /** @return iterable<string, array{string}> */
    public static function invalidSlackUrls(): iterable
    {
        yield 'lookalike host' => ['https://hooks.slack.com.attacker.example/services/T/B/secret'];
        yield 'unapproved Slack host' => ['https://slack.com/services/T/B/secret'];
        yield 'nonstandard port' => ['https://hooks.slack.com:8443/services/T/B/secret'];
        yield 'missing webhook path' => ['https://hooks.slack.com/'];
        yield 'query' => ['https://hooks.slack.com/services/T/B/secret?x=1'];
        yield 'fragment' => ['https://hooks.slack.com/services/T/B/secret#x'];
        yield 'userinfo' => ['https://user@hooks.slack.com/services/T/B/secret'];
    }
}
