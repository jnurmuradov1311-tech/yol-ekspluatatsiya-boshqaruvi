<?php

namespace App\Domain\Evidence;

use App\Support\HttpByteRange;
use Aws\S3\S3Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class S3EvidenceStreamer
{
    public function stream(
        Request $request,
        S3EvidencePolicy $policy,
        S3EvidenceObject $evidence,
    ): Response
    {
        $client = new S3Client([
            'version' => 'latest',
            'region' => $policy->region,
        ]);
        try {
            $head = $client->headObject([
                'Bucket' => $evidence->bucket,
                'Key' => $evidence->key,
                'ChecksumMode' => 'ENABLED',
            ])->toArray();
            $safe = $policy->validateHeadMetadata($evidence, $head);
        } catch (EvidencePolicyException $exception) {
            return $this->policyError($exception);
        } catch (\Throwable) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_UNAVAILABLE',
                'message' => 'Dalil faylini obyekt saqlash hududidan hozir olib bo‘lmadi.',
            ]], 503);
        }

        try {
            $range = HttpByteRange::parse($request->header('Range'), $safe['contentLength']);
        } catch (\InvalidArgumentException) {
            return response('', 416, [
                'Accept-Ranges' => 'bytes',
                'Content-Range' => "bytes */{$safe['contentLength']}",
                'Cache-Control' => 'private, no-store, max-age=0',
            ]);
        }

        $parameters = [
            'Bucket' => $evidence->bucket,
            'Key' => $evidence->key,
            'IfMatch' => $safe['etag'],
        ];
        if ($safe['versionId'] !== null) {
            $parameters['VersionId'] = $safe['versionId'];
        }
        if ($range !== null) {
            $parameters['Range'] = $range->s3Range();
        }
        try {
            $object = $client->getObject($parameters);
        } catch (\Throwable) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_UNAVAILABLE',
                'message' => 'Dalil faylini obyekt saqlash hududidan hozir olib bo‘lmadi.',
            ]], 503);
        }

        /** @var \Psr\Http\Message\StreamInterface $body */
        $body = $object['Body'];

        return new StreamedResponse(static function () use ($body): void {
            while (! $body->eof()) {
                echo $body->read(1024 * 1024);
                if (connection_aborted()) {
                    break;
                }
            }
        }, $range === null ? 200 : 206, array_filter([
            'Content-Type' => $safe['contentType'],
            'Content-Length' => (string) ($range?->length() ?? $safe['contentLength']),
            'Content-Disposition' => 'inline',
            'Accept-Ranges' => 'bytes',
            'Content-Range' => $range?->contentRange(),
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
            'Cross-Origin-Resource-Policy' => 'same-origin',
            'Referrer-Policy' => 'no-referrer',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], static fn (mixed $value): bool => $value !== null));
    }

    public function policyError(EvidencePolicyException $exception): JsonResponse
    {
        return response()->json(['error' => [
            'code' => $exception->errorCode,
            'message' => $exception->getMessage(),
        ]], $exception->httpStatus);
    }
}
