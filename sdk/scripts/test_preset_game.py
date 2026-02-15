"""
Test game: ALL preset strategies (no AI), with real on-chain join payments.

This script now:
  1) Generates N fresh bot wallets
  2) Funds each wallet from the house/source wallet
  3) Launches bots with preset strategies

Result: each bot performs real x402 join payments, so the prize pool grows and
payout flow can be demonstrated end-to-end.

Prerequisites:
    1. Start server in on-chain mode:
        cd server
        set DEV_SKIP_PAYMENT=false
        node index.js

    2. Export house/source private key in this shell:
        set HOT_WALLET_PRIVATE_KEY=0x...

    3. Run this script:
        cd sdk
        python -m scripts.test_preset_game
"""

import logging
import os
import random
import secrets
import threading
import time
import sys
from pathlib import Path
import requests
from web3 import Web3
from eth_account import Account

from survival_sdk import SurvivalAgent
from survival_sdk.strategies.aggressive import aggressive_strategy
from survival_sdk.strategies.gatherer import gatherer_strategy
from survival_sdk.strategies.diplomat import diplomat_strategy

# ── Configuration ──
SERVER = os.getenv("SERVER_URL", "http://localhost:3001")
NUM_BOTS = 10  # Total bots to launch

STRATEGIES = [
    ("Aggressive", aggressive_strategy),
    ("Gatherer", gatherer_strategy),
    ("Diplomat", diplomat_strategy),
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("test_preset")


def request_json_with_retry(url: str, timeout: int = 5, attempts: int = 4):
    """GET JSON with retry on transient network errors and 5xx/429."""
    last_error = None
    for attempt in range(attempts):
        try:
            r = requests.get(url, timeout=timeout)
            if r.status_code == 429 or 500 <= r.status_code < 600:
                if attempt < attempts - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_error = e
            if attempt < attempts - 1:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise RuntimeError(last_error) from last_error


def read_env_value_from_file(env_path: Path, key: str) -> str:
    """Read a single KEY=value from a dotenv-style file."""
    if not env_path.exists():
        return ""

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() != key:
                continue
            value = v.strip().strip('"').strip("'")
            return value
    except Exception:
        return ""

    return ""


def resolve_source_private_key() -> str:
    """Resolve funding key from shell env first, then local env files."""
    source_key = os.getenv("HOT_WALLET_PRIVATE_KEY", "").strip()
    if source_key:
        return source_key

    script_dir = Path(__file__).resolve().parent
    candidate_paths = [
        script_dir.parent / ".env",           # sdk/.env
        script_dir.parent.parent / "server" / ".env",  # server/.env
    ]

    for path in candidate_paths:
        value = read_env_value_from_file(path, "HOT_WALLET_PRIVATE_KEY")
        if value:
            return value

    return ""


def generate_dummy_key():
    """Generate a random private key for bot wallet creation."""
    return "0x" + secrets.token_hex(32)


def fetch_wallet_info() -> dict:
    """Fetch server wallet/payment config."""
    return request_json_with_retry(f"{SERVER}/api/wallet/info", timeout=5, attempts=4)


def generate_bot_wallets(count: int) -> list[dict]:
    """Generate fresh wallets for this run."""
    wallets = []
    for i in range(count):
        key = generate_dummy_key()
        acct = Account.from_key(key)
        wallets.append(
            {
                "index": i,
                "address": acct.address,
                "private_key": key,
            }
        )
    return wallets


def fund_wallets_for_demo(wallets: list[dict], wallet_info: dict) -> bool:
    """Fund each generated wallet so it can pay entry fee + gas."""
    source_key = resolve_source_private_key()
    if not source_key:
        print("  ERROR: HOT_WALLET_PRIVATE_KEY not found")
        print("  Set it in shell, or in sdk/.env, or in server/.env")
        return False

    rpc_url = wallet_info.get("rpc_url") or "https://testnet-rpc.monad.xyz/"
    chain_id = int(wallet_info.get("chain_id") or 10143)
    entry_fee_wei = int(wallet_info.get("entry_fee_wei") or 0)

    w3 = Web3(Web3.HTTPProvider(rpc_url))
    source = Account.from_key(source_key)

    # Demo funding amount per bot:
    # - at least 2x entry fee
    # - at least 0.02 MON to safely cover fee + tx gas
    min_demo_wei = w3.to_wei(0.02, "ether")
    per_bot_wei = max(entry_fee_wei * 2, min_demo_wei)

    gas_price = w3.eth.gas_price
    est_gas_total = 21000 * gas_price * len(wallets)
    required_total = per_bot_wei * len(wallets) + est_gas_total

    source_balance = w3.eth.get_balance(source.address)
    print(f"  Source wallet: {source.address}")
    print(f"  Source balance: {w3.from_wei(source_balance, 'ether')} MON")
    print(f"  Funding per bot: {w3.from_wei(per_bot_wei, 'ether')} MON")
    print(f"  Estimated total needed: {w3.from_wei(required_total, 'ether')} MON")

    if source_balance < required_total:
        print("  ERROR: insufficient source balance for this funding run")
        return False

    nonce = w3.eth.get_transaction_count(source.address, "pending")
    print("\n  Funding generated wallets...")

    for wallet in wallets:
        tx = {
            "to": Web3.to_checksum_address(wallet["address"]),
            "value": per_bot_wei,
            "chainId": chain_id,
            "gas": 21000,
            "gasPrice": w3.eth.gas_price,
            "nonce": nonce,
        }
        signed = source.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt.get("status") != 1:
            print(f"  ERROR: funding tx failed for bot {wallet['index']}")
            return False

        print(
            f"    [{wallet['index']}] {wallet['address'][:14]}... "
            f"funded tx={tx_hash.hex()[:14]}..."
        )
        nonce += 1

    print("  Funding complete.\n")
    return True


def wait_for_server(timeout_seconds: int = 20) -> bool:
    """Wait until /api/health is reachable."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            r = requests.get(f"{SERVER}/api/health", timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def get_game_state():
    try:
        r = requests.get(f"{SERVER}/api/health", timeout=2)
        if r.status_code == 200:
            return r.json().get("game_state")
    except Exception:
        pass
    return None


def wait_for_lobby_open(timeout_seconds: int = 120) -> bool:
    """Wait until server reports LOBBY_OPEN so bots can join."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        state = get_game_state()
        if state == "LOBBY_OPEN":
            return True
        time.sleep(1)
    return False


def run_bot(index: int, strategy_name: str, strategy_fn, private_key: str):
    """Run a single bot in its own thread."""
    try:
        agent = SurvivalAgent(SERVER, private_key)

        # If server is mid-game, wait and retry join for a bit.
        join_deadline = time.time() + 120
        joined = False
        while time.time() < join_deadline and not joined:
            try:
                agent.join(spawn_preference=[
                    random.randint(5, 45),
                    random.randint(5, 45),
                ])
                joined = True
            except Exception as e:
                if "GAME_NOT_IN_LOBBY" in str(e):
                    time.sleep(1)
                    continue
                raise

        if not joined:
            raise RuntimeError("Timed out waiting for lobby to open")

        logger.info(
            f"Bot {index} ({strategy_name}) joined as '{agent.display_name}'"
        )
        agent.run(strategy_fn)
        logger.info(f"Bot {index} ({strategy_name}) finished.")
    except Exception as e:
        logger.error(f"Bot {index} ({strategy_name}) error: {e}")


def main():
    print()
    print("═" * 50)
    print("  Protocol: SURVIVAL — Preset Strategies Test")
    print(f"  Server: {SERVER}")
    print(f"  Bots: {NUM_BOTS} (cycled Aggressive/Gatherer/Diplomat)")
    print("  AI: None (all rule-based)")
    print("═" * 50)
    print()

    if not wait_for_server():
        print(f"  ERROR: server is not reachable at {SERVER}")
        print("  Start server first (server terminal):")
        print("    cd server")
        print("    set DEV_SKIP_PAYMENT=true")
        print("    node index.js")
        return

    try:
        wallet_info = fetch_wallet_info()
    except Exception as e:
        print(f"  ERROR: failed to fetch /api/wallet/info: {e}")
        return

    if wallet_info.get("dev_skip_payment"):
        print("  ERROR: server is running with DEV_SKIP_PAYMENT=true")
        print("  Set DEV_SKIP_PAYMENT=false and restart the server.")
        return

    wallets = generate_bot_wallets(NUM_BOTS)
    if not fund_wallets_for_demo(wallets, wallet_info):
        return

    if not wait_for_lobby_open():
        print("  ERROR: server did not enter LOBBY_OPEN in time")
        print("  Wait for current match to end (or restart server), then re-run test.")
        return

    threads = []
    for i in range(NUM_BOTS):
        name, fn = STRATEGIES[i % len(STRATEGIES)]
        private_key = wallets[i]["private_key"]
        t = threading.Thread(
            target=run_bot, args=(i, name, fn, private_key), daemon=True
        )
        threads.append(t)
        print(f"  Launching bot {i}: [{name}]")
        t.start()
        time.sleep(0.5)  # Stagger joins

    print(f"\n  All {len(threads)} bots launched. Waiting for game...\n")

    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\n  Interrupted. Shutting down.")
        sys.exit(0)

    print("\n  Game complete!")


if __name__ == "__main__":
    main()
