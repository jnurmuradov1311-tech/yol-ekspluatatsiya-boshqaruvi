<?php

namespace App\Support;

final class HttpsEndpoint
{
    /**
     * Validate and normalize a vendor API base URL.
     */
    public static function baseApi(mixed $value, string $label = 'Vendor API endpoint'): string
    {
        return self::validate($value, $label);
    }

    /**
     * Validate an official Slack incoming-webhook URL.
     */
    public static function slackWebhook(mixed $value): string
    {
        $url = self::validate($value, 'Slack webhook endpoint');
        $parts = parse_url($url);
        if (! is_array($parts)) {
            throw new \InvalidArgumentException('Slack webhook endpoint must be a valid absolute HTTPS URL.');
        }

        $host = strtolower((string) ($parts['host'] ?? ''));
        if (! in_array($host, ['hooks.slack.com', 'hooks.slack-gov.com'], true)) {
            throw new \InvalidArgumentException('Slack webhook endpoint must use an approved Slack webhook host.');
        }
        if (array_key_exists('port', $parts) && (int) $parts['port'] !== 443) {
            throw new \InvalidArgumentException('Slack webhook endpoint must use the standard HTTPS port.');
        }
        $path = (string) ($parts['path'] ?? '');
        if ($path === '' || $path === '/') {
            throw new \InvalidArgumentException('Slack webhook endpoint must contain a webhook path.');
        }

        return $url;
    }

    private static function validate(mixed $value, string $label): string
    {
        if (! is_string($value) || $value === '' || $value !== trim($value)) {
            throw new \InvalidArgumentException("{$label} must be a valid absolute HTTPS URL.");
        }
        if (preg_match('/[\\x00-\\x20\\x7f\\\\]/', $value) === 1) {
            throw new \InvalidArgumentException("{$label} must not contain whitespace, control characters, or backslashes.");
        }
        if (filter_var($value, FILTER_VALIDATE_URL) === false) {
            throw new \InvalidArgumentException("{$label} must be a valid absolute HTTPS URL.");
        }

        $parts = parse_url($value);
        if (! is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || (string) ($parts['host'] ?? '') === '') {
            throw new \InvalidArgumentException("{$label} must be a valid absolute HTTPS URL.");
        }
        if (array_key_exists('user', $parts) || array_key_exists('pass', $parts)) {
            throw new \InvalidArgumentException("{$label} must not contain credentials.");
        }
        if (array_key_exists('query', $parts)) {
            throw new \InvalidArgumentException("{$label} must not contain a query string.");
        }
        if (array_key_exists('fragment', $parts)) {
            throw new \InvalidArgumentException("{$label} must not contain a fragment.");
        }

        return rtrim($value, '/');
    }
}
