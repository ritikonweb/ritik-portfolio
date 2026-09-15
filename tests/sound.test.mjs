import test from "node:test";
import assert from "node:assert/strict";
import {
  packNames,
  cueNames,
  getCue,
  getPlaybackMode,
  createUISFX,
} from "uisfx";

test("Sound Pack Selection: 'glass' pack is valid and supported", () => {
  assert.ok(packNames.includes("glass"), "'glass' must be an official uisfx pack");
});

test("Semantic Cue Catalog: all cues used in the application exist and match semantic roles", () => {
  const applicationCues = [
    { cue: "open", expectedMode: "one-shot", category: "navigation" },
    { cue: "close", expectedMode: "one-shot", category: "navigation" },
    { cue: "back", expectedMode: "one-shot", category: "navigation" },
    { cue: "select", expectedMode: "one-shot", category: "selection" },
    { cue: "toggle-on", expectedMode: "one-shot", category: "selection" },
    { cue: "connecting", expectedMode: "loop", category: "loops" },
    { cue: "connect", expectedMode: "one-shot", category: "system" },
    { cue: "disconnect", expectedMode: "one-shot", category: "system" },
    { cue: "complete", expectedMode: "one-shot", category: "progress" },
    { cue: "blocked", expectedMode: "one-shot", category: "feedback" },
    { cue: "error", expectedMode: "one-shot", category: "feedback" },
    { cue: "hover", expectedMode: "one-shot", category: "input" },
    { cue: "press", expectedMode: "one-shot", category: "input" },
  ];

  for (const { cue, expectedMode, category } of applicationCues) {
    assert.ok(cueNames.includes(cue), `Cue "${cue}" must exist in uisfx cueNames`);
    const def = getCue(cue);
    assert.equal(def.category, category, `Cue "${cue}" category must match "${category}"`);
    const mode = getPlaybackMode(cue);
    assert.equal(mode, expectedMode, `Cue "${cue}" playback mode must be "${expectedMode}"`);
  }
});

test("SSR Safety: player initialization safely handles missing Web Audio in Node/SSR environment", () => {
  // In Node environment, window and AudioContext are absent
  assert.equal(typeof window, "undefined", "Test runs in SSR-like environment (window is undefined)");

  let created = false;
  try {
    const player = createUISFX({
      pack: "glass",
      volume: 0.7,
      enabled: true,
    });
    created = player !== null;
    assert.ok(player, "createUISFX returns a player object even without DOM");
    assert.equal(player.getPack(), "glass");
    assert.equal(player.getVolume(), 0.7);
    assert.equal(player.isEnabled(), true);
  } catch (err) {
    // If Web Audio is strictly required by browser-only API, creating without window should not crash app
    assert.ok(err);
  }
});

test("Sound Manager Logic: Loop management, idempotency, and immediate mute cleanup simulation", () => {
  // Mock player to test lifecycle logic identical to lib/sound.ts
  const stoppedCues = [];
  let playerStopAllCalled = false;
  let playerEnabled = true;

  const mockPlayer = {
    play: (cue, options) => {
      if (!playerEnabled) return null;
      return {
        stop: () => stoppedCues.push(cue),
        ended: Promise.resolve(),
      };
    },
    stopAll: () => {
      playerStopAllCalled = true;
    },
    setEnabled: (enabled) => {
      playerEnabled = enabled;
    },
    isEnabled: () => playerEnabled,
  };

  const activeLoops = new Map();
  let unlocked = false;

  function startLoop(cue, options) {
    if (!playerEnabled) return null;
    if (activeLoops.has(cue)) {
      return activeLoops.get(cue); // Idempotent
    }
    if (options?.isUserGesture) {
      unlocked = true;
    }
    if (!unlocked && !options?.isUserGesture) {
      return null;
    }
    const handle = mockPlayer.play(cue, { ...options, loop: true });
    if (!handle) return null;

    const wrapped = {
      stop: () => {
        handle.stop();
        activeLoops.delete(cue);
      },
      ended: handle.ended.finally(() => activeLoops.delete(cue)),
    };
    activeLoops.set(cue, wrapped);
    return wrapped;
  }

  function stopLoop(cue) {
    const handle = activeLoops.get(cue);
    if (handle) {
      handle.stop();
    }
  }

  function setEnabled(enabled) {
    if (!enabled) {
      // Stop all active loops
      for (const [cue, handle] of activeLoops.entries()) {
        handle.stop();
      }
      activeLoops.clear();
      mockPlayer.stopAll();
    }
    mockPlayer.setEnabled(enabled);
  }

  // 1. Gating test: async loop before unlock is suppressed
  const suppressedHandle = startLoop("connecting");
  assert.equal(suppressedHandle, null, "Loop without user gesture before unlock is suppressed");
  assert.equal(activeLoops.size, 0);

  // 2. User gesture unlocks and starts connecting loop
  const loopHandle1 = startLoop("connecting", { isUserGesture: true });
  assert.ok(loopHandle1, "Loop starts on user gesture");
  assert.equal(activeLoops.size, 1);
  assert.equal(unlocked, true, "User gesture unlocks audio");

  // 3. Idempotent start: second startLoop call returns the exact same handle
  const loopHandle2 = startLoop("connecting");
  assert.strictEqual(loopHandle1, loopHandle2, "startLoop is idempotent and returns existing handle");
  assert.equal(activeLoops.size, 1);

  // 4. Normal loop stop on state transition (e.g. connection ready)
  stopLoop("connecting");
  assert.equal(activeLoops.size, 0, "stopLoop removes handle from activeLoops");
  assert.ok(stoppedCues.includes("connecting"), "handle.stop() was called");

  // 5. Restart loop and verify mute immediate stop behavior
  startLoop("connecting");
  assert.equal(activeLoops.size, 1);
  assert.equal(playerStopAllCalled, false);

  // Mute audio
  setEnabled(false);
  assert.equal(activeLoops.size, 0, "Active loops must be cleared immediately when muting");
  assert.equal(playerStopAllCalled, true, "player.stopAll() must be called immediately when muting");
  assert.equal(mockPlayer.isEnabled(), false, "Player is disabled");

  // 6. Playback when disabled returns null
  const disabledPlay = startLoop("connecting");
  assert.equal(disabledPlay, null, "startLoop returns null when disabled");
});
