<?php

namespace App\Domain\Integrations;

use Illuminate\Support\Facades\DB;

final class IntegrationInbox
{
    public function __construct(private readonly ExternalEventContractValidator $validator) {}

    /**
     * @param  array<string, mixed>  $envelope
     * @param  array<string, mixed>  $transportContext
     * @return array{id:string,duplicate:bool}
     */
    public function receive(
        string $sourceSystem,
        array $envelope,
        string $payloadChecksum,
        ?string $syncRunId = null,
        array $transportContext = [],
    ): array {
        $eventId = trim((string) ($envelope['event_id'] ?? ''));
        $eventType = trim((string) ($envelope['event_type'] ?? ''));
        $schemaVersion = trim((string) ($envelope['schema_version'] ?? ''));
        $occurredAt = trim((string) ($envelope['occurred_at'] ?? ''));
        $payload = $envelope['payload'] ?? null;

        if ($eventId === '' || $eventType === '' || $schemaVersion === '' || $occurredAt === '' || ! is_array($payload)) {
            throw new \InvalidArgumentException('Integration event envelope is incomplete.');
        }
        if (! preg_match('/^[a-f0-9]{64}$/', $payloadChecksum)) {
            throw new \InvalidArgumentException('Integration payload checksum must be lowercase SHA-256.');
        }
        $this->validator->validate($sourceSystem, $envelope);

        $connection = DB::connection('pgsql_sync');
        $sources = $connection->select(
            <<<'SQL'
                select s.id, c.id connection_id
                from roadops.source_systems s
                join roadops.integration_connections c on c.source_system_id = s.id
                where s.system_kind = ? and s.enabled = true and c.enabled = true
                  and c.configuration ->> 'contract_approved' = 'true'
                  and c.configuration ->> 'contract_sha256' ~ '^[a-f0-9]{64}$'
                order by s.code, s.id, c.created_at, c.id
            SQL,
            [$sourceSystem],
        );
        if (count($sources) !== 1) {
            throw new \RuntimeException(
                count($sources) === 0
                    ? "{$sourceSystem} approved source connection is CONFIGURATION_REQUIRED."
                    : "{$sourceSystem} has multiple approved enabled source connections; exactly one is required.",
            );
        }
        $source = $sources[0];

        $row = $connection->selectOne(
            <<<'SQL'
                insert into roadops.integration_inbox
                    (source_system_id, sync_run_id, stream_name, external_event_id,
                     event_kind, occurred_at, payload, payload_hash,
                     transport_context, state)
                values (?, ?, 'default', ?, ?, ?::timestamptz, ?::jsonb,
                        decode(?, 'hex'), ?::jsonb, 'pending')
                on conflict do nothing
                returning id
            SQL,
            [
                $source->id,
                $syncRunId,
                $eventId,
                $eventType,
                $occurredAt,
                json_encode($envelope, JSON_THROW_ON_ERROR),
                $payloadChecksum,
                json_encode($transportContext, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ],
        );

        if ($row !== null) {
            return ['id' => (string) $row->id, 'duplicate' => false];
        }

        $existingByEvent = $connection->selectOne(
            "select id, encode(payload_hash, 'hex') as payload_checksum from roadops.integration_inbox where source_system_id = ? and stream_name = 'default' and external_event_id = ?",
            [$source->id, $eventId],
        );
        if ($existingByEvent !== null && ! hash_equals((string) $existingByEvent->payload_checksum, $payloadChecksum)) {
            throw new \DomainException('Duplicate event_id has a different payload checksum.');
        }
        $existing = $existingByEvent ?? $connection->selectOne(
            "select id, encode(payload_hash, 'hex') as payload_checksum from roadops.integration_inbox where source_system_id = ? and stream_name = 'default' and payload_hash = decode(?, 'hex')",
            [$source->id, $payloadChecksum],
        );
        if ($existing === null) {
            throw new \RuntimeException('Integration inbox conflict could not be resolved deterministically.');
        }

        return ['id' => (string) $existing->id, 'duplicate' => true];
    }
}
