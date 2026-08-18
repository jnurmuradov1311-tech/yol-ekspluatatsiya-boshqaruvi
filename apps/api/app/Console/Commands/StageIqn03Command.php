<?php

namespace App\Console\Commands;

use App\Domain\Norms\Iqn03PdfStager;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class StageIqn03Command extends Command
{
    protected $signature = 'roadops:iqn03-stage
        {file : Path to IQN 03 PDF}
        {--expected-sha256= : Expected source SHA-256}';

    protected $description = 'Rejects PDF-only IQN 03 staging and records the required approved layout-JSON workflow.';

    public function handle(Iqn03PdfStager $stager): int
    {
        $path = (string) $this->argument('file');
        $artifact = $stager->configurationArtifact($path);
        $expected = strtolower(trim((string) $this->option('expected-sha256')));
        if ($expected !== '' && ! hash_equals($expected, (string) $artifact['source_sha256'])) {
            $this->error('SHA-256 mismatch; no data was written.');

            return self::FAILURE;
        }

        $connection = DB::connection('pgsql_sync');
        $existing = $connection->selectOne(
            <<<'SQL'
                select id from roadops.import_batches
                where import_kind = 'iqn_document'
                  and source_sha256 = decode(?, 'hex')
                  and parser_version = 'iqn03-pdf-configuration-artifact-1'
            SQL,
            [$artifact['source_sha256']],
        );
        if ($existing !== null) {
            $this->error("IQN 03 CONFIGURATION_REQUIRED artifact already exists as {$existing->id}.");

            return self::FAILURE;
        }

        $batchId = (string) Str::uuid();
        $connection->transaction(function () use ($connection, $batchId, $path, $artifact): void {
            $connection->insert(
                <<<'SQL'
                    insert into roadops.import_batches
                        (id, import_kind, source_filename, source_sha256, parser_version,
                         state, raw_row_count, error_count, manifest, completed_at)
                    values (?, 'iqn_document', ?, decode(?, 'hex'),
                            'iqn03-pdf-configuration-artifact-1', 'rejected', 0, 1,
                            ?::jsonb, clock_timestamp())
                SQL,
                [
                    $batchId,
                    basename($path),
                    $artifact['source_sha256'],
                    json_encode($artifact, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                ],
            );
            $connection->insert(
                <<<'SQL'
                    insert into roadops.import_issues
                        (import_batch_id, issue_code, issue_level, source_location,
                         raw_value, details)
                    values (?, ?, 'error', ?::jsonb, null, ?::jsonb)
                SQL,
                [
                    $batchId,
                    $artifact['blocker_code'],
                    json_encode(['document_kind' => 'iqn_03'], JSON_THROW_ON_ERROR),
                    json_encode($artifact, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                ],
            );
        });

        $this->error("IQN 03 staged as blocker artifact {$batchId}: {$artifact['blocker_code']}.");

        return self::FAILURE;
    }
}
