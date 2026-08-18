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
14. `20260812001400_primary_road_invariant.sql` — historical pilot-only,
    read-only D001 validation helpers (removed by forward migration 19).
15. `20260818000100_admin_network_summary.sql` — admin-only 42 371 km national
    baseline and RLS-independent live synchronized road/division aggregates.
16. `20260818000200_monthly_completion_costing.sql` — approved labor, material,
    and machine-hour rates plus immutable monthly completed-work act snapshots.
17. `20260818000300_manual_inspection_iqn_topics.sql` — preserves the
    expert-published top-level IQN 02 work topic selected during a road-master
    inspection and carries that provenance into the confirmed defect.
18. `20260818000400_organization_hierarchy.sql` — authoritative temporal
    Republic, region and enterprise identities, parent links and road-division
    assignments with an admin-only hierarchy snapshot; inserts no production
    organization data.
19. `20260818000500_remove_primary_road_invariant.sql` — removes the obsolete
    single-road SECURITY DEFINER helpers after operational APIs became
    assignment-scoped and multi-road.
20. `20260818000600_global_admin_session_scope.sql` — separates permissions
    granted by global memberships from division-scoped permissions so Republic
    administration cannot be inferred from a local `system.all` role.
21. `20260818000700_monthly_act_iqn_labor_norms.sql` — freezes exactly
    recomputable approved linear IQN labor-minute norms on monthly act items,
    fails closed for unsupported formulas, and prevents an act snapshot from
    omitting eligible verified work from the same division and month.
22. `20260818000800_iqn_publication_fail_closed.sql` — checksum-locks both IQN
    sources at approval, requires authenticated global-expert approval bound to
    actor/session/request and canonical manifest hashes, reviews every staged
    block and row, and makes the console publisher consume that persisted
    approval with an audited database principal.

Every file is transactional and must be applied with stop-on-error semantics.
Development and test fixtures are deliberately outside this directory.
