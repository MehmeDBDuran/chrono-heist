import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://mlfeemfaorwowolpteqr.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sZmVlbWZhb3J3b3dvbHB0ZXFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzE2OTQsImV4cCI6MjEwNzkwNzY5NH0.a8gXjNlZ1FvWuEhOCvdVA_0_1tl7C5r1WeY4L1R_SKA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface OperativeProfile {
  wallet_address: string;
  callsign: string;
  session_udao: number;
  chrono_gold: number;
  clearance_xp: number;
  clearance_rank: number;
  contract_tier_unlocked: number;
  wanted_heat: number;
  unlocked_classes: string[];
  crew_loadout: string[];
  equipped_loadout: {
    skin_id: string;
    weapon_id: string;
    echo_shader_id: string;
  };
  referred_by: string | null;
  referral_earnings_udao: number;
  wins: number;
  losses: number;
  paradoxes_triggered: number;
  alley_oops_landed: number;
  login_streak?: number;
  last_streak_claim_date?: string | null;
  directives_progress?: {
    alley_oops: number;
    paradox_shatters: number;
    matches_won: number;
    claimed_today: boolean;
  };
}

export interface MarketItem {
  item_id: string;
  name: string;
  category: "crew_class" | "skin" | "weapon" | "echo_shader";
  description: string;
  passive_desc: string | null;
  gadget_desc: string | null;
  tradeoff_desc: string | null;
  cost_gold: number;
  cost_udao: number;
  required_rank: number;
  preview_color: string;
}

export interface SyndicateContract {
  contract_tier: number;
  title: string;
  boss_callsign: string;
  sector_id: number;
  sector_name: string;
  target_score: number;
  reward_gold: number;
  reward_xp: number;
  unlocks_class: string | null;
  boss_crew: string[];
}

export interface WantedBountyDuel {
  id: string;
  mode: string;
  sector_id: number;
  seed_number: number;
  stake_udao: number;
  raider_wallet: string;
  raider_callsign: string;
  raider_score: number;
  raider_crew: string[];
  raider_loadout: {
    skin_id: string;
    weapon_id: string;
    echo_shader_id: string;
  };
  wanted_stars: number;
  status: string;
  created_at: string;
}
