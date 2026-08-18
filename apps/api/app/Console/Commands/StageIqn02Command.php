<?php

namespace App\Console\Commands;

use App\Domain\Norms\Iqn02DocxStager;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class StageIqn02Command extends Command
{
    protected $signature = 'roadops:iqn02-stage
        {file : Path to the checksum-approved IQN 02 DOCX}
        {--expected-sha256= : Optional second pin; the built-in approved checksum is always enforced}';

    protected $description = 'Stages lossless IQN 02 OOXML structure for expert interpretation; does not publish norms.';

    public function handle(Iqn02DocxStager $stager): int
    {
        $path = (string) $this->argument('file');
        try {
            $result = $stager->extract($path);
        } catch (\Throwable $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
        $expected = strtolower(trim((string) $this->option('expected-sha256')));
        if ($expected !== '' && ! hash_equals($expected, $result['checksum'])) {
            $this->error('SHA-256 mismatch; no data was written.');

            return self::FAILURE;
        }
        if ($result['table_count'] !== 99) {
            $this->error('Structural regression: expected 99 tables, got '.$result['table_count'].'.');

            return self::FAILURE;
        }

        $batchId = (string) Str::uuid();
        $connection = DB::connection('pgsql_sync');
        $connection->transaction(function () use ($connection, $batchId, $path, $result): void {
            $connection->insert(
                <<<'SQL'
                    insert into roadops.import_batches
                        (id, import_kind, source_filename, source_sha256, parser_version,
                         state, raw_row_count, manifest, completed_at)
                    values (?, 'iqn_document', ?, decode(?, 'hex'), 'iqn02-ooxml-2',
                            'parsed', ?, ?::jsonb, clock_timestamp())
                SQL,
                [
                    $batchId,
                    basename($path),
                    $result['checksum'],
                    $result['row_count'],
                    json_encode([
                        'document_kind' => 'iqn_02',
                        'paragraph_count' => $result['paragraph_count'],
                        'table_count' => $result['table_count'],
                        'row_count' => $result['row_count'],
                        'cell_count' => $result['cell_count'],
                        'paragraph_tab_token_count' => $result['paragraph_tab_count'],
                        'paragraph_explicit_break_count' => $result['paragraph_break_count'],
                        'cell_tab_token_count' => $result['cell_tab_count'],
                        'cell_explicit_break_count' => $result['cell_break_count'],
                        'tab_token_count' => $result['tab_count'],
                        'explicit_break_count' => $result['break_count'],
                        'ambiguous_row_count' => array_sum(array_map(
                            static fn (array $table): int => count(array_filter(
                                $table['rows'],
                                static fn (array $row): bool => $row['ambiguity_flags'] !== [],
                            )),
                            $result['tables'],
                        )),
                        'interpretation_status' => 'expert_review_required',
                    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                ],
            );
            foreach ($result['blocks'] as $block) {
                $connection->insert(
                    <<<'SQL'
                        insert into roadops.iqn_staged_blocks
                            (import_batch_id, block_sequence, block_kind, source_index,
                             raw_text, normalized_text, structure, provenance_hash, ambiguity_flags)
                        values (?, ?, ?, ?, ?, ?, ?::jsonb, decode(?, 'hex'), ?::jsonb)
                    SQL,
                    [
                        $batchId,
                        $block['block_sequence'],
                        $block['block_kind'],
                        $block['source_index'],
                        $block['raw_text'],
                        $block['normalized_text'],
                        json_encode($block['structure'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                        $block['provenance_hash'],
                        json_encode($block['ambiguity_flags'], JSON_THROW_ON_ERROR),
                    ],
                );
            }
            foreach ($result['tables'] as $table) {
                foreach ($table['rows'] as $row) {
                    $connection->insert(
                        <<<'SQL'
                            insert into roadops.iqn_staged_rows
                                (import_batch_id, block_sequence, table_index, row_index,
                                 physical_cell_count, logical_column_count, row_payload,
                                 provenance_hash, ambiguity_flags)
                            values (?, ?, ?, ?, ?, ?, ?::jsonb, decode(?, 'hex'), ?::jsonb)
                        SQL,
                        [
                            $batchId,
                            $row['block_sequence'],
                            $row['table_index'],
                            $row['row_index'],
                            $row['physical_cell_count'],
                            $row['logical_column_count'],
                            json_encode($row, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                            $row['provenance_hash'],
                            json_encode($row['ambiguity_flags'], JSON_THROW_ON_ERROR),
                        ],
                    );
                    foreach ($row['cells'] as $cell) {
                        $sourceLocation = [
                            'block_sequence' => $row['block_sequence'],
                            'table_index' => $table['table_index'],
                            'row_index' => $row['row_index'],
                            'physical_column_index' => $cell['physical_column_index'],
                            'logical_column_index' => $cell['logical_column_index'],
                            'grid_span' => $cell['grid_span'],
                            'vertical_merge' => $cell['vertical_merge'],
                            'tokens' => $cell['tokens'],
                            'ambiguity_flags' => $cell['ambiguity_flags'],
                            'provenance_hash' => $cell['provenance_hash'],
                        ];
                        $connection->insert(
                            <<<'SQL'
                                insert into roadops.import_raw_cells
                                    (import_batch_id, source_container, row_number,
                                     column_reference, raw_value, normalized_value,
                                     source_location, cell_hash)
                                values (?, ?, ?, ?, ?, ?, ?::jsonb, decode(?, 'hex'))
                            SQL,
                            [
                                $batchId,
                                'table:'.$table['table_index'],
                                $row['row_index'],
                                'physical-column:'.$cell['physical_column_index'],
                                $cell['raw_text'],
                                $cell['normalized_text'],
                                json_encode($sourceLocation, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                                $cell['provenance_hash'],
                            ],
                        );
                    }
                }
            }
        });

        $this->info("IQN 02 staged as {$batchId}; expert review is still required.");

        return self::SUCCESS;
    }
}
