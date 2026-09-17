import type { User } from "@/lib/api/types";

export function hasPermission(user: User | null | undefined, permission: string) {
  return Boolean(
    user
      && (user.permissions.includes("system.all") || user.permissions.includes(permission)),
  );
}

export function hasGlobalPermission(user: User | null | undefined, permission: string) {
  return Boolean(
    user
      && (
        user.globalPermissions.includes("system.all")
        || user.globalPermissions.includes(permission)
      ),
  );
}
