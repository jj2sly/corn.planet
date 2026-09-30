extends Node2D
class_name ColdCaseGame

const MAP_BOUNDS := Rect2(40, 40, 1880, 980)
const INTERACT_DISTANCE := 92.0

const ROOMS := [
    {"id":"KITCHEN","name":"KITCHEN","rect":Rect2(80, 330, 300, 300),"temp":21.0},
    {"id":"ENTRY","name":"REFRIGERATOR ENTRY","rect":Rect2(420, 330, 280, 300),"temp":5.0},
    {"id":"PANTRY","name":"FOOD STORAGE","rect":Rect2(740, 160, 360, 300),"temp":4.0},
    {"id":"POWER","name":"POWER ROOM","rect":Rect2(740, 520, 360, 300),"temp":3.0},
    {"id":"FREEZER","name":"FREEZER","rect":Rect2(1140, 160, 340, 300),"temp":-8.0},
    {"id":"OUTPOST","name":"TECHNICIAN OUTPOST","rect":Rect2(1140, 520, 340, 300),"temp":1.0},
    {"id":"CORE","name":"DEEP INTERIOR","rect":Rect2(1520, 280, 340, 420),"temp":-14.0},
]

const CONNECTIONS := [
    Rect2(360, 410, 80, 140),
    Rect2(680, 410, 80, 140),
    Rect2(890, 440, 60, 100),
    Rect2(1080, 260, 80, 120),
    Rect2(1080, 620, 80, 120),
    Rect2(1460, 360, 80, 240),
]

const INTERACTIONS := {
    "FRIDGE": Vector2(360, 480),
    "THERMOSTAT": Vector2(1030, 240),
    "POWER": Vector2(1030, 690),
    "FREEZER": Vector2(1390, 240),
    "OUTPOST": Vector2(1320, 670),
    "CORE": Vector2(1710, 490),
    "EXIT": Vector2(120, 480),
}

var mission_phase := "BRIEFING"
var objective := "Open the refrigerator"
var temperature := 21.0
var health := 100.0
var power_repaired := false
var cooling_repaired := false
var outpost_discovered := false
var chuck_found := false
var core_repaired := false
var extraction_active := false
var mission_complete := false
var thermostat_step := 0
var power_step := 0
var cooling_step := 0
var current_room := "KITCHEN"

var player: ColdCasePlayer
var hud: ColdCaseMissionHud
var temperature_controller: ColdCaseTemperatureController
var core_repair: ColdCaseCoreRepair
var checkpoint: ColdCaseCheckpoint
var milk: ColdCaseFoodThreat

func _ready() -> void:
    player = $Player as ColdCasePlayer
    hud = $MissionHud as ColdCaseMissionHud

    temperature_controller = ColdCaseTemperatureController.new()
    add_child(temperature_controller)
    temperature_controller.set_immediate(21.0)

    core_repair = ColdCaseCoreRepair.new()
    add_child(core_repair)
    core_repair.completed.connect(_on_core_repaired)

    checkpoint = ColdCaseCheckpoint.new()
    checkpoint.position = Vector2(1185, 680)
    add_child(checkpoint)

    milk = ColdCaseFoodThreat.new()
    milk.position = Vector2(890, 300)
    milk.set_target(player)
    milk.damaged_player.connect(_on_food_damage)
    milk.defeated.connect(_on_food_defeated)
    add_child(milk)

    player.interact_requested.connect(_interact)
    hud.set_objective(objective)
    hud.set_repair("MISSION BRIEFING")
    hud.set_status("CPST // COLD CASE // TOP-DOWN PROTOTYPE")
    queue_redraw()

func _physics_process(delta: float) -> void:
    player.position.x = clampf(player.position.x, MAP_BOUNDS.position.x, MAP_BOUNDS.end.x)
    player.position.y = clampf(player.position.y, MAP_BOUNDS.position.y, MAP_BOUNDS.end.y)

    current_room = _room_at(player.position)
    var target_temp := _temperature_for_room(current_room)
    if current_room == "OUTPOST" and outpost_discovered:
        target_temp = 8.0
    temperature_controller.set_target(target_temp)
    temperature_controller.tick(delta)
    temperature = temperature_controller.temperature

    if milk != null and is_instance_valid(milk):
        milk.set_temperature(temperature)

    if temperature < -10.0:
        health = maxf(1.0, health - delta * 1.4)
    elif current_room == "OUTPOST" and outpost_discovered:
        health = minf(100.0, health + delta * 2.5)

    hud.set_temperature(temperature)
    hud.set_status("%s  //  VITALS %03d%%" % [current_room, int(health)])
    hud.set_interaction(_interaction_prompt())

func _draw() -> void:
    draw_rect(MAP_BOUNDS, Color(0.015, 0.025, 0.03), true)
    for connection in CONNECTIONS:
        draw_rect(connection, Color(0.11, 0.16, 0.18), true)
        draw_rect(connection, Color(0.38, 0.52, 0.55), false, 3.0)

    for room in ROOMS:
        var rect: Rect2 = room["rect"]
        var color := Color(0.08, 0.12, 0.14)
        if room["id"] == "KITCHEN":
            color = Color(0.18, 0.16, 0.13)
        elif room["id"] == "FREEZER" or room["id"] == "CORE":
            color = Color(0.07, 0.14, 0.20)
        elif room["id"] == "OUTPOST":
            color = Color(0.12, 0.16, 0.12)
        draw_rect(rect, color, true)
        draw_rect(rect, Color(0.42, 0.58, 0.62), false, 4.0)
        draw_string(ThemeDB.fallback_font, rect.position + Vector2(18, 30), String(room["name"]), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color(0.82, 0.90, 0.90))

    _draw_interaction("FRIDGE", Color(0.95, 0.82, 0.22))
    _draw_interaction("THERMOSTAT", Color(0.40, 0.78, 0.95))
    _draw_interaction("POWER", Color(0.95, 0.70, 0.20))
    _draw_interaction("FREEZER", Color(0.40, 0.78, 0.95))
    _draw_interaction("OUTPOST", Color(0.45, 0.90, 0.50))
    _draw_interaction("CORE", Color(0.95, 0.35, 0.30))
    if extraction_active:
        _draw_interaction("EXIT", Color(0.45, 0.95, 0.55))

func _draw_interaction(id: String, color: Color) -> void:
    var point: Vector2 = INTERACTIONS[id]
    draw_circle(point, 13.0, color)
    draw_arc(point, 20.0, 0.0, TAU, 24, color, 2.0)

func _room_at(point: Vector2) -> String:
    for room in ROOMS:
        if (room["rect"] as Rect2).has_point(point):
            return String(room["id"])
    return "CORRIDOR"

func _temperature_for_room(id: String) -> float:
    for room in ROOMS:
        if String(room["id"]) == id:
            return float(room["temp"])
    return 2.0

func _nearest_interaction() -> String:
    var closest := ""
    var distance := INTERACT_DISTANCE
    for id in INTERACTIONS:
        if id == "EXIT" and not extraction_active:
            continue
        var next_distance := player.position.distance_to(INTERACTIONS[id])
        if next_distance < distance:
            closest = id
            distance = next_distance
    return closest

func _interaction_prompt() -> String:
    var target := _nearest_interaction()
    if target.is_empty():
        return ""
    var label := {
        "FRIDGE":"OPEN REFRIGERATOR",
        "THERMOSTAT":"ADJUST TEMPERATURE",
        "POWER":"REPAIR POWER",
        "FREEZER":"REPAIR COOLING",
        "OUTPOST":"SEARCH TECHNICIAN OUTPOST",
        "CORE":"STABILIZE CORE",
        "EXIT":"EXTRACT",
    }.get(target, "INTERACT")
    return "E  //  " + String(label)

func _interact() -> void:
    var target := _nearest_interaction()
    if target.is_empty():
        return

    match target:
        "FRIDGE":
            if mission_phase == "BRIEFING":
                mission_phase = "INSIDE"
                objective = "Investigate food storage"
                hud.message("REFRIGERATOR INTERIOR ACCESSED")
        "THERMOSTAT":
            if mission_phase == "INSIDE" or mission_phase == "PANTRY":
                mission_phase = "PANTRY"
                thermostat_step += 1
                hud.set_repair("THERMOSTAT CALIBRATION %d/2" % mini(thermostat_step, 2))
                if thermostat_step >= 2:
                    objective = "Restore refrigerator power"
                    hud.message("FOOD STORAGE TEMPERATURE SHIFTED")
        "POWER":
            if thermostat_step >= 2 and not power_repaired:
                power_step += 1
                hud.set_repair("POWER RELAYS %d/3" % mini(power_step, 3))
                if power_step >= 3:
                    power_repaired = true
                    checkpoint.activate()
                    objective = "Repair the cooling system"
                    hud.message("POWER RESTORED")
        "FREEZER":
            if power_repaired and not cooling_repaired:
                cooling_step += 1
                hud.set_repair("COOLING ARRAY %d/3" % mini(cooling_step, 3))
                if cooling_step >= 3:
                    cooling_repaired = true
                    objective = "Search the technician outpost"
                    hud.message("COOLING ARRAY STABILIZED")
        "OUTPOST":
            if cooling_repaired and not outpost_discovered:
                outpost_discovered = true
                chuck_found = true
                objective = "Reach and stabilize the refrigerator core"
                hud.message("MISSING TECHNICIAN LOCATED")
        "CORE":
            if cooling_repaired and not core_repaired:
                hud.set_repair(core_repair.interact())
        "EXIT":
            if extraction_active:
                _complete_mission()

    hud.set_objective(objective)
    queue_redraw()

func _on_core_repaired() -> void:
    core_repaired = true
    extraction_active = true
    objective = "Return to the kitchen and extract"
    hud.set_objective(objective)
    hud.set_repair("CORE STABLE")
    hud.message("STABILIZED — EXTRACTION ROUTE OPEN")
    queue_redraw()

func _on_food_damage(amount: float) -> void:
    health = maxf(0.0, health - amount)
    hud.message("FOOD THREAT CONTACT  //  -%d" % int(amount))
    if health <= 0.0:
        health = 100.0
        player.position = checkpoint.position if checkpoint.is_active() else Vector2(180, 480)
        hud.message("CPST RESPONSE // RETURNED TO LAST STABILIZED CHECKPOINT")

func _on_food_defeated() -> void:
    hud.message("FOOD THREAT NEUTRALIZED")

func _complete_mission() -> void:
    if mission_complete:
        return
    mission_complete = true
    extraction_active = false
    mission_phase = "COMPLETE"
    objective = "Mission complete"
    hud.set_objective(objective)
    hud.set_repair("STABILIZED — MONITORING REQUIRED")
    hud.message("CPI COLD CASE // EXTRACTION COMPLETE")
    queue_redraw()
