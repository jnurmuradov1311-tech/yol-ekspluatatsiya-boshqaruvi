<?php

namespace App\Console\Commands;

use App\Domain\Norms\RoadVisionCatalogAuditor;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class ImportRoadVisionCatalogCommand extends Command
{
    protected $signature = 'roadops:roadvision-catalog {file : Path to the reviewed xlsx} {--acknowledge-count-mismatch}';

    protected $description = 'Stages and validates the RoadVision attribute workbook; never auto-publishes mappings.';

    public function handle(RoadVisionCatalogAuditor $auditor): int
    {
        $path = (string) $this->argument('file');
        $audit = $auditor->audit($path);
        $blockingIssues = array_values(array_filter(
            $audit->issues,
            fn (array $issue): bool => $issue['blocking'] && ! (
                in_array($issue['code'], ['DECLARED_COUNT_MISMATCH', 'SUMMARY_SUBTOTAL_MISMATCH'], true)
                && (bool) $this->option('acknowledge-count-mismatch')
            ),
        ));
        $batchId = (string) Str::uuid();

        $connection = DB::connection('pgsql_sync');
        $connection->transaction(function () use ($connection, $batchId, $path, $audit, $blockingIssues): void {
            $source = $connection->selectOne(
                "select id from roadops.source_systems where system_kind = 'roadvision' and enabled = true order by created_at limit 1",
            );
            if ($source === null) {
                throw new \RuntimeException('RoadVision source system is CONFIGURATION_REQUIRED.');
            }
            $connection->insert(
                <<<'SQL'
                    insert into roadops.import_batches
                        (id, import_kind, source_system_id, source_filename, source_sha256,
                         parser_version, state, raw_row_count, error_count, warning_count,
                         manifest, completed_at)
                    values (?, 'roadvision_attribute_catalog', ?, ?, decode(?, 'hex'),
                            'roadvision-xlsx-2', ?, ?, ?, ?, ?::jsonb, clock_timestamp())
                SQL,
                [
                    $batchId,
                    $source->id,
                    basename($path),
                    hash_file('sha256', $path),
                    $blockingIssues === [] ? 'validated' : 'rejected',
                    $audit->actualCount,
                    count($blockingIssues),
                    count($audit->issues) - count($blockingIssues),
                    json_encode([
                        'declared_record_count' => $audit->declaredCount,
                        'actual_record_count' => $audit->actualCount,
                        'actual_direction_counts' => $audit->directionCounts,
                        'declared_direction_counts' => $audit->summaryCounts,
                        'classification_status' => 'expert_review_required',
                    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                ],
            );
            foreach ($audit->issues as $issue) {
                $blocking = in_array($issue, $blockingIssues, true);
                $connection->insert(
                    <<<'SQL'
                        insert into roadops.import_issues
                            (import_batch_id, issue_code, issue_level, source_location,
                             raw_value, details)
                        values (?, ?, ?, ?::jsonb, null, ?::jsonb)
                    SQL,
                    [
                        $batchId,
                        $issue['code'],
                        $blocking ? 'error' : 'warning',
                        json_encode($issue['context'] ?? [], JSON_THROW_ON_ERROR),
                        json_encode($issue, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    ],
                );
            }
            foreach ($audit->rows as $row) {
                $rawRow = [
                    'source_id' => $row['source_id'],
                    'category' => $row['category'],
                    'name' => $row['name'],
                    'direction' => $row['direction'],
                ];
                $encoded = json_encode($rawRow, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                $connection->insert(
                    <<<'SQL'
                        insert into roadops.roadvision_attribute_staging
                            (import_batch_id, source_row_number, external_code, external_name,
                             raw_row, row_hash, validation_state, validation_errors)
                        values (?, ?, ?, ?, ?::jsonb, decode(?, 'hex'), 'pending', '[]'::jsonb)
                    SQL,
                    [
                        $batchId,
                        $row['source_row'],
                        $row['source_id'],
                        $row['name'],
                        $encoded,
                        hash('sha256', $encoded),
                    ],
                );
            }
        });

        $this->table(['Batch', 'Declared', 'Actual', 'Status'], [[
            $batchId,
            $audit->declaredCount ?? '-',
            $audit->actualCount,
            $blockingIssues === [] ? 'VALIDATED' : 'REJECTED',
        ]]);
        foreach ($audit->issues as $issue) {
            $this->warn($issue['code'].': '.$issue['message']);
        }

        return $blockingIssues === [] ? self::SUCCESS : self::FAILURE;
    }
}
