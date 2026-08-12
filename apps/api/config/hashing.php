<?php

return [
    'driver' => 'argon',
    'bcrypt' => ['rounds' => env('BCRYPT_ROUNDS', 12), 'verify' => true, 'limit' => null],
    'argon' => [
        'memory' => 65536,
        'threads' => 2,
        'time' => 4,
        'verify' => true,
    ],
    'rehash_on_login' => true,
];
