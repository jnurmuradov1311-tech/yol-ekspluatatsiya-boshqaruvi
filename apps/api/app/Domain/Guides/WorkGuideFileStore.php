<?php

namespace App\Domain\Guides;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;

final class WorkGuideFileStore
{
    public const VIDEO_MAX_BYTES = 104857600;

    public const DOCUMENT_MAX_BYTES = 20971520;

    /** @return array{contentType: string, extension: string, byteSize: int, sha256: string, fileName: string} */
    public function inspect(UploadedFile $file, string $kind): array
    {
        if (! $file->isValid()) {
            throw ValidationException::withMessages(['file' => 'Fayl to‘liq yuklanmadi. Qayta tanlang.']);
        }
        $size = $file->getSize();
        $maximum = $kind === 'VIDEO' ? self::VIDEO_MAX_BYTES : self::DOCUMENT_MAX_BYTES;
        if ($size === false || $size < 1 || $size > $maximum) {
            throw ValidationException::withMessages(['file' => $kind === 'VIDEO'
                ? 'Video hajmi 100 MB dan oshmasin.' : 'Hujjat yoki rasm hajmi 20 MB dan oshmasin.']);
        }
        $mime = $file->getMimeType();
        $extensions = $kind === 'VIDEO' ? ['video/mp4' => 'mp4'] : [
            'application/pdf' => 'pdf', 'image/jpeg' => 'jpg',
            'image/png' => 'png', 'image/webp' => 'webp',
        ];
        if ($mime === null || ! isset($extensions[$mime])) {
            throw ValidationException::withMessages(['file' => $kind === 'VIDEO'
                ? 'MP4 video tanlang.' : 'PDF, JPG, PNG yoki WebP fayl tanlang.']);
        }
        $hash = hash_file('sha256', $file->getPathname());
        if ($hash === false) {
            throw new \RuntimeException('Guide upload cannot be read.');
        }
        $original = preg_replace('/[\x00-\x1f\x7f\/\\\\]/u', '_', $file->getClientOriginalName()) ?? 'Yoriqnoma';
        $base = pathinfo($original, PATHINFO_FILENAME);
        $name = mb_substr($base === '' ? 'Yoriqnoma' : $base, 0, 160).'.'.$extensions[$mime];

        return ['contentType' => $mime, 'extension' => $extensions[$mime], 'byteSize' => $size,
            'sha256' => $hash, 'fileName' => $name];
    }

    public function store(UploadedFile $file, string $extension): string
    {
        if (! in_array($extension, ['pdf', 'jpg', 'png', 'webp', 'mp4'], true)) {
            throw new \InvalidArgumentException('Unsupported guide extension.');
        }
        $path = 'work-guides/'.Str::uuid().'.'.$extension;
        $stream = fopen($file->getPathname(), 'rb');
        if ($stream === false) {
            throw new \RuntimeException('Guide upload cannot be opened.');
        }
        try {
            if (! Storage::disk('local')->put($path, $stream, ['visibility' => 'private'])) {
                throw new \RuntimeException('Guide upload could not be saved.');
            }
        } finally {
            fclose($stream);
        }

        return $path;
    }

    public function discard(string $path): void
    {
        $this->assertPath($path);
        Storage::disk('local')->delete($path);
    }

    public function response(string $path, string $mime, string $fileName, int $byteSize, string $sha256): BinaryFileResponse
    {
        $this->assertPath($path);
        $disk = Storage::disk('local');
        abort_unless($disk->exists($path), 404, 'Yo‘riqnoma fayli topilmadi.');
        $absolute = $disk->path($path);
        abort_unless(filesize($absolute) === $byteSize && hash_equals($sha256, (string) hash_file('sha256', $absolute)),
            409, 'Yo‘riqnoma fayli o‘zgargan. Uni qayta biriktiring.');
        // Symfony handles Range/If-Range and HEAD without loading video into memory.
        $response = new BinaryFileResponse($absolute, 200, [
            'Content-Type' => $mime,
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'Cross-Origin-Resource-Policy' => 'same-origin',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], false);
        $response->setContentDisposition(
            $mime === 'application/pdf' ? ResponseHeaderBag::DISPOSITION_ATTACHMENT : ResponseHeaderBag::DISPOSITION_INLINE,
            $fileName,
            'guide.'.pathinfo($path, PATHINFO_EXTENSION),
        );

        return $response;
    }

    private function assertPath(string $path): void
    {
        if (preg_match('/\Awork-guides\/[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4)\z/D', $path) !== 1) {
            throw new \InvalidArgumentException('Invalid private guide path.');
        }
    }
}
