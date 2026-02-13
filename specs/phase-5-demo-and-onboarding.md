# Phase 5 Spec: Demo System, Onboarding & Deployment

> **Owner:** DevOps / Full-Stack
> **Effort:** ~3 hours
> **Dependencies:** Phases 1-4 (all systems running)
> **Output:** 10-bot demo running end-to-end (wallet gen → fund → join → play → payout), a public onboarding page, deployment configuration, and a recorded demo video.

---

## 1. Overview

This phase ties everything together for the hackathon submission:

1. **10-bot demo** — Generate wallets, fund them, run 10 LLM-powered bots, record the match
2. **Public onboarding** — A `/join` page that tells anyone in the world how to build and enter an agent
3. **Deployment** — Get the server + frontend running on a publicly accessible URL
4. **Video recording** — Capture the spectator view for the hackathon submission

---

## 2. Demo System: Running 10 Bots

### 2.1 Prerequisites

- Game server running (Phase 1+2)
- Python SDK installed (Phase 3)
- Your main wallet with 10+ MON on Monad Testnet
- `GOOGLE_AI_API_KEY` set for Gemma-3-27B

### 2.2 Step-by-Step Demo Script

Create `scripts/run_full_demo.sh` (or `.ps1` for Windows):

```bash
#!/usr/bin/env bash
set -e

echo "=== Protocol: SURVIVAL — Full Demo Script ==="
echo ""

# Configuration
SERVER_URL="${SERVER_URL:-http://localhost:3001}"
SOURCE_PRIVATE_KEY="${SOURCE_PRIVATE_KEY:?Set SOURCE_PRIVATE_KEY env var}"
BOT_COUNT=10
FUNDING_AMOUNT=1.15  # 1.0 MON entry + 0.15 MON gas buffer

# Step 1: Generate wallets
echo "📝 Step 1: Generating $BOT_COUNT agent wallets..."
cd sdk
python scripts/generate_wallets.py --count $BOT_COUNT --output ../demo_wallets.json
echo ""

# Step 2: Fund wallets
echo "💰 Step 2: Funding wallets with $FUNDING_AMOUNT MON each..."
python scripts/fund_wallets.py \
  --source-key $SOURCE_PRIVATE_KEY \
  --wallets ../demo_wallets.json \
  --amount $FUNDING_AMOUNT
echo ""

# Step 3: Verify server is running
echo "🔍 Step 3: Checking server..."
HEALTH=$(curl -s $SERVER_URL/api/health)
echo "Server status: $HEALTH"
echo ""

# Step 4: Launch bots
echo "🤖 Step 4: Launching $BOT_COUNT bots..."
python scripts/launch_demo.py \
  --wallets ../demo_wallets.json \
  --server $SERVER_URL \
  --strategy mixed \
  --delay 2.0

echo ""
echo "🎬 Demo complete! Check the spectator view at http://localhost:3000/game"
```

### 2.3 Windows PowerShell Version

Create `scripts/run_full_demo.ps1`:

```powershell
# Protocol: SURVIVAL — Full Demo Script (Windows)

$ErrorActionPreference = "Stop"

$ServerUrl = if ($env:SERVER_URL) { $env:SERVER_URL } else { "http://localhost:3001" }
$SourceKey = $env:SOURCE_PRIVATE_KEY
if (-not $SourceKey) { throw "Set SOURCE_PRIVATE_KEY environment variable" }

$BotCount = 10
$FundingAmount = 1.15

Write-Host "=== Protocol: SURVIVAL - Full Demo ===" -ForegroundColor Cyan
Write-Host ""

# Step 1
Write-Host "Step 1: Generating $BotCount wallets..." -ForegroundColor Yellow
Set-Location sdk
python scripts/generate_wallets.py --count $BotCount --output ..\demo_wallets.json
Write-Host ""

# Step 2
Write-Host "Step 2: Funding wallets..." -ForegroundColor Yellow
python scripts/fund_wallets.py `
  --source-key $SourceKey `
  --wallets ..\demo_wallets.json `
  --amount $FundingAmount
Write-Host ""

# Step 3
Write-Host "Step 3: Checking server..." -ForegroundColor Yellow
$health = Invoke-RestMethod -Uri "$ServerUrl/api/health"
Write-Host "Server: $($health | ConvertTo-Json -Compress)"
Write-Host ""

# Step 4
Write-Host "Step 4: Launching bots..." -ForegroundColor Green
python scripts/launch_demo.py `
  --wallets ..\demo_wallets.json `
  --server $ServerUrl `
  --strategy mixed `
  --delay 2.0

Write-Host ""
Write-Host "Demo complete! Watch at http://localhost:3000/game" -ForegroundColor Cyan
```

### 2.4 Mixed Strategy Distribution for Demo

When using `--strategy mixed`, the 10 bots get assigned strategies in this pattern for maximum entertainment:

| Bot # | Strategy | Behavior |
|---|---|---|
| 0, 3, 6 | Aggressive | Hunt immediately |
| 1, 4, 7 | Gatherer | Farm first, fight late |
| 2, 5, 8 | Diplomat | Chat and form alliances |
| 9 | Aggressive | Extra attacker for chaos |

This creates emergent gameplay: diplomats chat while aggressors hunt, gatherers quietly build up power, alliances form and break.

### 2.5 LLM Demo Variant

For the most impressive demo, run all 10 bots with the LLM strategy:

```bash
export GOOGLE_AI_API_KEY="your-key-here"
python scripts/launch_demo.py \
  --wallets demo_wallets.json \
  --server http://localhost:3001 \
  --strategy llm \
  --delay 2.0
```

Each bot will:
- Receive the game state as a structured prompt
- Reason about resources, threats, alliances, zone position
- Output a JSON action
- Independently form emergent strategies

> **Rate Limiting Note:** 10 bots × 1 request/sec = 10 LLM calls/sec. Check your Gemma API quota. If rate-limited, stagger ticks or use `--delay 3.0` to spread out bot joins.

---

## 3. Onboarding Page (`frontend/src/app/join/page.tsx`)

A dedicated page explaining how anyone in the world can connect their AI agent.

```tsx
export default function JoinPage() {
  return (
    <main style={{
      maxWidth: '800px',
      margin: '0 auto',
      padding: '40px 20px',
      color: 'white',
      fontFamily: "'Inter', sans-serif",
      lineHeight: 1.7,
    }}>
      <h1 style={{ fontSize: '36px', marginBottom: '8px' }}>
        🎮 Join Protocol: SURVIVAL
      </h1>
      <p style={{ color: '#888', fontSize: '18px', marginBottom: '32px' }}>
        Build an AI agent, enter the battle royale, and compete for the MON prize pool.
      </p>
      
      {/* Step 1 */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ color: '#00ff88' }}>Step 1: Get a Monad Testnet Wallet</h2>
        <ol style={{ color: '#ccc' }}>
          <li>Install <a href="https://metamask.io" target="_blank" style={{ color: '#7c3aed' }}>MetaMask</a></li>
          <li>Add Monad Testnet as a custom network:
            <pre style={{
              background: '#1a1a1a',
              borderRadius: '8px',
              padding: '16px',
              fontSize: '13px',
              fontFamily: 'monospace',
              overflowX: 'auto',
              marginTop: '8px',
            }}>
{`Network Name: Monad Testnet
RPC URL:      https://testnet-rpc.monad.xyz/
Chain ID:     10143
Symbol:       MON
Explorer:     https://testnet.monadexplorer.com/`}
            </pre>
          </li>
          <li>Export your private key (MetaMask → Account Details → Export Private Key)</li>
        </ol>
      </section>

      {/* Step 2 */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ color: '#00ff88' }}>Step 2: Get Free Testnet MON</h2>
        <p style={{ color: '#ccc' }}>
          Visit the <a href="https://faucet.monad.xyz/" target="_blank" style={{ color: '#7c3aed' }}>
          Monad Faucet</a> and paste your wallet address to receive free testnet MON. 
          You need at least <strong>1.2 MON</strong> (1.0 entry fee + gas).
        </p>
        <p style={{ color: '#888', fontSize: '14px' }}>
          Alternative faucets: 
          <a href="https://faucets.chain.link/" target="_blank" style={{ color: '#7c3aed' }}> Chainlink</a>,
          <a href="https://thirdweb.com/monad-testnet" target="_blank" style={{ color: '#7c3aed' }}> thirdweb</a>
        </p>
      </section>

      {/* Step 3 */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ color: '#00ff88' }}>Step 3: Install the SDK</h2>
        <pre style={{
          background: '#1a1a1a',
          borderRadius: '8px',
          padding: '16px',
          fontSize: '14px',
          fontFamily: 'monospace',
        }}>
{`pip install protocol-survival-sdk
# For LLM-powered agents:
pip install protocol-survival-sdk[llm]`}
        </pre>
      </section>

      {/* Step 4 */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ color: '#00ff88' }}>Step 4: Write Your Bot</h2>
        <pre style={{
          background: '#1a1a1a',
          borderRadius: '8px',
          padding: '16px',
          fontSize: '13px',
          fontFamily: 'monospace',
          overflowX: 'auto',
        }}>
{`from survival_sdk import SurvivalAgent

def my_strategy(agent, state):
    me = state["self"]
    nearby = state.get("nearby_entities", [])
    zone = state["zone"]
    
    # Your AI logic here!
    # Examples:
    # agent.move("N")           - Move north
    # agent.attack("agent_0x…") - Attack adjacent player
    # agent.harvest("tree_3")   - Harvest adjacent tree
    # agent.craft("stone-axe")  - Craft (near workbench)
    # agent.talk("Hello!")      - Chat with nearby agents
    
    # Simple: move toward center
    agent.move(agent.direction_toward(zone["center"]))

bot = SurvivalAgent(
    server_url="${typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':3001') : 'http://localhost:3001'}",
    private_key="0xYOUR_PRIVATE_KEY"
)
bot.join(spawn_preference=[10, 10])
bot.run(my_strategy)`}
        </pre>
      </section>

      {/* Step 5 */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ color: '#00ff88' }}>Step 5: Watch Your Bot Fight</h2>
        <p style={{ color: '#ccc' }}>
          Open the <a href="/game" style={{ color: '#7c3aed' }}>Spectator View</a> to 
          watch your bot compete in real-time 3D. Click on any player in the leaderboard to 
          focus the camera on them.
        </p>
      </section>

      {/* API Reference */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ color: '#ffaa00' }}>📖 API Quick Reference</h2>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '13px',
          fontFamily: 'monospace',
        }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '8px', color: '#888' }}>Method</th>
              <th style={{ textAlign: 'left', padding: '8px', color: '#888' }}>Args</th>
              <th style={{ textAlign: 'left', padding: '8px', color: '#888' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['agent.move(dir)', 'N/S/E/W/NE/NW/SE/SW', '3 stamina'],
              ['agent.attack(id)', 'target_id', '10 stamina'],
              ['agent.harvest(id)', 'target_id', '5 stamina'],
              ['agent.craft(recipe)', 'recipe name', '0 stamina'],
              ['agent.use(slot)', 'inventory slot #', '0 stamina'],
              ['agent.talk(msg)', 'max 200 chars', '0 stamina'],
              ['agent.idle()', 'none', '0 (regen +5)'],
            ].map(([method, args, cost]) => (
              <tr key={method} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '6px 8px', color: '#00ff88' }}>{method}</td>
                <td style={{ padding: '6px 8px', color: '#ccc' }}>{args}</td>
                <td style={{ padding: '6px 8px', color: '#ccc' }}>{cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Crafting Recipes */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ color: '#ffaa00' }}>🔨 Crafting Recipes</h2>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '8px' }}>
          Must be within 2 tiles of a workbench to craft.
        </p>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '13px',
          fontFamily: 'monospace',
        }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '8px', color: '#888' }}>Recipe</th>
              <th style={{ textAlign: 'left', padding: '8px', color: '#888' }}>Ingredients</th>
              <th style={{ textAlign: 'left', padding: '8px', color: '#888' }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['wooden-club', '5 wood', '8 dmg'],
              ['stone-axe', '10 wood + 5 stone', '15 dmg, 2× tree harvest'],
              ['stone-pickaxe', '10 wood + 5 stone', '12 dmg, 2× rock harvest'],
              ['stone-hammer', '10 wood + 10 stone', '20 dmg (best weapon)'],
              ['barricade', '5 wood', 'Blocks movement'],
              ['health-potion', '5 wood + 3 stone', 'Heals 30 HP'],
            ].map(([recipe, ingredients, result]) => (
              <tr key={recipe} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '6px 8px', color: '#00ff88' }}>{recipe}</td>
                <td style={{ padding: '6px 8px', color: '#ccc' }}>{ingredients}</td>
                <td style={{ padding: '6px 8px', color: '#ccc' }}>{result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Tips */}
      <section style={{
        background: '#1a1a1a',
        borderRadius: '8px',
        padding: '20px',
        border: '1px solid #333',
      }}>
        <h3 style={{ color: '#ffaa00', margin: '0 0 12px' }}>💡 Pro Tips</h3>
        <ul style={{ color: '#ccc', fontSize: '14px', margin: 0, paddingLeft: '20px' }}>
          <li>The zone starts shrinking at 3:00. Don&apos;t get caught outside — 10 HP/tick is lethal.</li>
          <li>Bare hands deal 1 damage. You NEED weapons. Rush for a workbench.</li>
          <li>Standing still for 30 seconds = killed by wolves. Keep moving.</li>
          <li>Chat with other agents to form alliances... then betray them at the end.</li>
          <li>Stone Hammer (20 dmg) is the strongest weapon. Save up 10 wood + 10 stone.</li>
          <li>Health potions (30 HP) can be the difference in the final circle.</li>
          <li>You can only see entities within 15 tiles. Use this fog of war strategically.</li>
        </ul>
      </section>
    </main>
  );
}
```

---

## 4. Landing Page (`frontend/src/app/page.tsx`)

The root page showing what Protocol: SURVIVAL is and linking to the game and join pages.

```tsx
import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#0a0a0a',
      color: 'white',
      fontFamily: "'Inter', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ fontSize: '64px', marginBottom: '16px' }}>⚔️</div>
      <h1 style={{ fontSize: '48px', fontWeight: 800, margin: '0 0 8px' }}>
        Protocol: SURVIVAL
      </h1>
      <p style={{ color: '#00ff88', fontSize: '20px', fontWeight: 500, marginBottom: '24px' }}>
        The Hunger Games for AI Agents — on Monad
      </p>
      <p style={{
        color: '#888',
        maxWidth: '600px',
        fontSize: '16px',
        lineHeight: 1.7,
        marginBottom: '40px',
      }}>
        Autonomous AI agents pay an entry fee in MON via the x402 protocol, 
        spawn into a shrinking battle royale world, gather resources, craft weapons, 
        form alliances, and fight to the death. Last agent standing wins 90% of the pool.
      </p>
      
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/game" style={{
          padding: '14px 32px',
          background: '#7c3aed',
          color: 'white',
          borderRadius: '8px',
          textDecoration: 'none',
          fontSize: '16px',
          fontWeight: 600,
        }}>
          🎬 Watch Live
        </Link>
        <Link href="/join" style={{
          padding: '14px 32px',
          background: 'transparent',
          color: 'white',
          border: '1px solid #333',
          borderRadius: '8px',
          textDecoration: 'none',
          fontSize: '16px',
          fontWeight: 600,
        }}>
          🤖 Enter an Agent
        </Link>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'flex',
        gap: '40px',
        marginTop: '60px',
        fontSize: '14px',
        color: '#888',
      }}>
        <div>
          <div style={{ fontWeight: 'bold', color: '#00ff88', fontSize: '24px' }}>10</div>
          <div>AI Agents</div>
        </div>
        <div>
          <div style={{ fontWeight: 'bold', color: '#ffaa00', fontSize: '24px' }}>1 MON</div>
          <div>Entry Fee</div>
        </div>
        <div>
          <div style={{ fontWeight: 'bold', color: '#7c3aed', fontSize: '24px' }}>90%</div>
          <div>Winner Takes</div>
        </div>
        <div>
          <div style={{ fontWeight: 'bold', color: '#ff4444', fontSize: '24px' }}>10 min</div>
          <div>Max Match</div>
        </div>
      </div>

      {/* Tech badges */}
      <div style={{
        marginTop: '48px',
        padding: '16px 24px',
        background: '#111',
        borderRadius: '8px',
        border: '1px solid #222',
        fontSize: '12px',
        color: '#666',
        display: 'flex',
        gap: '16px',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        <span>Monad Testnet</span>
        <span>•</span>
        <span>x402 Protocol</span>
        <span>•</span>
        <span>React Three Fiber</span>
        <span>•</span>
        <span>Gemma-3-27B</span>
        <span>•</span>
        <span>Socket.io</span>
      </div>
    </main>
  );
}
```

---

## 5. Deployment Configuration

### 5.1 Development (Local)

Run all three services in separate terminals:

```bash
# Terminal 1: Game Server
cd server
cp .env.example .env  # Fill in values
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: Demo Bots
cd sdk
python scripts/launch_demo.py --wallets ../demo_wallets.json --server http://localhost:3001
```

### 5.2 Production Deployment Options

#### Option A: Single VPS (Cheapest — recommended for hackathon)

Use a DigitalOcean/Railway/Render instance:

```bash
# Install Node.js 20+ and Python 3.10+
# Clone repo
git clone https://github.com/YOUR_USERNAME/agent-royale
cd agent-royale

# Server
cd server && npm install && npm start &

# Frontend (build for production)
cd ../frontend && npm install && npm run build && npm start &
```

#### Option B: Separate Railway Services

```yaml
# railway.toml (server)
[build]
  builder = "nixpacks"

[deploy]
  startCommand = "node index.js"
  healthcheckPath = "/api/health"

[service]
  port = 3001
```

```yaml
# railway.toml (frontend)
[build]
  builder = "nixpacks"
  buildCommand = "npm run build"

[deploy]
  startCommand = "npm start"

[service]
  port = 3000
```

### 5.3 Environment Variables for Production

| Variable | Server | Frontend | Notes |
|---|---|---|---|
| `PORT` | ✅ | — | Default 3001 |
| `JWT_SECRET` | ✅ | — | Generate with `openssl rand -hex 32` |
| `MONAD_RPC_URL` | ✅ | — | `https://testnet-rpc.monad.xyz/` |
| `MONAD_CHAIN_ID` | ✅ | — | `10143` |
| `HOT_WALLET_PRIVATE_KEY` | ✅ | — | ⚠️ Keep secret |
| `ENTRY_FEE_MON` | ✅ | — | `1.0` |
| `NEXT_PUBLIC_SERVER_URL` | — | ✅ | Full URL to server |
| `GOOGLE_AI_API_KEY` | — | — | SDK bots only |

---

## 6. Demo Video Recording

### 6.1 What to Record

Record a 2-3 minute video showing:

1. **Lobby** — Agents connecting, names appearing (10 seconds)
2. **Game start** — Agents spawn on the 3D map (5 seconds)
3. **Scavenge phase** — Agents farming trees/rocks, moving around (20 seconds)
4. **Chat** — Agents forming alliances via chat bubbles (10 seconds)
5. **First kill** — Kill feed pops up, agent disappears (5 seconds)
6. **Zone shrink** — Red ring closing in, agents forced together (15 seconds)
7. **Final showdown** — Last 3-4 agents in tiny circle, combat (20 seconds)
8. **Victory** — Game over screen with winner and payout tx hash (10 seconds)
9. **Payout verification** — Open Monad Explorer showing the payout tx (5 seconds)
10. **Onboarding page** — Quick flash of `/join` page (5 seconds)

### 6.2 Recording Tips

- Use OBS Studio for screen recording
- Set resolution to 1920×1080
- Record at 60fps for smooth 3D
- Use God View camera for most of the recording
- Switch to follow-cam on a specific agent during combat
- Add background music (royalty-free) in post

### 6.3 Camera Script

During recording, follow this camera flow:

```
0:00 - 0:15  God View (top-down, full map)
0:15 - 0:30  Zoom into a cluster of agents farming
0:30 - 0:45  Follow an aggressive bot chasing someone
0:45 - 1:00  God View showing zone shrink
1:00 - 1:20  Follow the kill leader
1:20 - 1:45  God View, final circle
1:45 - 2:00  Close-up on final fight
2:00 - 2:15  Game Over screen
```

---

## 7. Wallet Management for Demo

### 7.1 Budget Breakdown

Total MON needed for a 10-bot demo:

| Item | Amount | Per-bot | Total |
|---|---|---|---|
| Entry fee | 1.0 MON | × 10 | 10.0 MON |
| Gas for entry tx | ~0.001 MON | × 10 | ~0.01 MON |
| Gas for funding txs | ~0.001 MON | × 10 | ~0.01 MON |
| Hot wallet gas (payout) | ~0.001 MON | × 1 | ~0.001 MON |
| **Total required** | | | **~10.05 MON** |

### 7.2 Wallet Recovery

After the demo, 90% of the pool goes to the winner. The winner's wallet is one of your 10 demo wallets, so you can recover the funds:

```python
# recover_funds.py — Send MON from all demo wallets back to your main wallet
import json
from web3 import Web3
from eth_account import Account

w3 = Web3(Web3.HTTPProvider("https://testnet-rpc.monad.xyz/"))

with open("demo_wallets.json") as f:
    wallets = json.load(f)

YOUR_MAIN_ADDRESS = "0xYOUR_MAIN_WALLET_ADDRESS"

for wallet in wallets:
    account = Account.from_key(wallet["private_key"])
    balance = w3.eth.get_balance(account.address)
    
    if balance > w3.to_wei(0.01, 'ether'):  # Only if has meaningful balance
        gas_cost = 21000 * w3.eth.gas_price
        send_amount = balance - gas_cost
        
        if send_amount > 0:
            tx = {
                'to': YOUR_MAIN_ADDRESS,
                'value': send_amount,
                'chainId': 10143,
                'gas': 21000,
                'gasPrice': w3.eth.gas_price,
                'nonce': w3.eth.get_transaction_count(account.address),
            }
            signed = account.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            print(f"Recovered from {account.address}: {w3.from_wei(send_amount, 'ether')} MON → {tx_hash.hex()}")
```

---

## 8. Checklist for Hackathon Submission

### Technical Requirements
- [ ] Game server runs and accepts x402 payments
- [ ] 10 AI agents complete a full match (10 minutes max)
- [ ] Winner receives 90% payout automatically
- [ ] Payout transaction viewable on Monad Explorer
- [ ] 3D spectator view works at 30+ FPS
- [ ] Position interpolation looks smooth
- [ ] Kill feed, leaderboard, timer, minimap all functional

### Demo Assets
- [ ] 2-3 minute video recorded
- [ ] Screenshots of key moments
- [ ] `/join` onboarding page is live
- [ ] SDK documentation is clear
- [ ] `README.md` updated with setup instructions

### Hackathon Metadata
- [ ] Project title: "Protocol: SURVIVAL"
- [ ] Track: Agent Track + World Model Bounty
- [ ] Tech stack listed: Monad, x402, ethers.js, Node.js, React Three Fiber, Gemma-3-27B, Python, Socket.io
- [ ] Team info
- [ ] Repository link
- [ ] Demo URL (if deployed)

---

## 9. Troubleshooting Guide

| Issue | Solution |
|---|---|
| **Bots can't connect** | Check server is running, check `SERVER_URL`, check CORS is enabled |
| **Payment fails** | Check wallet has enough MON, check `MONAD_RPC_URL`, try different RPC |
| **LLM rate limit** | Reduce bot count or increase tick interval. Use `--strategy mixed` instead of `--strategy llm` |
| **Frontend can't connect** | Check `NEXT_PUBLIC_SERVER_URL` matches server URL, check Socket.io namespace `/game` |
| **Payout fails** | Check hot wallet has gas (fund with 0.1 MON), check `HOT_WALLET_PRIVATE_KEY` |
| **Agents die immediately** | `DEV_SKIP_PAYMENT=true` may skip spawn coordinate assignment. Check spawn positions aren't overlapping. |
| **Game never starts** | Need `MIN_PLAYERS` (default 3). Join enough bots or reduce `MIN_PLAYERS` in env. |

---

## 10. Definition of Done

- [ ] Full demo script runs end-to-end: wallet gen → fund → join → play → payout
- [ ] 10 bots complete a full match without crashes
- [ ] Winner receives MON payout on Monad Testnet
- [ ] `/join` onboarding page explains full setup for external players
- [ ] Landing page (`/`) looks polished
- [ ] 2-3 minute demo video recorded
- [ ] Wallet recovery script works (get MON back after demo)
- [ ] README.md has setup instructions for judges
