<?php

namespace Tests\Unit\Guides;

use App\Domain\Guides\WorkGuideFileStore;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class WorkGuideFileStoreTest extends TestCase
{
    /** @var list<string> */
    private array $temporaryFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->temporaryFiles as $file) {
            @unlink($file);
        }
        parent::tearDown();
    }

    public function test_uploaded_pdf_is_saved_privately_and_downloads_the_original_bytes(): void
    {
        Storage::fake('local');
        $bytes = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF";
        $file = $this->upload($bytes, 'Ish tartibi.pdf');
        $store = new WorkGuideFileStore;
        $metadata = $store->inspect($file, 'DOCUMENT');
        $path = $store->store($file, $metadata['extension']);

        self::assertSame($bytes, Storage::disk('local')->get($path));
        self::assertSame('private', Storage::disk('local')->getVisibility($path));
        self::assertSame(hash('sha256', $bytes), $metadata['sha256']);
        $response = $store->response($path, $metadata['contentType'], $metadata['fileName'], $metadata['byteSize'], $metadata['sha256']);
        self::assertStringContainsString('attachment;', (string) $response->headers->get('Content-Disposition'));
        self::assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        self::assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        self::assertSame($bytes, file_get_contents($response->getFile()->getPathname()));
    }

    public function test_video_seek_returns_a_real_byte_range(): void
    {
        Storage::fake('local');
        $bytes = pack('N', 24).'ftypisom'.pack('N', 512).'isomiso2'.pack('N', 16).'mdat'.str_repeat('x', 8);
        $file = $this->upload($bytes, 'Tartib.mp4');
        $store = new WorkGuideFileStore;
        $metadata = $store->inspect($file, 'VIDEO');
        $path = $store->store($file, $metadata['extension']);
        $response = $store->response($path, 'video/mp4', 'Tartib.mp4', strlen($bytes), hash('sha256', $bytes));
        $request = Request::create('/api/v1/work-guides/guide/content', 'GET', [], [], [], ['HTTP_RANGE' => 'bytes=8-15']);
        $response->prepare($request);

        self::assertSame(206, $response->getStatusCode());
        self::assertSame('8', $response->headers->get('Content-Length'));
        self::assertSame('bytes 8-15/'.strlen($bytes), $response->headers->get('Content-Range'));
    }

    public function test_pdf_named_html_is_not_accepted_as_a_document(): void
    {
        $this->expectException(ValidationException::class);
        (new WorkGuideFileStore)->inspect($this->upload('<html><script>alert(1)</script></html>', 'safe.pdf'), 'DOCUMENT');
    }

    public function test_image_is_not_accepted_as_a_video(): void
    {
        $this->expectException(ValidationException::class);
        (new WorkGuideFileStore)->inspect($this->upload("%PDF-1.4\n%%EOF", 'safe.mp4'), 'VIDEO');
    }

    public function test_oversized_document_is_rejected_before_saving(): void
    {
        $file = $this->upload("%PDF-1.4\n", 'large.pdf');
        $handle = fopen($file->getPathname(), 'ab');
        self::assertIsResource($handle);
        ftruncate($handle, WorkGuideFileStore::DOCUMENT_MAX_BYTES + 1);
        fclose($handle);
        clearstatcache(true, $file->getPathname());
        $this->expectException(ValidationException::class);
        (new WorkGuideFileStore)->inspect($file, 'DOCUMENT');
    }

    public function test_changed_saved_bytes_cannot_be_downloaded(): void
    {
        Storage::fake('local');
        $store = new WorkGuideFileStore;
        $file = $this->upload("%PDF-1.4\n%%EOF", 'guide.pdf');
        $metadata = $store->inspect($file, 'DOCUMENT');
        $path = $store->store($file, 'pdf');
        Storage::disk('local')->put($path, 'changed');
        $this->expectException(HttpException::class);
        $store->response($path, 'application/pdf', 'guide.pdf', $metadata['byteSize'], $metadata['sha256']);
    }

    public function test_storage_path_cannot_escape_private_guide_directory(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        (new WorkGuideFileStore)->response('../.env', 'text/plain', 'x.txt', 1, str_repeat('0', 64));
    }

    private function upload(string $contents, string $name): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'guide-test-');
        self::assertIsString($path);
        file_put_contents($path, $contents);
        $this->temporaryFiles[] = $path;

        return new UploadedFile($path, $name, null, null, true);
    }
}
