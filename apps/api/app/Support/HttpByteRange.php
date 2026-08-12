<?php

namespace App\Support;

final readonly class HttpByteRange
{
    private function __construct(
        public int $start,
        public int $end,
        public int $resourceLength,
    ) {}

    public static function parse(?string $header, int $resourceLength): ?self
    {
        if ($header === null || trim($header) === '') {
            return null;
        }
        if ($resourceLength < 1) {
            throw new \InvalidArgumentException('A byte range requires a non-empty resource.');
        }

        $header = trim($header);
        if (preg_match('/^bytes=(\d*)-(\d*)$/D', $header, $matches) !== 1
            || ($matches[1] === '' && $matches[2] === '')) {
            throw new \InvalidArgumentException('Only one valid HTTP byte range is supported.');
        }

        if ($matches[1] === '') {
            $suffixLength = self::integer($matches[2]);
            if ($suffixLength < 1) {
                throw new \InvalidArgumentException('A suffix byte range must be positive.');
            }

            return new self(
                max(0, $resourceLength - $suffixLength),
                $resourceLength - 1,
                $resourceLength,
            );
        }

        $start = self::integer($matches[1]);
        $end = $matches[2] === '' ? $resourceLength - 1 : self::integer($matches[2]);
        if ($start >= $resourceLength || $end < $start) {
            throw new \InvalidArgumentException('The requested byte range is not satisfiable.');
        }

        return new self($start, min($end, $resourceLength - 1), $resourceLength);
    }

    public function length(): int
    {
        return $this->end - $this->start + 1;
    }

    public function contentRange(): string
    {
        return "bytes {$this->start}-{$this->end}/{$this->resourceLength}";
    }

    public function s3Range(): string
    {
        return "bytes={$this->start}-{$this->end}";
    }

    private static function integer(string $value): int
    {
        if (strlen($value) > 18) {
            throw new \InvalidArgumentException('The requested byte range is too large.');
        }

        $integer = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($integer === false) {
            throw new \InvalidArgumentException('The requested byte range is invalid.');
        }

        return $integer;
    }
}
