<?php

namespace App\Console\Commands;

use App\Support\HttpsEndpoint;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class ConfigureIntegrationCommand extends Command
{
    protected $signature = 'roadops:integration:configure
        {source : ytp or roadvision}
        {--contract-sha256= : SHA-256 of the approved external contract}
        {--approve-contract : Confirms that the named contract passed organizational approval}';

    protected $description = 'Registers an environment-backed integration without storing credentials in PostgreSQL.';

    public function handle(): int
    {
        $source = strtolower((string) $this->argument('source'));
        $definition = match ($source) {
            'ytp' => [
                'code' => 'road_repair_point',
                'name' => "Yo'l ta'mirlash punkti",
                'kind' => 'road_repair',
                'transport' => 'https',
                'endpoint' => config('roadops.integrations.ytp.base_url'),
                'secret_ref' => 'env:YTP_CLIENT_ID,YTP_CLIENT_SECRET,YTP_WEBHOOK_SECRET',
            ],
            'roadvision' => [
                'code' => 'roadvision',
                'name' => 'RoadVision AI',
                'kind' => 'roadvision',
                'transport' => config('roadops.integrations.roadvision.mode') === 'vendor_api' ? 'https' : 's3',
                'endpoint' => config('roadops.integrations.roadvision.mode') === 'vendor_api'
                    ? config('roadops.integrations.roadvision.api_url')
                    : 's3://'.config('roadops.integrations.roadvision.s3_bucket').'/'.config('roadops.integrations.roadvision.s3_prefix'),
                'secret_ref' => config('roadops.integrations.roadvision.mode') === 'vendor_api'
                    ? 'env:ROADVISION_CLIENT_ID,ROADVISION_CLIENT_SECRET,ROADVISION_WEBHOOK_SECRET'
                    : 'aws-default-credential-chain',
            ],
            default => null,
        };
        if ($definition === null) {
            $this->error('Source must be ytp or roadvision.');

            return self::INVALID;
        }
        if ($definition['transport'] === 'https') {
            try {
                $definition['endpoint'] = HttpsEndpoint::baseApi(
                    $definition['endpoint'],
                    $source === 'ytp' ? 'YTP base URL' : 'RoadVision API URL',
                );
            } catch (\InvalidArgumentException $exception) {
                $this->error($exception->getMessage());

                return self::INVALID;
            }
        }

        $checksum = strtolower(trim((string) $this->option('contract-sha256')));
        $approved = (bool) $this->option('approve-contract');
        if ($approved && ! preg_match('/^[0-9a-f]{64}$/', $checksum)) {
            $this->error('--approve-contract uchun 64 belgili --contract-sha256 majburiy.');

            return self::INVALID;
        }
        if (! $approved) {
            $this->warn('Ulanish saqlanadi, lekin rasmiy contract tasdiqlanmaguncha READY bo‘lmaydi.');
        }

        $connection = DB::connection('pgsql_sync');
        $connection->transaction(function () use ($connection, $definition, $approved, $checksum): void {
            $system = $connection->selectOne(
                <<<'SQL'
                    insert into roadops.source_systems (code, name, system_kind, enabled)
                    values (?, ?, ?, true)
                    on conflict (code) do update
                    set name = excluded.name, system_kind = excluded.system_kind,
                        enabled = excluded.enabled, updated_at = now()
                    returning id
                SQL,
                [$definition['code'], $definition['name'], $definition['kind']],
            );
            if ($system === null) {
                throw new \RuntimeException('Source system upsert returned no id.');
            }
            $configuration = [
                'contract_approved' => $approved,
                'contract_sha256' => $approved ? $checksum : null,
                'approved_at' => $approved ? now()->toIso8601String() : null,
            ];
            $connection->statement(
                <<<'SQL'
                    insert into roadops.integration_connections
                        (source_system_id, name, transport, endpoint, secret_reference,
                         enabled, configuration)
                    values (?, 'primary', ?, ?, ?, true, ?::jsonb)
                    on conflict (source_system_id, name) do update
                    set transport = excluded.transport, endpoint = excluded.endpoint,
                        secret_reference = excluded.secret_reference, enabled = excluded.enabled,
                        configuration = excluded.configuration, updated_at = now()
                SQL,
                [
                    $system->id,
                    $definition['transport'],
                    $definition['endpoint'],
                    $definition['secret_ref'],
                    json_encode($configuration, JSON_THROW_ON_ERROR),
                ],
            );
        });

        $this->info($definition['name'].' ulanishi ro‘yxatdan o‘tkazildi; maxfiy qiymatlar DBga yozilmadi.');

        return self::SUCCESS;
    }
}
