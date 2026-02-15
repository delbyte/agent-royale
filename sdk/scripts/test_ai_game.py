"""
Test game: FULL AI — all LLM-powered agents.

Launches Gemini-powered LLM agents and lets them battle it out.
This script now auto-generates bot wallets and funds them so joins use
real on-chain payments and build a real prize pool.
This is the ultimate stress test for the validation/adaptation layer,
since every bot is operating with 2-5s latency.

Watch for:
  - Adapted action counts (how many LLM actions were adjusted to reality)
  - Fallback action counts (how many ticks used emergency rules while LLM thought)
  - Stamina gate counts (LLM tried to act without enough stamina)
  - AFK saves (near-wolf-kill prevented by forced displacement)

Prerequisites:
    1. Start the game server (on-chain mode):
           cd server
        set DEV_SKIP_PAYMENT=false
           node index.js

    2. Set your Gemini API key:
           set GOOGLE_AI_API_KEY=your-key-here

    3. Set source/house wallet key (used to fund generated bot wallets):
        set HOT_WALLET_PRIVATE_KEY=0x...

    4. Run this script:
           cd sdk
           python -m scripts.test_ai_game

Environment Variables:
    GOOGLE_AI_API_KEY  — Required
    SERVER_URL         — Game server URL (default: http://localhost:3001)
    LLM_MODEL          — Gemini model to use (default: gemini-2.5-flash)
    BOT_COUNT          — Number of AI bots (default: 6, min: 3)
"""

import logging
import os
import random
import secrets
import sys
import threading
import time
import requests
from web3 import Web3
from eth_account import Account

from dotenv import load_dotenv

load_dotenv()

from survival_sdk import SurvivalAgent
from survival_sdk.strategies.llm import LLMStrategy, create_gemini_backend

# ── Configuration ──
SERVER = os.getenv("SERVER_URL", "http://localhost:3001")
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-2.5-flash")
BOT_COUNT = max(3, int(os.getenv("BOT_COUNT", "6")))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("test_ai")

# Track all strategies for final stats
all_strategies: list[tuple[str, LLMStrategy]] = []
stats_lock = threading.Lock()


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


def generate_dummy_key():
    return "0x" + secrets.token_hex(32)


def wait_for_server(timeout_seconds: int = 20) -> bool:
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
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if get_game_state() == "LOBBY_OPEN":
            return True
        time.sleep(1)
    return False


def fetch_wallet_info() -> dict:
    return request_json_with_retry(f"{SERVER}/api/wallet/info", timeout=5, attempts=4)


def generate_bot_wallets(count: int) -> list[dict]:
    wallets = []
    for i in range(count):
        key = generate_dummy_key()
        acct = Account.from_key(key)
        wallets.append({
            "index": i,
            "address": acct.address,
            "private_key": key,
        })
    return wallets


def fund_wallets_for_demo(wallets: list[dict], wallet_info: dict) -> bool:
    source_key = os.getenv("HOT_WALLET_PRIVATE_KEY", "").strip()
    if not source_key:
        print("  ERROR: HOT_WALLET_PRIVATE_KEY is not set in this shell")
        return False

    rpc_url = wallet_info.get("rpc_url") or "https://testnet-rpc.monad.xyz/"
    chain_id = int(wallet_info.get("chain_id") or 10143)
    entry_fee_wei = int(wallet_info.get("entry_fee_wei") or 0)

    w3 = Web3(Web3.HTTPProvider(rpc_url))
    source = Account.from_key(source_key)

    # Enough for join fee + gas + a little headroom.
    min_demo_wei = w3.to_wei(0.03, "ether")
    per_bot_wei = max(entry_fee_wei * 2, min_demo_wei)

    gas_price = w3.eth.gas_price
    est_gas_total = 21000 * gas_price * len(wallets)
    required_total = per_bot_wei * len(wallets) + est_gas_total
    source_balance = w3.eth.get_balance(source.address)

    print(f"  Source wallet: {source.address}")
    print(f"  Source balance: {w3.from_wei(source_balance, 'ether')} MON")
    print(f"  Funding per bot: {w3.from_wei(per_bot_wei, 'ether')} MON")

    if source_balance < required_total:
        print("  ERROR: insufficient source balance for funding")
        return False

    nonce = w3.eth.get_transaction_count(source.address, "pending")
    print("\n  Funding generated AI bot wallets...")
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
            print(f"  ERROR: funding tx failed for AI-{wallet['index']}")
            return False
        print(f"    [AI-{wallet['index']}] tx={tx_hash.hex()[:14]}...")
        nonce += 1

    print("  Funding complete.\n")
    return True


def run_bot(index: int, strategy: LLMStrategy, private_key: str):
    """Run a single LLM bot in its own thread."""
    label = f"AI-{index}"
    try:
        agent = SurvivalAgent(SERVER, private_key)

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

        logger.info(f"Bot {index} ({label}) joined as '{agent.display_name}'")
        agent.run(strategy)
        logger.info(f"Bot {index} ({label}) finished.")
    except Exception as e:
        logger.error(f"Bot {index} ({label}) error: {e}")


def print_final_stats():
    """Print a summary table of all bots' validation stats."""
    print()
    print("═" * 72)
    print("  VALIDATION LAYER STATS")
    print("═" * 72)
    print(
        f"  {'Bot':<8} {'LLM':>5} {'Adapt':>6} {'Fall':>6} "
        f"{'Stale':>6} {'Inval':>6} {'Stam':>6} {'AFK':>5}"
    )
    print("  " + "─" * 62)

    totals = [0] * 7
    for label, s in all_strategies:
        row = [
            s._total_llm_actions,
            s._total_adapted_actions,
            s._total_fallback_actions,
            s._total_stale_discards,
            s._total_invalid_discards,
            s._total_stamina_gates,
            s._total_afk_saves,
        ]
        for i in range(7):
            totals[i] += row[i]
        print(
            f"  {label:<8} {row[0]:>5} {row[1]:>6} {row[2]:>6} "
            f"{row[3]:>6} {row[4]:>6} {row[5]:>6} {row[6]:>5}"
        )

    print("  " + "─" * 62)
    print(
        f"  {'TOTAL':<8} {totals[0]:>5} {totals[1]:>6} {totals[2]:>6} "
        f"{totals[3]:>6} {totals[4]:>6} {totals[5]:>6} {totals[6]:>5}"
    )
    print()
    print("  Legend:")
    print("    LLM   = Actions generated by the LLM and executed")
    print("    Adapt = LLM actions that were adapted to current state")
    print("    Fall  = Ticks where fallback rules acted (LLM was thinking)")
    print("    Stale = LLM responses discarded as too old")
    print("    Inval = LLM actions fully invalidated (unfulfillable)")
    print("    Stam  = Actions blocked by insufficient stamina")
    print("    AFK   = Forced moves to prevent wolf-kill (AFK detection)")
    print("═" * 72)
    print()


def main():
    # Verify API key
    api_key = os.getenv("GOOGLE_AI_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("\n  ✗ GOOGLE_AI_API_KEY not set!")
        print("    Set it: set GOOGLE_AI_API_KEY=your-key-here")
        print("    Or create a .env file in the sdk/ directory.\n")
        sys.exit(1)

    print()
    print("═" * 50)
    print("  Protocol: SURVIVAL — Full AI Game Test")
    print(f"  Server: {SERVER}")
    print(f"  Model:  {LLM_MODEL}")
    print(f"  Bots:   {BOT_COUNT}x LLM (all Gemini)")
    print("═" * 50)
    print()

    if not wait_for_server():
        print(f"  ERROR: server is not reachable at {SERVER}")
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

    wallets = generate_bot_wallets(BOT_COUNT)
    if not fund_wallets_for_demo(wallets, wallet_info):
        return

    if not wait_for_lobby_open():
        print("  ERROR: server did not enter LOBBY_OPEN in time")
        return

    backend = create_gemini_backend(model=LLM_MODEL)

    threads = []
    for i in range(BOT_COUNT):
        # Each bot gets its own LLMStrategy instance (own state/thread)
        strategy = LLMStrategy(backend=backend)
        label = f"AI-{i}"
        all_strategies.append((label, strategy))
        private_key = wallets[i]["private_key"]

        t = threading.Thread(
            target=run_bot, args=(i, strategy, private_key), daemon=True
        )
        threads.append(t)
        print(f"  Launching bot {i}: [{label}]")
        t.start()
        time.sleep(0.5)

    print(f"\n  All {len(threads)} bots launched. Waiting for game...\n")

    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\n  Interrupted.")

    print_final_stats()
    print("  Game complete!")


if __name__ == "__main__":
    main()
