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

interface WorldMarker {
  id: string;
  label: string;
  tone: "orange" | "green" | "red" | "gold" | "target";
  x: number;
  y: number;
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
  tutorialTitle?: string;
  tutorialDetail?: string;
  tutorialProgress?: number;
  markers?: WorldMarker[];
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
  tutorialTitle: "",
  tutorialDetail: "",
  tutorialProgress: 0,
  markers: [],
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
  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(true);
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
    (prof: OperativeProfile | null, slotIdx: number = focusedLoopSlot) => {
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
          setShowHowToPlay(false);

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
            outcome: "Tutorial Complete! You Mastered Time-Loop Heists!",
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
            outcome: String(data.outcome || "Heist Complete"),
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
                ? "Heist Victory! You Outscored the Rival Crew!"
                : "Heist Repelled — Score More Points Next Run",
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

  // Launch Playable 4-Step Interactive Tutorial
  const launchInitiationTutorial = () => {
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
    canvasRef.current?.focus();
  };

  // Launch Selected Heist Mode (Solo Mission, Rival Bounty Duel, or Daily Mutator)
  const launchHeist = (
    overrideMode?: "contract" | "free_pvp" | "staked_duel",
    isAnomalyRun: boolean = false
  ) => {
    setSettlementModal(null);

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
        stake =
          mode === "staked_duel"
            ? Number(b.stake_udao || selectedStakeUdao)
            : 0;
      } else {
        stake = mode === "staked_duel" ? selectedStakeUdao : 0;
      }

      if (
        mode === "staked_duel" &&
        stake > 0 &&
        (profile?.session_udao ?? 0) < stake
      ) {
        flashBanner(
          `Need ${stake} $UDAO in Session Vault — Opening Vault Top-Up`
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
    canvasRef.current?.focus();
  };

  // Purchase or Equip 4-Loop Crew Class / 3D Skin / Weapon / Echo Shader
  const handleSelectCatalogItem = async (item: MarketItem) => {
    chronoSynth.trigger("ui_click", 0.8);
    try {
      const { data, error } = await supabase.rpc("purchase_and_equip_item", {
        p_wallet: wallet,
        p_item_id: item.item_id,
        p_loop_slot: item.category === "crew_class" ? focusedLoopSlot : null,
      });

      if (error) {
        flashBanner(error.message);
        return;
      }

      if (data) {
        const updatedProfile = data.profile as OperativeProfile;
        setProfile(updatedProfile);
        setOwnedItems((data.owned_items as string[]) || []);
        syncLoadoutToUnity(updatedProfile, focusedLoopSlot);
        flashBanner(
          item.category === "crew_class"
            ? `Equipped ${item.name} on Loop ${focusedLoopSlot + 1}`
            : `Equipped ${item.name} on your Operative`
        );
      }
    } catch {
      flashBanner("Failed to update loadout");
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
      flashBanner(`Added +${amount} $UDAO to your Session Vault`);
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
      flashBanner(`Withdrew ${bal.toFixed(2)} $UDAO to Polygon Wallet`);
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
      flashBanner(error.message);
      return;
    }
    if (data?.profile) {
      setProfile(data.profile as OperativeProfile);
      flashBanner(
        `Claimed +${data.reward_gold} Gold & +${data.reward_xp} XP!`
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
      "Copied Challenge Link (Earns you 2% lifetime referral rewards!)"
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

      {/* ===================================================================
          3D WORLD-TO-SCREEN FLOATING CALLOUT PINS (Projected from Unity Camera)
      =================================================================== */}
      {isUnityReady && hud.markers && hud.markers.length > 0 && (
        <div className="world-pins-layer">
          {hud.markers.map((m) => (
            <div
              key={m.id}
              className={`world-pin world-pin-${m.tone}`}
              style={{
                left: `${m.x}%`,
                top: `${m.y}%`,
              }}
            >
              {m.label}
            </div>
          ))}
        </div>
      )}

      {/* Initial Unity 6 .wasm Stream Bar (Non-Blocking Top Strip) */}
      {!isUnityReady && (
        <div
          className="brutalist-block"
          style={{
            position: "absolute",
            top: "84px",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 18px",
            zIndex: 30,
            fontSize: "0.85rem",
            fontWeight: 700,
          }}
        >
          Loading 3D Vault Arena… {Math.round(unityLoadProgress * 100)}%
        </div>
      )}

      {/* ===================================================================
          TOP BAR (Always Visible)
      =================================================================== */}
      <header className="hud-top-bar">
        {/* Left: Brand Identification + Interactive Tutorial & How to Play Buttons */}
        <div
          className="hud-interactive"
          style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}
        >
          <div
            className="brutalist-block"
            style={{
              padding: "8px 14px",
              display: "flex",
              gap: "10px",
              alignItems: "center",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "11px",
                height: "11px",
                borderRadius: "3px",
                background: "var(--signal-orange)",
              }}
            />
            <div>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  letterSpacing: "0.02em",
                }}
              >
                CHRONO HEIST
              </div>
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "var(--acid-volt)",
                  fontWeight: 600,
                }}
              >
                3D Time-Loop Co-Op With Yourself • Rank{" "}
                {profile?.clearance_rank ?? 1}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="tactical-btn tactical-btn-primary"
            style={{ padding: "8px 14px", fontSize: "0.82rem" }}
            onClick={launchInitiationTutorial}
          >
            ▶ Interactive Tutorial (4 Steps)
          </button>

          {!hud.isRunning && (
            <button
              type="button"
              className={`tactical-btn ${showHowToPlay ? "tactical-btn-dark" : ""}`}
              onClick={() => setShowHowToPlay((v) => !v)}
            >
              {showHowToPlay ? "Hide Guide" : "? How To Play"}
            </button>
          )}

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
              ✕ Exit to Lobby
            </button>
          )}
        </div>

        {/* Center: 4-Loop Timeline & Score Bar */}
        <div className="loop-cluster hud-interactive">
          <div className="loop-segments">
            {[1, 2, 3, 4].map((lp) => {
              const cls =
                profile?.crew_loadout?.[lp - 1]
                  ?.replace("_", " ")
                  .toUpperCase() || "INFILTRATOR";
              const stateClass = hud.isRunning
                ? lp < hud.loop
                  ? "done"
                  : lp === hud.loop
                  ? "active"
                  : ""
                : lp === focusedLoopSlot + 1
                ? "active"
                : "";
              return (
                <div key={lp} className={`loop-pill ${stateClass}`}>
                  Loop {lp} • {cls.slice(0, 6)}
                </div>
              );
            })}
          </div>

          {hud.isRunning ? (
            <div className="tug-bar-wrap">
              <div className="tug-scores">
                <span
                  style={{
                    color: "var(--signal-orange)",
                    fontWeight: 800,
                    fontSize: "0.88rem",
                  }}
                >
                  YOU: {hud.playerScore} PTS
                </span>
                <span
                  style={{
                    color: "var(--ink-light)",
                    fontWeight: 800,
                    fontSize: "0.95rem",
                  }}
                >
                  {hud.isTutorial
                    ? `TUTORIAL STEP ${hud.loop} OF 4`
                    : `LOOP ${hud.loop}/4 • ${hud.timeLeft.toFixed(1)}s`}
                </span>
                <span
                  style={{
                    color: "var(--infrared-red)",
                    fontWeight: 800,
                    fontSize: "0.88rem",
                  }}
                >
                  TARGET: {hud.rivalScore} PTS
                </span>
              </div>
              <div
                className="tug-track"
                style={{ "--you-pct": youPct } as React.CSSProperties}
              >
                <div className="tug-fill-you" />
              </div>
            </div>
          ) : (
            <div className="tug-bar-wrap" style={{ padding: "6px 14px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                }}
              >
                <span style={{ color: "var(--acid-volt)" }}>
                  4 Time Loops × 15s (Your Past Selves Help You!)
                </span>
                <span style={{ color: "var(--ink-light)" }}>
                  Goal:{" "}
                  {contracts.find(
                    (c) => c.contract_tier === selectedContractTier
                  )?.target_score ?? 350}{" "}
                  Pts
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Camera Angle Switcher [V], Audio Synth Mute, Wallet & Gold */}
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
            🎥 Camera [V]: {hud.cameraMode}
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
            {isMuted ? "🔇 Muted" : "🔊 Sound On"}
          </button>

          <button
            type="button"
            className="tactical-btn tactical-btn-dark"
            onClick={() => vaultDialogRef.current?.showModal()}
          >
            <span style={{ color: "var(--amber-gold)" }}>
              🪙 {profile?.chrono_gold ?? 250} Gold
            </span>
            <span>|</span>
            <span style={{ color: "var(--acid-volt)" }}>
              {Number(profile?.session_udao ?? 0).toFixed(1)} $UDAO
            </span>
          </button>
        </div>
      </header>

      {/* ===================================================================
          INTERACTIVE 4-STEP TUTORIAL COACH CARD (Only During Tutorial Mode!)
      =================================================================== */}
      {hud.isRunning && hud.isTutorial && (
        <section className="brutalist-bone tutorial-coach-card hud-interactive">
          <div className="tutorial-step-pills">
            {[
              { step: 1, name: "1. Hold Switch" },
              { step: 2, name: "2. Steal Vault Core" },
              { step: 3, name: "3. Throw Core [E]" },
              { step: 4, name: "4. Stop Rival [Space]" },
            ].map((s) => (
              <div
                key={s.step}
                className={`tutorial-step-pill ${
                  hud.loop > s.step
                    ? "done"
                    : hud.loop === s.step
                    ? "current"
                    : ""
                }`}
              >
                {hud.loop > s.step ? `✓ ${s.name}` : s.name}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "12px",
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "1.06rem",
                  fontWeight: 800,
                  color: "var(--signal-orange)",
                }}
              >
                {hud.tutorialTitle ||
                  `STEP ${hud.loop} OF 4: FOLLOW THE GLOWING FLOOR LINE`}
              </div>
              <p
                style={{
                  fontSize: "0.88rem",
                  lineHeight: 1.45,
                  color: "var(--ink-dark)",
                  marginTop: "4px",
                  fontWeight: 600,
                }}
              >
                {hud.tutorialDetail ||
                  "Use [WASD] or [Arrow Keys] to follow the glowing orange floor line to your target."}
              </p>
            </div>

            <button
              type="button"
              className="tactical-btn"
              style={{ flexShrink: 0 }}
              onClick={() => {
                unityRef.current?.SendMessage(
                  "ChronoGameManager",
                  "SkipTutorialStep"
                );
                canvasRef.current?.focus();
              }}
            >
              Skip Step ➔
            </button>
          </div>

          <div className="tutorial-progress-track">
            <div
              className="tutorial-progress-fill"
              style={{ width: `${hud.tutorialProgress ?? 20}%` }}
            />
          </div>
        </section>
      )}

      {/* ===================================================================
          STATUS / EVENT BANNERS & CONTEXTUAL MICRO-CUES (During Match)
      =================================================================== */}
      {(hud.eventBanner || statusBanner) && (
        <div className="event-toast-banner">
          {hud.eventBanner || statusBanner}
        </div>
      )}

      {hud.isRunning && !hud.isTutorial && hud.microCue && (
        <div className="micro-cue-banner">{hud.microCue}</div>
      )}

      {/* ===================================================================
          IN-MATCH BOTTOM CONTROLS BAR (Clear Human-Readable Controls)
      =================================================================== */}
      {hud.isRunning && (
        <div
          style={{
            position: "absolute",
            bottom: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: "10px",
            zIndex: 20,
            pointerEvents: "none",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <div
            className="brutalist-block"
            style={{
              padding: "8px 14px",
              fontSize: "0.8rem",
              fontWeight: 700,
            }}
          >
            🏃 Move: <span style={{ color: "var(--acid-volt)" }}>[WASD / Arrows]</span>
          </div>

          <div
            className="brutalist-block"
            style={{
              padding: "8px 14px",
              fontSize: "0.8rem",
              fontWeight: 700,
              borderColor: hud.carryingCore
                ? "var(--signal-orange)"
                : "var(--ink-dark)",
            }}
          >
            ☄️ Throw Core:{" "}
            <span
              style={{
                color: hud.carryingCore
                  ? "var(--signal-orange)"
                  : "var(--ink-muted)",
              }}
            >
              {hud.carryingCore
                ? "[E / Left-Click] READY TO THROW!"
                : "Pick up a Core first"}
            </span>
          </div>

          <div
            className="brutalist-block"
            style={{
              padding: "8px 14px",
              fontSize: "0.8rem",
              fontWeight: 700,
              borderColor: hud.dashReady
                ? "var(--acid-volt)"
                : "var(--ink-dark)",
            }}
          >
            ⚔️ Knock Out Rival:{" "}
            <span
              style={{
                color: hud.dashReady ? "var(--acid-volt)" : "var(--ink-muted)",
              }}
            >
              {hud.dashReady ? "[SPACE / Right-Click] READY" : "Recharging…"}
            </span>
          </div>

          <div
            className="brutalist-block"
            style={{
              padding: "8px 14px",
              fontSize: "0.8rem",
              fontWeight: 700,
            }}
          >
            ⚡ Class Gadget:{" "}
            <span
              style={{
                color: hud.gadgetReady ? "var(--acid-volt)" : "var(--ink-muted)",
              }}
            >
              {hud.gadgetReady ? "[Q / F] READY" : "Cooldown"}
            </span>
          </div>
        </div>
      )}

      {/* ===================================================================
          PLAIN-ENGLISH "WHAT IS CHRONO HEIST?" 3-STEP VISUAL GUIDE (In Lobby)
      =================================================================== */}
      {!hud.isRunning && showHowToPlay && (
        <aside className="brutalist-bone how-to-play-card hud-interactive">
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
                  fontSize: "0.74rem",
                  fontWeight: 800,
                  color: "var(--signal-orange)",
                  letterSpacing: "0.04em",
                }}
              >
                WHAT THIS GAME IS ABOUT
              </div>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 800 }}>
                Pull Off a Heist by Teaming Up With Your Past Self
              </h2>
            </div>
            <button
              type="button"
              className="tactical-btn"
              style={{ padding: "4px 10px", fontSize: "0.75rem" }}
              onClick={() => setShowHowToPlay(false)}
            >
              ✕
            </button>
          </div>

          <p
            style={{
              fontSize: "0.84rem",
              lineHeight: 1.4,
              color: "var(--ink-muted)",
              fontWeight: 600,
            }}
          >
            A match lasts <strong>4 Time Loops</strong> (15 seconds each). Every
            move you make is recorded and replayed by your{" "}
            <strong>Past Self</strong> when time rewinds:
          </p>

          <div className="how-step-row">
            <div className="how-step-badge">1</div>
            <div style={{ fontSize: "0.82rem", lineHeight: 1.38 }}>
              <strong>Loop 1 — Hold the Door Switch:</strong> Walk onto the{" "}
              <strong style={{ color: "#0d8a4b" }}>🟢 Green Door Switch</strong>{" "}
              on the left to power open the{" "}
              <strong style={{ color: "var(--infrared-red)" }}>
                🔴 Red Laser Vault Door
              </strong>
              .
            </div>
          </div>

          <div className="how-step-row">
            <div className="how-step-badge">2</div>
            <div style={{ fontSize: "0.82rem", lineHeight: 1.38 }}>
              <strong>Loop 2 — Co-Op With Past You:</strong> Time rewinds!{" "}
              <strong>Past You (Loop 1)</strong> walks onto the switch and holds
              the door open while <strong>You (Loop 2)</strong> run inside to
              steal the{" "}
              <strong style={{ color: "#b88200" }}>
                🔒 Gold Vault Core (+350 Pts)
              </strong>
              !
            </div>
          </div>

          <div className="how-step-row">
            <div className="how-step-badge">3</div>
            <div style={{ fontSize: "0.82rem", lineHeight: 1.38 }}>
              <strong>Loops 3 & 4 — Throw Cores & Stop Rivals:</strong> Press{" "}
              <strong>[E]</strong> to throw Cores to the{" "}
              <strong style={{ color: "var(--signal-orange)" }}>
                🔶 Escape Zone
              </strong>
              , and press <strong>[SPACE]</strong> to knock out{" "}
              <strong style={{ color: "var(--infrared-red)" }}>
                🔴 Red Rival Thieves
              </strong>
              !
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="tactical-btn tactical-btn-primary"
              style={{ flex: 1, justifyContent: "center" }}
              onClick={launchInitiationTutorial}
            >
              ▶ Play 4-Step Interactive Tutorial
            </button>
            <button
              type="button"
              className="tactical-btn tactical-btn-dark"
              onClick={() => launchHeist()}
            >
              ⚡ Start Heist Now
            </button>
          </div>
        </aside>
      )}

      {/* ===================================================================
          CLEAN LOBBY BOTTOM COMMAND DOCK
      =================================================================== */}
      {!hud.isRunning && (
        <section className="lobby-bottom-dock">
          <div
            className="brutalist-bone hud-interactive"
            style={{
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            {/* Mode Switcher Tabs + Primary Deploy Trigger */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "contracts" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("contracts");
                    unityRef.current?.SendMessage(
                      "ChronoGameManager",
                      "SetLobbyViewMode",
                      "overview"
                    );
                  }}
                >
                  🎯 Solo Heist Missions
                </button>

                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "bounties" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("bounties");
                    unityRef.current?.SendMessage(
                      "ChronoGameManager",
                      "SetLobbyViewMode",
                      "overview"
                    );
                  }}
                >
                  ⚔️ Rival PvP Bounties ($UDAO)
                </button>

                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "armory" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("armory");
                    unityRef.current?.SendMessage(
                      "ChronoGameManager",
                      "SetLobbyViewMode",
                      "armory"
                    );
                  }}
                >
                  🛡️ Customize Crew & 3D Loadout ({ownedItems.length})
                </button>

                <button
                  type="button"
                  className={`tactical-btn ${
                    activeDockTab === "daily" ? "tactical-btn-dark" : ""
                  }`}
                  onClick={() => {
                    chronoSynth.trigger("ui_click", 0.6);
                    setActiveDockTab("daily");
                    unityRef.current?.SendMessage(
                      "ChronoGameManager",
                      "SetLobbyViewMode",
                      "overview"
                    );
                  }}
                >
                  🔥 Daily Mutator & Rewards
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  className="tactical-btn"
                  onClick={() =>
                    handleCopyChallengeLink(selectedBountyId || undefined)
                  }
                >
                  🔗 Share Challenge Link (+2% Ref)
                </button>

                <button
                  type="button"
                  className="tactical-btn tactical-btn-primary"
                  onClick={() => launchHeist()}
                >
                  {activeDockTab === "bounties"
                    ? selectedStakeUdao > 0
                      ? `⚡ Start Staked Duel (${selectedStakeUdao} $UDAO → Win ${(
                          selectedStakeUdao * 1.8
                        ).toFixed(0)} $UDAO)`
                      : "⚡ Start Free PvP Raid"
                    : `⚡ Start Mission ${selectedContractTier}`}
                </button>
              </div>
            </div>

            {/* TAB 1: SOLO HEIST MISSIONS */}
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
                            `Beat Mission ${c.contract_tier - 1} first to unlock this mission!`
                          );
                          return;
                        }
                        chronoSynth.trigger("ui_click", 0.6);
                        setSelectedContractTier(c.contract_tier);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: isSel
                          ? "2px solid var(--signal-orange)"
                          : "1.5px solid var(--ink-dark)",
                        background: isSel
                          ? "var(--bg-carbon)"
                          : "var(--bg-bone)",
                        color: isSel ? "var(--ink-light)" : "var(--ink-dark)",
                        cursor: unlocked ? "pointer" : "not-allowed",
                        opacity: unlocked ? 1 : 0.65,
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.72rem",
                          color: isSel
                            ? "var(--acid-volt)"
                            : unlocked
                            ? "var(--signal-orange)"
                            : "var(--ink-muted)",
                          fontWeight: 800,
                        }}
                      >
                        {unlocked
                          ? `Mission ${c.contract_tier} • Score ${c.target_score}+ Pts`
                          : `🔒 Locked (Beat Mission ${c.contract_tier - 1})`}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: "0.88rem" }}>
                        {c.title}
                      </div>
                      <div
                        style={{
                          fontSize: "0.74rem",
                          color: isSel ? "var(--ink-light)" : "var(--ink-muted)",
                        }}
                      >
                        Rival Boss: {c.boss_callsign} • Reward: +{c.reward_gold}{" "}
                        Gold
                        {c.unlocks_class
                          ? ` + Unlocks ${c.unlocks_class
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
                    fontSize: "0.8rem",
                    fontWeight: 600,
                  }}
                >
                  <div>
                    Raid a real player&apos;s recorded 4-loop heist crew and beat
                    their score (Winner takes 90% of pot):
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {[0, 10, 25].map((stk) => (
                      <button
                        key={stk}
                        type="button"
                        className={`tactical-btn ${
                          selectedStakeUdao === stk ? "tactical-btn-dark" : ""
                        }`}
                        style={{ padding: "5px 11px", fontSize: "0.76rem" }}
                        onClick={() => setSelectedStakeUdao(stk)}
                      >
                        {stk === 0
                          ? "Free Practice Raid"
                          : `Stake ${stk} $UDAO → Win ${(stk * 1.8).toFixed(
                              0
                            )} $UDAO`}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
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
                          borderRadius: "8px",
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
                            fontSize: "0.74rem",
                            fontWeight: 800,
                          }}
                        >
                          <span style={{ color: "var(--infrared-red)" }}>
                            {"★".repeat(Math.max(1, b.wanted_stars))} Wanted
                            Raider
                          </span>
                          <span style={{ color: "var(--amber-gold)" }}>
                            {Number(b.stake_udao) > 0
                              ? `${b.stake_udao} $UDAO Stake`
                              : "Free Bounty"}
                          </span>
                        </div>
                        <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>
                          {b.raider_callsign} • Score to Beat: {b.raider_score}{" "}
                          Pts
                        </div>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            opacity: 0.85,
                          }}
                        >
                          Crew:{" "}
                          {(b.raider_crew || [])
                            .map(
                              (c, idx) =>
                                `L${idx + 1}: ${c.replace("_", " ")}`
                            )
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
                          Loop {slot + 1}:{" "}
                          {assigned.replace("_", " ").toUpperCase()}
                        </button>
                      );
                    })}
                  </div>

                  {/* Category Switcher */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {(
                      [
                        ["crew_class", "Operative Classes"],
                        ["skin", "3D Armor Skins"],
                        ["weapon", "Melee Weapons"],
                        ["echo_shader", "Echo Trail Colors"],
                      ] as const
                    ).map(([catKey, label]) => (
                      <button
                        key={catKey}
                        type="button"
                        className={`tactical-btn ${
                          armoryCategory === catKey ? "tactical-btn-dark" : ""
                        }`}
                        style={{ padding: "6px 12px" }}
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
                            borderRadius: "8px",
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
                              fontSize: "0.72rem",
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
                                ? "✓ Equipped"
                                : isOwned
                                ? "Owned — Click to Equip"
                                : item.cost_udao > 0
                                ? `Unlock: ${item.cost_udao} $UDAO`
                                : `Unlock: ${item.cost_gold} Gold`}
                            </span>
                            <span>Rank {item.required_rank}+</span>
                          </div>
                          <div style={{ fontWeight: 800, fontSize: "0.88rem" }}>
                            {item.name}
                          </div>
                          <div
                            style={{
                              fontSize: "0.74rem",
                              lineHeight: 1.35,
                              opacity: 0.9,
                            }}
                          >
                            {item.passive_desc
                              ? `${item.passive_desc} • ${item.gadget_desc}`
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
                    padding: "12px 14px",
                    borderRadius: "8px",
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
                        fontSize: "0.72rem",
                        color: "var(--acid-volt)",
                        fontWeight: 800,
                      }}
                    >
                      24-HOUR SPECIAL RULE HEIST
                    </div>
                    <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>
                      Daily Mutator: Ricochet Overdrive
                    </div>
                    <div
                      style={{
                        fontSize: "0.76rem",
                        color: "var(--bg-putty)",
                        marginTop: "4px",
                      }}
                    >
                      +35% Core Throw Speed, +18% Sprint Speed & 2.5× Throw
                      Bonus Points!
                    </div>
                  </div>
                  <button
                    type="button"
                    className="tactical-btn tactical-btn-primary"
                    onClick={() => launchHeist("contract", true)}
                  >
                    ⚡ Play Daily Mutator Heist
                  </button>
                </div>

                {/* 7-Day Login Streak & Daily Goals */}
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "8px",
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
                        fontSize: "0.72rem",
                        fontWeight: 800,
                        color: "var(--signal-orange)",
                      }}
                    >
                      DAILY LOGIN & BONUS GOALS
                    </div>
                    <div
                      style={{
                        fontSize: "0.78rem",
                        marginTop: "4px",
                        lineHeight: 1.45,
                      }}
                    >
                      • Throw & Catch Passes ({profile?.alley_oops_landed ?? 0}
                      /2)
                      <br />• Knock Out Rival Thieves (
                      {profile?.paradoxes_triggered ?? 0}/2)
                      <br />• Login Streak: Day {profile?.login_streak ?? 1}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="tactical-btn"
                      onClick={() => handleClaimDaily("streak")}
                    >
                      Claim Day {profile?.login_streak ?? 1} Bonus (+150 Gold)
                    </button>
                    <button
                      type="button"
                      className="tactical-btn tactical-btn-dark"
                      onClick={() => handleClaimDaily("directives")}
                    >
                      Claim Goal Cache (+350 Gold)
                    </button>
                  </div>
                </div>

                {/* Daily Anomaly Leaderboard */}
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "8px",
                    border: "1.5px solid var(--ink-dark)",
                    background: "var(--bg-putty)",
                    fontSize: "0.78rem",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: "6px" }}>
                    🏆 Today&apos;s Top Heist Scores
                  </div>
                  {anomalyLeaders.slice(0, 4).map((row, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "3px 0",
                        borderBottom: "1px solid rgba(20,20,19,0.12)",
                      }}
                    >
                      <span>
                        #{idx + 1} {row.callsign}
                      </span>
                      <span style={{ fontWeight: 800 }}>
                        {row.best_score} Pts
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
            padding: "22px",
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            style={{
              fontSize: "0.8rem",
              fontWeight: 800,
              color: settlementModal.won
                ? "var(--signal-orange)"
                : "var(--infrared-red)",
            }}
          >
            {settlementModal.won ? "🎉 HEIST SUCCESS!" : "⚠️ HEIST REPELLED"}
          </div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 800 }}>
            {settlementModal.outcome}
          </h2>

          <div
            className="brutalist-block"
            style={{
              padding: "14px",
              fontSize: "0.84rem",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            <div>
              Your Score:{" "}
              <strong style={{ color: "var(--acid-volt)" }}>
                {settlementModal.player_score} Pts
              </strong>
            </div>
            <div>
              Target Score: <strong>{settlementModal.rival_score} Pts</strong>
            </div>
            <div>
              Gold Earned:{" "}
              <strong style={{ color: "var(--amber-gold)" }}>
                +{settlementModal.gold_earned} Gold
              </strong>
            </div>
            <div>
              XP Earned: <strong>+{settlementModal.xp_earned} XP</strong>
            </div>
            {settlementModal.udao_delta !== 0 && (
              <div style={{ gridColumn: "1 / -1", color: "var(--acid-volt)" }}>
                $UDAO Settlement: {settlementModal.udao_delta > 0 ? "+" : ""}
                {settlementModal.udao_delta.toFixed(2)} $UDAO (90% Winner / 8%
                Treasury / 2% Referral)
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
                🔓 Unlocked New Class:{" "}
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
              ⚡ Play Next Heist Mission
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
              Back to Lobby
            </button>
            <button
              type="button"
              className="tactical-btn"
              onClick={() =>
                handleCopyChallengeLink(selectedBountyId || undefined)
              }
            >
              🔗 Share Challenge Link
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
                  fontSize: "0.74rem",
                  color: "var(--signal-orange)",
                  fontWeight: 800,
                }}
              >
                POLYGON MAINNET (CHAIN ID 137) • ARCADE VAULT
              </div>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 800 }}>
                Gas-Free Session $UDAO Vault
              </h3>
            </div>
            <button
              type="button"
              className="tactical-btn"
              onClick={() => vaultDialogRef.current?.close()}
            >
              Close [ESC]
            </button>
          </div>

          <div
            className="brutalist-block"
            style={{
              padding: "14px",
              fontSize: "0.82rem",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div>
              Operative Wallet: <strong>{formatShortWallet(wallet)}</strong>{" "}
              {isLiveWallet ? "(Polygon Connected)" : "(Guest Session)"}
            </div>
            <div>
              $UDAO Token Contract:{" "}
              <span style={{ color: "var(--ink-muted)" }}>
                {UDAO_CONTRACT_ADDRESS.slice(0, 14)}…
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: "4px",
              }}
            >
              <span>
                Session Vault:{" "}
                <strong style={{ color: "var(--acid-volt)" }}>
                  {Number(profile?.session_udao ?? 0).toFixed(2)} $UDAO
                </strong>
              </span>
              <span>
                Chrono Gold:{" "}
                <strong style={{ color: "var(--amber-gold)" }}>
                  {profile?.chrono_gold ?? 250} Gold
                </strong>
              </span>
            </div>
            <div>
              Referral Earnings (2% Lifetime):{" "}
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
                ? "✓ Polygon Wallet Linked"
                : "Connect Polygon Wallet"}
            </button>

            <input
              type="number"
              min={5}
              max={1000}
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              style={{
                width: "90px",
                padding: "8px 10px",
                borderRadius: "6px",
                fontWeight: 700,
                border: "2px solid var(--ink-dark)",
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
              Deposit $UDAO
            </button>

            <button
              type="button"
              className="tactical-btn"
              onClick={handleVaultWithdraw}
            >
              Withdraw All
            </button>
          </div>

          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--ink-muted)",
              lineHeight: 1.4,
            }}
          >
            Free Solo Missions award off-chain Chrono Gold. Staked PvP Duels are
            100% player-funded: 90% to the Winner, 8% to Protocol Treasury, and
            2% to your Referrer.
          </div>
        </div>
      </dialog>
    </main>
  );
}
