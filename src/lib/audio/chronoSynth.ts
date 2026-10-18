"use client";

/**
 * CHRONO HEIST: PARADOX PROTOCOL
 * Procedural WebAudio Synthesizer Engine (Zero-Latency SFX & Adaptive 4-Loop Pulse)
 * Automatically suspends on tab blur (visibilitychange) so background tabs never drone.
 */

class ChronoSynthEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private pulseInterval: ReturnType<typeof setInterval> | null = null;
  private currentLoopLayer: number = 1;
  private stepIndex: number = 0;

  constructor() {
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!this.ctx) return;
        if (document.hidden) {
          this.ctx.suspend().catch(() => {});
        } else if (!this.isMuted) {
          this.ctx.resume().catch(() => {});
        }
      });
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.isMuted || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.ctx) {
      this.ctx.suspend().catch(() => {});
    } else if (!muted && this.ctx) {
      this.ctx.resume().catch(() => {});
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setLoopIntensity(loopNumber: number) {
    this.currentLoopLayer = Math.max(1, Math.min(4, loopNumber));
  }

  public startAdaptivePulse() {
    this.stopAdaptivePulse();
    const scaleFreqs = [110, 130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66];
    this.stepIndex = 0;

    this.pulseInterval = setInterval(() => {
      if (this.isMuted || (typeof document !== "undefined" && document.hidden)) return;
      const ctx = this.ensureContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const step = this.stepIndex % 8;
      this.stepIndex++;

      // Layer 1: Industrial Sub-Bass Pulse
      const bassOsc = ctx.createOscillator();
      const bassGain = ctx.createGain();
      bassOsc.type = "triangle";
      const rootFreq = step < 4 ? 55 : 65.41;
      bassOsc.frequency.setValueAtTime(rootFreq, now);
      bassGain.gain.setValueAtTime(0.06, now);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      bassOsc.connect(bassGain);
      bassGain.connect(ctx.destination);
      bassOsc.start(now);
      bassOsc.stop(now + 0.17);

      // Layer 2+ (Loops 2-4): Analog Telemetry Arpeggio
      if (this.currentLoopLayer >= 2 && step % 2 === 0) {
        const arpOsc = ctx.createOscillator();
        const arpGain = ctx.createGain();
        arpOsc.type = this.currentLoopLayer >= 4 ? "sawtooth" : "sine";
        const note = scaleFreqs[(step + this.currentLoopLayer) % scaleFreqs.length];
        arpOsc.frequency.setValueAtTime(note * (this.currentLoopLayer >= 3 ? 2 : 1), now);
        arpGain.gain.setValueAtTime(0.028, now);
        arpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        arpOsc.connect(arpGain);
        arpGain.connect(ctx.destination);
        arpOsc.start(now);
        arpOsc.stop(now + 0.12);
      }
    }, 185);
  }

  public stopAdaptivePulse() {
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
  }

  public trigger(eventName: string, intensity: number = 1.0) {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const vol = Math.min(1.2, Math.max(0.1, intensity));

    switch (eventName) {
      case "blade_dash": {
        // High-velocity kinetic blade whoosh + metallic transient
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(95, now + 0.14);
        gain.gain.setValueAtTime(0.14 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.16);
        break;
      }

      case "paradox_shatter": {
        // Sub-bass hit-stop impact + harmonic glass/hologram shatter chord
        const sub = ctx.createOscillator();
        const subGain = ctx.createGain();
        sub.type = "sine";
        sub.frequency.setValueAtTime(140, now);
        sub.frequency.exponentialRampToValueAtTime(34, now + 0.38);
        subGain.gain.setValueAtTime(0.28 * vol, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        sub.connect(subGain);
        subGain.connect(ctx.destination);
        sub.start(now);
        sub.stop(now + 0.42);

        [523.25, 659.25, 987.77, 1318.5].forEach((freq, idx) => {
          const chime = ctx.createOscillator();
          const cGain = ctx.createGain();
          chime.type = "triangle";
          chime.frequency.setValueAtTime(freq, now + idx * 0.025);
          cGain.gain.setValueAtTime(0.09 * vol, now + idx * 0.025);
          cGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.025 + 0.28);
          chime.connect(cGain);
          cGain.connect(ctx.destination);
          chime.start(now + idx * 0.025);
          chime.stop(now + idx * 0.025 + 0.3);
        });
        break;
      }

      case "frontal_parry": {
        // Harsh metallic clang warning when hitting a Rival Echo's 90° Frontal Guard
        const clang = ctx.createOscillator();
        const gain = ctx.createGain();
        clang.type = "square";
        clang.frequency.setValueAtTime(310, now);
        clang.frequency.setValueAtTime(220, now + 0.06);
        gain.gain.setValueAtTime(0.18 * vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        clang.connect(gain);
        gain.connect(ctx.destination);
        clang.start(now);
        clang.stop(now + 0.24);
        break;
      }

      case "alley_oop_catch": {
        // Euphoric rising 3-note chord for catching a past self's pass
        [440, 554.37, 659.25, 880].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, now + idx * 0.035);
          g.gain.setValueAtTime(0.12 * vol, now + idx * 0.035);
          g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.035 + 0.25);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(now + idx * 0.035);
          osc.stop(now + idx * 0.035 + 0.26);
        });
        break;
      }

      case "core_throw":
      case "phase_vent": {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(720, now + 0.14);
        g.gain.setValueAtTime(0.13 * vol, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.17);
        break;
      }

      case "loop_rewind": {
        // Analog tape-rewind sweep between 15s loops
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.28);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.58);
        g.gain.setValueAtTime(0.14 * vol, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.64);
        break;
      }

      case "core_extract":
      case "match_deploy":
      case "match_complete": {
        [329.63, 440, 659.25].forEach((f, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(f, now + i * 0.05);
          g.gain.setValueAtTime(0.12 * vol, now + i * 0.05);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.3);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(now + i * 0.05);
          osc.stop(now + i * 0.05 + 0.32);
        });
        break;
      }

      default: {
        // Crisp industrial telemetry click (pad_engaged, ui_click, core_pickup, etc.)
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.05);
        g.gain.setValueAtTime(0.08 * vol, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
        break;
      }
    }
  }
}

export const chronoSynth = new ChronoSynthEngine();
