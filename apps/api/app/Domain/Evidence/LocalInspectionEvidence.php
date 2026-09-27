<?php

namespace App\Domain\Evidence;

use App\Security\AuthContext;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/** Private files are accessible only through an RLS-scoped inspection. */
final class LocalInspectionEvidence
{
    public const MAX_BYTES = 20 * 1024 * 1024;

    /**
     * @param  array<string, mixed>  $metadata
     * @return array<string, mixed>
     */
    public function upload(UploadedFile $file, AuthContext $actor, array $metadata): array
    {
        $mime = (string) $file->getMimeType();
        if (! $file->isValid() || ! in_array($mime, ['image/jpeg', 'image/png', 'video/mp4'], true)
            || $file->getSize() <= 0 || $file->getSize() > self::MAX_BYTES) {
            throw new EvidencePolicyException('EVIDENCE_FILE_INVALID', 422, 'JPG, PNG yoki MP4 fayl tanlang (20 MB gacha).');
        }
        if ($mime !== 'video/mp4') {
            $dimensions = @getimagesize($file->getPathname());
            if ($dimensions === false || $dimensions[0] * $dimensions[1] > 60000000) {
                throw new EvidencePolicyException('EVIDENCE_FILE_INVALID', 422, 'Rasm fayli yaroqsiz yoki o‘lchami juda katta.');
            }
        }
        $id = (string) Str::uuid();
        $sha256 = hash_file('sha256', $file->getPathname());
        if ($sha256 === false) {
            throw new EvidencePolicyException('EVIDENCE_FILE_INVALID', 422, 'Faylni o‘qib bo‘lmadi.');
        }
        $descriptor = [
            'objectUri' => 'local-evidence://'.$id,
            'contentType' => $mime,
            'sha256' => $sha256,
            'capturedAt' => (string) ($metadata['capturedAt'] ?? now()->toIso8601String()),
            'latitude' => isset($metadata['latitude']) ? (float) $metadata['latitude'] : null,
            'longitude' => isset($metadata['longitude']) ? (float) $metadata['longitude'] : null,
        ];
        $path = $this->path($descriptor['objectUri']);
        // Only server-generated names reach the private filesystem.
        $stored = Storage::disk('local')->putFileAs('inspection-evidence', $file, $id.'.bin');
        if ($stored !== $path) {
            throw new EvidencePolicyException('EVIDENCE_UPLOAD_FAILED', 503, 'Fayl saqlanmadi. Qayta urinib ko‘ring.');
        }
        $descriptor['uploadToken'] = Crypt::encryptString(json_encode([
            'actor' => $actor->userId, 'expiresAt' => now()->addDays(2)->timestamp, 'evidence' => $descriptor,
        ], JSON_THROW_ON_ERROR));

        return $descriptor;
    }

    /**
     * @param  array<string, mixed>  $item
     * @return array<string, mixed>
     */
    public function validateReceipt(array $item, AuthContext $actor): array
    {
        try {
            $receipt = json_decode(Crypt::decryptString((string) ($item['uploadToken'] ?? '')), true, 512, JSON_THROW_ON_ERROR);
        } catch (DecryptException|\JsonException) {
            throw new EvidencePolicyException('EVIDENCE_RECEIPT_INVALID', 422, 'Dalil faylini qayta yuklang.');
        }
        if (! is_array($receipt) || ($receipt['actor'] ?? null) !== $actor->userId
            || ! is_numeric($receipt['expiresAt'] ?? null) || (int) $receipt['expiresAt'] < now()->timestamp
            || ! is_array($receipt['evidence'] ?? null)) {
            throw new EvidencePolicyException('EVIDENCE_RECEIPT_INVALID', 422, 'Dalil faylini shu foydalanuvchi qayta yuklashi kerak.');
        }
        $evidence = $receipt['evidence'];
        foreach (['objectUri', 'contentType', 'sha256', 'capturedAt', 'latitude', 'longitude'] as $key) {
            $actual = $item[$key] ?? null;
            $expected = $evidence[$key] ?? null;
            if (in_array($key, ['latitude', 'longitude'], true) && is_numeric($actual) && is_numeric($expected)) {
                $actual = (float) $actual;
                $expected = (float) $expected;
            }
            if ($actual !== $expected) {
                throw new EvidencePolicyException('EVIDENCE_RECEIPT_INVALID', 422, 'Dalil ma’lumoti o‘zgargan. Faylni qayta yuklang.');
            }
        }
        $this->assertFile($evidence);

        return $evidence;
    }

    /** @param array<string, mixed> $item */
    public function stream(Request $request, array $item): Response
    {
        $path = $this->assertFile($item);
        // Symfony's file response handles one byte range for video playback.
        $response = response()->file($path, [
            'Content-Type' => (string) $item['contentType'],
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
            'Cross-Origin-Resource-Policy' => 'same-origin',
            'Referrer-Policy' => 'no-referrer',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ]);
        $response->prepare($request);

        return $response;
    }

    /** @param array<string, mixed> $item */
    private function assertFile(array $item): string
    {
        $key = $this->path((string) ($item['objectUri'] ?? ''));
        $disk = Storage::disk('local');
        if (! in_array($item['contentType'] ?? null, ['image/jpeg', 'image/png', 'video/mp4'], true)
            || ! is_string($item['sha256'] ?? null) || ! preg_match('/^[a-f0-9]{64}$/D', $item['sha256'])
            || ! $disk->exists($key) || $disk->size($key) > self::MAX_BYTES) {
            throw new EvidencePolicyException('EVIDENCE_UNAVAILABLE', 404, 'Dalil fayli mavjud emas.');
        }
        $path = $disk->path($key);
        $hash = hash_file('sha256', $path);
        if (! is_string($hash) || ! hash_equals($item['sha256'], $hash)) {
            throw new EvidencePolicyException('EVIDENCE_CHECKSUM_MISMATCH', 409, 'Dalil fayli yaxlitligi buzilgan.');
        }

        return $path;
    }

    private function path(string $uri): string
    {
        if (! preg_match('/^local-evidence:\/\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/D', $uri, $matches)) {
            throw new EvidencePolicyException('EVIDENCE_RECEIPT_INVALID', 422, 'Dalil fayli manzili yaroqsiz.');
        }

        return 'inspection-evidence/'.$matches[1].'.bin';
    }
}
