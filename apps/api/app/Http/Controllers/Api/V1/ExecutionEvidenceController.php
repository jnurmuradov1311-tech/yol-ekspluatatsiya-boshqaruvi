<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Evidence\ExecutionEvidenceFiles;
use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class ExecutionEvidenceController extends Controller
{
    public function store(Request $request, ApiScope $scope, ExecutionEvidenceFiles $files, string $id): JsonResponse
    {
        abort_unless(Str::isUuid($id), 404);
        $request->validate(['file' => ['required', 'file', 'mimetypes:image/jpeg,image/png,application/pdf', 'max:20480']]);
        $actor = $request->attributes->get(AuthContext::class);
        abort_unless($actor instanceof AuthContext, 401);
        $file = $request->file('file');
        abort_unless($file instanceof UploadedFile, 422, 'Dalil faylini tanlang.');
        $metadata = $files->inspect($file);

        return DB::transaction(function () use ($request, $scope, $files, $file, $actor, $metadata, $id): JsonResponse {
            $order = DbRows::selectOne(<<<'SQL'
                select wo.id,wo.status from roadops.work_orders wo
                where wo.id=?::uuid
                  and roadops.division_for_work_order(wo.id)=any(?::uuid[])
                  and roadops.has_permission('execution.manage',roadops.division_for_work_order(wo.id))
                for update
                SQL, [$id, $scope->pgUuidArray($scope->roadUnitIds($request))], false);
            abort_if($order === null, 404);
            abort_unless(in_array($order->status, ['issued', 'accepted', 'in_progress', 'paused'], true),
                409, 'Dalil faqat ijrodagi topshiriqqa yuklanadi.');
            // Retrying a file upload for the same order and actor reuses it.
            $existing = DbRows::selectOne(<<<'SQL'
                select * from roadops.work_order_evidence
                where work_order_id=?::uuid and created_by=?::uuid and sha256=?
                SQL, [$id, $actor->userId, $metadata['sha256']], false);
            if ($existing !== null) {
                return response()->json(['data' => $this->payload($existing)], 200);
            }
            $fileId = (string) Str::uuid();
            $path = $files->store($file, $fileId, $metadata['extension']);
            try {
                $row = DbRows::selectOneOrFail(<<<'SQL'
                    insert into roadops.work_order_evidence
                      (id,work_order_id,storage_path,file_name,content_type,extension,byte_size,sha256,created_by)
                    values (?::uuid,?::uuid,?,?,?,?,?,?,?::uuid) returning *
                    SQL, [$fileId, $id, $path, $metadata['fileName'], $metadata['contentType'], $metadata['extension'],
                        $metadata['sizeBytes'], $metadata['sha256'], $actor->userId], false);
            } catch (\Throwable $exception) {
                $files->discard($path);
                throw $exception;
            }

            return response()->json(['data' => $this->payload($row)], 201);
        });
    }

    public function content(Request $request, ApiScope $scope, ExecutionEvidenceFiles $files, string $id, string $file): BinaryFileResponse
    {
        abort_unless(Str::isUuid($id), 404);
        abort_unless(preg_match('/\A([a-f0-9-]{36})\.(jpg|png|pdf)\z/D', $file, $match) === 1, 404);
        abort_unless(Str::isUuid($match[1]), 404);
        $row = DbRows::selectOne(<<<'SQL'
            select * from roadops.work_order_evidence
            where id=?::uuid and work_order_id=?::uuid and extension=?
              and roadops.division_for_work_order(work_order_id)=any(?::uuid[])
            SQL, [$match[1], $id, $match[2], $scope->pgUuidArray($scope->roadUnitIds($request))]);
        abort_if($row === null, 404);

        return $files->response((string) $row->storage_path, (string) $row->content_type,
            (string) $row->file_name, (int) $row->byte_size, (string) $row->sha256);
    }

    /** @return array<string,mixed> */
    private function payload(stdClass $row): array
    {
        return [
            'id' => (string) $row->id,
            'url' => '/api/v1/work-orders/'.$row->work_order_id.'/evidence/'.$row->id.'.'.$row->extension,
            'contentType' => (string) $row->content_type,
            'fileName' => (string) $row->file_name,
            'sizeBytes' => (int) $row->byte_size,
        ];
    }
}
