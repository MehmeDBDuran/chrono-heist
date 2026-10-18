"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  supabase,
  OperativeProfile,
  MarketItem,
  SyndicateContract,
  WantedBountyDuel,
} from "@/lib/supabase/client";
import {
  connectPolygonWallet,
  getOrGenerateGuestWallet,
  formatShortWallet,
  UDAO_CONTRACT_ADDRESS,
} from "@/lib/web3/udaoVault";
import { chronoSynth } from "@/lib/audio/chronoSynth";

interface UnityInstance {
  SendMessage: (obj: string, method: string, param?: string | number) => void;
  Quit?: () => Promise<void>;
}

interface HudTelemetry {
  isRunning: boolean;
  isRewinding: boolean;
  isTutorial: boolean;
  loop: number;
  timeLeft: number;
  playerScore: number;
  rivalScore: number;
  carryingCore: boolean;
  dashReady: boolean;
  gadgetReady: boolean;
  cameraMode: string;
  rigClass: string;
  microCue: string;
  eventBanner: string;
  paradoxes: number;
  alleyOops: number;
}

interface MatchSettlementSummary {
  won: boolean;
  outcome: string;
  player_score: number;
  rival_score: number;
  gold_earned: number;
  xp_earned: number;
  udao_delta: number;
  winner_payout_udao?: number;
  treasury_cut_udao?: number;
  referral_cut_udao?: number;
  unlocked_class?: string | null;
}

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: Record<string, unknown>,
      onProgress?: (p: number) => void
    ) => Promise<UnityInstance>;
    ChronoHeistHost?: {
      onUnityReady: () => void;
      onSynthTrigger: (eventName: string, intensity: number) => void;
      onHudTelemetry: (jsonStr: string) => void;
      onMatchComplete: (jsonStr: string) => void;
    };
  }
}

const DEFAULT_TELEMETRY: HudTelemetry = {
  isRunning: false,
  isRewinding: false,
  isTutorial: false,
  loop: 1,
  timeLeft: 15.0,
  playerScore: 0,
  rivalScore: 350,
  carryingCore: false,
  dashReady: true,
  gadgetReady: true,
  cameraMode: "TACTICAL 46°",
  rigClass: "infiltrator",
  microCue: "",
  eventBanner: "",
  paradoxes: 0,
  alleyOops: 0,
};

export default function ChronoHeistApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unityRef = useRef<UnityInstance | null>(null);
  const vaultDialogRef = useRef<HTMLDialogElement | null>(null);

  // Unity Loading & Telemetry State
  const [unityLoadProgress, setUnityLoadProgress] = useState<number>(0);
  const [isUnityReady, setIsUnityReady] = useState<boolean>(false);
  const [hud, setHud] = useState<HudTelemetry>(DEFAULT_TELEMETRY);

  // Player Profile & Supabase Data
  const [wallet, setWallet] = useState<string>("");
  const [isLiveWallet, setIsLiveWallet] = useState<boolean>(false);
  const [profile, setProfile] = useState<OperativeProfile | null>(null);
  const [ownedItems, setOwnedItems] = useState<string[]>([
    "infiltrator",
    "skin_standard",
    "weapon_baton",
    "shader_cyan",
  ]);
  const [catalog, setCatalog] = useState<MarketItem[]>([]);
  const [contracts, setContracts] = useState<SyndicateContract[]>([]);
  const [bounties, setBounties] = useState<WantedBountyDuel[]>([]);
  const [anomalyLeaders, setAnomalyLeaders] = useState<
    Array<{ callsign: string; best_score: number; alley_oops: number }>
  >([]);

  // Navigation & Match Selection State
  const [activeDockTab, setActiveDockTab] = useState<
    "contracts" | "bounties" | "armory" | "daily"
  >("contracts");
  const [selectedContractTier, setSelectedContractTier] = useState<number>(1);
  const [selectedBountyId, setSelectedBountyId] = useState<string | null>(null);
  const [selectedStakeUdao, setSelectedStakeUdao] = useState<number>(10);
  const [focusedLoopSlot, setFocusedLoopSlot] = useState<number>(0);
  const [armoryCategory, setArmoryCategory] = useState<
    "crew_class" | "skin" | "weapon" | "echo_shader"
  >("crew_class");

  // Onboarding & Tutorial State
  const [showInitiationPrompt, setShowInitiationPrompt] =
    useState<boolean>(false);
  const [tourStep, setTourStep] = useState<number>(0); // 0=hidden, 1=click armory, 2=assign L1, 3=deploy
  const [statusBanner, setStatusBanner] = useState<string>("");
  const [settlementModal, setSettlementModal] =
    useState<MatchSettlementSummary | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [depositAmount, setDepositAmount] = useState<string>("50");

  // Track active match parameters for settlement when Unity finishes 4 loops
  const activeMatchMetaRef = useRef<{
    mode: "contract" | "free_pvp" | "staked_duel";
    targetDuelId: string | null;
    contractTier: number;
    stakeUdao: number;
    isAnomaly: boolean;
  }>({
    mode: "contract",
    targetDuelId: null,
    contractTier: 1,
    stakeUdao: 0,
    isAnomaly: false,
  });

  const flashBanner = useCallback((msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => {
      setStatusBanner((prev) => (prev === msg ? "" : prev));
    }, 3500);
  }, []);

  // Push Crew & Armory Loadout to Unity 3D Turntable
  const syncLoadoutToUnity = useCallback(
    (
      prof: OperativeProfile | null,
      slotIdx: number = focusedLoopSlot
    ) => {
      if (!unityRef.current || !prof) return;
      const crewStr = (
        prof.crew_loadout || [
          "infiltrator",
          "infiltrator",
          "infiltrator",
          "infiltrator",
        ]
      ).join(",");
      const skinId = prof.equipped_loadout?.skin_id || "skin_standard";
      const weaponId = prof.equipped_loadout?.weapon_id || "weapon_baton";
      const shaderId = prof.equipped_loadout?.echo_shader_id || "shader_cyan";
      const payload = `${crewStr}|${skinId}|${weaponId}|${shaderId}|${slotIdx}`;
      unityRef.current.SendMessage(
        "ChronoGameManager",
        "ConfigureCrewAndArmory",
        payload
      );
    },
    [focusedLoopSlot]
  );

  // Load Operative Profile, Catalog, Contracts & Wanted Bounties from Supabase
  const loadSupabaseData = useCallback(
    async (operativeWallet: string, referrerWallet?: string | null) => {
      try {
        const [opRes, catRes, conRes, btyRes, anomRes] = await Promise.all([
          supabase.rpc("get_or_create_operative", {
            p_wallet: operativeWallet,
            p_callsign: null,
            p_referrer: referrerWallet || null,
          }),
          supabase.from("market_catalog").select("*").order("cost_gold"),
          supabase
            .from("syndicate_contracts")
            .select("*")
            .order("contract_tier"),
          supabase
            .from("duel_matches")
            .select("*")
            .eq("status", "open_bounty")
            .order("wanted_stars", { ascending: false })
            .limit(12),
          supabase
            .from("daily_anomaly_runs")
            .select("callsign, best_score, alley_oops")
            .order("best_score", { ascending: false })
            .limit(8),
        ]);

        if (opRes.data) {
          const prof = opRes.data.profile as OperativeProfile;
          setProfile(prof);
          setOwnedItems((opRes.data.owned_items as string[]) || []);
          syncLoadoutToUnity(prof, 0);
        }
        if (catRes.data) setCatalog(catRes.data as MarketItem[]);
        if (conRes.data) setContracts(conRes.data as SyndicateContract[]);
        if (btyRes.data) {
          const list = btyRes.data as WantedBountyDuel[];
          setBounties(list);
          if (list.length > 0 && !selectedBountyId) {
            setSelectedBountyId(list[0].id);
          }
        }
        if (anomRes.data) setAnomalyLeaders(anomRes.data);
      } catch {
        // Resilient fallback if offline
      }
    },
    [selectedBountyId, syncLoadoutToUnity]
  );

  // Initialize Wallet, URL Challenge/Referral Params, and First-Time Onboarding
  useEffect(() => {
    const initialWallet = getOrGenerateGuestWallet();
    setWallet(initialWallet);

    const params = new URLSearchParams(window.location.search);
    const refParam = params.get("ref");
    const duelParam = params.get("duel");
    if (duelParam) {
      setActiveDockTab("bounties");
      setSelectedBountyId(duelParam);
      flashBanner("CHALLENGE LINK LOADED — RIVAL TIMELINE LOCKED IN");
    }

    const tutorialDone = localStorage.getItem("chrono_heist_tutorial_done");
    if (!tutorialDone) {
      setShowInitiationPrompt(true);
    }

    loadSupabaseData(initialWallet, refParam);
  }, [loadSupabaseData, flashBanner]);

  // Handle Match Completion from Unity WebGL -> Settle via Atomic Supabase RPC
  const handleUnityMatchComplete = useCallback(
    async (jsonPayload: string) => {
      chronoSynth.stopAdaptivePulse();
      try {
        const parsed = JSON.parse(jsonPayload) as {
          score: number;
          rivalScore: number;
          coresExtracted: number;
          paradoxes: number;
          alleyOops: number;
          isTutorial: boolean;
        };

        if (parsed.isTutorial) {
          localStorage.setItem("chrono_heist_tutorial_done", "1");
          setShowInitiationPrompt(false);
          setTourStep(1); // Start 3-step progressive lobby tour!

          // Credit Tutorial completion reward (+300 Gold + Tech Hacker unlock) via Contract 1 RPC
          const { data } = await supabase.rpc("submit_heist_and_settle", {
            p_wallet: wallet,
            p_mode: "contract",
            p_target_duel_id: null,
            p_contract_tier: 1,
            p_stake_udao: 0,
            p_score: Math.max(parsed.score, 400),
            p_cores_extracted: Math.max(1, parsed.coresExtracted),
            p_paradoxes: Math.max(1, parsed.paradoxes),
            p_alley_oops: Math.max(1, parsed.alleyOops),
            p_echo_frames: [],
          });

          if (data?.profile) {
            setProfile(data.profile as OperativeProfile);
            setOwnedItems((prev) =>
              prev.includes("tech_hacker") ? prev : [...prev, "tech_hacker"]
            );
          }

          setSettlementModal({
            won: true,
            outcome: "SECTOR 00 INITIATION CLEARED — TECH HACKER RIG UNLOCKED!",
            player_score: parsed.score,
            rival_score: 300,
            gold_earned: 300,
            xp_earned: 200,
            udao_delta: 0,
            unlocked_class: "tech_hacker",
          });
          return;
        }

        const meta = activeMatchMetaRef.current;
        const { data, error } = await supabase.rpc("submit_heist_and_settle", {
          p_wallet: wallet,
          p_mode: meta.mode,
          p_target_duel_id: meta.targetDuelId,
          p_contract_tier: meta.contractTier,
          p_stake_udao: meta.stakeUdao,
          p_score: parsed.score,
          p_cores_extracted: parsed.coresExtracted,
          p_paradoxes: parsed.paradoxes,
          p_alley_oops: parsed.alleyOops,
          p_echo_frames: [],
        });

        if (!error && data) {
          if (data.profile) {
            setProfile(data.profile as OperativeProfile);
          }
          if (data.unlocked_class) {
            setOwnedItems((prev) =>
              prev.includes(data.unlocked_class)
                ? prev
                : [...prev, data.unlocked_class]
            );
          }
          setSettlementModal({
            won: Boolean(data.won),
            outcome: String(data.outcome || "HEIST COMPLETE"),
            player_score: Number(data.player_score ?? parsed.score),
            rival_score: Number(data.rival_score ?? parsed.rivalScore),
            gold_earned: Number(data.gold_earned ?? 75),
            xp_earned: Number(data.xp_earned ?? 60),
            udao_delta: Number(data.udao_delta ?? 0),
            winner_payout_udao: Number(data.winner_payout_udao ?? 0),
            treasury_cut_udao: Number(data.treasury_cut_udao ?? 0),
            referral_cut_udao: Number(data.referral_cut_udao ?? 0),
            unlocked_class: data.unlocked_class,
          });
          loadSupabaseData(wallet);
        } else {
          setSettlementModal({
            won: parsed.score >= parsed.rivalScore,
            outcome:
              parsed.score >= parsed.rivalScore
                ? "TIMELINE VICTORY"
                : "RAID REPELLED",
            player_score: parsed.score,
            rival_score: parsed.rivalScore,
            gold_earned: 85,
            xp_earned: 65,
            udao_delta: 0,
          });
        }
      } catch {
        // Ignore malformed JSON
      }
    },
    [wallet, loadSupabaseData]
  );

  // Boot Unity 6 WebGL Canvas & Wire ChronoHeistHost Callbacks
  useEffect(() => {
    window.ChronoHeistHost = {
      onUnityReady: () => {
        setIsUnityReady(true);
        setUnityLoadProgress(1);
      },
      onSynthTrigger: (eventName: string, intensity: number) => {
        chronoSynth.trigger(eventName, intensity);
      },
      onHudTelemetry: (jsonStr: string) => {
        try {
          const nextHud = JSON.parse(jsonStr) as HudTelemetry;
          setHud(nextHud);
          chronoSynth.setLoopIntensity(nextHud.loop);
        } catch {
          // Ignore telemetry parse error
        }
      },
      onMatchComplete: (jsonStr: string) => {
        handleUnityMatchComplete(jsonStr);
      },
    };

    const script = document.createElement("script");
    script.src = "/unity-build/Build/unity-build.loader.js";
    script.async = true;
    script.onload = () => {
      if (window.createUnityInstance && canvasRef.current) {
        window
          .createUnityInstance(
            canvasRef.current,
            {
              dataUrl: "/unity-build/Build/unity-build.data",
              frameworkUrl: "/unity-build/Build/unity-build.framework.js",
              codeUrl: "/unity-build/Build/unity-build.wasm",
              streamingAssetsUrl: "StreamingAssets",
              companyName: "ParadoxSyndicate",
              productName: "Chrono Heist: Paradox Protocol",
              productVersion: "1.0",
            },
            (p: number) => setUnityLoadProgress(p)
          )
          .then((instance: UnityInstance) => {
            unityRef.current = instance;
            setIsUnityReady(true);
          })
          .catch(() => {
            // Keep UI interactive if WebGL context is unavailable
          });
      }
    };
    document.body.appendChild(script);

    return () => {
      chronoSynth.stopAdaptivePulse();
    };
  }, [handleUnityMatchComplete]);

  // Re-sync 3D Turntable whenever profile changes and Unity is ready
  useEffect(() => {
    if (isUnityReady && profile && !hud.isRunning) {
      syncLoadoutToUnity(profile, focusedLoopSlot);
    }
  }, [isUnityReady, profile, hud.isRunning, focusedLoopSlot, syncLoadoutToUnity]);

  // Launch Playable 4-Loop Initiation Tutorial (Sector 00)
  const launchInitiationTutorial = () => {
    setShowInitiationPrompt(false);
    setSettlementModal(null);
    chronoSynth.startAdaptivePulse();
    activeMatchMetaRef.current = {
      mode: "contract",
      targetDuelId: null,
      contractTier: 1,
      stakeUdao: 0,
      isAnomaly: false,
    };
    if (unityRef.current) {
      unityRef.current.SendMessage(
        "ChronoGameManager",
        "StartHeistMatch",
        "tutorial|1|300|1|0"
      );
    }
  };

  // Launch Selected Heist Mode (Syndicate Contract, Wanted Bounty Duel, or Daily Anomaly)
  const launchHeist = (
    overrideMode?: "contract" | "free_pvp" | "staked_duel",
    isAnomalyRun: boolean = false
  ) => {
    setSettlementModal(null);
    setShowInitiationPrompt(false);
    if (tourStep === 3) setTourStep(0);

    let mode: "contract" | "free_pvp" | "staked_duel" =
      overrideMode ||
      (activeDockTab === "bounties"
        ? selectedStakeUdao > 0
          ? "staked_duel"
          : "free_pvp"
        : "contract");

    let sectorId = 1;
    let targetScore = 350;
    let targetDuelId: string | null = null;
    let stake = 0;

    if (isAnomalyRun) {
      mode = "contract";
      sectorId = 2;
      targetScore = 550;
    } else if (mode === "contract") {
      const c =
        contracts.find((x) => x.contract_tier === selectedContractTier) ||
        contracts[0];
      if (c) {
        sectorId = c.sector_id;
        targetScore = c.target_score;
      }
    } else {
      const b = bounties.find((x) => x.id === selectedBountyId) || bounties[0];
      if (b) {
        sectorId = b.sector_id;
        targetScore = b.raider_score;
        targetDuelId = b.id;
        stake = mode === "staked_duel" ? Number(b.stake_udao || selectedStakeUdao) : 0;
      } else {
        stake = mode === "staked_duel" ? selectedStakeUdao : 0;
      }

      if (
        mode === "staked_duel" &&
        stake > 0 &&
        (profile?.session_udao ?? 0) < stake
      ) {
        flashBanner(
          `NEED ${stake} $UDAO IN SESSION VAULT — OPENING VAULT TOP-UP`
        );
        vaultDialogRef.current?.showModal();
        return;
      }
    }

    activeMatchMetaRef.current = {
      mode,
      targetDuelId,
      contractTier: selectedContractTier,
      stakeUdao: stake,
      isAnomaly: isAnomalyRun,
    };

    chronoSynth.startAdaptivePulse();

    if (unityRef.current) {
      syncLoadoutToUnity(profile, focusedLoopSlot);
      unityRef.current.SendMessage(
        "ChronoGameManager",
        "StartHeistMatch",
        `${mode}|${sectorId}|${targetScore}|0|${isAnomalyRun ? 1 : 0}`
      );
    }
  };

  // Purchase or Equip 4-Loop Crew Class / 3D Skin / Hand_R Weapon / Echo Shader
  const handleSelectCatalogItem = async (item: MarketItem) => {
    chronoSynth.trigger("ui_click", 0.8);
    try {
      const { data, error } = await supabase.rpc("purchase_and_equip_item", {
        p_wallet: wallet,
        p_item_id: item.item_id,
        p_loop_slot: item.category === "crew_class" ? focusedLoopSlot : null,
      });

      if (error) {
        flashBanner(error.message.toUpperCase());
        return;
      }

      if (data) {
        const updatedProfile = data.profile as OperativeProfile;
        setProfile(updatedProfile);
        setOwnedItems((data.owned_items as string[]) || []);
        syncLoadoutToUnity(updatedProfile, focusedLoopSlot);
        flashBanner(
          item.category === "crew_class"
            ? `ASSIGNED ${item.name} TO LOOP L${focusedLoopSlot + 1}`
            : `EQUIPPED ${item.name} ON 3D RIG`
        );
        if (tourStep === 2) setTourStep(3);
      }
    } catch {
      flashBanner("FAILED TO UPDATE LOADOUT");
    }
  };

  // Deposit / Withdraw Session $UDAO
  const handleVaultDeposit = async (amount: number) => {
    chronoSynth.trigger("core_extract", 0.9);
    const { data, error } = await supabase.rpc("deposit_udao_vault", {
      p_wallet: wallet,
      p_amount: amount,
      p_tx_hash: `0xpolygon_session_${Date.now().toString(16)}`,
    });
    if (!error && data) {
      setProfile(data as OperativeProfile);
      flashBanner(`CREDITED +${amount} $UDAO TO GAS-FREE SESSION VAULT`);
    }
  };

  const handleVaultWithdraw = async () => {
    const bal = Number(profile?.session_udao ?? 0);
    if (bal <= 0) return;
    const { data, error } = await supabase.rpc("withdraw_udao_vault", {
      p_wallet: wallet,
      p_amount: bal,
    });
    if (!error && data) {
      setProfile(data as OperativeProfile);
      flashBanner(`WITHDREW ${bal.toFixed(2)} $UDAO TO POLYGON WALLET`);
    }
  };

  // Claim Daily Login Streak or Daily Directives Cache
  const handleClaimDaily = async (claimType: "streak" | "directives") => {
    chronoSynth.trigger("alley_oop_catch", 1.0);
    const { data, error } = await supabase.rpc(
      "claim_daily_retention_rewards",
      {
        p_wallet: wallet,
        p_claim_type: claimType,
      }
    );
    if (error) {
      flashBanner(error.message.toUpperCase());
      return;
    }
    if (data?.profile) {
      setProfile(data.profile as OperativeProfile);
      flashBanner(
        `CLAIMED +${data.reward_gold} CHRONO GOLD & +${data.reward_xp} XP!`
      );
    }
  };

  // Copy Viral Challenge + 2% Referral URL
  const handleCopyChallengeLink = (duelId?: string) => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/?${duelId ? `duel=${duelId}&` : ""}ref=${wallet}`;
    navigator.clipboard?.writeText(url);
    chronoSynth.trigger("ui_click", 0.9);
    flashBanner(
      "COPIED PLAYABLE CHALLENGE LINK (BINDS YOUR 2% LIFETIME REFERRAL!)"
    );
  };

  const totalScoreSum = Math.max(1, hud.playerScore + hud.rivalScore);
  const youPct = Math.round((hud.playerScore / totalScoreSum) * 100);

  return (
    <main className="chrono-viewport">
      {/* 100% Full-Bleed Unity 6 3D WebGL Viewport */}
      <canvas
        ref={canvasRef}
        id="unity-canvas"
        className="unity-canvas"
        tabIndex={-1}
      />

      {/* Initial Unity 6 .wasm Stream Bar (Non-Blocking Top Strip) */}
      {!isUnityReady && (
        <div
          className="brutalist-block"
          style={{
            position: "absolute",
            top: "74px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 16px",
            zIndex: 30,
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
          }}
        >
          LOADING 3D CONTAINMENT VAULT (QUATERNIUS .FBX) //{" "}
          {Math.round(unityLoadProgress * 100)}%
        </div>
      )}

      {/* ===================================================================
          TOP TACTICAL VISOR BAR (Always Visible)
      =================================================================== */}
      <header className="hud-top-bar">
        {/* Left: Brand Identification + Initiation Tutorial Trigger */}
        <div
          className="hud-interactive"
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <div
            className="brutalist-block"
            style={{ padding: "8px 13px", display: "flex", gap: "10px", alignItems: "center" }}
          >
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                background: "var(--signal-orange)",
              }}
            />
            <div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: "0.88rem",
                  letterSpacing: "0.06em",
                }}
              >
                CHRONO HEIST
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.64rem",
                  color: "var(--acid-volt)",
                }}
              >
                RANK {profile?.clearance_rank ?? 1} //{" "}
                {profile?.callsign ?? "OPERATIVE"}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="tactical-btn"
            onClick={launchInitiationTutorial}
          >
            SECTOR 00: TUTORIAL
          </button>

          {hud.isRunning && (
            <button
              type="button"
              className="tactical-btn tactical-btn-dark"
              onClick={() => {
                chronoSynth.stopAdaptivePulse();
                unityRef.current?.SendMessage(
                  "ChronoGameManager",
                  "ReturnToArmoryLobby"
                );
              }}
            >
              ABORT TO LOBBY
            </button>
          )}
        </div>

        {/* Center: 4-Loop Segmented Timeline & Tug-of-War Score Bar */}
        <div className="loop-cluster hud-interactive">
          <div className="loop-segments">
            {[1, 2, 3, 4].map((lp) => {
              const cls =
                profile?.crew_loadout?.[lp - 1]
                  ?.replace("_", " ")
                  .toUpperCase() || "INFILTRATOR";
              const stateClass =
                lp < hud.loop ? "done" : lp === hud.loop ? "active" : "";
              return (
                <div key={lp} className={`loop-pill ${stateClass}`}>
                  L{lp} • {cls.slice(0, 6)}
                </div>
              );
            })}
          </div>

          <div className="tug-bar-wrap">
            <div className="tug-scores">
              <span
                style={{
                  color: "var(--signal-orange)",
                  fontWeight: 800,
                  fontSize: "0.82rem",
                }}
              >
                YOU {hud.playerScore}
              </span>
              <span
                style={{
                  color: "var(--ink-light)",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                }}
              >
                {hud.isRunning
                  ? `${hud.timeLeft.toFixed(1)}s`
                  : "4 × 15.0s LOOPS"}
              </span>
              <span
                style={{
                  color: "var(--infrared-red)",
                  fontWeight: 800,
                  fontSize: "0.82rem",
                }}
              >
                {hud.rivalScore} RIVAL
              </span>
            </div>
            <div
              className="tug-track"
              style={{ "--you-pct": youPct } as React.CSSProperties}
            >
              <div className="tug-fill-you" />
            </div>
          </div>
        </div>

        {/* Right: Camera Angle Switcher [V], Audio Synth Mute, Dual-Currency Arcade Vault */}
        <div
          className="hud-interactive"
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <button
            type="button"
            className="tactical-btn"
            onClick={() =>
              unityRef.current?.SendMessage(
                "ChronoGameManager",
                "CycleCameraFromUI"
              )
            }
          >
            CAM [V]: {hud.cameraMode}
          </button>

          <button
            type="button"
            className="tactical-btn"
            onClick={() => {
              const next = !isMuted;
              setIsMuted(next);
              chronoSynth.setMuted(next);
            }}
          >
            {isMuted ? "SYNTH: MUTED" : "SYNTH: LIVE"}
          </button>

          <button
            type="button"
            className="tactical-btn tactical-btn-dark"
            onClick={() => vaultDialogRef.current?.showModal()}
          >
            <span style={{ color: "var(--amber-gold)" }}>
              ⚡ {profile?.chrono_gold ?? 250}G
            </span>
            <span>|</span>
            <span style={{ color: "var(--acid-volt)" }}>
              {Number(profile?.session_udao ?? 0).toFixed(1)} $UDAO
            </span>
          </button>
        </div>
      </header>

      {/* ===================================================================
          STATUS / EVENT BANNERS & CONTEXTUAL MICRO-CUES (During Match)
      =================================================================== */}
      {(hud.eventBanner || statusBanner) && (
        <div className="event-toast-banner">
          {hud.eventBanner || statusBanner}
        </div>
      )}

      {hud.isRunning && hud.microCue && (
        <div className="micro-cue-banner">{hud.microCue}</div>
      )}

      {/* ===================================================================
          IN-MATCH BOTTOM ABILITY READOUT (Minimalist 3-Slot Bar)
      =================================================================== */}
      {hud.isRunning && (
        <div
          style={{
            position: "absolute",
            bottom: "18px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: "10px",
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <div
            className="brutalist-block"
            style={{
              padding: "7px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              borderColor: hud.dashReady
                ? "var(--acid-volt)"
                : "var(--ink-dark)",
            }}
          >
            [SPACE / R-CLICK] BLADE DASH:{" "}
            <span
              style={{
                color: hud.dashReady
                  ? "var(--acid-volt)"
                  : "var(--ink-muted)",
              }}
            >
              {hud.dashReady ? "READY (RESET ON HIT)" : "RECHARGING"}
            </span>
          </div>

          <div
            className="brutalist-block"
            style={{
              padding: "7px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
            }}
          >
            [E / L-CLICK] THROW PASS:{" "}
            <span
              style={{
                color: hud.carryingCore
                  ? "var(--signal-orange)"
                  : "var(--ink-muted)",
              }}
            >
              {hud.carryingCore ? "CORE LOCKED — FIRE!" : "NO CORE"}
            </span>
          </div>

          <div
            className="brutalist-block"
            style={{
              padding: "7px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
            }}
          >
            [F / Q] {hud.rigClass.replace("_", " ").toUpperCase()} GADGET:{" "}
            <span
              style={{
                color: hud.gadgetReady
                  ? "var(--acid-volt)"
                  : "var(--ink-muted)",
              }}
            >
              {hud.gadgetReady ? "ARMED" : "COOLDOWN"}
            </span>
          </div>
        </div>
      )}

      {/* ===================================================================
          FIRST-BOOT PLAYABLE TUTORIAL PROMPT (Sector 00: Initiation Protocol)
      =================================================================== */}
      {!hud.isRunning && showInitiationPrompt && (
        <div
          className="brutalist-bone hud-interactive"
          style={{
            position: "absolute",
            top: "96px",
            left: "16px",
            maxWidth: "410px",
            padding: "14px 16px",
            zIndex: 28,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              fontWeight: 800,
              color: "var(--signal-orange)",
            }}
          >
            <span>FIRST-TIME OPERATIVE DETECTED</span>
            <span>50s PLAYABLE RUN</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: "0.96rem" }}>
            Master Temporal Alley-Oops & Causal Laser Wipeouts in 4 Guided
            Loops
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.73rem",
              color: "var(--ink-muted)",
            }}
          >
            REWARD: +300 CHRONO GOLD + UNLOCKS TECH HACKER RIG
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="tactical-btn tactical-btn-primary"
              onClick={launchInitiationTutorial}
            >
              PLAY SECTOR 00 TUTORIAL
            </button>
            <button
              type="button"
              className="tactical-btn"
              onClick={() => {
                localStorage.setItem("chrono_heist_tutorial_done", "1");
                setShowInitiationPrompt(false);
                setTourStep(1);
              }}
            >
              SKIP TO LOBBY
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================
          LOBBY BOTTOM COMMAND DOCK (Leaves 3D Turntable Unobstructed)
      =================================================================== */}
      {!hud.isRunning && (
        <section className="lobby-bottom-dock">
          {/* Progressive 3-Step Tethered First-Time UI Guide */}
          {tourStep > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div className="tether-tour-pill hud-interactive">
                <span>
                  {tourStep === 1 &&
                    "STEP 1/3: CLICK [3D CREW & ARMORY] BELOW TO INSPECT YOUR 4 TIME-LOOP PODS"}
                  {tourStep === 2 &&
                    "STEP 2/3: CLICK A RIG CLASS TO ASSIGN IT TO LOOP L1 ON THE 3D TURNTABLE"}
                  {tourStep === 3 &&
                    "STEP 3/3: CREW LOCKED! CLICK [DEPLOY HEIST] TO RAID THE VAULT"}
                </span>
                <button
                  type="button"
                  className="tactical-btn"
                  style={{ padding: "3px 8px", fontSize: "0.68rem" }}
                  onClick={() => setTourStep(0)}
                >
                  DISMISS
                </button>
              </div>
            </div>
          )}

          {/* Main Tactical Control Bar */}
          <div
            className="brutalist-bone hud-interactive"
            style={{
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {/* Mode Switcher Tabs + Primary Deploy Trigger */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "contracts" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("contracts");
                  }}
                >
                  1. SYNDICATE CONTRACTS (FREE)
                </button>

                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "bounties" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("bounties");
                  }}
                >
                  2. WANTED BOUNTIES ($UDAO PVP)
                </button>

                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "armory" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("armory");
                    if (tourStep === 1) setTourStep(2);
                  }}
                >
                  3. 3D CREW & ARMORY ({ownedItems.length} OWNED)
                </button>

                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "daily" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("daily");
                  }}
                >
                  4. DAILY ANOMALY & STREAK
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className="tactical-btn"
                  onClick={() => handleCopyChallengeLink(selectedBountyId || undefined)}
                >
                  SHARE CHALLENGE LINK (+2% REF)
                </button>

                <button
                  type="button"
                  className="tactical-btn tactical-btn-primary"
                  onClick={() => launchHeist()}
                >
                  {activeDockTab === "bounties"
                    ? selectedStakeUdao > 0
                      ? `DEPLOY DUEL (${selectedStakeUdao} $UDAO → WIN ${(
                          selectedStakeUdao * 1.8
                        ).toFixed(0)} $UDAO)`
                      : "DEPLOY FREE PVP RAID"
                    : `DEPLOY CONTRACT TIER ${selectedContractTier}`}
                </button>
              </div>
            </div>

            {/* TAB 1: SYNDICATE CONTRACT LADDER */}
            {activeDockTab === "contracts" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: "8px",
                }}
              >
                {contracts.map((c) => {
                  const unlocked =
                    (profile?.contract_tier_unlocked ?? 1) >= c.contract_tier;
                  const isSel = selectedContractTier === c.contract_tier;
                  return (
                    <div
                      key={c.contract_tier}
                      onClick={() => {
                        if (!unlocked) {
                          flashBanner(
                            `CLEAR CONTRACT TIER ${c.contract_tier - 1} FIRST`
                          );
                          return;
                        }
                        chronoSynth.trigger("ui_click", 0.6);
                        setSelectedContractTier(c.contract_tier);
                      }}
                      style={{
                        padding: "10px 12px",
                        border: isSel
                          ? "2px solid var(--signal-orange)"
                          : "1.5px solid var(--ink-dark)",
                        background: isSel
                          ? "var(--bg-carbon)"
                          : "var(--bg-putty)",
                        color: isSel ? "var(--ink-light)" : "var(--ink-dark)",
                        opacity: unlocked ? 1 : 0.55,
                        cursor: unlocked ? "pointer" : "not-allowed",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.68rem",
                          color: isSel
                            ? "var(--acid-volt)"
                            : "var(--signal-orange)",
                          fontWeight: 800,
                        }}
                      >
                        {c.sector_name} // TARGET {c.target_score} PTS
                      </div>
                      <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>
                        {c.title}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.7rem",
                        }}
                      >
                        BOSS: {c.boss_callsign} • +{c.reward_gold}G
                        {c.unlocks_class
                          ? ` • UNLOCKS ${c.unlocks_class
                              .replace("_", " ")
                              .toUpperCase()}`
                          : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* TAB 2: LIVE WANTED BOUNTIES ($UDAO PVP) */}
            {activeDockTab === "bounties" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.74rem",
                  }}
                >
                  <div>
                    SELECT RIVAL RECORDED 4-LOOP ECHOES TO SHATTER (90% WINNER
                    POT / 8% TREASURY / 2% REFERRAL):
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {[0, 10, 25].map((stk) => (
                      <button
                        key={stk}
                        type="button"
                        className={`tactical-btn ${
                          selectedStakeUdao === stk ? "tactical-btn-dark" : ""
                        }`}
                        style={{ padding: "4px 10px" }}
                        onClick={() => setSelectedStakeUdao(stk)}
                      >
                        {stk === 0
                          ? "FREE PRACTICE RAID"
                          : `${stk} $UDAO → WIN ${(stk * 1.8).toFixed(0)} $UDAO`}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: "8px",
                  }}
                >
                  {bounties.map((b) => {
                    const isSel = selectedBountyId === b.id;
                    return (
                      <div
                        key={b.id}
                        onClick={() => {
                          chronoSynth.trigger("ui_click", 0.6);
                          setSelectedBountyId(b.id);
                          setSelectedStakeUdao(Number(b.stake_udao || 0));
                        }}
                        style={{
                          padding: "10px 12px",
                          border: isSel
                            ? "2px solid var(--signal-orange)"
                            : "1.5px solid var(--ink-dark)",
                          background: isSel
                            ? "var(--bg-carbon)"
                            : "var(--bg-putty)",
                          color: isSel ? "var(--ink-light)" : "var(--ink-dark)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.7rem",
                            fontWeight: 800,
                          }}
                        >
                          <span style={{ color: "var(--infrared-red)" }}>
                            {"★".repeat(Math.max(1, b.wanted_stars))} WANTED
                            RAIDER
                          </span>
                          <span style={{ color: "var(--amber-gold)" }}>
                            {Number(b.stake_udao) > 0
                              ? `${b.stake_udao} $UDAO STAKE`
                              : "FREE BOUNTY"}
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>
                          {b.raider_callsign} // BENCHMARK: {b.raider_score} PTS
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.68rem",
                          }}
                        >
                          CREW:{" "}
                          {(b.raider_crew || [])
                            .map((c, idx) => `L${idx + 1}:${c.slice(0, 4).toUpperCase()}`)
                            .join(" • ")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 3: LIVE 3D CREW & ARMORY TURNTABLE */}
            {activeDockTab === "armory" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  {/* 4 Cryo Pod Loop Slot Selector (Dollies 3D Unity Camera to Pod!) */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {[0, 1, 2, 3].map((slot) => {
                      const assigned =
                        profile?.crew_loadout?.[slot] || "infiltrator";
                      return (
                        <button
                          key={slot}
                          type="button"
                          className={`tactical-btn ${
                            focusedLoopSlot === slot ? "tactical-btn-dark" : ""
                          }`}
                          onClick={() => {
                            setFocusedLoopSlot(slot);
                            unityRef.current?.SendMessage(
                              "ChronoGameManager",
                              "FocusArmorySlot",
                              slot
                            );
                          }}
                        >
                          POD L{slot + 1}:{" "}
                          {assigned.replace("_", " ").toUpperCase()}
                        </button>
                      );
                    })}
                  </div>

                  {/* Category Switcher */}
                  <div style={{ display: "flex", gap: "6px" }}>
                    {(
                      [
                        ["crew_class", "LOOP CLASSES"],
                        ["skin", "3D CHASSIS SKINS"],
                        ["weapon", "HAND_R WEAPONS"],
                        ["echo_shader", "ECHO SHADERS"],
                      ] as const
                    ).map(([catKey, label]) => (
                      <button
                        key={catKey}
                        type="button"
                        className={`tactical-btn ${
                          armoryCategory === catKey ? "tactical-btn-dark" : ""
                        }`}
                        style={{ padding: "5px 10px" }}
                        onClick={() => setArmoryCategory(catKey)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  className="tactical-scroll-list"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "8px",
                  }}
                >
                  {catalog
                    .filter((item) => item.category === armoryCategory)
                    .map((item) => {
                      const isOwned = ownedItems.includes(item.item_id);
                      const isEquipped =
                        item.category === "crew_class"
                          ? profile?.crew_loadout?.[focusedLoopSlot] ===
                            item.item_id
                          : item.category === "skin"
                          ? profile?.equipped_loadout?.skin_id === item.item_id
                          : item.category === "weapon"
                          ? profile?.equipped_loadout?.weapon_id ===
                            item.item_id
                          : profile?.equipped_loadout?.echo_shader_id ===
                            item.item_id;

                      return (
                        <div
                          key={item.item_id}
                          onClick={() => handleSelectCatalogItem(item)}
                          style={{
                            padding: "10px 12px",
                            border: isEquipped
                              ? "2px solid var(--signal-orange)"
                              : "1.5px solid var(--ink-dark)",
                            background: isEquipped
                              ? "var(--bg-carbon)"
                              : "var(--bg-putty)",
                            color: isEquipped
                              ? "var(--ink-light)"
                              : "var(--ink-dark)",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontFamily: "var(--font-mono)",
                              fontSize: "0.68rem",
                              fontWeight: 800,
                            }}
                          >
                            <span
                              style={{
                                color: isEquipped
                                  ? "var(--acid-volt)"
                                  : "var(--signal-orange)",
                              }}
                            >
                              {isEquipped
                                ? "ACTIVE ON RIG"
                                : isOwned
                                ? "OWNED — CLICK TO EQUIP"
                                : item.cost_udao > 0
                                ? `UNLOCK: ${item.cost_udao} $UDAO`
                                : `UNLOCK: ${item.cost_gold} GOLD`}
                            </span>
                            <span>RANK {item.required_rank}+</span>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>
                            {item.name}
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: "0.68rem",
                              lineHeight: 1.35,
                            }}
                          >
                            {item.passive_desc
                              ? `${item.passive_desc} • ${item.gadget_desc} (${item.tradeoff_desc})`
                              : item.description}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* TAB 4: DAILY ANOMALY & RETENTION DIRECTIVES */}
            {activeDockTab === "daily" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: "10px",
                }}
              >
                {/* 24h Rotating Daily Anomaly Seed */}
                <div
                  style={{
                    padding: "10px 12px",
                    border: "1.5px solid var(--ink-dark)",
                    background: "var(--bg-carbon)",
                    color: "var(--ink-light)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.68rem",
                        color: "var(--acid-volt)",
                        fontWeight: 800,
                      }}
                    >
                      24H ROTATING GLOBAL MUTATOR
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                      ANOMALY // RICOCHET OVERDRIVE
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.7rem",
                        color: "var(--bg-putty)",
                        marginTop: "4px",
                      }}
                    >
                      +35% Throw Speed, +18% Operative Velocity & 2.5× Temporal
                      Alley-Oop Bonus
                    </div>
                  </div>
                  <button
                    type="button"
                    className="tactical-btn tactical-btn-primary"
                    onClick={() => launchHeist("contract", true)}
                  >
                    DEPLOY INTO DAILY ANOMALY
                  </button>
                </div>

                {/* 7-Day Login Streak & 3 Daily Directives */}
                <div
                  style={{
                    padding: "10px 12px",
                    border: "1.5px solid var(--ink-dark)",
                    background: "var(--bg-putty)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.68rem",
                        fontWeight: 800,
                        color: "var(--signal-orange)",
                      }}
                    >
                      DAILY SYNDICATE SUPPLY & DIRECTIVES
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.72rem",
                        marginTop: "4px",
                      }}
                    >
                      • Land Temporal Alley-Oops ({profile?.alley_oops_landed ?? 0}
                      /2)
                      <br />• Trigger Paradox Shatters (
                      {profile?.paradoxes_triggered ?? 0}/2)
                      <br />• Active Streak: DAY {profile?.login_streak ?? 1}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      className="tactical-btn"
                      onClick={() => handleClaimDaily("streak")}
                    >
                      CLAIM DAY {profile?.login_streak ?? 1} DROP (+150G)
                    </button>
                    <button
                      type="button"
                      className="tactical-btn tactical-btn-dark"
                      onClick={() => handleClaimDaily("directives")}
                    >
                      CLAIM DIRECTIVE CACHE (+350G)
                    </button>
                  </div>
                </div>

                {/* Daily Anomaly Leaderboard */}
                <div
                  style={{
                    padding: "10px 12px",
                    border: "1.5px solid var(--ink-dark)",
                    background: "var(--bg-putty)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.72rem",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: "6px" }}>
                    TODAY&apos;S TOP ANOMALY TIMELINES
                  </div>
                  {anomalyLeaders.slice(0, 4).map((row, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "2px 0",
                        borderBottom: "1px solid rgba(20,20,19,0.12)",
                      }}
                    >
                      <span>
                        #{idx + 1} {row.callsign}
                      </span>
                      <span style={{ fontWeight: 800 }}>
                        {row.best_score} PTS
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ===================================================================
          POST-MATCH SETTLEMENT OVERLAY
      =================================================================== */}
      {settlementModal && (
        <div
          className="brutalist-bone hud-interactive"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            maxWidth: "480px",
            width: "calc(100% - 32px)",
            padding: "20px",
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              fontWeight: 800,
              color: settlementModal.won
                ? "var(--signal-orange)"
                : "var(--infrared-red)",
            }}
          >
            {settlementModal.won ? "MISSION SUCCESS" : "TIMELINE DEFENDED"}
          </div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800 }}>
            {settlementModal.outcome}
          </h2>

          <div
            className="brutalist-block"
            style={{
              padding: "12px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.78rem",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            <div>
              YOUR SCORE:{" "}
              <strong style={{ color: "var(--acid-volt)" }}>
                {settlementModal.player_score} PTS
              </strong>
            </div>
            <div>
              RIVAL BENCHMARK: <strong>{settlementModal.rival_score} PTS</strong>
            </div>
            <div>
              CHRONO GOLD:{" "}
              <strong style={{ color: "var(--amber-gold)" }}>
                +{settlementModal.gold_earned} GOLD
              </strong>
            </div>
            <div>
              CLEARANCE XP: <strong>+{settlementModal.xp_earned} XP</strong>
            </div>
            {settlementModal.udao_delta !== 0 && (
              <div style={{ gridColumn: "1 / -1", color: "var(--acid-volt)" }}>
                SESSION $UDAO SETTLEMENT:{" "}
                {settlementModal.udao_delta > 0 ? "+" : ""}
                {settlementModal.udao_delta.toFixed(2)} $UDAO (90% WINNER / 8%
                TREASURY / 2% REFERRAL)
              </div>
            )}
            {settlementModal.unlocked_class && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  color: "var(--signal-orange)",
                  fontWeight: 800,
                }}
              >
                NEW CREW CLASS UNLOCKED:{" "}
                {settlementModal.unlocked_class.replace("_", " ").toUpperCase()}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="tactical-btn tactical-btn-primary"
              onClick={() => launchHeist()}
            >
              REMATCH / DEPLOY AGAIN
            </button>
            <button
              type="button"
              className="tactical-btn"
              onClick={() => {
                setSettlementModal(null);
                unityRef.current?.SendMessage(
                  "ChronoGameManager",
                  "ReturnToArmoryLobby"
                );
              }}
            >
              RETURN TO 3D ARMORY
            </button>
            <button
              type="button"
              className="tactical-btn"
              onClick={() => handleCopyChallengeLink(selectedBountyId || undefined)}
            >
              SHARE CHALLENGE URL
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================
          NATIVE <DIALOG> ARCADE SESSION VAULT (Polygon Mainnet $UDAO)
      =================================================================== */}
      <dialog ref={vaultDialogRef} className="tactical-dialog">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  color: "var(--signal-orange)",
                  fontWeight: 800,
                }}
              >
                POLYGON MAINNET (CHAIN ID 137) // ARCADE VAULT
              </div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800 }}>
                GAS-FREE SESSION $UDAO VAULT
              </h3>
            </div>
            <button
              type="button"
              className="tactical-btn"
              onClick={() => vaultDialogRef.current?.close()}
            >
              CLOSE [ESC]
            </button>
          </div>

          <div
            className="brutalist-block"
            style={{
              padding: "12px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.76rem",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div>
              OPERATIVE WALLET: <strong>{formatShortWallet(wallet)}</strong>{" "}
              {isLiveWallet ? "(POLYGON CONNECTED)" : "(SESSION OPERATIVE)"}
            </div>
            <div>
              $UDAO CONTRACT:{" "}
              <span style={{ color: "var(--ink-muted)" }}>
                {UDAO_CONTRACT_ADDRESS.slice(0, 14)}…
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
              <span>
                SESSION VAULT:{" "}
                <strong style={{ color: "var(--acid-volt)" }}>
                  {Number(profile?.session_udao ?? 0).toFixed(2)} $UDAO
                </strong>
              </span>
              <span>
                CHRONO GOLD:{" "}
                <strong style={{ color: "var(--amber-gold)" }}>
                  {profile?.chrono_gold ?? 250} GOLD
                </strong>
              </span>
            </div>
            <div>
              REFERRAL EARNINGS (2% LIFETIME):{" "}
              <strong>
                {Number(profile?.referral_earnings_udao ?? 0).toFixed(2)} $UDAO
              </strong>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="tactical-btn"
              onClick={async () => {
                const res = await connectPolygonWallet();
                setWallet(res.walletAddress);
                setIsLiveWallet(res.isLiveEvm);
                loadSupabaseData(res.walletAddress);
              }}
            >
              {isLiveWallet
                ? "POLYGON WALLET LINKED"
                : "CONNECT POLYGON WALLET"}
            </button>

            <input
              type="number"
              min={5}
              max={1000}
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              style={{
                width: "90px",
                padding: "7px 10px",
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                border: "1.5px solid var(--ink-dark)",
                background: "var(--bg-putty)",
              }}
            />

            <button
              type="button"
              className="tactical-btn tactical-btn-primary"
              onClick={() =>
                handleVaultDeposit(Math.max(5, Number(depositAmount) || 50))
              }
            >
              DEPOSIT $UDAO TO SESSION
            </button>

            <button
              type="button"
              className="tactical-btn"
              onClick={handleVaultWithdraw}
            >
              WITHDRAW ALL
            </button>
          </div>

          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.68rem",
              color: "var(--ink-muted)",
              lineHeight: 1.4,
            }}
          >
            ECONOMIC GUARDRAIL: Free Contract & Practice modes award strictly
            off-chain Chrono Gold (zero unbacked $UDAO inflation). Staked PvP
            Duels are 100% player-funded: 90% to Winner, 8% Protocol Treasury,
            2% Referrer.
          </div>
        </div>
      </dialog>
    </main>
  );
}
