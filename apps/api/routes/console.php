<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Schedule::command('roadops:sync ytp')->everyFiveMinutes()->withoutOverlapping()
    ->when(static fn (): bool => (bool) config('roadops.integrations.ytp.scheduled_sync_enabled'));
Schedule::command('roadops:sync roadvision')->everyFiveMinutes()->withoutOverlapping()
    ->when(static fn (): bool => (bool) config('roadops.integrations.roadvision.scheduled_sync_enabled'));
Schedule::command('roadops:process-inbox')->everyMinute()->withoutOverlapping()->runInBackground();
Schedule::command('roadops:reconcile')->everyFiveMinutes()->withoutOverlapping()->runInBackground();
Schedule::command('roadops:dispatch-outbox')->everyMinute()->withoutOverlapping();
Schedule::call(static function (): void {
    DB::connection('pgsql_sync')->scalar(
        'select roadops.cleanup_expired_idempotency_keys(?)',
        [1000],
    );
})->name('roadops:cleanup-expired-idempotency-keys')->hourly()->withoutOverlapping();
