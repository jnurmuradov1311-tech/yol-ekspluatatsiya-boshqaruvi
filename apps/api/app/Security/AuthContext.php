<?php

namespace App\Security;

final readonly class AuthContext
{
    /**
     * @param  list<string>  $permissions
     * @param  list<string>  $globalPermissions
     * @param  list<string>  $roadUnitIds
     */
    public function __construct(
        public string $sessionId,
        public string $userId,
        public string $email,
        public string $fullName,
        public string $csrfHash,
        public array $permissions,
        public array $globalPermissions,
        public array $roadUnitIds,
    ) {}

    public function can(string $permission): bool
    {
        return in_array('*', $this->permissions, true)
            || in_array('system.all', $this->permissions, true)
            || in_array($permission, $this->permissions, true);
    }

    public function canGlobally(string $permission): bool
    {
        return in_array('*', $this->globalPermissions, true)
            || in_array('system.all', $this->globalPermissions, true)
            || in_array($permission, $this->globalPermissions, true);
    }

    public function canAccessRoadUnit(string $roadUnitId): bool
    {
        return in_array('*', $this->roadUnitIds, true)
            || in_array($roadUnitId, $this->roadUnitIds, true);
    }
}
