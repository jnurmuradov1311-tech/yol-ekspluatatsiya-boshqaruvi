<?php

return [
    // No model or API key is shipped with the application. Enable only on the server.
    'enabled' => env('WORK_RECOMMENDATION_AI_ENABLED', false),
    'api_key' => env('OPENAI_API_KEY', ''),
    'model' => env('OPENAI_WORK_RECOMMENDATION_MODEL', ''),
    'timeout_seconds' => (int) env('WORK_RECOMMENDATION_AI_TIMEOUT_SECONDS', 25),
];
