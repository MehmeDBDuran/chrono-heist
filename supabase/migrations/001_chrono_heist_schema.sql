-- ============================================================================
-- CHRONO HEIST: PARADOX PROTOCOL
-- Dedicated Isolated Supabase Schema & Atomic RPC Functions
-- Project Ref: mlfeemfaorwowolpteqr
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PROTOCOL TREASURY & BOUNTY POOL LEDGER
CREATE TABLE IF NOT EXISTS public.protocol_treasury (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    total_treasury_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    total_referral_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    bounty_jackpot_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    total_duels_settled INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.protocol_treasury (id, total_treasury_udao, total_referral_udao, bounty_jackpot_udao, total_duels_settled)
VALUES (1, 0, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- 2. OPERATIVE ARCADE VAULTS & 4-LOOP CREW PROGRESSION
CREATE TABLE IF NOT EXISTS public.arcade_vaults (
    wallet_address TEXT PRIMARY KEY,
    callsign TEXT NOT NULL DEFAULT 'OPERATIVE',
    session_udao NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (session_udao >= 0),
    chrono_gold INTEGER NOT NULL DEFAULT 250 CHECK (chrono_gold >= 0),
    clearance_xp INTEGER NOT NULL DEFAULT 0,
    clearance_rank INTEGER NOT NULL DEFAULT 1,
    contract_tier_unlocked INTEGER NOT NULL DEFAULT 1,
    wanted_heat INTEGER NOT NULL DEFAULT 0,
    unlocked_classes JSONB NOT NULL DEFAULT '["infiltrator"]'::jsonb,
    crew_loadout JSONB NOT NULL DEFAULT '["infiltrator", "infiltrator", "infiltrator", "infiltrator"]'::jsonb,
    equipped_loadout JSONB NOT NULL DEFAULT '{"skin_id":"skin_standard","weapon_id":"weapon_baton","echo_shader_id":"shader_cyan"}'::jsonb,
    referred_by TEXT,
    referral_earnings_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    paradoxes_triggered INTEGER NOT NULL DEFAULT 0,
    alley_oops_landed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 3D BLACK MARKET & CREW RIG CATALOG
CREATE TABLE IF NOT EXISTS public.market_catalog (
    item_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('crew_class', 'skin', 'weapon', 'echo_shader')),
    description TEXT NOT NULL,
    passive_desc TEXT,
    gadget_desc TEXT,
    tradeoff_desc TEXT,
    cost_gold INTEGER NOT NULL DEFAULT 0,
    cost_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    required_rank INTEGER NOT NULL DEFAULT 1,
    preview_color TEXT NOT NULL DEFAULT '#00f0ff'
);

INSERT INTO public.market_catalog (item_id, name, category, description, passive_desc, gadget_desc, tradeoff_desc, cost_gold, cost_udao, required_rank, preview_color)
VALUES
    -- 4-Loop Crew Classes (Earned via Contracts or Chrono Gold — Zero Pay-to-Win)
    ('infiltrator', 'INFILTRATOR RIG', 'crew_class', 'Balanced starter operative chassis built for fast insertion and core relay.', 'Balanced Sprint & Throw Velocity', '[Q] Overclock Surge (+25% Speed 2s)', 'Standard 90° Frontal Reflex Guard', 0, 0, 1, '#00f0ff'),
    ('tech_hacker', 'TECH HACKER RIG', 'crew_class', 'Circuit specialist designed to hold Pressure Pads and lock down Laser Gates.', 'Capacitor Relay: Pads stay active +2.2s after stepping off', '[Q] Holo-Decoy: Spawns 3s weight-clone on Pad', '-15% Core Throw Range', 300, 0, 1, '#f59e0b'),
    ('grav_runner', 'GRAV-RUNNER RIG', 'crew_class', 'High-velocity Alley-Oop specialist built for cross-room passes through Throw Windows.', 'Magnet Catch: 2.5x catch radius & +25% Throw Speed', '[Q] Kinetic Pull: Yanks loose Core within 5.5m into hands', '-20% Blade Dash Distance', 600, 0, 2, '#10b981'),
    ('phase_phantom', 'PHASE PHANTOM RIG', 'crew_class', 'Quantum breacher capable of blinking directly through active security Laser Gates.', 'Ghost Sprint: +12% Unencumbered Speed', '[Q] Phase Blink: 1.2s phase-shift through Laser Gates', 'Drops carried Core if Blinking', 900, 0, 3, '#a855f7'),
    ('enforcer', 'ENFORCER RIG', 'crew_class', 'Heavy timeline bodyguard designed to protect earlier loops from Challenger ambushes.', 'Fortress Guard: 140° Frontal Reflex Parry as Echo', '[Q] Chrono EMP Mine: Proximity stun trap (2.0s)', '-12% Move Speed while carrying Core', 1200, 0, 4, '#ef4444'),

    -- 3D Operative Rig Skins
    ('skin_standard', 'STANDARD RAIDER', 'skin', 'Tactical matte-slate containment suit with cyan telemetry trim.', NULL, NULL, NULL, 0, 0, 1, '#38bdf8'),
    ('skin_specops', 'CYBER-SPEC OPS', 'skin', 'Stealth carbon-weave chassis with high-contrast crimson optics.', NULL, NULL, NULL, 500, 0, 2, '#f43f5e'),
    ('skin_hazard', 'BIO-REACTOR HAZARD', 'skin', 'Industrial yellow containment armor engineered for Sector II Reactor Bay.', NULL, NULL, NULL, 1200, 0, 3, '#eab308'),
    ('skin_archon', 'ARCHON CHROME PHANTOM', 'skin', 'Mirror-polished liquid chrome rig with void-violet energy conduits.', NULL, NULL, NULL, 0, 15, 1, '#c084fc'),
    ('skin_sovereign', 'SOVEREIGN OBSIDIAN-GOLD', 'skin', 'Prestige syndicate commander armor forged in black obsidian and 24k gold.', NULL, NULL, NULL, 0, 40, 1, '#fbbf24'),

    -- 3D Melee Weapons (Attached to Hand_R bone)
    ('weapon_baton', 'STUN BATON', 'weapon', 'Standard high-voltage kinetic baton.', NULL, NULL, NULL, 0, 0, 1, '#38bdf8'),
    ('weapon_tonfa', 'TWIN PLASMA TONFA', 'weapon', 'Dual-arc plasma blades with rapid slash recovery.', NULL, NULL, NULL, 600, 0, 2, '#2dd4bf'),
    ('weapon_cleaver', 'HEAVY RELIC CLEAVER', 'weapon', 'Industrial armor-splitting blade with orange thermal sparks.', NULL, NULL, NULL, 1500, 0, 3, '#fb923c'),
    ('weapon_katana', 'SINGULARITY KATANA', 'weapon', 'Prestige zero-point blade that carves distortion ribbons across time.', NULL, NULL, NULL, 0, 20, 1, '#e879f9'),

    -- Echo Hologram Shaders
    ('shader_cyan', 'CYAN GRID HOLOGRAM', 'echo_shader', 'Standard tactical cyan scanline projection for past Echoes.', NULL, NULL, NULL, 0, 0, 1, '#06b6d4'),
    ('shader_solar', 'SOLAR EMBER ECHOES', 'echo_shader', 'Radiant gold-amber hologram clones leaving ember floor vectors.', NULL, NULL, NULL, 800, 0, 2, '#f59e0b'),
    ('shader_matrix', 'MATRIX WIREFRAME', 'echo_shader', 'High-frequency phosphor green digital ghost projection.', NULL, NULL, NULL, 1800, 0, 4, '#22c55e'),
    ('shader_astral', 'ASTRAL SUPERNOVA', 'echo_shader', 'Prestige deep-space nebula hologram with harmonic rewind chords.', NULL, NULL, NULL, 0, 25, 1, '#818cf8')
ON CONFLICT (item_id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    passive_desc = EXCLUDED.passive_desc,
    gadget_desc = EXCLUDED.gadget_desc,
    tradeoff_desc = EXCLUDED.tradeoff_desc,
    cost_gold = EXCLUDED.cost_gold,
    cost_udao = EXCLUDED.cost_udao;

-- 4. PLAYER INVENTORY
CREATE TABLE IF NOT EXISTS public.player_inventory (
    wallet_address TEXT NOT NULL REFERENCES public.arcade_vaults(wallet_address) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES public.market_catalog(item_id) ON DELETE CASCADE,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (wallet_address, item_id)
);

-- 5. VAULT TRANSACTIONS LEDGER
CREATE TABLE IF NOT EXISTS public.vault_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL,
    tx_type TEXT NOT NULL CHECK (tx_type IN ('deposit', 'withdraw', 'duel_escrow', 'duel_win', 'treasury_rake', 'referral_reward', 'market_purchase', 'contract_reward')),
    amount_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    amount_gold INTEGER NOT NULL DEFAULT 0,
    reference_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. SYNDICATE CONTRACT BOSS LADDER & HEIST SEEDS
CREATE TABLE IF NOT EXISTS public.syndicate_contracts (
    contract_tier INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    boss_callsign TEXT NOT NULL,
    sector_id INTEGER NOT NULL DEFAULT 1,
    sector_name TEXT NOT NULL,
    target_score INTEGER NOT NULL,
    reward_gold INTEGER NOT NULL,
    reward_xp INTEGER NOT NULL,
    unlocks_class TEXT REFERENCES public.market_catalog(item_id),
    boss_crew JSONB NOT NULL,
    boss_loadout JSONB NOT NULL,
    seed_config JSONB NOT NULL
);

INSERT INTO public.syndicate_contracts (contract_tier, title, boss_callsign, sector_id, sector_name, target_score, reward_gold, reward_xp, unlocks_class, boss_crew, boss_loadout, seed_config)
VALUES
    (1, 'CONTRACT I: CRYO CONTAINMENT BREACH', 'VEX // CRYO ROOKIES', 1, 'SECTOR I: CRYO CONTAINMENT', 350, 200, 150, 'tech_hacker',
     '["infiltrator","infiltrator","infiltrator","infiltrator"]'::jsonb,
     '{"skin_id":"skin_standard","weapon_id":"weapon_baton","echo_shader_id":"shader_cyan"}'::jsonb,
     '{"seed":101,"droneSpeed":1.0,"padDecay":2.0,"hasRicochetWalls":false}'::jsonb),
    (2, 'CONTRACT II: SWITCHBLADE LASER RELAY', 'KIRA // CIRCUIT BREAKER', 1, 'SECTOR I: CRYO CONTAINMENT', 500, 350, 250, 'grav_runner',
     '["tech_hacker","infiltrator","infiltrator","tech_hacker"]'::jsonb,
     '{"skin_id":"skin_specops","weapon_id":"weapon_tonfa","echo_shader_id":"shader_solar"}'::jsonb,
     '{"seed":202,"droneSpeed":1.15,"padDecay":2.0,"hasRicochetWalls":false}'::jsonb),
    (3, 'CONTRACT III: THE ALLEY-OOP TWINS', 'AXEL & NYX // GRAV SYNDICATE', 2, 'SECTOR II: REACTOR CORE', 650, 500, 400, 'phase_phantom',
     '["tech_hacker","grav_runner","grav_runner","infiltrator"]'::jsonb,
     '{"skin_id":"skin_hazard","weapon_id":"weapon_tonfa","echo_shader_id":"shader_solar"}'::jsonb,
     '{"seed":303,"droneSpeed":1.25,"padDecay":1.8,"hasRicochetWalls":true}'::jsonb),
    (4, 'CONTRACT IV: IRON PHALANX GARRISON', 'WARDEN KRON // HEAVY GUARD', 2, 'SECTOR II: REACTOR CORE', 800, 750, 600, 'enforcer',
     '["tech_hacker","phase_phantom","grav_runner","enforcer"]'::jsonb,
     '{"skin_id":"skin_archon","weapon_id":"weapon_cleaver","echo_shader_id":"shader_matrix"}'::jsonb,
     '{"seed":404,"droneSpeed":1.35,"padDecay":1.6,"hasRicochetWalls":true}'::jsonb),
    (5, 'CONTRACT V: THE PARADOX ARCHITECT', 'ZERO // CHRONO SOVEREIGN', 3, 'SECTOR III: SINGULARITY VAULT', 950, 1200, 1000, NULL,
     '["tech_hacker","phase_phantom","grav_runner","enforcer"]'::jsonb,
     '{"skin_id":"skin_sovereign","weapon_id":"weapon_katana","echo_shader_id":"shader_astral"}'::jsonb,
     '{"seed":505,"droneSpeed":1.5,"padDecay":1.5,"hasRicochetWalls":true}'::jsonb)
ON CONFLICT (contract_tier) DO UPDATE SET
    title = EXCLUDED.title,
    target_score = EXCLUDED.target_score,
    reward_gold = EXCLUDED.reward_gold;

-- 7. DUEL MATCHES & WANTED BOUNTY TIMELINES
CREATE TABLE IF NOT EXISTS public.duel_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode TEXT NOT NULL CHECK (mode IN ('contract', 'free_pvp', 'staked_duel')),
    sector_id INTEGER NOT NULL DEFAULT 1,
    seed_number INTEGER NOT NULL DEFAULT 101,
    contract_tier INTEGER DEFAULT 1,
    stake_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    raider_wallet TEXT NOT NULL,
    raider_callsign TEXT NOT NULL DEFAULT 'RAIDER',
    raider_score INTEGER NOT NULL DEFAULT 0,
    raider_crew JSONB NOT NULL DEFAULT '["infiltrator","infiltrator","infiltrator","infiltrator"]'::jsonb,
    raider_loadout JSONB NOT NULL DEFAULT '{"skin_id":"skin_standard","weapon_id":"weapon_baton","echo_shader_id":"shader_cyan"}'::jsonb,
    raider_echo_frames JSONB NOT NULL DEFAULT '[]'::jsonb,
    challenger_wallet TEXT,
    challenger_callsign TEXT,
    challenger_score INTEGER,
    challenger_echo_frames JSONB,
    paradoxes_triggered INTEGER NOT NULL DEFAULT 0,
    alley_oops_landed INTEGER NOT NULL DEFAULT 0,
    winner_wallet TEXT,
    payout_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    treasury_cut_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    referral_cut_udao NUMERIC(18, 4) NOT NULL DEFAULT 0,
    wanted_stars INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open_bounty' CHECK (status IN ('in_progress', 'open_bounty', 'settled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);

-- Seed 3 initial Wanted Bounties so the Bounty Board is alive immediately
INSERT INTO public.duel_matches (id, mode, sector_id, seed_number, stake_udao, raider_wallet, raider_callsign, raider_score, raider_crew, raider_loadout, wanted_stars, status)
VALUES
    ('11111111-1111-4111-8111-111111111101', 'staked_duel', 1, 101, 10, '0x71C95911E9a5D330f4D621842EC243EE1343292e', 'VALKYRIE_99', 550,
     '["tech_hacker","grav_runner","infiltrator","enforcer"]'::jsonb,
     '{"skin_id":"skin_specops","weapon_id":"weapon_tonfa","echo_shader_id":"shader_solar"}'::jsonb, 2, 'open_bounty'),
    ('11111111-1111-4111-8111-111111111102', 'staked_duel', 2, 303, 25, '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', 'CHRONO_GHOST', 720,
     '["tech_hacker","phase_phantom","grav_runner","enforcer"]'::jsonb,
     '{"skin_id":"skin_archon","weapon_id":"weapon_katana","echo_shader_id":"shader_matrix"}'::jsonb, 4, 'open_bounty'),
    ('11111111-1111-4111-8111-111111111103', 'free_pvp', 1, 202, 0, '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'NEON_BLADE', 450,
     '["infiltrator","grav_runner","infiltrator","tech_hacker"]'::jsonb,
     '{"skin_id":"skin_hazard","weapon_id":"weapon_cleaver","echo_shader_id":"shader_cyan"}'::jsonb, 1, 'open_bounty')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ATOMIC RPC FUNCTIONS
-- ============================================================================

-- RPC 1: Get or Create Operative Profile + Inventory
CREATE OR REPLACE FUNCTION public.get_or_create_operative(
    p_wallet TEXT,
    p_callsign TEXT DEFAULT NULL,
    p_referrer TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vault public.arcade_vaults%ROWTYPE;
    v_items JSONB;
BEGIN
    INSERT INTO public.arcade_vaults (wallet_address, callsign, referred_by)
    VALUES (
        LOWER(p_wallet),
        COALESCE(NULLIF(TRIM(p_callsign), ''), 'OP_' || UPPER(SUBSTRING(MD5(LOWER(p_wallet)) FROM 1 FOR 5))),
        CASE WHEN p_referrer IS NOT NULL AND LOWER(p_referrer) <> LOWER(p_wallet) THEN LOWER(p_referrer) ELSE NULL END
    )
    ON CONFLICT (wallet_address) DO UPDATE SET
        updated_at = NOW()
    RETURNING * INTO v_vault;

    -- Ensure starter items exist in player_inventory
    INSERT INTO public.player_inventory (wallet_address, item_id)
    VALUES
        (v_vault.wallet_address, 'infiltrator'),
        (v_vault.wallet_address, 'skin_standard'),
        (v_vault.wallet_address, 'weapon_baton'),
        (v_vault.wallet_address, 'shader_cyan')
    ON CONFLICT DO NOTHING;

    SELECT COALESCE(jsonb_agg(item_id), '[]'::jsonb)
    INTO v_items
    FROM public.player_inventory
    WHERE wallet_address = v_vault.wallet_address;

    RETURN jsonb_build_object(
        'profile', row_to_json(v_vault),
        'owned_items', v_items
    );
END;
$$;

-- RPC 2: Deposit $UDAO into Session Arcade Vault
CREATE OR REPLACE FUNCTION public.deposit_udao_vault(
    p_wallet TEXT,
    p_amount NUMERIC,
    p_tx_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vault public.arcade_vaults%ROWTYPE;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Deposit amount must be positive';
    END IF;

    PERFORM public.get_or_create_operative(p_wallet);

    UPDATE public.arcade_vaults
    SET session_udao = session_udao + p_amount,
        updated_at = NOW()
    WHERE wallet_address = LOWER(p_wallet)
    RETURNING * INTO v_vault;

    INSERT INTO public.vault_transactions (wallet_address, tx_type, amount_udao, reference_id)
    VALUES (LOWER(p_wallet), 'deposit', p_amount, COALESCE(p_tx_hash, 'session_topup'));

    RETURN row_to_json(v_vault)::jsonb;
END;
$$;

-- RPC 3: Withdraw $UDAO from Session Arcade Vault
CREATE OR REPLACE FUNCTION public.withdraw_udao_vault(
    p_wallet TEXT,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vault public.arcade_vaults%ROWTYPE;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdraw amount must be positive';
    END IF;

    UPDATE public.arcade_vaults
    SET session_udao = session_udao - p_amount,
        updated_at = NOW()
    WHERE wallet_address = LOWER(p_wallet) AND session_udao >= p_amount
    RETURNING * INTO v_vault;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient session $UDAO balance';
    END IF;

    INSERT INTO public.vault_transactions (wallet_address, tx_type, amount_udao, reference_id)
    VALUES (LOWER(p_wallet), 'withdraw', -p_amount, 'polygon_withdraw');

    RETURN row_to_json(v_vault)::jsonb;
END;
$$;

-- RPC 4: Purchase & Equip Item or 4-Loop Crew Class
CREATE OR REPLACE FUNCTION public.purchase_and_equip_item(
    p_wallet TEXT,
    p_item_id TEXT,
    p_loop_slot INTEGER DEFAULT NULL -- 0..3 if assigning a crew_class to a specific loop
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vault public.arcade_vaults%ROWTYPE;
    v_item public.market_catalog%ROWTYPE;
    v_already_owned BOOLEAN;
    v_treasury_cut NUMERIC(18, 4);
    v_ref_cut NUMERIC(18, 4);
    v_bounty_cut NUMERIC(18, 4);
    v_new_crew JSONB;
    v_new_loadout JSONB;
    v_owned JSONB;
BEGIN
    PERFORM public.get_or_create_operative(p_wallet);

    SELECT * INTO v_item FROM public.market_catalog WHERE item_id = p_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found in catalog';
    END IF;

    SELECT * INTO v_vault FROM public.arcade_vaults WHERE wallet_address = LOWER(p_wallet) FOR UPDATE;

    SELECT EXISTS(
        SELECT 1 FROM public.player_inventory
        WHERE wallet_address = v_vault.wallet_address AND item_id = p_item_id
    ) INTO v_already_owned;

    -- Purchase if not yet owned
    IF NOT v_already_owned THEN
        IF v_item.cost_gold > 0 THEN
            IF v_vault.chrono_gold < v_item.cost_gold THEN
                RAISE EXCEPTION 'Insufficient Chrono Gold (Need % GOLD)', v_item.cost_gold;
            END IF;
            UPDATE public.arcade_vaults
            SET chrono_gold = chrono_gold - v_item.cost_gold
            WHERE wallet_address = v_vault.wallet_address
            RETURNING * INTO v_vault;

            INSERT INTO public.vault_transactions (wallet_address, tx_type, amount_gold, reference_id)
            VALUES (v_vault.wallet_address, 'market_purchase', -v_item.cost_gold, p_item_id);

        ELSIF v_item.cost_udao > 0 THEN
            IF v_vault.session_udao < v_item.cost_udao THEN
                RAISE EXCEPTION 'Insufficient Session $UDAO (Need % $UDAO)', v_item.cost_udao;
            END IF;

            -- 80% Treasury, 10% Referrer, 10% Bounty Jackpot Pool
            v_treasury_cut := ROUND(v_item.cost_udao * 0.80, 4);
            v_ref_cut := ROUND(v_item.cost_udao * 0.10, 4);
            v_bounty_cut := v_item.cost_udao - v_treasury_cut - v_ref_cut;

            UPDATE public.arcade_vaults
            SET session_udao = session_udao - v_item.cost_udao
            WHERE wallet_address = v_vault.wallet_address
            RETURNING * INTO v_vault;

            IF v_vault.referred_by IS NOT NULL THEN
                UPDATE public.arcade_vaults
                SET session_udao = session_udao + v_ref_cut,
                    referral_earnings_udao = referral_earnings_udao + v_ref_cut
                WHERE wallet_address = v_vault.referred_by;
            ELSE
                v_treasury_cut := v_treasury_cut + v_ref_cut;
                v_ref_cut := 0;
            END IF;

            UPDATE public.protocol_treasury
            SET total_treasury_udao = total_treasury_udao + v_treasury_cut,
                total_referral_udao = total_referral_udao + v_ref_cut,
                bounty_jackpot_udao = bounty_jackpot_udao + v_bounty_cut,
                updated_at = NOW()
            WHERE id = 1;

            INSERT INTO public.vault_transactions (wallet_address, tx_type, amount_udao, reference_id)
            VALUES (v_vault.wallet_address, 'market_purchase', -v_item.cost_udao, p_item_id);
        END IF;

        INSERT INTO public.player_inventory (wallet_address, item_id)
        VALUES (v_vault.wallet_address, p_item_id)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Equip item or assign crew class to loop slot
    v_new_crew := v_vault.crew_loadout;
    v_new_loadout := v_vault.equipped_loadout;

    IF v_item.category = 'crew_class' THEN
        IF p_loop_slot IS NOT NULL AND p_loop_slot BETWEEN 0 AND 3 THEN
            v_new_crew := jsonb_set(v_new_crew, ARRAY[p_loop_slot::text], to_jsonb(p_item_id));
        END IF;
        IF NOT (v_vault.unlocked_classes @> to_jsonb(p_item_id)) THEN
            UPDATE public.arcade_vaults
            SET unlocked_classes = unlocked_classes || to_jsonb(p_item_id)
            WHERE wallet_address = v_vault.wallet_address;
        END IF;
    ELSIF v_item.category = 'skin' THEN
        v_new_loadout := jsonb_set(v_new_loadout, '{skin_id}', to_jsonb(p_item_id));
    ELSIF v_item.category = 'weapon' THEN
        v_new_loadout := jsonb_set(v_new_loadout, '{weapon_id}', to_jsonb(p_item_id));
    ELSIF v_item.category = 'echo_shader' THEN
        v_new_loadout := jsonb_set(v_new_loadout, '{echo_shader_id}', to_jsonb(p_item_id));
    END IF;

    UPDATE public.arcade_vaults
    SET crew_loadout = v_new_crew,
        equipped_loadout = v_new_loadout,
        updated_at = NOW()
    WHERE wallet_address = v_vault.wallet_address
    RETURNING * INTO v_vault;

    SELECT COALESCE(jsonb_agg(item_id), '[]'::jsonb)
    INTO v_owned
    FROM public.player_inventory
    WHERE wallet_address = v_vault.wallet_address;

    RETURN jsonb_build_object(
        'profile', row_to_json(v_vault),
        'owned_items', v_owned
    );
END;
$$;

-- RPC 5: Complete Heist & Atomically Settle Staked Duel or Syndicate Contract
CREATE OR REPLACE FUNCTION public.submit_heist_and_settle(
    p_wallet TEXT,
    p_mode TEXT,                  -- 'contract', 'free_pvp', or 'staked_duel'
    p_target_duel_id UUID,        -- Optional existing open_bounty duel to challenge
    p_contract_tier INTEGER,      -- 1..5 when playing Syndicate Contract
    p_stake_udao NUMERIC,         -- 0 for free/contract, >0 for staked_duel
    p_score INTEGER,
    p_cores_extracted INTEGER,
    p_paradoxes INTEGER,
    p_alley_oops INTEGER,
    p_echo_frames JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vault public.arcade_vaults%ROWTYPE;
    v_contract public.syndicate_contracts%ROWTYPE;
    v_duel public.duel_matches%ROWTYPE;
    v_won BOOLEAN := FALSE;
    v_gold_earned INTEGER := 0;
    v_xp_earned INTEGER := 0;
    v_udao_Delta NUMERIC(18, 4) := 0;
    v_total_pot NUMERIC(18, 4) := 0;
    v_winner_payout NUMERIC(18, 4) := 0;
    v_treasury_cut NUMERIC(18, 4) := 0;
    v_ref_cut NUMERIC(18, 4) := 0;
    v_unlocked_class TEXT := NULL;
    v_new_rank INTEGER;
    v_new_tier INTEGER;
    v_outcome_label TEXT;
BEGIN
    PERFORM public.get_or_create_operative(p_wallet);
    SELECT * INTO v_vault FROM public.arcade_vaults WHERE wallet_address = LOWER(p_wallet) FOR UPDATE;

    -- Base Chrono Gold & XP from skilled actions (Alley-Oops + Paradox Shatters + Cores)
    v_gold_earned := GREATEST(35, (p_cores_extracted * 25) + (p_paradoxes * 40) + (p_alley_oops * 50));
    v_xp_earned := GREATEST(40, (p_cores_extracted * 20) + (p_paradoxes * 35) + (p_alley_oops * 45));

    -- MODE A: SYNDICATE CONTRACT LADDER (Free Play Progression -> Unlocks Classes & Sectors)
    IF p_mode = 'contract' THEN
        SELECT * INTO v_contract FROM public.syndicate_contracts WHERE contract_tier = COALESCE(p_contract_tier, 1);
        IF NOT FOUND THEN
            SELECT * INTO v_contract FROM public.syndicate_contracts WHERE contract_tier = 1;
        END IF;

        v_won := (p_score >= v_contract.target_score);

        IF v_won THEN
            v_gold_earned := v_gold_earned + v_contract.reward_gold;
            v_xp_earned := v_xp_earned + v_contract.reward_xp;
            v_outcome_label := 'CONTRACT CLEARED';

            -- Unlock next contract tier & class rig if applicable
            IF v_contract.unlocks_class IS NOT NULL THEN
                INSERT INTO public.player_inventory (wallet_address, item_id)
                VALUES (v_vault.wallet_address, v_contract.unlocks_class)
                ON CONFLICT DO NOTHING;

                IF NOT (v_vault.unlocked_classes @> to_jsonb(v_contract.unlocks_class)) THEN
                    v_unlocked_class := v_contract.unlocks_class;
                    v_vault.unlocked_classes := v_vault.unlocked_classes || to_jsonb(v_contract.unlocks_class);
                END IF;
            END IF;
        ELSE
            v_outcome_label := 'CONTRACT FAILED — TARGET NOT MET';
        END IF;

        v_new_tier := CASE
            WHEN v_won AND v_vault.contract_tier_unlocked <= v_contract.contract_tier
            THEN LEAST(5, v_contract.contract_tier + 1)
            ELSE v_vault.contract_tier_unlocked
        END;

        v_new_rank := 1 + ((v_vault.clearance_xp + v_xp_earned) / 250);

        UPDATE public.arcade_vaults
        SET chrono_gold = chrono_gold + v_gold_earned,
            clearance_xp = clearance_xp + v_xp_earned,
            clearance_rank = v_new_rank,
            contract_tier_unlocked = v_new_tier,
            unlocked_classes = v_vault.unlocked_classes,
            wins = wins + (CASE WHEN v_won THEN 1 ELSE 0 END),
            losses = losses + (CASE WHEN v_won THEN 0 ELSE 1 END),
            paradoxes_triggered = paradoxes_triggered + p_paradoxes,
            alley_oops_landed = alley_oops_landed + p_alley_oops,
            updated_at = NOW()
        WHERE wallet_address = v_vault.wallet_address
        RETURNING * INTO v_vault;

        RETURN jsonb_build_object(
            'won', v_won,
            'outcome', v_outcome_label,
            'player_score', p_score,
            'rival_score', v_contract.target_score,
            'gold_earned', v_gold_earned,
            'xp_earned', v_xp_earned,
            'udao_delta', 0,
            'unlocked_class', v_unlocked_class,
            'profile', row_to_json(v_vault)
        );
    END IF;

    -- MODE B: STAKED $UDAO PVP DUEL OR FREE PVP BOUNTY
    IF p_mode = 'staked_duel' AND p_stake_udao > 0 THEN
        IF v_vault.session_udao < p_stake_udao THEN
            RAISE EXCEPTION 'Insufficient Session $UDAO for % $UDAO Duel Stake', p_stake_udao;
        END IF;

        -- Deduct player stake first
        UPDATE public.arcade_vaults
        SET session_udao = session_udao - p_stake_udao
        WHERE wallet_address = v_vault.wallet_address
        RETURNING * INTO v_vault;

        v_udao_Delta := -p_stake_udao;
    END IF;

    -- Check if challenging an existing open Wanted Bounty
    IF p_target_duel_id IS NOT NULL THEN
        SELECT * INTO v_duel FROM public.duel_matches
        WHERE id = p_target_duel_id AND status = 'open_bounty'
        FOR UPDATE;
    END IF;

    IF FOUND THEN
        -- Challenger (Player 2) vs Recorded Raider (Player 1)
        v_won := (p_score >= v_duel.raider_score);
        v_total_pot := v_duel.stake_udao * 2;

        IF v_duel.stake_udao > 0 THEN
            -- Exact 10% House Rake: 8% Treasury, 2% Referrals, 90% Winner
            v_treasury_cut := ROUND(v_total_pot * 0.08, 4);
            v_ref_cut := ROUND(v_total_pot * 0.02, 4);
            v_winner_payout := v_total_pot - v_treasury_cut - v_ref_cut;

            IF v_won THEN
                UPDATE public.arcade_vaults
                SET session_udao = session_udao + v_winner_payout,
                    wanted_heat = wanted_heat + 1
                WHERE wallet_address = v_vault.wallet_address
                RETURNING * INTO v_vault;

                v_udao_Delta := v_winner_payout - p_stake_udao;
                v_outcome_label := 'TIMELINE SHATTERED — BOUNTY CLAIMED';

                -- Post Challenger's winning timeline as the new Wanted Bounty!
                INSERT INTO public.duel_matches (
                    mode, sector_id, seed_number, stake_udao, raider_wallet, raider_callsign,
                    raider_score, raider_crew, raider_loadout, raider_echo_frames, wanted_stars, status
                ) VALUES (
                    p_mode, v_duel.sector_id, v_duel.seed_number, v_duel.stake_udao,
                    v_vault.wallet_address, v_vault.callsign, GREATEST(p_score, 400),
                    v_vault.crew_loadout, v_vault.equipped_loadout, COALESCE(p_echo_frames, '[]'::jsonb),
                    LEAST(5, v_duel.wanted_stars + 1), 'open_bounty'
                );
            ELSE
                -- Raider defended their timeline! Credit Raider if registered in arcade_vaults
                UPDATE public.arcade_vaults
                SET session_udao = session_udao + v_winner_payout,
                    wanted_heat = LEAST(5, wanted_heat + 1),
                    wins = wins + 1
                WHERE wallet_address = LOWER(v_duel.raider_wallet);

                -- Keep Raider's bounty alive with +1 Wanted Star
                UPDATE public.duel_matches
                SET wanted_stars = LEAST(5, wanted_stars + 1)
                WHERE id = v_duel.id;

                v_outcome_label := 'RAID REPELLED BY RIVAL ECHOES';
            END IF;

            -- Route 2% Referral Cut
            IF v_vault.referred_by IS NOT NULL THEN
                UPDATE public.arcade_vaults
                SET session_udao = session_udao + v_ref_cut,
                    referral_earnings_udao = referral_earnings_udao + v_ref_cut
                WHERE wallet_address = v_vault.referred_by;
            ELSE
                v_treasury_cut := v_treasury_cut + v_ref_cut;
                v_ref_cut := 0;
            END IF;

            -- Route 8% Treasury Cut
            UPDATE public.protocol_treasury
            SET total_treasury_udao = total_treasury_udao + v_treasury_cut,
                total_referral_udao = total_referral_udao + v_ref_cut,
                total_duels_settled = total_duels_settled + 1,
                updated_at = NOW()
            WHERE id = 1;
        ELSE
            -- Free PvP Bounty Mode (Chrono Gold Only — Zero Unbacked $UDAO)
            IF v_won THEN
                v_gold_earned := v_gold_earned + 150;
                v_outcome_label := 'FREE DUEL VICTORY';
            ELSE
                v_outcome_label := 'FREE DUEL DEFEAT';
            END IF;
        END IF;

        -- Update progression stats for Challenger
        v_new_rank := 1 + ((v_vault.clearance_xp + v_xp_earned) / 250);
        UPDATE public.arcade_vaults
        SET chrono_gold = chrono_gold + v_gold_earned,
            clearance_xp = clearance_xp + v_xp_earned,
            clearance_rank = v_new_rank,
            wins = wins + (CASE WHEN v_won THEN 1 ELSE 0 END),
            losses = losses + (CASE WHEN v_won THEN 0 ELSE 1 END),
            paradoxes_triggered = paradoxes_triggered + p_paradoxes,
            alley_oops_landed = alley_oops_landed + p_alley_oops,
            updated_at = NOW()
        WHERE wallet_address = v_vault.wallet_address
        RETURNING * INTO v_vault;

        RETURN jsonb_build_object(
            'won', v_won,
            'outcome', v_outcome_label,
            'player_score', p_score,
            'rival_score', v_duel.raider_score,
            'gold_earned', v_gold_earned,
            'xp_earned', v_xp_earned,
            'udao_delta', v_udao_Delta,
            'winner_payout_udao', v_winner_payout,
            'treasury_cut_udao', v_treasury_cut,
            'referral_cut_udao', v_ref_cut,
            'profile', row_to_json(v_vault)
        );
    ELSE
        -- Player 1 (Raider) setting a brand-new Wanted Bounty Benchmark!
        INSERT INTO public.duel_matches (
            mode, sector_id, seed_number, stake_udao, raider_wallet, raider_callsign,
            raider_score, raider_crew, raider_loadout, raider_echo_frames, wanted_stars, status
        ) VALUES (
            p_mode, 1, 101, COALESCE(p_stake_udao, 0),
            v_vault.wallet_address, v_vault.callsign, p_score,
            v_vault.crew_loadout, v_vault.equipped_loadout, COALESCE(p_echo_frames, '[]'::jsonb),
            1, 'open_bounty'
        ) RETURNING * INTO v_duel;

        v_new_rank := 1 + ((v_vault.clearance_xp + v_xp_earned) / 250);
        UPDATE public.arcade_vaults
        SET chrono_gold = chrono_gold + v_gold_earned,
            clearance_xp = clearance_xp + v_xp_earned,
            clearance_rank = v_new_rank,
            wanted_heat = LEAST(5, wanted_heat + 1),
            paradoxes_triggered = paradoxes_triggered + p_paradoxes,
            alley_oops_landed = alley_oops_landed + p_alley_oops,
            updated_at = NOW()
        WHERE wallet_address = v_vault.wallet_address
        RETURNING * INTO v_vault;

        RETURN jsonb_build_object(
            'won', TRUE,
            'outcome', 'WANTED TIMELINE RECORDED & POSTED',
            'player_score', p_score,
            'rival_score', 0,
            'gold_earned', v_gold_earned,
            'xp_earned', v_xp_earned,
            'udao_delta', v_udao_Delta,
            'duel_id', v_duel.id,
            'profile', row_to_json(v_vault)
        );
    END IF;
END;
$$;

-- Enable Row Level Security with public read & RPC write access
ALTER TABLE public.protocol_treasury ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syndicate_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duel_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read protocol_treasury" ON public.protocol_treasury;
CREATE POLICY "Public read protocol_treasury" ON public.protocol_treasury FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read arcade_vaults" ON public.arcade_vaults;
CREATE POLICY "Public read arcade_vaults" ON public.arcade_vaults FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read market_catalog" ON public.market_catalog;
CREATE POLICY "Public read market_catalog" ON public.market_catalog FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read player_inventory" ON public.player_inventory;
CREATE POLICY "Public read player_inventory" ON public.player_inventory FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read vault_transactions" ON public.vault_transactions;
CREATE POLICY "Public read vault_transactions" ON public.vault_transactions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read syndicate_contracts" ON public.syndicate_contracts;
CREATE POLICY "Public read syndicate_contracts" ON public.syndicate_contracts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read duel_matches" ON public.duel_matches;
CREATE POLICY "Public read duel_matches" ON public.duel_matches FOR SELECT USING (true);
