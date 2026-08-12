<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class CreateAdminUserCommand extends Command
{
    protected $signature = 'roadops:user:create-admin {email?} {--name=}';

    protected $description = 'Creates the first local administrator without seeding a shared default password.';

    public function handle(): int
    {
        $email = strtolower(trim((string) ($this->argument('email') ?: $this->ask('Email'))));
        $name = trim((string) ($this->option('name') ?: $this->ask("To'liq ism")));
        $password = (string) $this->secret('Kamida 12 belgili vaqtinchalik parol');
        $confirmation = (string) $this->secret('Parolni takrorlang');

        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 254) {
            $this->error('Email yaroqsiz.');

            return self::INVALID;
        }
        if ($name === '' || mb_strlen($name) > 200) {
            $this->error("To'liq ism yaroqsiz.");

            return self::INVALID;
        }
        if (strlen($password) < 12 || ! hash_equals($password, $confirmation)) {
            $this->error('Parol qisqa yoki tasdiq bilan teng emas.');

            return self::INVALID;
        }

        try {
            $created = DB::selectOne(
                'select roadops.bootstrap_first_admin(?, ?, ?, gen_random_uuid()) as user_id',
                [$email, Hash::make($password), $name],
            );
            if ($created === null) {
                throw new \RuntimeException('Bootstrap workflow returned no user id.');
            }
            $userId = (string) $created->user_id;
        } catch (\Throwable $exception) {
            $this->error('Administrator yaratilmadi: '.$exception->getMessage());

            return self::FAILURE;
        }

        $this->info("Administrator yaratildi: {$userId}");
        $this->warn("Kirishdan oldin `php artisan roadops:user:enroll-totp {$email}` ni bajaring.");

        return self::SUCCESS;
    }
}
