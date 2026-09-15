"use client";

import {
  createUISFX,
  type CueName,
  type PackName,
  type PlayOptions,
  type PlayingSFX,
  type UISFXPlayer,
} from "uisfx";

export const SOUND_PACK: PackName = "glass";
export const DEFAULT_VOLUME = 0.7;
const PREFERENCE_KEY = "ritik:sound:enabled";
const VOLUME_KEY = "ritik:sound:volume";

class SoundManager {
  private player: UISFXPlayer | null = null;
  private activeLoops = new Map<CueName, PlayingSFX>();
  private unlocked = false;
  private enabled = true;
  private volume = DEFAULT_VOLUME;
  private isBrowser = typeof window !== "undefined";

  constructor() {
    if (!this.isBrowser) return;

    // Load initial preference from localStorage
    try {
      const savedPref = localStorage.getItem(PREFERENCE_KEY);
      if (savedPref !== null) {
        this.enabled = savedPref === "true";
      }
      const savedVol = localStorage.getItem(VOLUME_KEY);
      if (savedVol !== null) {
        const parsed = parseFloat(savedVol);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          this.volume = parsed;
        }
      }
    } catch {
      // Storage unavailable (e.g. private mode)
    }

    // Lazy initialization of UISFX player
    this.initPlayer();
  }

  private initPlayer() {
    if (!this.isBrowser || this.player) return;

    try {
      this.player = createUISFX({
        pack: SOUND_PACK,
        volume: this.volume,
        enabled: this.enabled,
        preferences: {
          key: PREFERENCE_KEY,
        },
      });
    } catch (err) {
      console.warn("[uisfx] Failed to initialize audio player:", err);
      this.player = null;
    }
  }

  public isAudioUnlocked(): boolean {
    return this.unlocked;
  }

  /**
   * Unlock Web Audio from a genuine user interaction (pointer or keyboard event).
   * Safe to call multiple times; idempotent.
   */
  public async unlock(): Promise<boolean> {
    if (!this.isBrowser) return false;
    if (this.unlocked) return true;

    if (!this.player) {
      this.initPlayer();
    }
    if (!this.player) return false;

    try {
      const result = await this.player.unlock();
      this.unlocked = true;
      return result;
    } catch {
      return false;
    }
  }

  /**
   * Play a one-shot cue or custom play configuration.
   * Suppresses background/async cues if audio hasn't been unlocked yet.
   */
  public play(
    cue: CueName,
    options?: PlayOptions & { isUserGesture?: boolean }
  ): PlayingSFX | null {
    if (!this.isBrowser || !this.enabled) return null;

    if (!this.player) {
      this.initPlayer();
    }
    if (!this.player) return null;

    // If this is triggered directly by a user gesture, mark as unlocked
    if (options?.isUserGesture) {
      this.unlocked = true;
    }

    // Suppress async/background cues if not yet unlocked to prevent stale audio queue
    if (!this.unlocked && !options?.isUserGesture) {
      return null;
    }

    try {
      const handle = this.player.play(cue, options);
      return handle ?? null;
    } catch (err) {
      console.warn(`[uisfx] Failed to play cue "${cue}":`, err);
      return null;
    }
  }

  /**
   * Start a looping cue (loading, processing, recording, connecting, scanning, streaming).
   * Loop starts are idempotent. If already active, returns existing handle.
   */
  public startLoop(
    cue: CueName,
    options?: PlayOptions & { isUserGesture?: boolean }
  ): PlayingSFX | null {
    if (!this.isBrowser || !this.enabled) return null;

    // Idempotent: return existing active loop if already running
    const existing = this.activeLoops.get(cue);
    if (existing) {
      return existing;
    }

    if (options?.isUserGesture) {
      this.unlocked = true;
    }

    if (!this.unlocked && !options?.isUserGesture) {
      return null;
    }

    if (!this.player) {
      this.initPlayer();
    }
    if (!this.player) return null;

    try {
      const handle = this.player.play(cue, { ...options, loop: true });
      if (!handle) return null;

      const wrappedHandle: PlayingSFX = {
        stop: () => {
          try {
            handle.stop();
          } catch {
            // Safe ignore
          } finally {
            this.activeLoops.delete(cue);
          }
        },
        ended: handle.ended.finally(() => {
          this.activeLoops.delete(cue);
        }),
      };

      this.activeLoops.set(cue, wrappedHandle);
      return wrappedHandle;
    } catch (err) {
      console.warn(`[uisfx] Failed to start loop "${cue}":`, err);
      return null;
    }
  }

  /**
   * Stop an active loop and clear its retained handle.
   */
  public stopLoop(cue: CueName): void {
    const handle = this.activeLoops.get(cue);
    if (handle) {
      try {
        handle.stop();
      } catch {
        // Safe ignore
      } finally {
        this.activeLoops.delete(cue);
      }
    }
  }

  /**
   * Stop all active loops and clear handles.
   */
  public stopAllLoops(): void {
    this.activeLoops.forEach((handle) => {
      try {
        handle.stop();
      } catch {
        // Safe ignore
      }
    });
    this.activeLoops.clear();
  }

  /**
   * Immediately mute or unmute audio.
   * If disabling: stops active loops, clears retained handles, and calls player.stopAll().
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    try {
      localStorage.setItem(PREFERENCE_KEY, String(enabled));
    } catch {
      // Safe ignore
    }

    if (!enabled) {
      // Stop all active loops first
      this.stopAllLoops();
      // Call stopAll() on player so mute is immediate
      if (this.player) {
        try {
          this.player.stopAll();
        } catch {
          // Safe ignore
        }
      }
    }

    if (this.player) {
      this.player.setEnabled(enabled);
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set playback volume (0 to 1).
   */
  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.volume = clamped;

    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      // Safe ignore
    }

    if (this.player) {
      this.player.setVolume(clamped);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  /**
   * Stop all audio immediately.
   */
  public stopAll(): void {
    this.stopAllLoops();
    if (this.player) {
      try {
        this.player.stopAll();
      } catch {
        // Safe ignore
      }
    }
  }

  /**
   * Cleanly teardown and dispose player.
   */
  public async destroy(): Promise<void> {
    this.stopAll();
    if (this.player) {
      try {
        await this.player.destroy();
      } catch {
        // Safe ignore
      }
      this.player = null;
    }
  }
}

// Client-side singleton instance
let instance: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!instance) {
    instance = new SoundManager();
  }
  return instance;
}
