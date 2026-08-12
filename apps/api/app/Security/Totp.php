<?php

namespace App\Security;

final class Totp
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public function generateSecret(int $bytes = 20): string
    {
        if ($bytes < 16) {
            throw new \InvalidArgumentException('TOTP secret must have at least 128 bits.');
        }

        return $this->base32Encode(random_bytes($bytes));
    }

    /**
     * Returns the accepted counter, or null. A counter at or below last-used is a replay.
     */
    public function verify(
        string $base32Secret,
        string $code,
        ?int $lastUsedCounter,
        ?int $unixTime = null,
    ): ?int {
        if (! preg_match('/^\d{6}$/', $code)) {
            return null;
        }
        $counter = intdiv($unixTime ?? time(), 30);

        for ($offset = -1; $offset <= 1; $offset++) {
            $candidateCounter = $counter + $offset;
            if ($lastUsedCounter !== null && $candidateCounter <= $lastUsedCounter) {
                continue;
            }
            if (hash_equals($this->at($base32Secret, $candidateCounter), $code)) {
                return $candidateCounter;
            }
        }

        return null;
    }

    public function at(string $base32Secret, int $counter): string
    {
        $secret = $this->base32Decode($base32Secret);
        $high = intdiv($counter, 0x100000000);
        $low = $counter % 0x100000000;
        $binaryCounter = pack('N2', $high, $low);
        $hash = hash_hmac('sha1', $binaryCounter, $secret, true);
        $offset = ord($hash[19]) & 0x0F;
        $value = (
            ((ord($hash[$offset]) & 0x7F) << 24)
            | ((ord($hash[$offset + 1]) & 0xFF) << 16)
            | ((ord($hash[$offset + 2]) & 0xFF) << 8)
            | (ord($hash[$offset + 3]) & 0xFF)
        ) % 1_000_000;

        return str_pad((string) $value, 6, '0', STR_PAD_LEFT);
    }

    private function base32Decode(string $encoded): string
    {
        $encoded = strtoupper(preg_replace('/[\s=-]+/', '', $encoded) ?? '');
        if ($encoded === '') {
            throw new \InvalidArgumentException('TOTP secret is empty.');
        }

        $buffer = 0;
        $bits = 0;
        $result = '';
        foreach (str_split($encoded) as $character) {
            $value = strpos(self::ALPHABET, $character);
            if ($value === false) {
                throw new \InvalidArgumentException('TOTP secret is not valid Base32.');
            }
            $buffer = ($buffer << 5) | $value;
            $bits += 5;
            while ($bits >= 8) {
                $bits -= 8;
                $result .= chr(($buffer >> $bits) & 0xFF);
                $buffer &= (1 << $bits) - 1;
            }
        }

        return $result;
    }

    private function base32Encode(string $raw): string
    {
        $buffer = 0;
        $bits = 0;
        $result = '';
        foreach (str_split($raw) as $byte) {
            $buffer = ($buffer << 8) | ord($byte);
            $bits += 8;
            while ($bits >= 5) {
                $bits -= 5;
                $result .= self::ALPHABET[($buffer >> $bits) & 0x1F];
                $buffer &= (1 << $bits) - 1;
            }
        }
        if ($bits > 0) {
            $result .= self::ALPHABET[($buffer << (5 - $bits)) & 0x1F];
        }

        return $result;
    }
}
