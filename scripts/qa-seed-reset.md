# QA seed/reset scripts (contract)

Implementations run only against staging with secret-manager credentials.

## seed

```bash
node scripts/qa/seed-cli-e2e.mjs --run-id "$RUN_ID" --profile staging
```

Creates deterministic fixtures owned by `cli-e2e-user`.

## reset

```bash
node scripts/qa/reset-cli-e2e.mjs --run-id "$RUN_ID" --profile staging
```

Must stop traders, delete temp connectors, cancel open backtests for that run id.
