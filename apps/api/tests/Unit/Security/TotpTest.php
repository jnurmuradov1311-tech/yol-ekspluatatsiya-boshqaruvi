<?php

namespace Tests\Unit\Security;

use App\Security\Totp;
use PHPUnit\Framework\TestCase;

final class TotpTest extends TestCase
{
    public function test_rfc_6238_sha1_vector_is_derived_correctly(): void
    {
        $totp = new Totp;

        // RFC 6238 secret "12345678901234567890" encoded in Base32; 8-digit vector is 94287082.
        // The system intentionally uses the last 6 digits.
        self::assertSame('287082', $totp->at('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1));
    }

    public function test_used_counter_cannot_be_replayed(): void
    {
        $totp = new Totp;
        $time = 59;
        $code = $totp->at('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1);

        self::assertSame(1, $totp->verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', $code, null, $time));
        self::assertNull($totp->verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', $code, 1, $time));
    }
}
