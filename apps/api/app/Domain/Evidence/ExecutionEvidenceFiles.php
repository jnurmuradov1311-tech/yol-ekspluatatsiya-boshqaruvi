<?php

namespace App\Domain\Evidence;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;

final class ExecutionEvidenceFiles
{
    public const MAX_BYTES = 20971520;

    /** @return array{contentType:string,extension:string,sizeBytes:int,sha256:string,fileName:string} */
    public function inspect(UploadedFile $file): array
    {
        $size = $file->getSize();
        $mime = $file->getMimeType();
        $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'application/pdf' => 'pdf'];
        if (! $file->isValid() || $size === false || $size < 1 || $size > self::MAX_BYTES
            || $mime === null || ! isset($extensions[$mime])) {
            throw ValidationException::withMessages(['file' => ['JPG, PNG yoki PDF fayl tanlang (20 MB gacha).']]);
        }
        if ($mime !== 'application/pdf') {
            $dimensions = @getimagesize($file->getPathname());
            if ($dimensions === false || $dimensions[0] * $dimensions[1] > 60000000) {
                throw ValidationException::withMessages(['file' => ['Rasm fayli yaroqsiz yoki o‘lchami juda katta.']]);
            }
        }
        $hash = hash_file('sha256', $file->getPathname());
        if ($hash === false) {
            throw new \RuntimeException('Execution evidence cannot be read.');
        }
        $original = preg_replace('/[\x00-\x1f\x7f\/\\\\]/u', '_', $file->getClientOriginalName()) ?? 'Dalil';
        $base = pathinfo($original, PATHINFO_FILENAME);

        return [
            'contentType' => $mime, 'extension' => $extensions[$mime], 'sizeBytes' => $size,
            'sha256' => $hash,
            'fileName' => mb_substr($base === '' ? 'Dalil' : $base, 0, 150).'.'.$extensions[$mime],
        ];
    }

    public function store(UploadedFile $file, string $fileId, string $extension): string
    {
        $path = 'execution-evidence/'.$fileId.'.'.$extension;
        $this->assertPath($path);
        $stored = Storage::disk('local')->putFileAs('execution-evidence', $file, $fileId.'.'.$extension);
        if ($stored !== $path) {
            throw new \RuntimeException('Execution evidence could not be saved.');
        }

        return $path;
    }

    public function discard(string $path): void
    {
        $this->assertPath($path);
        Storage::disk('local')->delete($path);
    }

    public function assertFile(string $path, int $size, string $hash): string
    {
        $this->assertPath($path);
        $disk = Storage::disk('local');
        abort_unless($disk->exists($path), 404, 'Dalil fayli topilmadi.');
        $absolute = $disk->path($path);
        abort_unless(filesize($absolute) === $size && hash_equals($hash, (string) hash_file('sha256', $absolute)),
            409, 'Dalil fayli o‘zgargan. Uni qayta yuklang.');

        return $absolute;
    }

    public function response(string $path, string $mime, string $name, int $size, string $hash): BinaryFileResponse
    {
        $absolute = $this->assertFile($path, $size, $hash);
        $response = new BinaryFileResponse($absolute, 200, [
            'Content-Type' => $mime, 'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff', 'Cross-Origin-Resource-Policy' => 'same-origin',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], false);
        $response->setContentDisposition(
            $mime === 'application/pdf' ? ResponseHeaderBag::DISPOSITION_ATTACHMENT : ResponseHeaderBag::DISPOSITION_INLINE,
            $name, 'evidence.'.pathinfo($path, PATHINFO_EXTENSION),
        );

        return $response;
    }

    private function assertPath(string $path): void
    {
        if (! preg_match('/\Aexecution-evidence\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(jpg|png|pdf)\z/D', $path)) {
            throw new \InvalidArgumentException('Invalid private execution evidence path.');
        }
    }
}
