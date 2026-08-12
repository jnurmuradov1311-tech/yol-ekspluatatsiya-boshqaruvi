<?php

namespace App\Domain\Integrations;

use App\Support\DbRows;
use Illuminate\Support\Facades\DB;

final class IntegrationReadiness
{
    /** @return list<array<string, mixed>> */
    public function all(): array
    {
        return [
            $this->external(
                'ROAD_REPAIR_POINT',
                "Yo'l ta'mirlash punkti",
                'road_repair',
                ['Yo‘llar va uzunlik', 'Yo‘l elementlari', 'Yo‘l bo‘limlari va profillari', 'Xodimlar va malakalar'],
                ['base_url', 'client_id', 'client_secret', 'webhook_secret'],
                [
                    'OpenAPI va sandbox shartnomasini tasdiqlash',
                    'Cursor, revision va retired/deleted qoidalarini tasdiqlash',
                    'Kalibrlangan geometriya va piketajni berish',
                ],
                (array) config('roadops.integrations.ytp'),
            ),
            $this->external(
                'ROADVISION',
                'RoadVision AI',
                'roadvision',
                ['AI kuzatuvlari', 'Koordinata va piketaj', 'O‘lchovlar', 'Dalil media'],
                $this->roadVisionRequiredKeys(),
                [
                    'Natija manifest/API shartnomasini tasdiqlash',
                    'Revision va withdrawal qoidalarini tasdiqlash',
                    '152/153 katalog tafovutini manba egasi bilan yopish',
                ],
                (array) config('roadops.integrations.roadvision'),
            ),
            [
                'code' => 'SUPABASE',
                'name' => 'Supabase PostgreSQL',
                'supplies' => ['PostgreSQL/PostGIS', 'Yopiq roadops sxemasi', 'Backup va PITR'],
                'state' => $this->databaseHealthy() ? 'READY' : 'ERROR',
                'lastSuccessfulSyncAt' => null,
                'lastAttemptAt' => null,
                'message' => $this->databaseHealthy()
                    ? 'Ma’lumotlar bazasi ulanishi ishlayapti.'
                    : 'Ma’lumotlar bazasiga ulanish tekshiruvdan o‘tmadi.',
                'requiredActions' => $this->databaseHealthy() ? [] : ['DB ulanishi va SSL sozlamalarini tekshirish'],
            ],
        ];
    }

    /** @return list<string> */
    private function roadVisionRequiredKeys(): array
    {
        return config('roadops.integrations.roadvision.mode') === 'vendor_api'
            ? ['api_url', 'client_id', 'client_secret', 'webhook_secret']
            : ['s3_bucket', 's3_region', 'manifest_canonicalization'];
    }

    /**
     * @param  list<string>  $supplies
     * @param  list<string>  $requiredKeys
     * @param  list<string>  $contractActions
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    private function external(
        string $code,
        string $name,
        string $systemKind,
        array $supplies,
        array $requiredKeys,
        array $contractActions,
        array $config,
    ): array {
        $missing = array_values(array_filter(
            $requiredKeys,
            static fn (string $key): bool => $key === 'webhook_secret'
                ? strlen((string) ($config[$key] ?? '')) < 32
                : trim((string) ($config[$key] ?? '')) === '',
        ));
        $last = DbRows::selectOne(
            <<<'SQL'
                select sr.status, sr.started_at, sr.finished_at, ic.configuration,
                       ic.enabled connection_enabled, ss.enabled source_enabled,
                       coalesce(q.pending_count, 0) pending_count,
                       coalesce(q.conflict_count, 0) conflict_count,
                       coalesce(q.dead_count, 0) dead_count
                from roadops.integration_connections ic
                join roadops.source_systems ss on ss.id = ic.source_system_id
                left join lateral (
                    select r.status, r.started_at, r.finished_at
                    from roadops.sync_runs r where r.connection_id = ic.id
                    order by r.started_at desc limit 1
                ) sr on true
                left join lateral (
                    select
                      count(*) filter (where i.state in ('pending', 'processing', 'failed')) pending_count,
                      count(*) filter (where i.state = 'conflict') conflict_count,
                      count(*) filter (where i.state = 'dead_letter') dead_count
                    from roadops.integration_inbox i
                    where i.source_system_id = ss.id
                ) q on true
                where ss.system_kind = ?
                order by ic.enabled desc, ic.created_at
                limit 1
            SQL,
            [$systemKind],
        );

        $requiredActions = array_map(
            static fn (string $key): string => "{$key} maxfiy konfiguratsiyasini kiriting",
            $missing,
        );
        $connectionConfig = $last === null ? [] : (is_string($last->configuration)
            ? json_decode($last->configuration, true, 64, JSON_THROW_ON_ERROR)
            : (array) $last->configuration);
        $contractHash = $connectionConfig['contract_sha256'] ?? null;
        $contractApproved = $last !== null
            && (bool) $last->connection_enabled
            && (bool) $last->source_enabled
            && ($connectionConfig['contract_approved'] ?? false) === true
            && is_string($contractHash)
            && preg_match('/^[a-f0-9]{64}$/', $contractHash) === 1;
        if (! $contractApproved) {
            $requiredActions = array_values(array_unique([...$requiredActions, ...$contractActions]));
            $requiredActions[] = 'Tasdiqlangan contract SHA-256 xeshini yozish va ulanishni yoqish';
        }
        $pending = $last === null ? 0 : (int) $last->pending_count;
        $conflicts = $last === null ? 0 : (int) $last->conflict_count;
        $dead = $last === null ? 0 : (int) $last->dead_count;
        if ($pending > 0) {
            $requiredActions[] = "{$pending} ta qabul qilingan voqeani qayta ishlash";
        }
        if ($conflicts > 0) {
            $requiredActions[] = "{$conflicts} ta manba ziddiyatini hal qilish";
        }
        if ($dead > 0) {
            $requiredActions[] = "{$dead} ta dead-letter voqeani tekshirish";
        }
        $requiredActions = array_values(array_unique($requiredActions));

        $state = $missing === [] && $contractApproved ? 'READY' : 'NEEDS_CONFIGURATION';
        if ($last?->status === 'running') {
            $state = 'SYNCING';
        } elseif (in_array($last?->status, ['failed', 'partially_succeeded'], true)) {
            $state = 'ERROR';
        } elseif (($pending + $conflicts + $dead) > 0) {
            $state = 'ERROR';
        }

        return [
            'code' => $code,
            'name' => $name,
            'supplies' => $supplies,
            'state' => $state,
            'lastSuccessfulSyncAt' => $last?->status === 'succeeded' ? (string) $last->finished_at : null,
            'lastAttemptAt' => $last === null ? null : (string) $last->started_at,
            'message' => match ($state) {
                'READY' => 'Konfiguratsiya mavjud; contract test va reconciliation holatini kuzating.',
                'SYNCING' => 'Sinxronizatsiya davom etmoqda.',
                'ERROR' => 'Oxirgi sinxronizatsiya tekshiruv talab qiladi.',
                default => 'Haqiqiy integratsiya uchun konfiguratsiya va rasmiy shartnoma yetishmaydi.',
            },
            'requiredActions' => $requiredActions,
        ];
    }

    private function databaseHealthy(): bool
    {
        try {
            return (int) DB::scalar('select 1') === 1;
        } catch (\Throwable) {
            return false;
        }
    }
}
