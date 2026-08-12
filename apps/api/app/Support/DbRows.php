<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use RuntimeException;
use stdClass;

/**
 * Typed access to raw PDO result rows.
 *
 * RoadOps deliberately uses Laravel's default PDO::FETCH_OBJ mode. Checking
 * that invariant at this boundary keeps query consumers explicit and prevents
 * a connection-level fetch-mode change from silently corrupting API payloads.
 */
final class DbRows
{
    /**
     * @param  array<int|string, mixed>  $bindings
     * @param  array<int|string, mixed>  $fetchUsing
     * @return list<stdClass>
     */
    public static function select(
        string $query,
        array $bindings = [],
        bool $useReadPdo = true,
        array $fetchUsing = [],
    ): array {
        $rows = DB::select($query, $bindings, $useReadPdo, $fetchUsing);

        return array_values(array_map(self::row(...), $rows));
    }

    /**
     * @param  array<int|string, mixed>  $bindings
     */
    public static function selectOne(
        string $query,
        array $bindings = [],
        bool $useReadPdo = true,
    ): ?stdClass {
        $row = DB::selectOne($query, $bindings, $useReadPdo);

        return $row === null ? null : self::row($row);
    }

    /**
     * Use for aggregate and RETURNING queries whose contract guarantees one row.
     *
     * @param  array<int|string, mixed>  $bindings
     */
    public static function selectOneOrFail(
        string $query,
        array $bindings = [],
        bool $useReadPdo = true,
    ): stdClass {
        $row = self::selectOne($query, $bindings, $useReadPdo);

        if ($row === null) {
            throw new RuntimeException('Database query was expected to return one row.');
        }

        return $row;
    }

    private static function row(mixed $row): stdClass
    {
        if (! $row instanceof stdClass) {
            throw new RuntimeException('Database connection must use PDO::FETCH_OBJ.');
        }

        return $row;
    }
}
