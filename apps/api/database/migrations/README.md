# Migration order

1. `20260812000100_bootstrap.sql` — extensions, private schema, group roles,
   shared trigger helpers.
2. `20260812000200_identity_and_access.sql` — users, opaque sessions, RBAC,
   memberships, idempotency.
3. `20260812000300_integrations_and_master_data.sql` — inbox/outbox and
   versioned Yo‘l ta’mirlash punkti master data.
4. `20260812000400_iqn_and_defects.sql` — IQN quantity norms, RoadVision
   candidate lifecycle, verified defects.
5. `20260812000500_planning_execution_resources.sql` — annual programs,
   deterministic planning, capacity, work orders, equipment and material
   ledgers.
6. `20260812000600_domain_functions_and_audit.sql` — guarded workflows,
   planner evaluation, append-only tamper-evident audit.
7. `20260812000700_security.sql` — grants, RLS, policies, function execution.
8. `20260812000800_source_assignment_mirrors.sql` — source-owned road/worker
   assignment mirrors and deterministic ownership lookups.
9. `20260812000900_operational_planning_and_assignment_scope.sql` — manual
   operations, assignment-aware resource allocation, and safety controls.
10. `20260812001000_catalog_import_review.sql` — lossless IQN staging rows,
   explicit expert review records, and RoadVision classification audit fields.
11. `20260812001100_planning_operator_guards.sql` — equipment/operator
    planning guards and allocator diagnostics.
12. `20260812001200_idempotency_cleanup_workflow.sql` — bounded scheduler-only
    cleanup for expired idempotency records.
13. `20260812001300_planning_handoff_and_work_date_norms.sql` — maker-checker
    approval revalidation and scheduled-work-date IQN norm selection.
14. `20260812001400_primary_road_invariant.sql` — RLS-independent, read-only
    validation of the single active D001 road and exact 67 000 metre length.

Every file is transactional and must be applied with stop-on-error semantics.
Development and test fixtures are deliberately outside this directory.
