<?php

return [
    'name' => env('APP_NAME', "Yo'l ekspluatatsiyasini boshqarish"),
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://localhost'),
    'timezone' => env('APP_TIMEZONE', 'Asia/Tashkent'),
    'locale' => env('APP_LOCALE', 'uz'),
    'fallback_locale' => 'uz',
    'key' => env('APP_KEY'),
    'cipher' => 'AES-256-CBC',
    'maintenance' => ['driver' => 'file'],
];
