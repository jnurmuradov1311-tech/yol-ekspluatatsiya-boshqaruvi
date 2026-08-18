<?php

namespace App\Domain\Norms;

final class Iqn03PdfStager
{
    /**
     * PDF-only IQN 03 import is intentionally prohibited. This inspection
     * result points operators to the separately reviewed layout JSON path.
     *
     * @return array<string, mixed>
     */
    public function configurationArtifact(string $path): array
    {
        if (! is_file($path) || ! is_readable($path)) {
            throw new \InvalidArgumentException('IQN 03 PDF file is not readable.');
        }
        $bytes = file_get_contents($path);
        if (! is_string($bytes) || ! str_starts_with($bytes, '%PDF-')) {
            throw new \InvalidArgumentException('IQN 03 source is not a valid PDF envelope.');
        }
        $checksum = hash('sha256', $bytes);
        preg_match_all('/\/Type\s*\/Page\b/', $bytes, $pageMatches);
        $pageObjectCount = count($pageMatches[0]);
        $encrypted = preg_match('/\/Encrypt\b/', $bytes) === 1;

        return [
            'document_kind' => 'iqn_03',
            'source_sha256' => $checksum,
            'pdf_version' => substr($bytes, 5, 3),
            'page_object_count_hint' => $pageObjectCount > 0 ? $pageObjectCount : null,
            'encrypted' => $encrypted,
            'status' => 'CONFIGURATION_REQUIRED',
            'blocker_code' => $encrypted
                ? 'IQN03_ENCRYPTED_PDF_REVIEW_REQUIRED'
                : 'IQN03_APPROVED_PDF_EXTRACTOR_REQUIRED',
            'reason' => $encrypted
                ? 'Encrypted PDF content cannot enter the IQN review workflow.'
                : 'PDF-only staging is prohibited; generate and review the approved layout JSON artifact first.',
            'required_artifact' => [
                'format' => 'iqn03-layout-json-v1',
                'schema' => 'docs/iqn/schemas/iqn03-layout-json-v1.schema.json',
                'stage_command' => 'roadops:iqn03-layout-stage',
                'must_include' => [
                    'page_number',
                    'block_sequence',
                    'raw_text',
                    'bbox',
                    'rows',
                    'cells',
                    'word_sequence',
                    'extractor.name',
                    'extractor.version',
                    'source.sha256',
                ],
                'approval' => 'expert_review_required',
            ],
        ];
    }
}
