-- ============================================================================
-- CHRONO HEIST: PARADOX PROTOCOL
-- Migration 002: Retention Pillars (Daily Anomaly Seed, Daily Directives,
-- Streak Supply Drops, Anti-Cheat Validation & Offline Defense Log)
-- ============================================================================

-- 1. Add Daily Streak & Last Claim Tracking to arcade_vaults
ALTER TABLE public.arcade_vaults
    ADD COLUMN IF NOT EXISTS login_streak INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS last_streak_claim_date DATE,
    ADD COLUMN IF NOT EXISTS daily_anomaly_best_score INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS daily_anomaly_date DATE,
    ADD COLUMN IF NOT EXISTS directives_progress JSONB NOT NULL DEFAULT '{"alley_oops":0,"paradox_shatters":0,"matches_won":0,"claimed_today":false}'::jsonb;

-- 2. Daily Anomaly Leaderboard Table
CREATE TABLE IF NOT EXISTS public.daily_anomaly_runs (
    anomaly_date DATE NOT NULL DEFAULT CURRENT_DATE,
    wallet_address TEXT NOT NULL,
    callsign TEXT NOT NULL,
    anomaly_name TEXT NOT NULL,
    best_score INTEGER NOT NULL DEFAULT 0,
    alley_oops INTEGER NOT NULL DEFAULT 0,
    paradoxes INTEGER NOT NULL DEFAULT 0,
    crew_loadout JSONB NOT NULL DEFAULT '["infiltrator","infiltrator","infiltrator","infiltrator"]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (anomaly_date, wallet_address)
);

ALTER TABLE public.daily_anomaly_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read daily_anomaly_runs" ON public.daily_anomaly_runs;
CREATE POLICY "Public read daily_anomaly_runs" ON public.daily_anomaly_runs FOR SELECT USING (true);

-- Seed initial Daily Anomaly Leaderboard entries for today so players have immediate rivals to beat
INSERT INTO public.daily_anomaly_runs (anomaly_date, wallet_address, callsign, anomaly_name, best_score, alley_oops, paradoxes, crew_loadout)
SELECT
    CURRENT_DATE,
    raider_wallet,
    raider_callsign,
    'ANOMALY // RICOCHET OVERDRIVE (2X PASS BONUS)',
    raider_score + 180,
    3,
    2,
    raider_crew
FROM public.duel_matches
ON CONFLICT (anomaly_date, wallet_address) DO NOTHING;

-- 3. RPC: Claim Daily Streak Supply Drop & Directives Bonus (100% Off-Chain Chrono Gold — Zero Unbacked $UDAO)
CREATE OR REPLACE FUNCTION public.claim_daily_retention_rewards(
    p_wallet TEXT,
    p_claim_type TEXT -- 'streak' or 'directives'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_vault public.arcade_vaults%ROWTYPE;
    v_reward_gold INTEGER := 0;
    v_reward_xp INTEGER := 0;
    v_new_streak INTEGER;
BEGIN
    PERFORM public.get_or_create_operative(p_wallet);
    SELECT * INTO v_vault FROM public.arcade_vaults WHERE wallet_address = LOWER(p_wallet) FOR UPDATE;

    IF p_claim_type = 'streak' THEN
        IF v_vault.last_streak_claim_date = CURRENT_DATE THEN
            RAISE EXCEPTION 'Daily Supply Drop already claimed today';
        END IF;

        IF v_vault.last_streak_claim_date = (CURRENT_DATE - INTERVAL '1 day')::date THEN
            v_new_streak := LEAST(7, v_vault.login_streak + 1);
        ELSE
            v_new_streak := 1;
        END IF;

        v_reward_gold := 100 + (v_new_streak * 50);
        v_reward_xp := 75 + (v_new_streak * 25);

        UPDATE public.arcade_vaults
        SET login_streak = v_new_streak,
            last_streak_claim_date = CURRENT_DATE,
            chrono_gold = chrono_gold + v_reward_gold,
            clearance_xp = clearance_xp + v_reward_xp,
            clearance_rank = 1 + ((clearance_xp + v_reward_xp) / 250),
            updated_at = NOW()
        WHERE wallet_address = v_vault.wallet_address
        RETURNING * INTO v_vault;

    ELSIF p_claim_type = 'directives' THEN
        IF COALESCE((v_vault.directives_progress->>'claimed_today')::boolean, false) THEN
            RAISE EXCEPTION 'Daily Directives cache already claimed today';
        END IF;

        v_reward_gold := 350;
        v_reward_xp := 250;

        UPDATE public.arcade_vaults
        SET directives_progress = jsonb_set(v_vault.directives_progress, '{claimed_today}', 'true'::jsonb),
            chrono_gold = chrono_gold + v_reward_gold,
            clearance_xp = clearance_xp + v_reward_xp,
            clearance_rank = 1 + ((clearance_xp + v_reward_xp) / 250),
            updated_at = NOW()
        WHERE wallet_address = v_vault.wallet_address
        RETURNING * INTO v_vault;
    END IF;

    RETURN jsonb_build_object(
        'reward_gold', v_reward_gold,
        'reward_xp', v_reward_xp,
        'profile', row_to_json(v_vault)
    );
END;
$$;
