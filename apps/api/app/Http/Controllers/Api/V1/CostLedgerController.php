<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Transparency\MonthlyCostLedgerReader;
use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class CostLedgerController extends Controller
{
    public function __construct(private readonly MonthlyCostLedgerReader $reader) {}

    public function costs(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate([
            'month' => ['required', 'date_format:Y-m', 'regex:/^(20[2-9][0-9]|2100)-/'],
            'roadId' => ['nullable', 'uuid'],
            'kind' => ['nullable', 'in:labor,material,equipment'],
            'state' => ['nullable', 'in:DRAFT,SUBMITTED,APPROVED'],
        ]);

        return response()->json(['data' => $this->reader->costs(
            $scope->roadUnitIds($request),
            (string) $validated['month'],
            $validated['roadId'] ?? null,
            $validated['kind'] ?? null,
            isset($validated['state']) ? strtolower($validated['state']) : null,
            Pagination::from($request),
        )]);
    }

    public function machines(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate([
            'month' => ['required', 'date_format:Y-m', 'regex:/^(20[2-9][0-9]|2100)-/'],
            'roadId' => ['nullable', 'uuid'],
            'equipmentId' => ['nullable', 'uuid'],
        ]);

        return response()->json(['data' => $this->reader->machines(
            $scope->roadUnitIds($request),
            (string) $validated['month'],
            $validated['roadId'] ?? null,
            $validated['equipmentId'] ?? null,
            Pagination::from($request),
        )]);
    }
}
