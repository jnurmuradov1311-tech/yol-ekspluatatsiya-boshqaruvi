<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Resources\MonthlyTimesheetReader;
use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class TimesheetController extends Controller
{
    public function __construct(private readonly MonthlyTimesheetReader $reader) {}

    public function __invoke(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate([
            'year' => ['required', 'integer', 'between:2020,2100'],
            'month' => ['required', 'integer', 'between:1,12'],
        ]);

        return response()->json(['data' => $this->reader->read(
            $scope->roadUnitIds($request),
            (int) $validated['year'],
            (int) $validated['month'],
        )]);
    }
}
