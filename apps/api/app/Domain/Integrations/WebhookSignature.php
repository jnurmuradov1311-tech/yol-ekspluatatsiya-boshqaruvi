<?php

namespace App\Domain\Integrations;

use DateTimeImmutable;

final class WebhookSignature
{
    public function verify(string $body, string $timestamp, string $providedSignature, string $secret): bool
    {
        if (strlen($secret) < 32 || ! ctype_digit($timestamp)) {
            return false;
        }
        $now = new DateTimeImmutable('now');
        $received = (new DateTimeImmutable)->setTimestamp((int) $timestamp);
        if (abs($now->getTimestamp() - $received->getTimestamp()) > 300) {
            return false;
        }

        $provided = str_starts_with($providedSignature, 'sha256=')
            ? substr($providedSignature, 7)
            : $providedSignature;
        $expected = hash_hmac('sha256', $timestamp.'.'.$body, $secret);

        return strlen($provided) === 64 && hash_equals($expected, strtolower($provided));
    }
}
