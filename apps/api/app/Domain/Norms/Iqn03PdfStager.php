<?php

namespace App\Domain\Norms;

final class Iqn03PdfStager
{
    /**
     * IQN 03 is intentionally not extracted with an unapproved heuristic parser.
     * This inspection result is persisted as a machine-readable configuration blocker.
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
                : 'No approved layout-aware PDF extractor is configured; heuristic text extraction is prohibited.',
            'required_artifact' => [
                'format' => 'iqn03-layout-json-v1',
                'must_include' => [
                    'page_number',
                    'block_sequence',
                    'raw_text',
                    'table_coordinates',
                    'source_bbox',
                    'extractor_name',
                    'extractor_version',
                    'source_sha256',
                ],
                'approval' => 'expert_review_required',
            ],
        ];
    }
}
