<?php

return [
    'default' => env('QUEUE_CONNECTION', 'redis'),
    'connections' => [
        'sync' => ['driver' => 'sync'],
        'redis' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => env('REDIS_QUEUE', 'default'),
            'retry_after' => 120,
            'block_for' => 5,
        ],
        'redis_integrations' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => 'integrations',
            'retry_after' => 960,
            'block_for' => 5,
            'after_commit' => true,
        ],
    ],
    'failed' => [
        'driver' => 'database-uuids',
        'database' => 'pgsql_sync',
        'table' => 'roadops.failed_jobs',
    ],
];
