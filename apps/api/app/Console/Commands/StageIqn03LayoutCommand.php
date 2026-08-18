<?php

namespace App\Console\Commands;

use App\Domain\Norms\Iqn03LayoutJsonStager;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class StageIqn03LayoutCommand extends Command
{
    protected $signature = 'roadops:iqn03-layout-stage
        {pdf : Path to the checksum-approved IQN 03 PDF}
        {layout_json : Path to iqn03-layout-json-v1 output}';

    protected $description = 'Validates and stages approved IQN 03 page/table/cell geometry for explicit expert review.';

    public function handle(Iqn03LayoutJsonStager $stager): int
    {
        try {
            $result = $stager->extract(
                (string) $this->argument('pdf'),
                (string) $this->argument('layout_json'),
            );
        } catch (\Throwable $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $connection = DB::connection('pgsql_sync');
        $existing = $connection->selectOne(
            <<<'SQL'
                select id from roadops.import_batches
                where import_kind = 'iqn_document'
                  and source_sha256 = decode(?, 'hex')
                  and parser_version = ?
            SQL,
            [$result['checksum'], $result['parser_version']],
        );
        if ($existing !== null) {
            $this->error("This exact IQN 03 layout is already staged as {$existing->id}.");

            return self::FAILURE;
        }

        $batchId = (string) Str::uuid();
        $pdfPath = (string) $this->argument('pdf');
        $layoutPath = (string) $this->argument('layout_json');
        $connection->transaction(function () use (
            $connection,
            $batchId,
            $pdfPath,
            $layoutPath,
            $result,
        ): void {
            $connection->insert(
                <<<'SQL'
                    insert into roadops.import_batches
                        (id, import_kind, source_filename, source_sha256, parser_version,
                         state, raw_row_count, manifest, completed_at)
                    values (?, 'iqn_document', ?, decode(?, 'hex'), ?, 'parsed', ?, ?::jsonb,
                            clock_timestamp())
                SQL,
                [
                    $batchId,
                    basename($pdfPath),
                    $result['checksum'],
                    $result['parser_version'],
                    $result['counts']['table_row_count'],
                    $this->json([
                        'document_kind' => 'iqn_03',
                        'schema_version' => Iqn03LayoutJsonStager::SCHEMA_VERSION,
                        'source_sha256' => $result['checksum'],
                        'layout_filename' => basename($layoutPath),
                        'layout_sha256' => $result['layout_checksum'],
                        'extractor' => $result['extractor'],
                        'counts' => $result['counts'],
                        'interpretation_status' => 'expert_review_required',
                    ]),
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
                        $this->json($block['structure']),
                        $block['provenance_hash'],
                        $this->json($block['ambiguity_flags']),
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
                            $this->json($row),
                            $row['provenance_hash'],
                            $this->json($row['ambiguity_flags']),
                        ],
                    );

                    foreach ($row['cells'] as $cell) {
                        $sourceLocation = [
                            'coordinate_system' => Iqn03LayoutJsonStager::COORDINATE_SYSTEM,
                            'page_number' => $row['page_number'],
                            'block_sequence' => $row['block_sequence'],
                            'table_index' => $row['table_index'],
                            'row_index' => $row['row_index'],
                            'physical_column_index' => $cell['physical_column_index'],
                            'logical_column_index' => $cell['logical_column_index'],
                            'is_placeholder' => $cell['is_placeholder'],
                            'bbox' => $cell['bbox'],
                            'words' => $cell['words'],
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
                                'page:'.$row['page_number'].':table:'.$row['table_index'],
                                $row['row_index'],
                                'column:'.$cell['logical_column_index'],
                                $cell['raw_text'],
                                $cell['normalized_text'],
                                $this->json($sourceLocation),
                                $cell['provenance_hash'],
                            ],
                        );
                    }
                }
            }
        });

        $this->info(sprintf(
            'IQN 03 layout staged as %s: %d pages, %d blocks, %d table rows, %d cell slots. Expert review is still required.',
            $batchId,
            $result['counts']['page_count'],
            $result['counts']['block_count'],
            $result['counts']['table_row_count'],
            $result['counts']['table_cell_slot_count'],
        ));

        return self::SUCCESS;
    }

    private function json(mixed $payload): string
    {
        return json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        );
    }
}
