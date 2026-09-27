<?php

namespace Tests\Feature;

use App\Domain\Evidence\ExecutionEvidenceFiles;
use App\Domain\Evidence\ExecutionEvidenceReference;
use App\Http\Controllers\Api\V1\WorkOrderExecutionController;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Mockery;
use ReflectionMethod;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class ExecutionEvidenceUploadTest extends TestCase
{
    private const ORDER = '98028000-0000-4000-8000-000000000001';

    private const FILE = '98028000-0000-4000-8000-000000000002';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('roadops.execution_evidence_allowed_origins', []);
    }

    public function test_local_evidence_works_without_external_storage_configuration(): void
    {
        $files = new ExecutionEvidenceFiles;
        $photo = $this->photo();
        $metadata = $files->inspect($photo);
        $path = $files->store($photo, self::FILE, 'png');
        DB::shouldReceive('selectOne')->once()->with(Mockery::type('string'),
            [self::FILE, self::ORDER, 'png'], false)->andReturn((object) [
                'storage_path' => $path, 'byte_size' => $metadata['sizeBytes'], 'sha256' => $metadata['sha256'],
            ]);
        $method = new ReflectionMethod(WorkOrderExecutionController::class, 'assertEvidenceOrigins');
        $method->invoke(new WorkOrderExecutionController, [$this->url()], self::ORDER);
        self::assertSame('image/png', $metadata['contentType']);
        Storage::disk('local')->assertExists($path);
    }

    public function test_other_order_url_is_rejected_without_querying(): void
    {
        DB::shouldReceive('selectOne')->never();
        $this->expectException(ValidationException::class);
        (new ExecutionEvidenceReference)->validate($this->url(), '98028000-0000-4000-8000-000000000099');
    }

    public function test_guessed_unregistered_file_id_is_rejected(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturnNull();
        $this->expectException(ValidationException::class);
        (new ExecutionEvidenceReference)->validate($this->url(), self::ORDER);
    }

    public function test_changed_file_bytes_are_rejected(): void
    {
        $files = new ExecutionEvidenceFiles;
        $photo = $this->photo();
        $metadata = $files->inspect($photo);
        $path = $files->store($photo, self::FILE, 'png');
        Storage::disk('local')->put($path, 'changed');
        $this->expectException(HttpException::class);
        $files->assertFile($path, $metadata['sizeBytes'], $metadata['sha256']);
    }

    public function test_script_renamed_to_an_image_is_rejected(): void
    {
        $this->expectException(ValidationException::class);
        (new ExecutionEvidenceFiles)->inspect(UploadedFile::fake()->createWithContent('photo.png', '<?php echo 1;'));
    }

    public function test_legacy_https_still_requires_an_allowed_origin(): void
    {
        $method = new ReflectionMethod(WorkOrderExecutionController::class, 'assertEvidenceOrigins');
        config()->set('roadops.execution_evidence_allowed_origins', ['https://evidence.example.invalid']);
        $method->invoke(new WorkOrderExecutionController, ['https://evidence.example.invalid/report.pdf'], self::ORDER);
        $this->expectException(ValidationException::class);
        $method->invoke(new WorkOrderExecutionController, ['https://other.example.invalid/report.pdf'], self::ORDER);
    }

    private function photo(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('photo.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=', true,
        ));
    }

    private function url(): string
    {
        return '/api/v1/work-orders/'.self::ORDER.'/evidence/'.self::FILE.'.png';
    }
}
