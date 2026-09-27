<?php

namespace App\Domain\Evidence;

use App\Support\DbRows;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class ExecutionEvidenceReference
{
    /** Returns false for an external legacy URL, never for a malformed local URL. */
    public function validate(string $url, string $workOrderId): bool
    {
        $workOrderId = strtolower($workOrderId);
        if (! str_starts_with($url, '/')) {
            return false;
        }
        if (! preg_match('#\A/api/v1/work-orders/([a-f0-9-]{36})/evidence/([a-f0-9-]{36})\.(jpg|png|pdf)\z#D', $url, $match)
            || ! Str::isUuid($match[1]) || ! Str::isUuid($match[2]) || $match[1] !== $workOrderId) {
            throw ValidationException::withMessages(['evidence' => ['Dalil fayli aynan shu topshiriqqa yuklangan bo‘lishi kerak.']]);
        }
        $row = DbRows::selectOne(<<<'SQL'
            select storage_path,byte_size,sha256
            from roadops.work_order_evidence
            where id=?::uuid and work_order_id=?::uuid and extension=?
            SQL, [$match[2], $workOrderId, $match[3]], false);
        if ($row === null) {
            throw ValidationException::withMessages(['evidence' => ['Dalil fayli topilmadi yoki bu topshiriqqa tegishli emas.']]);
        }
        (new ExecutionEvidenceFiles)->assertFile((string) $row->storage_path, (int) $row->byte_size, (string) $row->sha256);

        return true;
    }
}
