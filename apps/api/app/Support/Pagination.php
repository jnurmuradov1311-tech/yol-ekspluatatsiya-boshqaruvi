<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

final readonly class Pagination
{
    private function __construct(
        public int $page,
        public int $pageSize,
    ) {}

    public static function from(Request $request): self
    {
        $page = self::positiveInteger($request->query('page', 1), 'page');
        $pageSize = self::positiveInteger($request->query('pageSize', 25), 'pageSize');
        if ($pageSize > 100) {
            throw ValidationException::withMessages([
                'pageSize' => ['Sahifa hajmi 100 tadan oshmasligi kerak.'],
            ]);
        }
        if ($page - 1 > intdiv(PHP_INT_MAX, $pageSize)) {
            throw ValidationException::withMessages([
                'page' => ['Sahifa raqami juda katta.'],
            ]);
        }

        return new self($page, $pageSize);
    }

    public function offset(): int
    {
        return ($this->page - 1) * $this->pageSize;
    }

    private static function positiveInteger(mixed $value, string $field): int
    {
        if ((! is_int($value) && ! is_string($value))
            || ! preg_match('/^[1-9][0-9]*$/', (string) $value)
            || filter_var($value, FILTER_VALIDATE_INT) === false) {
            throw ValidationException::withMessages([
                $field => ['Qiymat 1 yoki undan katta butun son bo‘lishi kerak.'],
            ]);
        }

        return (int) $value;
    }
}
