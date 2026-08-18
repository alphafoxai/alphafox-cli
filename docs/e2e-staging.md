# Staging E2E checklist (t101364 / t101369)

Run only against the stable public facade `https://staging.alphafox.app`. Do not use Preview URLs, internal service tokens, or production.

Staging CLI issuer: `https://staging.alphafox.app`. Obtain the rotating E2E account from the approved staging secret store; never commit its username or password. Device Flow approval without a human click uses the internal staging helper with credentials supplied through environment variables. Isolate credentials with `ALPHAFOX_CONFIG_DIR` and `ALPHAFOX_FORCE_FILE_KEYCHAIN=1`.

## Scenarios

1. Install CLI → `version` / `doctor`
2. Device Flow split (`--no-wait` + `--device-code`)
3. `whoami` / `auth status --verify`
4. Readonly: strategy definitions, connectors, traders
5. ~~Write: create chat with idempotency~~ **historical** — chat is not a CLI surface; do not use `chats.create` as the trader-create path
6. ~~Backtest create → watch stream → cancel~~ **historical** — web `/api/v1/backtests` is not a CLI surface; use `engine-backtest`
7. High-risk without `--yes` → exit 10
8. Logout / revoke
9. Cross-env token rejection (prod token on staging)

## Evidence (2026-08-13) — vertical slice pass (historical chat / web-backtest slice)

The chat and `POST /api/v1/backtests` steps below are a **historical** facade record. They are not the CLI trader-create path. Current create is Engine `trading.traders.create` (`strategyDefinitionId` + `config`). Do not treat this section as a playbook.

Anonymous `GET https://staging.alphafox.app/api/v1/meta` → **HTTP 200**, `environment=staging`, `contractVersion=2026-08-13`, `commitSha=65d1f816007adc7acc09db5e86671931737e0379`, `x-request-id=66511bcf-dda9-4974-9378-3aacd8d938ff`. No 302 to `vercel.com/sso-api`. Vercel Authentication is disabled for the whole `alphafox-web` project (Preview `*.vercel.app` is also public; accepted).

CLI used: local `alphafox-cli` `fd04570747b1096b57a5a12ef20994b6c79531d7` (`dist/cli.js --profile staging --format json --no-input`). Config dir `/tmp/alphafox-e2e-staging`.

| Step | Result | Evidence |
|------|--------|----------|
| 1. `version` | pass | `contractsSha` matches freeze `5a4f9c0175951a6bedc52640fe917abe992ec824` |
| 1. `doctor` | pass | `apiBaseUrl` / issuer `https://staging.alphafox.app` |
| 2. password sign-in | pass | HTTP 200, session cookie, `userId=019f3073-307f-76e9-adf1-0203af9ab22b` |
| 2. Device Flow `--no-wait` | pass | `user_code` issued; verification `https://staging.alphafox.app/cli/device` |
| 2. device approve helper | pass | HTTP 200, `requestId=821fa89f-04c9-490a-8e45-88f83a7e69e6` |
| 2. `auth login --device-code` | pass | authenticated, `requestId=a90ef882-c341-4af5-b68c-f27b2a280bfd` |
| 3. `whoami` | pass | same `userId`, `requestId=8202f6b0-517d-44fa-acf3-0e19c39db7c7` |
| 3. `auth status --verify` | pass | `verified: true`, issuer/audience/clientId staging |
| 4. `GET /api/v1/trading/strategy-definitions` | pass | HTTP 200 via CLI, `requestId=22afdb63-d8cf-4512-a6b7-326f97a876a9` |
| 4. `GET /api/v1/exchange-connectors` | pass | HTTP 200, `requestId=1284cfe7-a06a-4f30-bac1-6322eaf05e1b` |
| 4. `GET /api/v1/trading/traders` | pass | HTTP 200, `requestId=c09ced70-d704-4b78-bc72-96a7048d4c7a` |
| 7. high-risk without `--yes` | pass | `api POST /api/v1/trading/traders/{id}/start` → **exit 10**, `confirmation_required` (no HTTP call) |
| Rate limit | pass (live) | 80 sequential `POST /api/auth/oauth/device/code` → first **HTTP 429** at request 72, `x-request-id=e585251a-2768-4cfc-aab6-77da1ae20570`, `Retry-After: 43`. Limit is 10/min **per serverless instance**; cross-instance windows do not share memory. Feishu alert is debounce 10 min/key via `ALPHAFOX_OPS_FEISHU_WEBHOOK_URL`. |

Login UI on the website is still OTP/passwordless. E2E used API password + the approve helper. Remaining human click if someone uses the browser `/cli/device` page: they must already have a web session (OTP unless they hit the sign-in API).

Web PR: https://github.com/alphafoxai/alphafox-web/pull/448 (head `65d1f816`). Do not enable production OAuth client or npm `latest` from this evidence.

## Evidence (2026-08-13) — leftover checklist (5 / 6 / 8 / 9)

Reused staging Device Flow session `userId=019f3073-307f-76e9-adf1-0203af9ab22b` (`whoami` `requestId=51222050-1226-4d2f-92d2-96059778fb36`). Anonymous `GET /api/v1/meta` still **HTTP 200**, `commitSha=65d1f816007adc7acc09db5e86671931737e0379`, `x-request-id=d0f964ef-1f5a-4271-ad6e-0cf0f57b6ae2`. CLI: local `alphafox-cli` `1db8f416` (`--profile staging --format json --no-input`). Staging is **not** MVP in-process stubs (`ALPHAFOX_PUBLIC_API_USE_MVP_HANDLERS` unset); product handlers go through the BFF / llm-gateway / trader.

| Step | Result | Evidence |
|------|--------|----------|
| 5. `POST /api/v1/chats` create | **pass** | HTTP **201**, `{chatId}`, `x-matched-path=/api/v1/chats`. Raw: `chatId=7fb9b5ce-f4c2-47e1-a8f6-804bcbfadedb`, `x-request-id=6a091c9b-e08d-4bb6-9e05-9e66e124f073`. CLI: `chatId=ce72df27-b207-49cd-a99a-d6d692e4e725`, `requestId=ea3f253d-3050-4060-9296-e56687c71313` |
| 5. same `Idempotency-Key` replay | **fail** | Expected HTTP 200 + same `chatId` / `replayed=true`. Got a **second HTTP 201** with a **new** chat. Raw replay `chatId=be5664ad-5fc8-4288-9a29-f865ec554dd6`, `x-request-id=ab54ca06-1b59-4b4c-89f2-4909204b8813`. CLI replay `chatId=d880e9e5-ae39-46c2-8719-6546f637575b`, `requestId=3fed3750-6564-45c9-94cf-89b6ac8634b4`. BFF `/api/chats` does not honor `Idempotency-Key` |
| 6. `POST /api/v1/backtests` `{}` | **fail** | HTTP **400** `chatId is required`, `x-request-id=946c02c7-1ce8-4ef9-9405-9cd407af3ace` |
| 6. `POST /api/v1/backtests` contract `{backtestSettings:{}}` | **fail** | HTTP **400** `unknown request keys: backtestSettings`, `x-request-id=49610211-7980-4726-97a1-47b87ee98bd5`. Facade BFF expects `{chatId, strategyId}`; contracts catalog wants `backtestSettings` |
| 6. `POST /api/v1/backtests` `{chatId, strategyId:1}` | **fail** | HTTP **404** `JOB_NOT_FOUND` `strategy not found` (trader `POST /v2/backtests`), `x-request-id=5715eb82-0fe8-427b-86e2-bb1ce1bd6029`. New chat has no compiled strategy |
| 6. get / stream / cancel (no live job) | **fail** (blocked by create) | Handlers are on the facade (not catch-all 404). Missing id `00000000-0000-0000-0000-000000000001`: GET **404** `JOB_NOT_FOUND` `x-request-id=406b0439-4c33-4f4c-b117-bac6787e7f59`; stream GET **404** `x-request-id=0e1f335b-2865-4fdf-ae5f-e5450514ad8a`; cancel POST **404** `x-request-id=8793823c-3ea8-405e-9c15-1eae47b4a4af`. Did **not** watch a live stream or cancel a created job |
| 8. `POST /api/auth/oauth/revoke` | **pass** | HTTP **200** `{revoked:true}`, `x-request-id=f8dbc0da-1784-46ba-8180-0ad56225e253` |
| 8. revoked AT on `GET /api/v1/me` | **pass** | HTTP **401** `unauthorized`, `x-request-id=992b12f5-f1b7-4750-ab7e-f162278be8e8` |
| 8. `auth logout` | **pass** | `localCleared: true`, `remoteRevoke: ok`, `fullyLoggedOut: true`. Keychain file removed. Follow-up `whoami` HTTP **401**, `requestId=c52c8c33-d898-4471-b008-27b4d558664a`, CLI exit 77 |
| 9. CLI prod-audience token → staging | **pass** | No HTTP. CLI **exit 77**, `subtype=cross_origin_token`, `status=403`: refuses to send tokens whose audience origin is `https://alphafox.app` to `https://staging.alphafox.app` |
| 9. unknown / prod-shaped bearer on staging `/api/v1/me` | **pass** (fail-closed) | No production OAuth client (not enabled). Unknown opaque bearer HTTP **401** `x-request-id=c73deb73-8ae4-472f-9d19-ad0b930f04fe`. Forged JWT with `iss=https://alphafox.app/api/auth` HTTP **401** `x-request-id=cb92f0f7-05ab-4e25-9455-a770467d4a07`. Staging token table does not accept foreign tokens |

### Leftover blockers (do not treat the full checklist as green)

- **Idempotency:** `chats.create` on staging creates a real llm-gateway chat (201) but ignores `Idempotency-Key`.
- **Backtest vertical slice:** cannot `create → stream → cancel` until a chat has an integer `strategyId`, and until the facade body matches contracts (`backtestSettings`) or the catalog is updated to `{chatId, strategyId}`.
- Parent Feishu task and t101364 (production publish / npm `latest` / production OAuth) stay **todo**. Do not merge web PR 448 to production `main` from this evidence.

## Evidence (2026-08-13) — gapfix retest (historical; idempotency + backtests.create)

Anonymous `GET https://staging.alphafox.app/api/v1/meta` → **HTTP 200**, `environment=staging`, `contractVersion=2026-08-13`, `commitSha=fba21ef4b2c3909c51a5a19e2d2a45b30d1d598c`, `x-request-id=8702a21b-a749-4007-82eb-76ca1dd0caaf`. No SSO redirect. Staging Device Flow approval, token exchange, and `whoami` passed for the E2E fixture account. CLI local `92c8610250b30e7881f79a2fde60b00fe50b4628`, catalog `contractsSha=d1f184e3d72581f155497978880d9ab3029ff858`. Staging llm-gateway image `0a10d8e3a1304b04eff2f21c503922a5b7c11491` (workflow `31683345740` failed after the container was healthy: `/opt/alphafox/images` permission on an unrelated host step).

| Step | Result | Evidence |
|------|--------|----------|
| 5. `POST /api/v1/chats` create | **pass** | HTTP **201** `chatId=8d1a569a-e19e-44f6-84e3-4f5f28f8e1e6`, `x-request-id=6cfe0cdc-db13-455b-87a7-7ddcc56aa30f`. CLI create `chatId=6ca09650-b259-4343-95fb-dc5891dd81a4`, `requestId=d647b1aa-2a07-4d42-80bc-b88384f6c8b5` |
| 5. same `Idempotency-Key` replay | **pass** | HTTP **200** same `chatId=8d1a569a-e19e-44f6-84e3-4f5f28f8e1e6`, `x-request-id=eaea63ac-07ff-49b9-b049-ff8c402a8fb6`. CLI replay same `chatId=6ca09650-b259-4343-95fb-dc5891dd81a4`, `requestId=3e9d6246-3f6c-4be3-a804-1de5d8abf772`. Same key + different title → HTTP **409** `IDEMPOTENCY_CONFLICT`, `x-request-id=f18d8aaf-16b2-4784-a42e-b2a088a586d3` |
| 6. `POST /api/v1/backtests` `{}` | **pass** (honest 400) | HTTP **400** `chatId is required`, `code=validation_error`, `x-request-id=811c9938-337e-4364-85c6-1a5e34f8427f`. CLI `requestId=2bd9e4c8-c33c-4123-84fa-ff999c1a2bed` |
| 6. `POST /api/v1/backtests` `{backtestSettings:{}}` | **pass** (honest 400) | HTTP **400** `chatId is required` (no longer `unknown request keys: backtestSettings`), `x-request-id=6ee3856f-73da-4888-b23d-f3981f8bec22`. CLI `requestId=1b26087b-73ea-4422-98d8-9050a403322e` |
| 6. `POST /api/v1/backtests` `{chatId, strategyId:1}` on empty chat | **pass** (honest 404) | HTTP **404** `STRATEGY_NOT_FOUND` (not `JOB_NOT_FOUND`), `x-request-id=1c58acd7-ed0f-40d3-9d71-618adbf634b5`, chat `88497dc2-1f86-4edc-ae08-f11e8ded57f8` |
| 6. `POST /api/v1/backtests` `{chatId}` omit strategyId | **pass** (honest 422) | HTTP **422** `CHAT_HAS_NO_COMPILED_STRATEGY`, `x-request-id=011c1b47-df76-4a5e-b045-799666eac304`. CLI `requestId=16e44bcc-8780-4146-8f72-8383bc415e07` |
| 6. create → stream → cancel (live job) | **fail** (blocked) | The E2E fixture account has no compiled `strategyId`. Chat stream `x-request-id=2e26667b-0cfd-4bfe-9a75-25971120f1ab` ended `finishReason=tool-calls` (`modifyBacktestSettings`) without `save_strategy`. Follow-up create still **422** `x-request-id=37198479-fbd1-462f-8d5a-3a0d1d8f49bb` |


### Remaining blockers after this retest

- Live `backtests.create` → GET stream → POST cancel still needs a chat with a compiled `strategyId`. Generating one is the multi-step chat tool loop, not this facade fix.
- llm-gateway staging deploy workflow `31683345740` is red on a post-start file permission; the new image is serving (replay evidence above). Do not merge gateway `feat/chats-create-idempotency` to `main`.
- Parent Feishu task and t101364 stay **todo**. Do not enable production OAuth or npm `latest`.

## Policy

- Capture the real HTTP status, redirect, and request-id. Never fabricate staging success.
- External dependency outage → fail the test. No mock success, no silent skip.
- Parent Feishu task stays `todo` until production publish / OAuth latest is accepted.
- Do not enable production OAuth client or npm latest from a staging-only pass.
