<?php

namespace Tests\Feature;

use App\Domain\Evidence\EvidencePolicyException;
use App\Domain\Evidence\LocalInspectionEvidence;
use App\Security\AuthContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class LocalInspectionEvidenceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config()->set('app.key', 'base64:'.base64_encode(str_repeat('e', 32)));
        Storage::fake('local');
    }

    public function test_uploaded_photo_can_be_attached_only_by_its_uploader(): void
    {
        $store = new LocalInspectionEvidence;
        $descriptor = $store->upload($this->photo(), $this->actor('one'), ['latitude' => 41.0, 'longitude' => 69.0]);
        self::assertSame('image/png', $descriptor['contentType']);
        self::assertArrayHasKey('uploadToken', $descriptor);
        $saved = $store->validateReceipt($descriptor, $this->actor('one'));
        self::assertSame($descriptor['sha256'], $saved['sha256']);
        self::assertArrayNotHasKey('uploadToken', $saved);
        $this->expectException(EvidencePolicyException::class);
        $store->validateReceipt($descriptor, $this->actor('two'));
    }

    public function test_changed_descriptor_is_rejected(): void
    {
        $store = new LocalInspectionEvidence;
        $descriptor = $store->upload($this->photo(), $this->actor('one'), []);
        $descriptor['sha256'] = str_repeat('a', 64);
        $this->expectException(EvidencePolicyException::class);
        $store->validateReceipt($descriptor, $this->actor('one'));
    }

    public function test_file_content_change_is_detected_before_attach(): void
    {
        $store = new LocalInspectionEvidence;
        $descriptor = $store->upload($this->photo(), $this->actor('one'), []);
        $id = substr($descriptor['objectUri'], strlen('local-evidence://'));
        Storage::disk('local')->put('inspection-evidence/'.$id.'.bin', 'changed');
        $this->expectException(EvidencePolicyException::class);
        $store->validateReceipt($descriptor, $this->actor('one'));
    }

    public function test_script_renamed_as_photo_is_rejected(): void
    {
        $this->expectException(EvidencePolicyException::class);
        (new LocalInspectionEvidence)->upload(
            UploadedFile::fake()->createWithContent('photo.jpg', '<?php echo "bad";'),
            $this->actor('one'), [],
        );
    }

    public function test_expired_unattached_receipt_requires_a_fresh_upload(): void
    {
        $store = new LocalInspectionEvidence;
        $descriptor = $store->upload($this->photo(), $this->actor('one'), []);
        $this->travel(3)->days();
        $this->expectException(EvidencePolicyException::class);
        $store->validateReceipt($descriptor, $this->actor('one'));
    }

    private function photo(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('photo.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=',
            true,
        ));
    }

    private function actor(string $id): AuthContext
    {
        return new AuthContext('session', $id, 'test@example.invalid', 'Test', '', ['defects.capture'], [], []);
    }
}
