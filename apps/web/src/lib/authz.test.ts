import { describe, expect, it } from "vitest";
import type { User } from "@/lib/api/types";
import { hasGlobalPermission, hasPermission } from "@/lib/authz";

const scopedSystemAdministrator: User = {
  id: "94000000-0000-4000-8000-000000000030",
  fullName: "Scoped System Administrator",
  roleLabel: "Tizim administratori",
  division: { id: "91000000-0000-4000-8000-000000000001", name: "Test bo‘limi" },
  permissions: ["system.all"],
  globalPermissions: [],
};

describe("permission scope", () => {
  it("keeps division-scoped system.all as a local wildcard only", () => {
    expect(hasPermission(scopedSystemAdministrator, "reports.read")).toBe(true);
    expect(hasGlobalPermission(scopedSystemAdministrator, "system.all")).toBe(false);
  });

  it("accepts system.all only when it comes from a global membership", () => {
    expect(hasGlobalPermission({
      ...scopedSystemAdministrator,
      globalPermissions: ["system.all"],
    }, "system.all")).toBe(true);
  });
});
