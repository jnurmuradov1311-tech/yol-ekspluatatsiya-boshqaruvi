<?php

namespace App\Domain\Guides;

use Illuminate\Validation\ValidationException;

final class WorkGuideLink
{
    public static function validate(string $url): string
    {
        $parts = parse_url($url);
        if (strlen($url) > 2048 || preg_match('/[\x00-\x20\x7f\\\\]/', $url) === 1
            || filter_var($url, FILTER_VALIDATE_URL) === false || ! is_array($parts)
            || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            throw ValidationException::withMessages(['url' => 'To‘liq https:// havolasini kiriting.']);
        }

        // This link is displayed to the user. The API never fetches or embeds it.
        // Query strings are allowed for video providers (e.g. watch?v=...).
        return $url;
    }
}
