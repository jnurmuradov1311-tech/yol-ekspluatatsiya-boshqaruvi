<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Norms\Iqn02DocxStager;
use App\Domain\Norms\Iqn03LayoutJsonStager;
use App\Domain\Norms\IqnReviewManifestValidator;
use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\DbRows;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class IqnReviewApprovalController extends Controller
{
    public function store(
        Request $request,
        IqnReviewManifestValidator $validator,
        string $batch,
    ): JsonResponse {
        if (! Str::isUuid($batch)) {
            abort(404);
        }
        $validated = $request->validate([
            'manifest' => ['required', 'array'],
            'confirmation' => ['required', 'in:IQN_CATALOG_REVIEW_APPROVED'],
        ]);
        $manifest = $validated['manifest'];
        if (! is_array($manifest) || array_is_list($manifest)) {
            throw ValidationException::withMessages([
                'manifest' => 'IQN review manifest must be a JSON object.',
            ]);
        }
        if (array_key_exists('reviewer_attestation', $manifest)) {
            throw ValidationException::withMessages([
                'manifest.reviewer_attestation' => 'Reviewer identity is created by the authenticated server.',
            ]);
        }

        /** @var array<string, mixed> $manifest */

        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $batchRow = DbRows::selectOne(
            <<<'SQL'
                select state, parser_version, completed_at,
                       encode(source_sha256, 'hex') source_sha256
                from roadops.import_batches
                where id = ?::uuid and import_kind = 'iqn_document'
            SQL,
            [$batch],
            false,
        );
        if ($batchRow === null) {
            abort(404);
        }
        if (! in_array((string) $batchRow->state, ['parsed', 'validated'], true)
            || $batchRow->completed_at === null) {
            return $this->error('IQN_BATCH_NOT_READY', 'IQN staging batch is not ready for review.', 409);
        }
        $documentKind = match (true) {
            str_starts_with((string) $batchRow->parser_version, 'iqn02-ooxml-') => 'iqn_02',
            str_starts_with((string) $batchRow->parser_version, 'iqn03-layout-json-') => 'iqn_03',
            default => throw ValidationException::withMessages([
                'manifest.document.document_kind' => 'This parser output is not publication-eligible.',
            ]),
        };
        $approvedSourceSha256 = match ($documentKind) {
            'iqn_02' => Iqn02DocxStager::APPROVED_SOURCE_SHA256,
            'iqn_03' => Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256,
        };
        $sourceSha256 = strtolower((string) $batchRow->source_sha256);
        if (! hash_equals($approvedSourceSha256, $sourceSha256)) {
            return $this->error(
                'IQN_SOURCE_NOT_APPROVED',
                'IQN staging batch does not match the checksum-approved source.',
                409,
            );
        }
        $openIssues = DbRows::selectOneOrFail(
            <<<'SQL'
                select count(*)::integer issue_count
                from roadops.import_issues
                where import_batch_id = ?::uuid and issue_level = 'error'
                  and resolution_state = 'open'
            SQL,
            [$batch],
            false,
        );
        if ((int) $openIssues->issue_count > 0) {
            return $this->error(
                'IQN_BLOCKING_ISSUES',
                'IQN staging batch has unresolved blocking issues.',
                409,
            );
        }

        $stagedBlocks = $this->sources(DbRows::select(
            <<<'SQL'
                select encode(provenance_hash, 'hex') provenance_hash,
                       ambiguity_flags::text ambiguity_flags
                from roadops.iqn_staged_blocks
                where import_batch_id = ?::uuid
                order by block_sequence
            SQL,
            [$batch],
            false,
        ));
        $stagedRows = $this->sources(DbRows::select(
            <<<'SQL'
                select encode(provenance_hash, 'hex') provenance_hash,
                       ambiguity_flags::text ambiguity_flags
                from roadops.iqn_staged_rows
                where import_batch_id = ?::uuid
                order by table_index, row_index
            SQL,
            [$batch],
            false,
        ));
        if ($stagedBlocks === [] || $stagedRows === []) {
            return $this->error(
                'IQN_STAGING_INCOMPLETE',
                'Every IQN approval requires staged blocks and table rows.',
                409,
            );
        }

        $clock = DbRows::selectOneOrFail(
            <<<'SQL'
                with approval_clock as (select clock_timestamp() approved_at)
                select to_char(approved_at at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') confirmed_at,
                       to_char((approved_at + interval '24 hours') at time zone 'UTC',
                               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') expires_at
                from approval_clock
            SQL,
            [],
            false,
        );
        $attestationId = (string) Str::uuid();
        $canonicalManifestHash = $validator->reviewPayloadHash($manifest);
        $attestation = [
            'attestation_id' => $attestationId,
            'canonical_manifest_sha256' => $canonicalManifestHash,
            'confirmation' => 'IQN_CATALOG_REVIEW_APPROVED',
            'confirmed_at' => (string) $clock->confirmed_at,
            'expires_at' => (string) $clock->expires_at,
            'import_batch_id' => strtolower($batch),
            'reviewed_by' => strtolower($context->userId),
            'source_sha256' => $sourceSha256,
        ];
        $manifest['reviewer_attestation'] = $attestation;
        try {
            $validator->validate(
                $manifest,
                $stagedBlocks,
                $stagedRows,
                $documentKind,
                $batch,
                $sourceSha256,
                $context->userId,
            );
        } catch (\DomainException $exception) {
            throw ValidationException::withMessages([
                'manifest' => $exception->getMessage(),
            ]);
        }

        $requestId = (string) $request->header('X-Request-ID');
        if (! Str::isUuid($requestId)) {
            throw new \RuntimeException('Authenticated request ID is missing.');
        }
        try {
            DB::insert(
                <<<'SQL'
                    insert into roadops.iqn_import_reviews
                        (id, import_batch_id, document_kind, review_manifest,
                         review_manifest_hash, review_state, reviewed_by,
                         reviewer_attestation, reviewer_confirmed_at,
                         approval_expires_at, reviewer_session_id,
                         approval_request_id, approved_source_sha256,
                         canonical_manifest_hash)
                    values (?::uuid, ?::uuid, ?, ?::jsonb, decode(?, 'hex'),
                            'validated', ?::uuid, ?::jsonb, ?::timestamptz,
                            ?::timestamptz, ?::uuid, ?::uuid, decode(?, 'hex'),
                            decode(?, 'hex'))
                SQL,
                [
                    $attestationId,
                    $batch,
                    $documentKind,
                    $this->json($manifest),
                    $canonicalManifestHash,
                    $context->userId,
                    $this->json($attestation),
                    $clock->confirmed_at,
                    $clock->expires_at,
                    $context->sessionId,
                    $requestId,
                    $sourceSha256,
                    $canonicalManifestHash,
                ],
            );
        } catch (QueryException $exception) {
            if (($exception->errorInfo[0] ?? null) !== '23505') {
                throw $exception;
            }

            return $this->error(
                'IQN_REVIEW_ALREADY_APPROVED',
                'This IQN staging batch already has a persisted review approval.',
                409,
            );
        }

        return response()->json([
            'data' => [
                'reviewId' => $attestationId,
                'importBatchId' => strtolower($batch),
                'documentKind' => $documentKind,
                'reviewedBy' => strtolower($context->userId),
                'reviewerSessionId' => strtolower($context->sessionId),
                'confirmedAt' => (string) $clock->confirmed_at,
                'expiresAt' => (string) $clock->expires_at,
                'sourceSha256' => $sourceSha256,
                'canonicalManifestSha256' => $canonicalManifestHash,
                'confirmation' => 'IQN_CATALOG_REVIEW_APPROVED',
            ],
        ], 201);
    }

    /**
     * @param  list<object>  $rows
     * @return list<array{provenance_hash:string,ambiguity_flags:list<string>}>
     */
    private function sources(array $rows): array
    {
        return array_values(array_map(function (object $row): array {
            $flags = json_decode((string) $row->ambiguity_flags, true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($flags) || ! array_is_list($flags)) {
                throw new \DomainException('IQN ambiguity flags must be a JSON array.');
            }
            foreach ($flags as $flag) {
                if (! is_string($flag)) {
                    throw new \DomainException('IQN ambiguity flags must contain only strings.');
                }
            }

            /** @var list<string> $flags */
            return [
                'provenance_hash' => strtolower((string) $row->provenance_hash),
                'ambiguity_flags' => $flags,
            ];
        }, $rows));
    }

    private function json(mixed $payload): string
    {
        return json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        );
    }

    private function error(string $code, string $message, int $status): JsonResponse
    {
        return response()->json(['error' => ['code' => $code, 'message' => $message]], $status);
    }
}
