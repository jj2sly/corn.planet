// The CPI Party sound catalog: which trigger tags exist, which games use which tags, and how a
// game's sound list (its "rows") is built and checked. Shared by the server (defaults, validation),
// the sound manager (playback) and Moderation → Sound effects.
//
// A trigger tag is what game code asks to play ("success", "budget_approved"). A row says "this
// sound plays for this tag in this game": a file under /sounds/mycob/, or a built-in placeholder
// tone ("synth:<tag>"). Several enabled rows on one tag means one is picked at random each time.
// No enabled rows on a tag means silence.
//
// Every game has its own rows, so retagging a sound in Channel Cob never touches Angry Thud's.
// "lobby" covers the Steam My Deck menus, which play outside any one game, so it is marked GLOBAL.
//
// A moderator's saved list remembers which triggers it was saved with. A trigger added to the game
// later starts with its default sounds in that list (nobody chose otherwise yet); a trigger the
// moderator emptied stays silent.

/**
 * id -> { label, base?, since? }. `base`: a game-specific tag starts with that tag's sounds and
 * tone. `since: 2`: added after saved lists began recording their triggers, so a list saved before
 * that doesn't cover it.
 */
export const SOUND_TAGS = {
  game_start: { label: "Game start" },
  alert: { label: "Alert / alarm" },
  timer_warning: { label: "Timer running out" },
  response_in: { label: "Response filed" },
  success: { label: "Success" },
  major_failure: { label: "Failure" },
  discovery: { label: "Discovery / new info" },
  chaos_up: { label: "Chaos rises" },
  life_lost: { label: "Life lost" },
  vote_start: { label: "Vote starts" },
  vote_result: { label: "Vote result" },
  contained: { label: "Contained / victory" },
  terminated: { label: "Terminated" },
  escaped: { label: "Escaped" },
  everyone_dies: { label: "Everyone dies" },
  game_end: { label: "Game end / final results" },
  device_boot: { label: "Device boot" },
  ui_click: { label: "Menu click" },
  achievement: { label: "Achievement" },
  jump: { label: "Jump" },
  land: { label: "Land" },
  plank_place: { label: "Plank placed" },
  hazard_arm: { label: "Hazard arms" },
  tilt_creak: { label: "Tilt creak" },
  deck_shake: { label: "Deck shake" },
  static: { label: "Static" },
  thud_cow: { label: "Red cow" },
  thud_weather: { label: "Weather" },
  thud_nest: { label: "Nest" },
  thud_donate: { label: "Kernels donated" },
  thud_victory: { label: "Victory" },
  thud_defeat: { label: "Defeat" },
  thud_stretch: { label: "Slingshot stretch" },
  thud_launch: { label: "Launch" },
  thud_break: { label: "Block breaks" },
  thud_pig_hit: { label: "Pig hit" },
  thud_pig_pop: { label: "Pig pops" },
  thud_boom: { label: "Explosion" },
  thud_ability: { label: "Bird ability" },
  thud_lightning: { label: "Lightning" },
  thud_tornado: { label: "Tornado" },
  thud_repair: { label: "Repair" },
  thud_build: { label: "Build" },
  thud_nest_hatch: { label: "Nest hatches" },
  thud_lob: { label: "Lob" },
  thud_splash: { label: "Splash" },
  thud_shield: { label: "Shield" },
  thud_clone: { label: "Clone" },
  thud_purge: { label: "Purge" },
  thud_kernels: { label: "Kernels" },
  thud_breed: { label: "Breeding" },
  thud_chain: { label: "Chain reaction" },
  // Budget Cuts
  budget_briefing: { label: "Cycle briefing", base: "alert" },
  budget_approved: { label: "Budget approved", base: "success" },
  budget_rejected: { label: "Budget rejected", base: "vote_result" },
  emergency_allocation: { label: "Emergency allocation", base: "major_failure" },
  incident_alarm: { label: "Incident alarm", base: "alert" },
  incident_resolved: { label: "Incident handled", base: "success" },
  incident_failed: { label: "Incident failed", base: "major_failure" },
  department_failure: { label: "Department failed", base: "major_failure" },
  // Channel Cob
  broadcast_intro: { label: "Channel Cob intro", base: "game_start" },
  breaking_news: { label: "Breaking-news sting", base: "alert" },
  live_transition: { label: "Going live", base: "vote_start" },
  incoming_update: { label: "Incoming private update", base: "discovery" },
  scoop: { label: "Went live with breaking news", base: "alert" },
  decision_made: { label: "On-air decision", base: "response_in" },
  broadcast_error: { label: "Broadcast error / missed it", base: "major_failure" },
  segment_end: { label: "Segment ends", base: "vote_result" },
  segment_good: { label: "Good segment", base: "success" },
  segment_bad: { label: "Bad segment", base: "major_failure" },
  final_results: { label: "Final results", base: "game_end" },
  // The host screen's case-file launch (every game) and Cornlashing's cob scoreboard
  launch_shuffle: { label: "Launch: papers land", since: 2 },
  launch_stamp: { label: "Launch: stamp", since: 2 },
  launch_pop: { label: "Launch: title pops", since: 2 },
  cob_pop: { label: "Cob scoreboard: kernels pop", since: 2 },
  cob_sting: { label: "Cob scoreboard: top agent", since: 2 },
};

const THUD = Object.keys(SOUND_TAGS).filter((t) => t.startsWith("thud_"));

/** Games (registry ids) that use the sound system, and the tags each one plays. */
export const SOUND_SCOPES = {
  lobby: { name: "Steam My Deck menus", global: true, tags: ["device_boot", "ui_click", "achievement", "launch_shuffle", "launch_stamp", "launch_pop"] },
  chaos: { tags: ["cob_pop", "cob_sting"] },
  mycob: { tags: ["game_start", "alert", "timer_warning", "response_in", "success", "major_failure", "discovery", "chaos_up", "life_lost", "vote_start", "vote_result", "contained", "terminated", "escaped", "everyone_dies", "game_end"] },
  steamdeck: { tags: ["game_start", "alert", "timer_warning", "success", "major_failure", "discovery", "life_lost", "vote_result", "contained", "escaped", "jump", "land", "plank_place", "hazard_arm", "tilt_creak", "ui_click", "deck_shake", "achievement", "static"] },
  thud: { tags: ["game_start", "alert", "success", "major_failure", "discovery", "contained", "everyone_dies", "vote_start", "achievement", "ui_click", ...THUD] },
  budgetcuts: { tags: ["game_start", "budget_briefing", "vote_start", "budget_approved", "budget_rejected", "emergency_allocation", "incident_alarm", "incident_resolved", "incident_failed", "department_failure", "final_results"] },
  channelcob: { tags: ["broadcast_intro", "breaking_news", "live_transition", "incoming_update", "scoop", "decision_made", "broadcast_error", "segment_end", "segment_good", "segment_bad", "final_results"] },
};

export const SOUND_FAMILIES = {
  ui: { label: "UI / menu", gain: 0.68, cooldown: 0.06, priority: 0 },
  movement: { label: "Movement / texture", gain: 0.62, cooldown: 0.08, priority: 0 },
  action: { label: "Action", gain: 0.76, cooldown: 0.1, priority: 1 },
  info: { label: "Information", gain: 0.78, cooldown: 0.2, priority: 1 },
  tension: { label: "Warning / tension", gain: 0.82, cooldown: 0.55, priority: 2 },
  result: { label: "Result", gain: 0.9, cooldown: 0.45, priority: 3 },
  critical: { label: "Critical event", gain: 0.94, cooldown: 0.8, priority: 4 },
};

const FAMILY_OVERRIDES = {
  device_boot: "ui", ui_click: "ui", achievement: "result",
  jump: "movement", land: "movement", tilt_creak: "movement", static: "movement",
  plank_place: "action", response_in: "action", decision_made: "action",
  discovery: "info", incoming_update: "info", budget_briefing: "info",
  timer_warning: "tension", alert: "tension", hazard_arm: "tension", incident_alarm: "tension",
  breaking_news: "tension", live_transition: "tension", scoop: "tension",
  success: "result", vote_start: "info", vote_result: "result", budget_approved: "result",
  budget_rejected: "result", incident_resolved: "result", segment_end: "result", segment_good: "result",
  game_start: "result", broadcast_intro: "result", final_results: "result", game_end: "result",
  major_failure: "critical", life_lost: "critical", contained: "critical", terminated: "critical",
  escaped: "critical", everyone_dies: "critical", emergency_allocation: "critical",
  incident_failed: "critical", department_failure: "critical", broadcast_error: "critical",
  segment_bad: "critical", deck_shake: "critical",
  launch_shuffle: "movement", launch_stamp: "action", launch_pop: "result",
  cob_pop: "movement", cob_sting: "result",
};

/** Shared audio-direction policy for a cue. Games still choose the clip; this controls how it sits in the mix. */
export function soundPolicy(tag) {
  let family = FAMILY_OVERRIDES[tag];
  if (!family && tag.startsWith("thud_")) {
    family = /victory|defeat|cow|boom|lightning|tornado|chain/.test(tag) ? "critical"
      : /weather|pig_pop|ability|breed|clone|purge/.test(tag) ? "result"
      : /launch|break|pig_hit|repair|build|nest|lob|splash|shield|kernels|donate/.test(tag) ? "action"
      : "movement";
  }
  if (!family) family = "action";
  return { family, ...SOUND_FAMILIES[family] };
}

export const SOUND_BASE = "/sounds/mycob/";
const TAG_RE = /^[a-z][a-z0-9_]{0,39}$/;
const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_\-./]{0,199}\.(mp3|ogg|wav|m4a)$/;

/** The tag whose built-in tone and default sounds a tag uses. */
export const baseTag = (tag) => SOUND_TAGS[tag]?.base ?? tag;

/** sounds.json value -> { files, volume }. */
function manifestEntry(manifest, tag) {
  const value = manifest?.[tag];
  const entry = typeof value === "string" || Array.isArray(value) ? { files: value } : (value ?? {});
  const files = [entry.files ?? []].flat().filter((f) => typeof f === "string" && f);
  const volume = typeof entry.volume === "number" ? Math.min(2, Math.max(0, entry.volume)) : 1;
  return { files, volume };
}

/** A game's sounds before any moderator has touched them: what sounds.json says, else the tone. */
export function defaultRows(scopeId, manifest) {
  const scope = SOUND_SCOPES[scopeId];
  if (!scope) return [];
  const rows = [];
  for (const tag of scope.tags) {
    let { files, volume } = manifestEntry(manifest, tag);
    if (!files.length && baseTag(tag) !== tag) ({ files, volume } = manifestEntry(manifest, baseTag(tag)));
    if (files.length) for (const f of files) rows.push({ id: `${tag}:${f}`, source: `file:${f}`, tag, enabled: true, volume });
    else rows.push({ id: `${tag}:synth`, source: `synth:${baseTag(tag)}`, tag, enabled: true, volume: 1 });
  }
  return rows;
}

/**
 * A moderator's saved rows plus the default rows for any trigger the game gained after they were
 * saved. `savedTags`: the triggers the list was saved with, or null for a list saved before lists
 * recorded them (it covers every trigger that existed then: those without `since`).
 */
export function withNewTriggers(scopeId, rows, savedTags, manifest) {
  const scope = SOUND_SCOPES[scopeId];
  if (!scope) return rows;
  const covered = new Set(Array.isArray(savedTags) ? savedTags : scope.tags.filter((t) => !SOUND_TAGS[t]?.since));
  const added = new Set(scope.tags.filter((t) => !covered.has(t)));
  if (!added.size) return rows;
  const ids = new Set(rows.map((r) => r.id));
  return [...rows, ...defaultRows(scopeId, manifest).filter((r) => added.has(r.tag) && !ids.has(r.id))];
}

/**
 * Checks a moderator's rows for a game. `files` is every sound file the server has. Returns clean
 * rows or a string saying what is wrong.
 */
export function checkRows(scopeId, rows, files) {
  const scope = SOUND_SCOPES[scopeId];
  if (!scope) return "Unknown game.";
  if (!Array.isArray(rows) || rows.length > 300) return "Rows must be a list.";
  const out = [];
  const ids = new Set();
  for (const r of rows) {
    if (typeof r !== "object" || r === null) return "Bad row.";
    const id = String(r.id ?? "");
    if (!id || id.length > 120 || ids.has(id)) return "Every sound needs its own id.";
    ids.add(id);
    if (typeof r.tag !== "string" || !TAG_RE.test(r.tag) || !scope.tags.includes(r.tag)) return `“${r.tag}” isn't a trigger this game uses.`;
    const source = String(r.source ?? "");
    if (source.startsWith("file:")) {
      const f = source.slice(5);
      if (!FILE_RE.test(f) || f.includes("..") || !files.has(f)) return `No sound file “${f}”.`;
    } else if (source.startsWith("synth:")) {
      if (!SOUND_TAGS[source.slice(6)]) return "Unknown built-in tone.";
    } else return "Unknown sound source.";
    const volume = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(2, Math.max(0, r.volume)) : 1;
    out.push({ id, source, tag: r.tag, enabled: r.enabled !== false, volume });
  }
  return out;
}
