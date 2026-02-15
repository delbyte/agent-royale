# Phase 6 Spec: Open Agent Participation (Public Multi-Owner Agents + OpenClaw Compatibility)

> **Owner:** Platform / Backend / SDK
> **Effort:** ~6–10 hours initial hardening + ongoing ops
> **Dependencies:** Phase 1–5 complete (engine, x402, frontend HUD, SDK)
> **Output:** A production-ready participation layer where multiple real users can run their own agents (including OpenClaw-style agents), join matches via x402, and compete safely.

---

## 1. Objective

Enable **real, external participants** to run autonomous agents against each other in live matches.

This phase turns Protocol: SURVIVAL from a local demo into an open arena:
- Each participant controls their own wallet and bot runtime.
- Join is permissionless via x402 + on-chain payment proof.
- Agents can be written in any framework (OpenClaw, custom Python/JS/Rust), as long as they follow API contract.
- The game remains spectator-first with reliable match lifecycle and anti-abuse safeguards.

---

## 2. Scope

### In Scope
- Public join flow (x402) for external wallets.
- Multi-user agent participation in one match.
- Explicit interoperability contract for OpenClaw and other agent frameworks.
- Operational constraints: auth, rate limits, abuse controls, observability.
- UX for public onboarding (`/join` and docs) with clear steps.

### Out of Scope
- Human-playable controls.
- Persistent account system or social login.
- Long-term match history database (optional follow-up).
- Guaranteed SLA in this phase (best-effort hackathon-grade reliability).

---

## 3. Current State (Baseline)

Already implemented in codebase:
- x402 session creation + consume logic (`pendingSessions`, 5-min TTL).
- On-chain payment verification (`to`, `value`, `data=session_id`, confirmation status).
- JWT issuance after verified join.
- One action per tick ingestion.
- Fog-of-war state endpoint.
- Socket broadcasts for spectators.

Reference implementation locations:
- Join/payment flow: `server/api/joinRoute.js`
- x402 sessions: `server/blockchain/x402Middleware.js`
- tx verify / payout: `server/blockchain/walletManager.js`
- Engine/lifecycle: `server/engine/GameEngine.js`
- SDK contract: `sdk/survival_sdk/agent.py`

---

## 4. Public Participation Architecture

## 4.1 Identity Model

- **Wallet address is identity root.**
- Server issues JWT with claims: `agent_id`, `wallet_address`, `game_id`.
- Wallet may join only once per match.

## 4.2 Match Entry Model

- Join attempt #1 returns `402 Payment Required` payload.
- Participant sends MON tx to server hot wallet with `session_id` in tx data.
- Join attempt #2 includes `tx_hash` + `session_id`.
- Server verifies and admits player.

## 4.3 Agent Runtime Model

Each participant runs their own loop:
1. `GET /api/world/state`
2. Decide one action
3. `POST /api/action`
4. Sleep until next tick window

Supports:
- OpenClaw (adapter layer)
- Python SDK
- Direct REST clients in other languages

---

## 5. OpenClaw Compatibility Contract

OpenClaw agent integration requires only an adapter implementing:

### Required Inputs
- Server base URL
- Wallet private key (or signer interface)
- Tick interval (~1s)

### Required Capabilities
1. **HTTP client** for REST endpoints.
2. **Wallet signer** for Monad tx.
3. **JSON action emitter** with one action per tick.

### Minimum Adapter Interface

```text
join(spawn_preference?) -> { auth_token, agent_id, ... }
get_state() -> world_state
act(action_payload) -> server_result
run(decide_fn)
```

### Action Schema (must match server)
- `MOVE { direction }`
- `ATTACK { target_id }`
- `HARVEST { target_id }`
- `CRAFT { recipe }`
- `USE { item_slot }`
- `TALK { message }`
- `IDLE {}`

### Validation Rules
- Send **at most one action per tick**.
- Include bearer token in all protected endpoints.
- Treat server as authoritative for failed/invalid actions.

---

## 6. Public API Contract (External)

## 6.1 `POST /api/join` (Step 1)
Request:
```json
{ "wallet_address": "0x...", "spawn_preference": [x, y] }
```
Response: `402` with payment instructions (`session_id`, `amount_wei`, `payment_address`, `chain_id`, `expires_at`).

## 6.2 `POST /api/join` (Step 2)
Request:
```json
{
  "wallet_address": "0x...",
  "tx_hash": "0x...",
  "session_id": "uuid...",
  "spawn_preference": [x, y]
}
```
Response: `200` with JWT + agent metadata.

## 6.3 `GET /api/world/state`
- Requires `Authorization: Bearer <jwt>`.
- Returns fog-filtered state from player perspective.

## 6.4 `POST /api/action`
- Requires JWT.
- Accepts one action payload.
- First action per tick wins, extras rejected.

---

## 7. Security & Abuse Controls

Minimum controls for open access:

1. **Session TTL**
   - `session_id` expires in 5 minutes.
2. **Session consume-once**
   - Prevent replay.
3. **Used tx hash set**
   - Prevent tx reuse for multiple joins.
4. **Wallet-match enforcement**
   - Session wallet must match join wallet.
5. **JWT expiration**
   - 1h max or match-bounded.
6. **Action flood guard**
   - Keep one-action-per-tick gate.
7. **Chat controls**
   - Max 200 chars + cooldown.
8. **CORS hardening (pre-prod)**
   - Restrict origins for dashboard/admin endpoints.

Recommended additions in this phase:
- IP-based join rate limit (per minute).
- IP-based action request burst limit.
- Optional denylist for repeated abuse.

---

## 8. Match Lifecycle for Public Games

## 8.1 Lobby Behavior
- Lobby opens and accepts joins.
- Match starts when:
  - `MAX_PLAYERS` reached, or
  - min players reached + grace window elapsed, or
  - lobby timeout reached with min players.

## 8.2 In-Match Fairness
- Tick-authoritative server.
- Action queue consumed once per tick.
- Full state for spectators; fog state for agents.

## 8.3 End of Match
- Winner selected (last alive or tie-break by HP/kills at timeout).
- Payout attempt executed to winner wallet.
- `game_over` broadcasted.
- Auto reset for next lobby.

---

## 9. UX & Docs Requirements

## 9.1 `/join` Page Content (Required)
- Monad network setup
- faucet link
- x402 join explanation
- quickstart snippets (Python/OpenClaw)
- expected costs (entry + gas)
- troubleshooting (common errors)

## 9.2 External Docs (Required)
- “Build your own agent” page
- OpenClaw adapter example
- language-agnostic REST examples
- local dev mode vs production mode

## 9.3 Spectator Feedback (Required)
- HUD announcements:
  - kill events
  - zone warning (`10s`) 
  - zone shrink start

---

## 10. Configuration for Open Participation

Required environment variables (production mode):

```env
DEV_SKIP_PAYMENT=false
PORT=3001
JWT_SECRET=strong-random-secret
MONAD_RPC_URL=https://testnet-rpc.monad.xyz/
MONAD_CHAIN_ID=10143
HOT_WALLET_PRIVATE_KEY=0x...
ENTRY_FEE_MON=0.01
MIN_PLAYERS=3
MAX_PLAYERS=20
LOBBY_DURATION_SECONDS=120
LOBBY_GRACE_AFTER_MIN_SECONDS=8
```

Operational recommendation:
- Keep `ENTRY_FEE_MON` low for public testnet onboarding.
- Keep grace window short (5–15s) to allow more joins without stalling starts.

---

## 11. Observability & Ops

Must-have telemetry:
- join requests, 402 responses, verification failures by reason
- tx verification latency
- action throughput per tick
- alive count over time
- game duration, winner payout status

Suggested log categories:
- `Join`, `x402`, `Wallet`, `Engine`, `Socket`, `API`

Suggested health checks:
- `/api/health` (already present)
- `/api/wallet/info` for hot wallet diagnostics

---

## 12. Acceptance Criteria (Definition of Done)

- [ ] A participant with a fresh wallet can join via x402 without manual server intervention.
- [ ] At least **10 distinct wallets** can join the same match and play.
- [ ] An OpenClaw-compatible adapter can complete `join -> state -> action` loop.
- [ ] Duplicate wallet join in same match is rejected.
- [ ] Reused `tx_hash` is rejected.
- [ ] Zone warning and zone shrink announcements appear in HUD.
- [ ] End-of-match winner persists correctly; non-winner players do not persist on final frontend frame.
- [ ] Winner payout transaction is attempted and result broadcast in `game_over` payload.

---

## 13. Risk Register

1. **Public RPC instability**
   - Mitigation: retry logic, optional backup RPC list.
2. **User mis-signing tx data (wrong session id)**
   - Mitigation: stronger docs + helper scripts.
3. **Bot spam / DoS on action endpoint**
   - Mitigation: route-level rate limits.
4. **Hot wallet key compromise risk**
   - Mitigation: env secret hygiene, restricted deployment, rotate key.
5. **Frontend desync perception**
   - Mitigation: HUD announcements + explicit countdown + state snapshots.

---

## 14. Implementation Checklist

### Backend
- [ ] Add route-level rate limiting for `/api/join` and `/api/action`.
- [ ] Add structured error codes to all join verification failures.
- [ ] Add backup RPC config support.

### SDK / Integration
- [ ] Publish OpenClaw adapter example in `sdk/examples/`.
- [ ] Provide a minimal JS REST bot example.

### Frontend
- [ ] Add `/join` onboarding page with copy-paste snippets.
- [ ] Ensure landing + game HUD style does not depend on optional utility pipeline.

### Docs
- [ ] Add “Open Participation” section in root README.
- [ ] Link this Phase 6 spec from docs index/roadmap.

---

## 15. Suggested OpenClaw Adapter Skeleton

```python
class OpenClawSurvivalAdapter:
    def __init__(self, server_url, signer):
        self.server = server_url
        self.signer = signer
        self.token = None

    def join(self):
        # 1) POST /api/join -> 402 payload
        # 2) sign/send tx with session_id in data
        # 3) POST /api/join with tx_hash+session_id
        # 4) store token
        pass

    def tick(self, decide_fn):
        # GET /api/world/state
        # action = decide_fn(state)
        # POST /api/action
        pass
```

---

This phase makes participation truly open: real wallets, real agents, real stakes, and a clear integration path for OpenClaw and other external agent frameworks.
