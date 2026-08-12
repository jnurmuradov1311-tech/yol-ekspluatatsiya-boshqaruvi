<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\Iqn03PdfStager;
use PHPUnit\Framework\TestCase;

final class Iqn03PdfStagerTest extends TestCase
{
    public function test_real_pdf_yields_an_explicit_configuration_blocker_without_guessing_content(): void
    {
        $path = dirname(__DIR__, 6).'/source-materials/ИҚН 03-24 29.01.2025.pdf';
        if (! is_file($path)) {
            self::markTestSkipped('Source-materials fixture is unavailable.');
        }

        $artifact = (new Iqn03PdfStager)->configurationArtifact($path);

        self::assertSame('iqn_03', $artifact['document_kind']);
        self::assertSame('CONFIGURATION_REQUIRED', $artifact['status']);
        self::assertSame('IQN03_APPROVED_PDF_EXTRACTOR_REQUIRED', $artifact['blocker_code']);
        self::assertSame(51, $artifact['page_object_count_hint']);
        self::assertFalse($artifact['encrypted']);
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $artifact['source_sha256']);
    }
}
