<?php

return [
    'web_url' => env('WEB_URL', 'http://localhost:3000'),
    'session_cookie' => env('SESSION_COOKIE', 'roadops_session'),
    'session_secure' => filter_var(env('SESSION_SECURE_COOKIE', true), FILTER_VALIDATE_BOOL),
    'session_ttl_minutes' => (int) env('SESSION_TTL_MINUTES', 480),
    'cors_allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', '')),
    ))),
    'trusted_proxies' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('TRUSTED_PROXIES', '127.0.0.1,::1')),
    ))),
    'worker_daily_limit_minutes' => 420,
    'primary_road_code' => env('PRIMARY_ROAD_CODE', 'D001'),
    'primary_road_length_m' => env('PRIMARY_ROAD_LENGTH_M', '67000'),
    'manual_evidence_s3_bucket' => env('MANUAL_EVIDENCE_S3_BUCKET'),
    'integrations' => [
        'ytp' => [
            'scheduled_sync_enabled' => filter_var(env('YTP_SYNC_ENABLED', false), FILTER_VALIDATE_BOOL),
            'base_url' => env('YTP_BASE_URL'),
            'client_id' => env('YTP_CLIENT_ID'),
            'client_secret' => env('YTP_CLIENT_SECRET'),
            'webhook_secret' => env('YTP_WEBHOOK_SECRET'),
        ],
        'roadvision' => [
            'scheduled_sync_enabled' => filter_var(env('ROADVISION_SYNC_ENABLED', false), FILTER_VALIDATE_BOOL),
            'mode' => env('ROADVISION_MODE', 's3_manifest'),
            'api_url' => env('ROADVISION_API_URL'),
            'client_id' => env('ROADVISION_CLIENT_ID'),
            'client_secret' => env('ROADVISION_CLIENT_SECRET'),
            'webhook_secret' => env('ROADVISION_WEBHOOK_SECRET'),
            's3_bucket' => env('ROADVISION_S3_BUCKET'),
            's3_region' => env('ROADVISION_S3_REGION'),
            's3_prefix' => env('ROADVISION_S3_PREFIX', 'results/'),
            'evidence_max_bytes' => (int) env('ROADVISION_EVIDENCE_MAX_BYTES', 262144000),
            'manifest_canonicalization' => env('ROADVISION_MANIFEST_CANONICALIZATION'),
        ],
    ],
];
