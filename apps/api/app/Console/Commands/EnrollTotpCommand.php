<?php

namespace App\Console\Commands;

use App\Security\Totp;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class EnrollTotpCommand extends Command
{
    protected $signature = 'roadops:user:enroll-totp {email} {--label=Asosiy qurilma}';

    protected $description = 'Enrolls and verifies an administrator TOTP factor from the secure console.';

    public function handle(Totp $totp): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        $user = DB::selectOne(
            'select user_id as id, email from roadops.lookup_login_identity(?)',
            [$email],
        );
        if ($user === null) {
            $this->error('Foydalanuvchi topilmadi.');

            return self::FAILURE;
        }

        $secret = $totp->generateSecret();
        $issuer = rawurlencode((string) config('app.name'));
        $account = rawurlencode((string) $user->email);
        $uri = "otpauth://totp/{$issuer}:{$account}?secret={$secret}&issuer={$issuer}&algorithm=SHA1&digits=6&period=30";

        $this->newLine();
        $this->line('Authenticator ilovasiga quyidagi URI ni xavfsiz kiriting:');
        $this->line($uri);
        $code = trim((string) $this->ask('Ilovadagi joriy 6 xonali kod'));
        $counter = $totp->verify($secret, $code, null);
        if ($counter === null) {
            $this->error('Kod tasdiqlanmadi; hech narsa saqlanmadi.');

            return self::FAILURE;
        }

        try {
            $factor = DB::selectOne(
                <<<'SQL'
                    select roadops.complete_initial_totp_enrollment(
                        ?::uuid, ?, convert_to(?, 'UTF8'), ?, gen_random_uuid()
                    ) as factor_id
                SQL,
                [
                    $user->id,
                    (string) $this->option('label'),
                    Crypt::encryptString($secret),
                    $counter,
                ],
            );
            if ($factor === null) {
                throw new \RuntimeException('Enrollment workflow returned no factor id.');
            }
        } catch (\Throwable $exception) {
            $this->error('TOTP saqlanmadi: '.$exception->getMessage());

            return self::FAILURE;
        }

        $this->info('TOTP faktori tasdiqlandi. URI/secretni terminal tarixida qoldirmang.');

        return self::SUCCESS;
    }
}
