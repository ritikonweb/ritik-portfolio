"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { CueName, PlayOptions, PlayingSFX } from "uisfx";
import { getSoundManager } from "@/lib/sound";

interface SoundContextValue {
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  toggleSound: () => void;
  volume: number;
  setVolume: (vol: number) => void;
  play: (
    cue: CueName,
    options?: PlayOptions & { isUserGesture?: boolean }
  ) => PlayingSFX | null;
  startLoop: (
    cue: CueName,
    options?: PlayOptions & { isUserGesture?: boolean }
  ) => PlayingSFX | null;
  stopLoop: (cue: CueName) => void;
  stopAll: () => void;
  unlock: () => Promise<boolean>;
  isUnlocked: boolean;
}

const SoundContext = createContext<SoundContextValue | null>(null);

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(true);
  const [volume, setVolumeState] = useState<number>(0.7);
  const [unlocked, setUnlockedState] = useState<boolean>(false);

  useEffect(() => {
    const manager = getSoundManager();
    setEnabledState(manager.isEnabled());
    setVolumeState(manager.getVolume());
    setUnlockedState(manager.isAudioUnlocked());

    // Auto-unlock Web Audio on the first genuine user gesture
    const handleGesture = () => {
      void manager.unlock().then((res) => {
        if (res) setUnlockedState(true);
      });
    };

    window.addEventListener("pointerdown", handleGesture, {
      capture: true,
      once: true,
    });
    window.addEventListener("keydown", handleGesture, {
      capture: true,
      once: true,
    });

    return () => {
      window.removeEventListener("pointerdown", handleGesture, {
        capture: true,
      });
      window.removeEventListener("keydown", handleGesture, { capture: true });
    };
  }, []);

  const setSoundEnabled = useCallback((nextEnabled: boolean) => {
    const manager = getSoundManager();
    manager.setEnabled(nextEnabled);
    setEnabledState(nextEnabled);
  }, []);

  const toggleSound = useCallback(() => {
    const manager = getSoundManager();
    const next = !manager.isEnabled();
    manager.setEnabled(next);
    setEnabledState(next);
    if (next) {
      // Play toggle-on cue after turning on
      manager.play("toggle-on", { isUserGesture: true });
    }
  }, []);

  const setVolume = useCallback((nextVol: number) => {
    const manager = getSoundManager();
    manager.setVolume(nextVol);
    setVolumeState(nextVol);
  }, []);

  const play = useCallback(
    (
      cue: CueName,
      options?: PlayOptions & { isUserGesture?: boolean }
    ): PlayingSFX | null => {
      const manager = getSoundManager();
      return manager.play(cue, options);
    },
    []
  );

  const startLoop = useCallback(
    (
      cue: CueName,
      options?: PlayOptions & { isUserGesture?: boolean }
    ): PlayingSFX | null => {
      const manager = getSoundManager();
      return manager.startLoop(cue, options);
    },
    []
  );

  const stopLoop = useCallback((cue: CueName) => {
    const manager = getSoundManager();
    manager.stopLoop(cue);
  }, []);

  const stopAll = useCallback(() => {
    const manager = getSoundManager();
    manager.stopAll();
  }, []);

  const unlock = useCallback(async () => {
    const manager = getSoundManager();
    const res = await manager.unlock();
    setUnlockedState(manager.isAudioUnlocked());
    return res;
  }, []);

  const value: SoundContextValue = {
    soundEnabled: enabled,
    setSoundEnabled,
    toggleSound,
    volume,
    setVolume,
    play,
    startLoop,
    stopLoop,
    stopAll,
    unlock,
    isUnlocked: unlocked,
  };

  return (
    <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
  );
}

export function useSound(): SoundContextValue {
  const ctx = useContext(SoundContext);
  if (!ctx) {
    // SSR or unmounted fallback
    return {
      soundEnabled: true,
      setSoundEnabled: () => {},
      toggleSound: () => {},
      volume: 0.7,
      setVolume: () => {},
      play: () => null,
      startLoop: () => null,
      stopLoop: () => {},
      stopAll: () => {},
      unlock: async () => false,
      isUnlocked: false,
    };
  }
  return ctx;
}
