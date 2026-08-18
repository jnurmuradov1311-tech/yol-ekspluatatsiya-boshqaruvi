<?php

use App\Http\Controllers\Api\V1\AdminNetworkSummaryController;
use App\Http\Controllers\Api\V1\AdminOrganizationHierarchyController;
use App\Http\Controllers\Api\V1\AnnualProgramController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CostRateController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\IntegrationReadinessController;
use App\Http\Controllers\Api\V1\IntegrationSyncController;
use App\Http\Controllers\Api\V1\IntegrationWebhookController;
use App\Http\Controllers\Api\V1\IqnReviewApprovalController;
use App\Http\Controllers\Api\V1\ManualInspectionController;
use App\Http\Controllers\Api\V1\MapController;
use App\Http\Controllers\Api\V1\MonthlyCompletionActController;
use App\Http\Controllers\Api\V1\PlanningController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\ResourceController;
use App\Http\Controllers\Api\V1\RoadController;
use App\Http\Controllers\Api\V1\RoadVisionFindingController;
use App\Http\Controllers\Api\V1\SettingsController;
use App\Http\Controllers\Api\V1\TimesheetController;
use App\Http\Controllers\Api\V1\WorkOrderController;
use App\Http\Controllers\Api\V1\WorkOrderExecutionController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::get('/health', HealthController::class);
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

    Route::post('/integrations/roadvision/webhook', [IntegrationWebhookController::class, 'roadVision'])
        ->middleware('throttle:120,1');
    Route::post('/integrations/ytp/webhook', [IntegrationWebhookController::class, 'ytp'])
        ->middleware('throttle:120,1');

    Route::middleware('roadops.auth')->group(function (): void {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::get('/auth/csrf', [AuthController::class, 'csrf']);
        Route::post('/auth/logout', [AuthController::class, 'logout'])
            ->middleware(['roadops.csrf', 'roadops.idempotency']);

        Route::get('/dashboard/summary', DashboardController::class)
            ->middleware('roadops.permission:reports.read');

        Route::get('/roadvision/findings', [RoadVisionFindingController::class, 'index'])
            ->middleware('roadops.permission:defects.read');
        Route::get('/roadvision/findings/{id}/evidence/{index}', [RoadVisionFindingController::class, 'evidence'])
            ->middleware(['roadops.permission:defects.read', 'throttle:60,1']);
        Route::get('/defects', [RoadVisionFindingController::class, 'confirmedDefects'])
            ->middleware('roadops.permission:defects.read');
        Route::post('/roadvision/findings/{id}/decision', [RoadVisionFindingController::class, 'decide'])
            ->middleware(['roadops.permission:defects.verify', 'roadops.csrf', 'roadops.idempotency', 'throttle:30,1']);

        Route::get('/planning/candidates', [PlanningController::class, 'candidates'])
            ->middleware('roadops.permission:planning.read');
        Route::get('/planning/options', [PlanningController::class, 'options'])
            ->middleware('roadops.permission:planning.read');
        Route::post('/planning/preview', [PlanningController::class, 'preview'])
            ->middleware(['roadops.permission:planning.write', 'roadops.csrf', 'roadops.idempotency', 'throttle:30,1']);
        Route::post('/planning/manual/preview', [PlanningController::class, 'manualPreview'])
            ->middleware(['roadops.permission:planning.write', 'roadops.csrf', 'roadops.idempotency', 'throttle:30,1']);
        Route::get('/planning/plans', [PlanningController::class, 'index'])
            ->middleware('roadops.permission:planning.read');
        Route::get('/planning/plans/{id}', [PlanningController::class, 'show'])
            ->middleware('roadops.permission:planning.read');
        Route::post('/planning/plans/{id}/approve', [PlanningController::class, 'approve'])
            ->middleware(['roadops.permission:planning.approve', 'roadops.csrf', 'roadops.idempotency', 'throttle:30,1']);
        Route::post('/planning/plans/{id}/publish', [PlanningController::class, 'publish'])
            ->middleware(['roadops.permission:planning.approve', 'roadops.csrf', 'roadops.idempotency', 'throttle:30,1']);

        Route::get('/work-orders', [WorkOrderController::class, 'index'])
            ->middleware('roadops.permission:execution.read');
        Route::get('/work-orders/{id}', [WorkOrderExecutionController::class, 'show'])
            ->middleware('roadops.permission:execution.read');
        Route::post('/work-orders/{id}/start', [WorkOrderExecutionController::class, 'start'])
            ->middleware(['roadops.permission:execution.manage', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/work-orders/{id}/reschedule', [WorkOrderExecutionController::class, 'reschedule'])
            ->middleware(['roadops.permission:execution.manage', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/work-orders/{id}/complete', [WorkOrderExecutionController::class, 'complete'])
            ->middleware(['roadops.permission:execution.manage', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/work-orders/{id}/verify', [WorkOrderExecutionController::class, 'verify'])
            ->middleware(['roadops.permission:execution.verify', 'roadops.csrf', 'roadops.idempotency']);

        Route::get('/cost-rates', [CostRateController::class, 'index'])
            ->middleware('roadops.permission:costs.read');
        Route::post('/cost-rates', [CostRateController::class, 'store'])
            ->middleware(['roadops.permission:costs.manage', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/cost-rates/{id}/approve', [CostRateController::class, 'approve'])
            ->middleware(['roadops.permission:costs.approve', 'roadops.csrf', 'roadops.idempotency']);
        Route::get('/monthly-work-time-norms', [CostRateController::class, 'normIndex'])
            ->middleware('roadops.permission:costs.read');
        Route::post('/monthly-work-time-norms', [CostRateController::class, 'normStore'])
            ->middleware(['roadops.permission:costs.manage', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/monthly-work-time-norms/{id}/approve', [CostRateController::class, 'normApprove'])
            ->middleware(['roadops.permission:costs.approve', 'roadops.csrf', 'roadops.idempotency']);

        Route::get('/monthly-completion-acts', [MonthlyCompletionActController::class, 'index'])
            ->middleware('roadops.permission:costs.read');
        Route::post('/monthly-completion-acts', [MonthlyCompletionActController::class, 'generate'])
            ->middleware(['roadops.permission:costs.manage', 'roadops.csrf', 'roadops.idempotency']);
        Route::get('/monthly-completion-acts/{id}', [MonthlyCompletionActController::class, 'show'])
            ->middleware('roadops.permission:costs.read');
        Route::post('/monthly-completion-acts/{id}/submit', [MonthlyCompletionActController::class, 'submit'])
            ->middleware(['roadops.permission:costs.manage', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/monthly-completion-acts/{id}/approve', [MonthlyCompletionActController::class, 'approve'])
            ->middleware(['roadops.permission:costs.approve', 'roadops.csrf', 'roadops.idempotency']);
        Route::get('/monthly-completion-acts/{id}/export.xlsx', [MonthlyCompletionActController::class, 'export'])
            ->middleware(['roadops.permission:costs.read', 'throttle:10,1']);
        Route::get('/annual-programs', [AnnualProgramController::class, 'index'])
            ->middleware('roadops.permission:reports.read');
        Route::get('/annual-programs/{id}/export.xlsx', [AnnualProgramController::class, 'export'])
            ->middleware('roadops.permission:reports.read');

        Route::get('/resources/{kind}', ResourceController::class)
            ->middleware('roadops.permission:resources.read');
        Route::get('/timesheets/monthly', TimesheetController::class)
            ->middleware('roadops.permission:resources.read');
        Route::get('/roads', RoadController::class)
            ->middleware('roadops.permission:master.read');
        Route::get('/map/records', MapController::class)
            ->middleware('roadops.permission:defects.read');
        Route::get('/manual-inspections/options', [ManualInspectionController::class, 'options'])
            ->middleware('roadops.permission:defects.capture');
        Route::get('/manual-inspections', [ManualInspectionController::class, 'index'])
            ->middleware('roadops.permission:defects.read');
        Route::post('/manual-inspections', [ManualInspectionController::class, 'store'])
            ->middleware(['roadops.permission:defects.capture', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/manual-inspections/{id}/submit', [ManualInspectionController::class, 'submit'])
            ->middleware(['roadops.permission:defects.capture', 'roadops.csrf', 'roadops.idempotency']);
        Route::post('/manual-inspections/{id}/decision', [ManualInspectionController::class, 'decide'])
            ->middleware(['roadops.permission:defects.verify', 'roadops.csrf', 'roadops.idempotency']);
        Route::get('/manual-inspections/{id}/observations/{observationId}/evidence/{index}', [ManualInspectionController::class, 'evidence'])
            ->middleware(['roadops.permission:defects.read', 'throttle:60,1']);

        Route::get('/settings', [SettingsController::class, 'show'])
            ->middleware('roadops.permission:master.read');
        Route::patch('/settings', [SettingsController::class, 'update'])
            ->middleware(['roadops.global-permission:system.all', 'roadops.csrf', 'roadops.idempotency']);
        Route::get('/admin/network-summary', AdminNetworkSummaryController::class)
            ->middleware('roadops.global-permission:system.all');
        Route::get('/admin/organization-hierarchy', AdminOrganizationHierarchyController::class)
            ->middleware('roadops.global-permission:system.all');
        Route::post('/admin/iqn/import-batches/{batch}/review-approval', [IqnReviewApprovalController::class, 'store'])
            ->middleware([
                'roadops.global-permission:catalog.manage',
                'roadops.csrf',
                'roadops.idempotency',
                'throttle:10,1',
            ]);

        Route::get('/reports/timesheet.xlsx', [ReportController::class, 'timesheet'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:resources.read', 'throttle:10,1']);
        Route::get('/reports/roadvision-findings.xlsx', [ReportController::class, 'roadVisionFindings'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:defects.read', 'throttle:10,1']);
        Route::get('/reports/manual-inspections.xlsx', [ReportController::class, 'manualInspections'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:defects.read', 'throttle:10,1']);
        Route::get('/reports/confirmed-defects.xlsx', [ReportController::class, 'confirmedDefects'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:defects.read', 'throttle:10,1']);
        Route::get('/reports/plans.xlsx', [ReportController::class, 'plans'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:planning.read', 'throttle:10,1']);
        Route::get('/reports/work-orders.xlsx', [ReportController::class, 'workOrders'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:execution.read', 'throttle:10,1']);
        Route::get('/reports/annual-program.xlsx', [ReportController::class, 'annualProgram'])
            ->middleware(['roadops.permission:reports.read', 'throttle:10,1']);
        Route::get('/reports/workers.xlsx', [ReportController::class, 'workers'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:resources.read', 'throttle:10,1']);
        Route::get('/reports/equipment.xlsx', [ReportController::class, 'equipment'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:resources.read', 'throttle:10,1']);
        Route::get('/reports/warehouse.xlsx', [ReportController::class, 'warehouse'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:resources.read', 'throttle:10,1']);
        Route::get('/reports/audit-log.xlsx', [ReportController::class, 'auditLog'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:audit.read', 'throttle:10,1']);
        Route::get('/reports/daily-brief.pdf', [ReportController::class, 'dailyBrief'])
            ->middleware(['roadops.permission:reports.read', 'roadops.permission:defects.read', 'roadops.permission:execution.read', 'roadops.permission:integrations.read', 'throttle:10,1']);

        Route::get('/integrations/readiness', IntegrationReadinessController::class)
            ->middleware('roadops.permission:integrations.read');
        Route::post('/integrations/{code}/sync', IntegrationSyncController::class)
            ->middleware(['roadops.permission:integrations.manage', 'roadops.csrf', 'roadops.idempotency']);
    });
});
