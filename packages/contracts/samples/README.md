# Synthetic contract examples

These examples contain invented identifiers, names and amounts. They contain no production records or credentials.

- `cost-ledger.json` and `machine-usage.json` were emitted by the production reader SQL against isolated synthetic PostgreSQL 17 tables. The reports are paged; their summary totals cover all matching rows.
- `payroll-snapshot.json` was calculated by the production `PayrollCalculator` with synthetic verified-attendance inputs. It demonstrates coefficient, meal and holiday allowances, source allocation, explicit deductions and employer cost.

`make contracts` validates these response examples against their JSON schemas and also retains all existing IQN and vendor-contract checks. Approved costs are accounting calculations, not evidence of bank payments.
