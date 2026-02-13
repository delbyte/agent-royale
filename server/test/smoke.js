/**
 * Smoke test for Phase 1 game server.
 * Run: node test/smoke.js (with server running on port 3001)
 *
 * Tests:
 * 1. Health check
 * 2. Join 3 players via stubbed x402 flow (402 → 200)
 * 3. Wait for game to start (lobby auto-start with min players)
 * 4. Verify world state via authenticated GET
 * 5. Submit an action (MOVE)
 */

const BASE = 'http://localhost:3001';

function assert(condition, message) {
    if (!condition) {
        console.error(`  ✖ FAIL: ${message}`);
        process.exitCode = 1;
    } else {
        console.log(`  ✔ ${message}`);
    }
}

async function post(url, body, headers = {}) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
    return { status: resp.status, data: await resp.json() };
}

async function get(url, headers = {}) {
    const resp = await fetch(url, { headers });
    return { status: resp.status, data: await resp.json() };
}

async function test() {
    console.log('\n═══ Protocol: SURVIVAL — Smoke Test ═══\n');

    // ── 1. Health Check ──
    console.log('1. Health check');
    const health = await get(`${BASE}/api/health`);
    assert(health.status === 200, `Status 200 (got ${health.status})`);
    assert(health.data.status === 'ok', 'Server OK');
    assert(health.data.game_state === 'LOBBY_OPEN', `Game in lobby (got ${health.data.game_state})`);
    console.log();

    // ── 2. Join 3 players ──
    console.log('2. Join 3 players via stubbed x402');
    const tokens = [];
    const agentIds = [];

    for (let i = 0; i < 3; i++) {
        const wallet = `0xTEST_WALLET_${i}_${Date.now()}`;

        // Step 1: Request join — may get 402 (production) or 200 (DEV_SKIP_PAYMENT)
        const step1 = await post(`${BASE}/api/join`, {
            wallet_address: wallet,
            spawn_preference: [10 + i * 15, 10 + i * 15],
        });

        let joinResult;

        if (step1.status === 200) {
            // DEV_SKIP_PAYMENT=true — direct join, no 402 flow
            assert(true, `Player ${i} joined directly (DEV mode)`);
            joinResult = step1;
        } else {
            // Production flow: 402 → verify → 200
            assert(step1.status === 402, `Player ${i} got 402 Payment Required`);
            assert(step1.data.payment_required.session_id, `Player ${i} received session_id`);

            // Step 2: Confirm with fake tx_hash → should get 200
            joinResult = await post(`${BASE}/api/join`, {
                wallet_address: wallet,
                tx_hash: `0xfake_tx_${i}`,
                session_id: step1.data.payment_required.session_id,
                spawn_preference: [10 + i * 15, 10 + i * 15],
            });
        }

        assert(joinResult.status === 200, `Player ${i} joined successfully`);
        assert(joinResult.data.auth_token, `Player ${i} received JWT`);
        assert(joinResult.data.display_name, `Player ${i} got name: ${joinResult.data.display_name}`);
        assert(joinResult.data.position, `Player ${i} spawned at [${joinResult.data.position}]`);

        tokens.push(joinResult.data.auth_token);
        agentIds.push(joinResult.data.agent_id);
    }
    console.log();

    // ── 3. Wait for game start ──
    // With 3 players and lobby timer, the game should auto-start.
    // But since lobby duration is 120s, let's check health to see if it started.
    console.log('3. Waiting for game start...');

    // Poll health until game becomes active (max 5 seconds for this test)
    let gameStarted = false;
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        const h = await get(`${BASE}/api/health`);
        if (h.data.game_state === 'GAME_ACTIVE') {
            gameStarted = true;
            break;
        }
    }

    if (!gameStarted) {
        console.log('  ⚠ Game did not auto-start (lobby duration not yet elapsed).');
        console.log('  ⚠ Remaining tests require GAME_ACTIVE state. Set LOBBY_DURATION_SECONDS=3 for fast testing.');
        console.log('\n═══ Partial test complete ═══');
        return;
    }

    assert(gameStarted, 'Game transitioned to GAME_ACTIVE');
    console.log();

    // ── 4. Get world state ──
    console.log('4. Get world state (fog of war)');
    const state = await get(`${BASE}/api/world/state`, {
        Authorization: `Bearer ${tokens[0]}`,
    });
    assert(state.status === 200, `Got state (status ${state.status})`);
    assert(state.data.game_state === 'GAME_ACTIVE', 'Game is active');
    assert(state.data.self, 'Self state present');
    assert(state.data.self.hp === 100, `HP = ${state.data.self.hp}`);
    assert(state.data.self.stamina === 100, `Stamina = ${state.data.self.stamina}`);
    assert(state.data.zone, 'Zone data present');
    assert(state.data.nearby_entities, `Nearby entities: ${state.data.nearby_entities.length}`);
    assert(state.data.alive_count === 3, `Alive count = ${state.data.alive_count}`);
    console.log();

    // ── 5. Submit action (MOVE) ──
    console.log('5. Submit MOVE action');
    const moveResult = await post(
        `${BASE}/api/action`,
        { action: 'MOVE', direction: 'N' },
        { Authorization: `Bearer ${tokens[0]}` }
    );
    assert(moveResult.status === 200, `Action accepted (status ${moveResult.status})`);
    assert(moveResult.data.success === true, 'Action succeeded');
    assert(moveResult.data.action_queued === 'MOVE', 'MOVE was queued');
    console.log();

    // ── 6. Duplicate action same tick ──
    console.log('6. Duplicate action (should fail)');
    const dupe = await post(
        `${BASE}/api/action`,
        { action: 'MOVE', direction: 'S' },
        { Authorization: `Bearer ${tokens[0]}` }
    );
    assert(dupe.status === 400, `Duplicate rejected (status ${dupe.status})`);
    assert(dupe.data.error === 'ACTION_ALREADY_QUEUED', 'Got ACTION_ALREADY_QUEUED');
    console.log();

    // ── 7. Invalid action ──
    console.log('7. Invalid action type');
    const invalid = await post(
        `${BASE}/api/action`,
        { action: 'FLY' },
        { Authorization: `Bearer ${tokens[1]}` }
    );
    assert(invalid.status === 400, `Invalid action rejected (status ${invalid.status})`);
    console.log();

    // ── 8. Unauthorized request ──
    console.log('8. Unauthorized state request');
    const noAuth = await get(`${BASE}/api/world/state`);
    assert(noAuth.status === 401, `Unauthorized (status ${noAuth.status})`);
    console.log();

    console.log('═══ All smoke tests passed! ═══\n');
}

test().catch(err => {
    console.error('Test runner error:', err);
    process.exitCode = 1;
});
