---
name: alphafox-admin
description: Admin-only operations reusing Web role authorization.
version: 0.3.24
---

# Admin

Requires admin role on the server. CLI confirmation does not grant privilege. Not available to automation (v1 deferred). Always `--format json --no-input`.

```bash
alphafox api GET /api/v1/admin/users --format json --no-input
```

High-risk cataloged admin writes: `alphafox schema <operationId>` first, then `--dry-run` then `--yes`. Body fields must come from that schema; use `--config @file` for large objects. If the operator is not admin, expect `403` and stop.

## Passivbot paper acceptance

This Stage 1 endpoint is intentionally absent from the public Operation Registry and typed CLI catalog. The only allowed uncataloged admin path is the exact direct route below. Its JSON body is strict: `name`, `exchangeConnectorId`, and `config` are required; `configSchemaVersion` must be `3`; `autoStart` is optional and defaults to `true`. Use the complete v3 config envelope for new acceptance traders. Existing v1/v2 configs are not migrated automatically: first add the complete v3 envelope (at minimum `common.riskControl: {}`), then explicitly update the trader with `configSchemaVersion: 3` and confirm that update succeeded before starting or restoring it. Do not start an un-migrated trader, and do not add server-owned fields.

Preview the exact raw request first. The unknown/high-risk gate must return `confirmation_required`; show the requested action and risk to the operator, wait for explicit confirmation, then rerun the same command with `--yes`.

```bash
alphafox api POST /api/admin/passivbot-paper-acceptance-traders --config @./create-passivbot-paper.json --dry-run --format json --no-input
alphafox api POST /api/admin/passivbot-paper-acceptance-traders --config @./create-passivbot-paper.json --yes --format json --no-input
```

The config file shape is:

```json
{
  "name": "Passivbot paper acceptance",
  "exchangeConnectorId": "<internal-paper-connector-id>",
  "configSchemaVersion": 3,
  "config": {
    "common": {
      "execution": { "leverage": 1, "openMinPosition": false },
      "riskControl": {},
      "orderExecution": {}
    },
    "strategy": {
      "symbols": ["BTC/USDT:USDT"],
      "long": {
        "n_positions": 1,
        "wallet_exposure_limit": 1,
        "total_wallet_exposure_limit": 1,
        "risk_entry_cooldown_minutes": 0,
        "risk_wel_enforcer_enabled": false,
        "risk_wel_enforcer_threshold": 1,
        "risk_twel_entry_gate_enabled": false,
        "risk_twel_enforcer_enabled": false,
        "risk_twel_enforcer_policy": "reduce_overweight",
        "risk_twel_enforcer_threshold": 1,
        "risk_we_excess_allowance_pct": 0,
        "risk_we_excess_allowance_mode": "bounded",
        "unstuck_enabled": false,
        "unstuck_ema_gating_enabled": false,
        "unstuck_close_pct": 0,
        "unstuck_ema_dist": 0,
        "unstuck_loss_allowance_pct": 0,
        "unstuck_threshold": 0,
        "trailing_martingale": {
          "ema_span_0": 3,
          "ema_span_1": 5,
          "volatility_ema_span_1h": 0,
          "volatility_ema_span_1m": 0,
          "entry": {
            "double_down_factor": 0,
            "ema_gate_mode": "disabled",
            "initial_ema_dist": 0,
            "initial_qty_pct": 0.1,
            "retracement_base_pct": 0,
            "retracement_volatility_1h_weight": 0,
            "retracement_volatility_1m_weight": 0,
            "retracement_we_weight": 0,
            "threshold_base_pct": 0,
            "threshold_volatility_1h_weight": 0,
            "threshold_volatility_1m_weight": 0,
            "threshold_we_weight": 0
          },
          "close": {
            "qty_pct": 0.1,
            "retracement_base_pct": 0,
            "retracement_volatility_1h_weight": 0,
            "retracement_volatility_1m_weight": 0,
            "threshold_base_pct": 0,
            "threshold_volatility_1h_weight": 0,
            "threshold_volatility_1m_weight": 0,
            "threshold_we_weight": 0
          }
        }
      },
      "short": {
        "n_positions": 0,
        "wallet_exposure_limit": 1,
        "total_wallet_exposure_limit": 1,
        "risk_entry_cooldown_minutes": 0,
        "risk_wel_enforcer_enabled": false,
        "risk_wel_enforcer_threshold": 1,
        "risk_twel_entry_gate_enabled": false,
        "risk_twel_enforcer_enabled": false,
        "risk_twel_enforcer_policy": "reduce_overweight",
        "risk_twel_enforcer_threshold": 1,
        "risk_we_excess_allowance_pct": 0,
        "risk_we_excess_allowance_mode": "bounded",
        "unstuck_enabled": false,
        "unstuck_ema_gating_enabled": false,
        "unstuck_close_pct": 0,
        "unstuck_ema_dist": 0,
        "unstuck_loss_allowance_pct": 0,
        "unstuck_threshold": 0,
        "trailing_martingale": {
          "ema_span_0": 3,
          "ema_span_1": 5,
          "volatility_ema_span_1h": 0,
          "volatility_ema_span_1m": 0,
          "entry": {
            "double_down_factor": 0,
            "ema_gate_mode": "disabled",
            "initial_ema_dist": 0,
            "initial_qty_pct": 0.1,
            "retracement_base_pct": 0,
            "retracement_volatility_1h_weight": 0,
            "retracement_volatility_1m_weight": 0,
            "retracement_we_weight": 0,
            "threshold_base_pct": 0,
            "threshold_volatility_1h_weight": 0,
            "threshold_volatility_1m_weight": 0,
            "threshold_we_weight": 0
          },
          "close": {
            "qty_pct": 0.1,
            "retracement_base_pct": 0,
            "retracement_volatility_1h_weight": 0,
            "retracement_volatility_1m_weight": 0,
            "threshold_base_pct": 0,
            "threshold_volatility_1h_weight": 0,
            "threshold_volatility_1m_weight": 0,
            "threshold_we_weight": 0
          }
        }
      }
    }
  },
  "autoStart": true
}
```

## Recovery

- `401`: re-auth. `403`: not admin — do not escalate by switching profiles.
- Uncataloged admin POST/PATCH/DELETE still require `--yes` (unknown risk).

## operationIds

- `admin.users.list`
