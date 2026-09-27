<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Guides\WorkGuideFileStore;
use App\Domain\Guides\WorkGuideLink;
use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use stdClass;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class WorkGuideController extends Controller
{
    public function __construct(private readonly WorkGuideFileStore $files) {}

    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate(['workVariantId' => ['required', 'uuid']]);
        $units = $scope->roadUnitIds($request);
        $unit = $units[0] ?? '';
        abort_unless($unit !== '' && $this->allowed($unit, false), 403, 'Yo‘riqnomalarni ko‘rishga ruxsat yo‘q.');
        $rows = DbRows::select(<<<'SQL'
            select * from roadops.work_guides
            where work_variant_id = ?::uuid and division_id = ?::uuid and deleted_at is null
            order by created_at desc, id
            SQL, [$validated['workVariantId'], $unit]);

        return response()->json(['data' => [
            'items' => array_map($this->item(...), $rows),
            'canManage' => $this->allowed($unit, true),
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $validated = $request->validate([
            'roadUnitId' => ['required', 'uuid'],
            'workVariantId' => ['required', 'uuid'],
            'title' => ['required', 'string', 'max:200'],
            'kind' => ['required', 'in:DOCUMENT,VIDEO'],
            'url' => ['nullable', 'string', 'max:2048'],
            'file' => ['nullable', 'file', 'max:102400'],
        ]);
        $unit = (string) $validated['roadUnitId'];
        abort_unless($context->canAccessRoadUnit($unit) && $this->allowed($unit, true), 403, 'Yo‘riqnoma biriktirishga ruxsat yo‘q.');
        $key = trim((string) $request->header('Idempotency-Key', ''));
        if (strlen($key) < 8 || strlen($key) > 128) {
            throw ValidationException::withMessages(['idempotencyKey' => 'Saqlash kaliti yo‘q. Sahifani yangilab qayta urinib ko‘ring.']);
        }
        $title = trim((string) $validated['title']);
        if ($title === '') {
            throw ValidationException::withMessages(['title' => 'Yo‘riqnoma nomini kiriting.']);
        }
        $file = $request->file('file');
        $url = trim((string) ($validated['url'] ?? ''));
        if (($file instanceof UploadedFile) === ($url !== '')) {
            throw ValidationException::withMessages(['file' => 'Fayl yoki havoladan bittasini tanlang.']);
        }
        $kind = (string) $validated['kind'];
        $metadata = $file instanceof UploadedFile ? $this->files->inspect($file, $kind) : null;
        $url = $url === '' ? null : WorkGuideLink::validate($url);
        $sourceType = $metadata === null ? 'LINK' : 'FILE';
        $hash = hash('sha256', json_encode([
            $unit, $validated['workVariantId'], $title, $kind, $sourceType, $url, $metadata,
        ], JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($context, $key, $hash, $unit, $validated, $title, $kind, $sourceType, $url, $metadata, $file): JsonResponse {
            // Serialized by actor/key, including file checksum: retries cannot
            // create duplicate uploads or reuse a key for different file bytes.
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['work-guide:'.$context->userId.':'.$key]);
            $existing = DbRows::selectOne('select * from roadops.work_guides where created_by = ?::uuid and request_key = ?',
                [$context->userId, $key], false);
            if ($existing !== null) {
                abort_unless(hash_equals((string) $existing->request_hash, $hash), 409, 'Bu saqlash kaliti boshqa fayl uchun ishlatilgan.');
                abort_if($existing->deleted_at !== null, 409, 'Ushbu yo‘riqnoma arxivlangan. Yangi saqlash kalitidan foydalaning.');

                return response()->json(['data' => $this->item($existing)], 200);
            }
            $variant = DbRows::selectOne('select id from roadops.iqn_work_variants where id = ?::uuid', [$validated['workVariantId']], false);
            abort_if($variant === null, 422, 'IQN ish turi topilmadi.');
            $path = $file instanceof UploadedFile && $metadata !== null ? $this->files->store($file, $metadata['extension']) : null;
            try {
                $row = DbRows::selectOneOrFail(<<<'SQL'
                    insert into roadops.work_guides
                      (division_id, work_variant_id, title, kind, source_type, external_url,
                       storage_path, file_name, content_type, byte_size, sha256, created_by, request_key, request_hash)
                    values (?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::uuid, ?, ?) returning *
                    SQL, [$unit, $validated['workVariantId'], $title, $kind, $sourceType, $url,
                    $path, $metadata['fileName'] ?? null, $metadata['contentType'] ?? null,
                    $metadata['byteSize'] ?? null, $metadata['sha256'] ?? null, $context->userId, $key, $hash], false);
            } catch (\Throwable $exception) {
                if ($path !== null) {
                    $this->files->discard($path);
                }
                throw $exception;
            }

            return response()->json(['data' => $this->item($row)], 201);
        });
    }

    public function destroy(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $row = $this->find($request, $scope, $id);
        abort_unless($this->allowed((string) $row->division_id, true), 403, 'Yo‘riqnomani olib tashlashga ruxsat yo‘q.');
        // Retire access, retain original bytes and audit provenance.
        DB::update('update roadops.work_guides set deleted_at = clock_timestamp(), deleted_by = roadops.current_actor_id() where id = ?::uuid and deleted_at is null', [$id]);

        return response()->json(['data' => ['id' => $id, 'deleted' => true]]);
    }

    public function content(Request $request, ApiScope $scope, string $id): BinaryFileResponse
    {
        $row = $this->find($request, $scope, $id);
        abort_unless($row->source_type === 'FILE', 404);

        return $this->files->response((string) $row->storage_path, (string) $row->content_type,
            (string) $row->file_name, (int) $row->byte_size, (string) $row->sha256);
    }

    private function find(Request $request, ApiScope $scope, string $id): stdClass
    {
        abort_unless(Str::isUuid($id), 404);
        $row = DbRows::selectOne(<<<'SQL'
            select * from roadops.work_guides where id = ?::uuid
              and division_id = any(?::uuid[]) and deleted_at is null
            SQL, [$id, $scope->pgUuidArray($scope->roadUnitIds($request))]);
        if ($row === null) {
            abort(404);
        }
        abort_unless($this->allowed((string) $row->division_id, false), 403);

        return $row;
    }

    private function allowed(string $unit, bool $write): bool
    {
        $permissions = $write ? ['planning.write', 'catalog.manage'] : ['planning.read', 'execution.read', 'catalog.manage'];
        foreach ($permissions as $permission) {
            if (DB::scalar('select roadops.has_permission(?, ?::uuid)', [$permission, $unit])) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> */
    private function item(stdClass $row): array
    {
        return [
            'id' => (string) $row->id, 'roadUnitId' => (string) $row->division_id,
            'workVariantId' => (string) $row->work_variant_id, 'title' => (string) $row->title,
            'kind' => (string) $row->kind, 'sourceType' => (string) $row->source_type,
            'url' => $row->source_type === 'FILE'
                ? '/api/v1/work-guides/'.$row->id.'/content?roadUnitId='.$row->division_id : (string) $row->external_url,
            'fileName' => $row->file_name, 'contentType' => $row->content_type,
            'byteSize' => $row->byte_size === null ? null : (int) $row->byte_size,
            'createdAt' => (string) $row->created_at,
        ];
    }
}
