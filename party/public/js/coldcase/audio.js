// CPI: Cold Case — sound. Everything plays through the party's one sound system
// (games/mycob-sound.js): the simulation's cues become short effects, and the room the agent is in
// sets the looping ambience (refrigerator hum, cold wind, the power-loss alarm, the core's drone).

import { playSfx, setAmbience, stopAmbience } from "../games/mycob-sound.js";

const HUM = { KITCHEN: 60, ENTRY: 58, CENTRAL: 52, PANTRY: 55, POWER: 48, FREEZER: 64, SERVICE: 50, OUTPOST: 46, DEEP: 41, CORE: 36 };

export function createAudio() {
  function onEvent(state, e) {
    const p = state.player;
    if (e.type === "sound") playSfx(String(e.cue));
    else if (e.type === "hurt") playSfx("cc_hurt", { volume: 0.8 });
    else if (e.type === "hazard") {
      const d = Math.hypot(Number(e.x) - p.x, Number(e.y) - p.y);
      if (d < 11) playSfx(e.kind === "spark" ? "cc_arc" : "cc_vent", { volume: Math.max(0.15, 1 - d / 11) });
    }
  }

  function update(state, paused) {
    if (paused || state.phase === "BRIEFING" || state.phase === "COMPLETE") {
      stopAmbience();
      return;
    }
    const p = state.player;
    const zone = state.zones[p.zone];
    const f = state.flags;
    const inside = zone.id !== "KITCHEN";
    setAmbience("hum", inside ? 0.85 : 0.3, { freq: HUM[zone.id] ?? 55 });
    setAmbience("wind", Math.max(0, Math.min(1, -zone.temp / 24)) * (inside ? 1 : 0));
    const alarm = (!f.powerRestored && ["CENTRAL", "POWER", "PANTRY", "ENTRY"].includes(zone.id) && f.entered) || (f.coreStage === 3 && zone.id === "CORE");
    setAmbience("alarm", alarm ? (zone.id === "POWER" || zone.id === "CORE" ? 0.9 : 0.45) : 0);
    const core = state.map.core;
    const d = Math.hypot(p.x - core.x, p.y - core.y);
    setAmbience("drone", !f.coreStabilized ? Math.max(0, 1 - d / 22) : Math.max(0, 0.4 - d / 30));
  }

  return { onEvent, update, stop: stopAmbience };
}
