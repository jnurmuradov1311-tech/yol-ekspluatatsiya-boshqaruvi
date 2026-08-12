<?php

namespace Tests\Unit\Planning;

use App\Domain\Planning\BlockerCode;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class BlockerCodeTest extends TestCase
{
    /** @return iterable<string, array{BlockerCode}> */
    public static function codes(): iterable
    {
        foreach (BlockerCode::cases() as $code) {
            yield $code->value => [$code];
        }
    }

    #[DataProvider('codes')]
    public function test_every_blocker_has_a_message_and_remedy(BlockerCode $code): void
    {
        self::assertNotSame('', trim($code->messageUz()));
        self::assertNotSame('', trim($code->remedyUz()));
    }
}
