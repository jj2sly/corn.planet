extends Node3D
class_name ColdCaseGame

var temperature := 21.0
var mission_phase := "BRIEFING"
var player_speed := 4.5
var mouse_sensitivity := 0.0025
var look_pitch := 0.0

var camera: Camera3D
var player_body: CharacterBody3D
var fridge_door: Node3D
var door_open := false

var interior: Node3D
var pantry: Node3D
var power_room: Node3D
var freezer: Node3D
var milk: Node3D
var outpost: Node3D
var deep_interior: Node3D
var checkpoint: Node3D
var core_repair: Node

var interaction_hint: Label
var objective_label: Label
var temp_label: Label
var status_label: Label
var health_label: Label
var briefing_overlay: ColorRect
var briefing_layer: CanvasLayer
var briefing_active: bool = true

var power_repaired := false
var cooling_repaired := false
var outpost_discovered := false
var checkpoint_active := false
var final_report_shown := false
var core_repaired := false
var milk_defeated := false
var health: float = 100.0
var damage_cooldown: float = 0.0
var core_instability: float = 0.0
var extraction_alarm: float = 0.0
var extraction_active: bool = false
var debrief_layer: CanvasLayer
var last_zone: String = "KITCHEN"
var chuck_assistance: bool = false
var core_repair_step: int = 0
var core_repair_lock: float = 0.0
var return_detail_changed: bool = false
var ice_cream: Node3D
var ice_cream_defeated: bool = false
var ice_cream_extreme_time: float = 0.0
var extraction_flash: float = 0.0
var scanner_label: Label
var alert_label: Label

func _ready() -> void:
    player_body = $Player
    camera = $Player/Camera
    fridge_door = $World/Refrigerator/Door
    _build_hud()
    _build_briefing()
    core_repair = load("res://games/cold_case/core_repair.gd").new()
    add_child(core_repair)
    core_repair.completed.connect(_on_core_repaired)
    Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
    if briefing_active and event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_E:
        briefing_active = false
        if briefing_overlay != null:
            briefing_layer.queue_free()
        Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
        return
    if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
        player_body.rotate_y(-event.relative.x * mouse_sensitivity)
        look_pitch = clamp(look_pitch - event.relative.y * mouse_sensitivity, -1.35, 1.35)
        camera.rotation.x = look_pitch
    elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_E:
        _interact()
    elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
        Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
    elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
        Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _physics_process(delta: float) -> void:
    _move_player(delta)
    _update_zone_state(delta)
    _update_survival(delta)
    _update_core_instability(delta)
    _update_ice_cream(delta)
    core_repair_lock = maxf(0.0, core_repair_lock - delta)
    if extraction_active:
        extraction_alarm = maxf(0.0, extraction_alarm - delta)
    if milk != null and not milk_defeated:
        var active_milk: ColdCaseMilk = milk as ColdCaseMilk
        if active_milk != null and active_milk.defeated_state:
            milk_defeated = true
            status_label.text = "THREAT  //  MILK CARTON NEUTRALIZED"
    if mission_phase == "BRIEFING" and not door_open and _near_fridge():
        _toggle_fridge()
    temp_label.text = "TEMP  //  %0.1f C" % temperature
    if scanner_label != null:
        scanner_label.text = "CPST SCANNER  //  %s  //  DEPTH %02dM" % [mission_phase, int(absf(player_body.position.z))]
    if alert_label != null:
        alert_label.text = "CORE ALERT" if core_instability > 0.72 else ("EXTRACTION %02dS" % int(extraction_alarm) if extraction_active else "SYSTEMS NOMINAL")
    health_label.text = "VITALS  //  %03d%%" % int(health)
    interaction_hint.visible = _has_interaction()

func _move_player(delta: float) -> void:
    var x: float = 0.0
    var z: float = 0.0
    if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
        x -= 1.0
    if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
        x += 1.0
    if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
        z -= 1.0
    if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
        z += 1.0

    var input: Vector2 = Vector2(x, z).normalized()
    var direction: Vector3 = (player_body.transform.basis * Vector3(input.x, 0, input.y)).normalized()
    player_body.velocity.x = direction.x * player_speed
    player_body.velocity.z = direction.z * player_speed
    player_body.velocity.y = 0.0
    player_body.move_and_slide()
    player_body.position.x = clamp(player_body.position.x, -5.5, 5.5)
    player_body.position.y = 1.0
    player_body.position.z = clamp(player_body.position.z, -88.0, 2.0)

func _update_zone_state(delta: float) -> void:
    if mission_phase == "BRIEFING":
        temperature = move_toward(temperature, 21.0, delta * 0.3)
        if door_open:
            mission_phase = "INTERIOR_DISCOVERED"
            objective_label.text = "OBJECTIVE  //  Enter the refrigerator"
        return

    if mission_phase == "INTERIOR_DISCOVERED":
        temperature = move_toward(temperature, 4.0, delta * 0.7)
        var doorway_distance: float = player_body.global_position.distance_to(fridge_door.global_position)
        if player_body.global_position.z < -0.2 or doorway_distance < 3.2:
            _enter_refrigerator()
        return

    temperature = move_toward(temperature, -2.0 if player_body.position.z < -50.0 else 4.0, delta * 0.15)

    if player_body.position.z < -12.0 and mission_phase == "INSIDE":
        mission_phase = "PANTRY"
        objective_label.text = "OBJECTIVE  //  Investigate the food storage"
        status_label.text = "ZONE  //  PANTRY"
    elif player_body.position.z < -30.0 and mission_phase == "PANTRY":
        mission_phase = "POWER"
        objective_label.text = "OBJECTIVE  //  Restore refrigerator power"
        status_label.text = "ZONE  //  POWER SYSTEM"
    elif player_body.position.z < -49.0 and mission_phase == "POWER" and power_repaired:
        mission_phase = "FREEZER"
        objective_label.text = "OBJECTIVE  //  Repair the cooling system"
        status_label.text = "ZONE  //  FREEZER CAVERN"
    elif player_body.position.z < -63.0 and mission_phase == "FREEZER" and cooling_repaired:
        mission_phase = "DEEP_INTERIOR"
        objective_label.text = "OBJECTIVE  //  Investigate the deeper anomaly"
        status_label.text = "ZONE  //  DEEP INTERIOR"
    elif mission_phase == "DEEP_INTERIOR" and player_body.position.z < -72.0:
        mission_phase = "STABILIZING"
        core_instability = 0.35
        objective_label.text = "OBJECTIVE  //  Repair the refrigerator core"
        status_label.text = "SYSTEM  //  CORE INSTABILITY"
    elif mission_phase == "STABILIZING" and core_repaired:
        mission_phase = "STABILIZED"
        extraction_active = true
        extraction_alarm = 30.0
        objective_label.text = "OBJECTIVE  //  EXTRACTION — RETURN TO THE ORIGINAL DOOR"
        status_label.text = "ALARM  //  REFRIGERATOR STABILIZED — EXTRACT NOW"
        temperature = -2.0
    if mission_phase == "STABILIZED" and player_body.position.z > -1.0 and not final_report_shown:
        _complete_mission()
        return_detail_changed = true
    if mission_phase == "STABILIZED" and extraction_alarm <= 0.0 and not final_report_shown:
        status_label.text = "ALARM  //  EXTRACTION WINDOW EXPIRED"
        health = maxf(1.0, health - delta * 8.0)


func _update_core_instability(delta: float) -> void:
    if mission_phase != "STABILIZING":
        return
    core_instability = minf(1.0, core_instability + delta * 0.012)
    if deep_interior != null:
        var deep_script: ColdCaseDeepInterior = deep_interior as ColdCaseDeepInterior
        if deep_script != null:
            deep_script.instability = core_instability
    if core_instability > 0.72:
        status_label.text = "WARNING  //  CORE INSTABILITY %03d%%" % int(core_instability * 100.0)
        temperature = move_toward(temperature, -18.0, delta * 0.4)

func _update_survival(delta: float) -> void:
    damage_cooldown = maxf(0.0, damage_cooldown - delta)
    if milk == null or mission_phase == "BRIEFING" or mission_phase == "COMPLETE":
        return
    var milk_script: ColdCaseMilk = milk as ColdCaseMilk
    if milk_script == null or not milk_script.active or milk_script.defeated_state:
        return
    var distance: float = player_body.global_position.distance_to(milk_script.global_position)
    if distance < 1.8 and damage_cooldown <= 0.0:
        health = maxf(0.0, health - 10.0)
        damage_cooldown = 0.8
        status_label.text = "THREAT  //  FOOD CONTACT  -10"
        if health <= 0.0:
            _respawn_player()

func _respawn_player() -> void:
    health = 100.0
    damage_cooldown = 1.5
    var respawn_position: Vector3 = Vector3(0, 1.0, 2.0)
    if checkpoint != null:
        var checkpoint_script: ColdCaseCheckpoint = checkpoint as ColdCaseCheckpoint
        if checkpoint_script != null and checkpoint_script.is_active():
            respawn_position = checkpoint.global_position + Vector3(0, 1.0, 2.0)
    player_body.global_position = respawn_position
    status_label.text = "CPST  //  RESPONDED AT LAST STABILIZED CHECKPOINT"

func _interact() -> void:
    if mission_phase == "BRIEFING" and _near_fridge():
        _toggle_fridge()
        return

    if mission_phase == "INTERIOR_DISCOVERED" and player_body.position.z < -0.8:
        _enter_refrigerator()
        return

    if mission_phase == "PANTRY" and _near_temperature_control():
        var pantry_script: ColdCasePantry = pantry as ColdCasePantry
        status_label.text = pantry_script.cycle_temperature_control()
        pantry_script.trigger_milk_response()
        if milk != null:
            var controlled_milk: ColdCaseMilk = milk as ColdCaseMilk
            controlled_milk.set_temperature(pantry_script.temperature)
        return

    if mission_phase == "PANTRY" and _near_milk():
        var pantry_script := pantry as ColdCasePantry
        pantry_script.trigger_milk_response()
        var milk_script: ColdCaseMilk = milk as ColdCaseMilk
        milk_script.set_temperature(pantry_script.temperature)
        if pantry_script.milk_awake:
            milk_script.set_temperature(pantry_script.temperature)
            status_label.text = "THREAT  //  MILK CARTON ACTIVE"
            objective_label.text = "OBJECTIVE  //  Move deeper into the refrigerator"
        return

    if mission_phase == "POWER" and _near_power_panel():
        var power_script := power_room as ColdCasePowerRoom
        power_script.interact()
        status_label.text = "REPAIR  //  " + power_script.current_step()
        if power_script.repaired:
            power_repaired = true
            if checkpoint != null:
                var checkpoint_script: ColdCaseCheckpoint = checkpoint as ColdCaseCheckpoint
                if checkpoint_script != null:
                    checkpoint_script.activate()
            objective_label.text = "OBJECTIVE  //  Reach the deeper cooling system"
            status_label.text = "SYSTEM  //  POWER RESTORED"
        return

    if mission_phase == "DEEP_INTERIOR" and _near_outpost():
        _discover_outpost()
        return

    if mission_phase == "STABILIZING" and _near_core():
        _interact_core()
        return

    if mission_phase == "FREEZER" and _near_ice_cream():
        _interact_ice_cream()
        return

    if mission_phase == "FREEZER" and _near_freezer_unit():
        var freezer_script: ColdCaseFreezer = freezer as ColdCaseFreezer
        status_label.text = "REPAIR  //  " + freezer_script.interact_repair()
        if freezer_script.repaired:
            cooling_repaired = true
            objective_label.text = "OBJECTIVE  //  Enter the deeper refrigerator interior"
            status_label.text = "SYSTEM  //  COOLING STABLE"
        return

func _toggle_fridge() -> void:
    if door_open:
        return
    door_open = true
    var tween := create_tween()
    tween.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
    tween.tween_property(fridge_door, "rotation:y", deg_to_rad(105.0), 0.45)
    mission_phase = "INTERIOR_DISCOVERED"
    objective_label.text = "OBJECTIVE  //  Enter the refrigerator"
    interaction_hint.text = "E  ENTER"

func _build_interior() -> void:
    var packed := load("res://games/cold_case/interior.tscn") as PackedScene
    if packed:
        interior = packed.instantiate()
        interior.position = Vector3(0, 0, 0)
        add_child(interior)

    var pantry_scene := load("res://games/cold_case/pantry.tscn") as PackedScene
    if pantry_scene:
        pantry = pantry_scene.instantiate()
        pantry.position = Vector3(0, 0, -18)
        add_child(pantry)

    var power_scene := load("res://games/cold_case/power_room.tscn") as PackedScene
    if power_scene:
        power_room = power_scene.instantiate()
        power_room.position = Vector3(0, 0, -34)
        add_child(power_room)

    var freezer_scene := load("res://games/cold_case/freezer.tscn") as PackedScene
    if freezer_scene:
        freezer = freezer_scene.instantiate()
        freezer.position = Vector3(0, 0, -52)
        add_child(freezer)

    var deep_scene := load("res://games/cold_case/deep_interior.tscn") as PackedScene
    if deep_scene:
        deep_interior = deep_scene.instantiate()
        deep_interior.position = Vector3(0, 0, -68)
        add_child(deep_interior)

    var outpost_scene := load("res://games/cold_case/outpost.tscn") as PackedScene
    if outpost_scene:
        outpost = outpost_scene.instantiate()
        outpost.position = Vector3(0, 0, -61)
        add_child(outpost)

    var checkpoint_scene := load("res://games/cold_case/checkpoint.tscn") as PackedScene
    if checkpoint_scene:
        checkpoint = checkpoint_scene.instantiate()
        checkpoint.position = Vector3(0, 0, -50)
        add_child(checkpoint)

    var milk_scene: PackedScene = load("res://games/cold_case/milk.tscn") as PackedScene
    if milk_scene:
        milk = milk_scene.instantiate()
        milk.position = Vector3(0, 0.6, -26.0)
        add_child(milk)

    var ice_scene: PackedScene = load("res://games/cold_case/ice_cream.tscn") as PackedScene
    if ice_scene:
        ice_cream = ice_scene.instantiate()
        ice_cream.position = Vector3(3.5, 0.8, -58.0)
        add_child(ice_cream)

func _has_interaction() -> bool:
    if mission_phase == "BRIEFING":
        return _near_fridge()
    if mission_phase == "INTERIOR_DISCOVERED":
        return position.z < -0.8
    if mission_phase == "PANTRY":
        return _near_milk() or _near_temperature_control()
    if mission_phase == "POWER":
        return _near_power_panel()
    if mission_phase == "FREEZER":
        return _near_freezer_unit() or _near_ice_cream()
    if mission_phase == "DEEP_INTERIOR":
        return _near_outpost()
    if mission_phase == "STABILIZING":
        return _near_core()
    return false

func _near_fridge() -> bool:
    return player_body.global_position.distance_to(fridge_door.global_position) < 2.8

func _near_milk() -> bool:
    return milk != null and player_body.global_position.distance_to(milk.global_position) < 3.0

func _near_temperature_control() -> bool:
    return pantry != null and player_body.global_position.distance_to(pantry.global_position + Vector3(4.8, 2.2, -1.0)) < 3.0

func _near_power_panel() -> bool:
    return power_room != null and player_body.global_position.distance_to(power_room.global_position + Vector3(0, 1.6, -3.9)) < 3.5

func _near_outpost() -> bool:
    return outpost != null and player_body.global_position.distance_to(outpost.global_position + Vector3(0, 0.8, -4.0)) < 4.0

func _discover_outpost() -> void:
    if outpost_discovered:
        return
    outpost_discovered = true
    var script: ColdCaseOutpost = outpost as ColdCaseOutpost
    script.discover()
    chuck_assistance = true
    objective_label.text = "OBJECTIVE  //  Continue toward the refrigerator core"
    status_label.text = "TECHNICIAN AREA  //  OUTPOST DISCOVERED"

func _near_core() -> bool:
    return deep_interior != null and player_body.global_position.distance_to(deep_interior.global_position + Vector3(0, 1.0, -4.0)) < 4.0

func _interact_core() -> void:
    if core_repair == null or core_repair_lock > 0.0:
        return
    core_repair_lock = 0.6
    core_repair_step += 1
    var result: String = core_repair.interact()
    status_label.text = "CORE REPAIR  //  " + result
    if not core_repaired:
        objective_label.text = "OBJECTIVE  //  COMPLETE CORE REPAIR STEP %d/4" % min(core_repair_step, 4)
        core_instability = minf(1.0, core_instability + 0.04)
        if chuck_assistance:
            core_instability = maxf(0.0, core_instability - 0.015)
    else:
        objective_label.text = "OBJECTIVE  //  Return to the refrigerator door"

func _on_core_repaired() -> void:
    core_repaired = true
    core_instability = 0.0
    if deep_interior != null:
        var deep_script: ColdCaseDeepInterior = deep_interior as ColdCaseDeepInterior
        if deep_script != null:
            deep_script.stabilize()
    temperature = -2.0
    status_label.text = "SYSTEM  //  CORE STABILIZED"
    objective_label.text = "OBJECTIVE  //  Return to the refrigerator door"

func _near_ice_cream() -> bool:
    return ice_cream != null and player_body.global_position.distance_to(ice_cream.global_position) < 3.0

func _interact_ice_cream() -> void:
    if ice_cream_defeated or ice_cream == null:
        return
    if temperature > -4.0:
        status_label.text = "THREAT  //  ICE CREAM CREATURE AGITATED"
        health = maxf(0.0, health - 5.0)
        return
    ice_cream_extreme_time += 0.75
    status_label.text = "THREAT  //  FREEZE RESPONSE %02d%%" % int(minf(100.0, ice_cream_extreme_time / 4.0 * 100.0))
    if ice_cream_extreme_time >= 4.0:
        ice_cream_defeated = true
        ice_cream.queue_free()
        status_label.text = "THREAT  //  ICE CREAM CREATURE NEUTRALIZED"

func _update_ice_cream(delta: float) -> void:
    if ice_cream == null or ice_cream_defeated:
        return
    if mission_phase != "FREEZER":
        return
    if temperature <= -14.0:
        ice_cream_extreme_time = minf(4.0, ice_cream_extreme_time + delta * 0.35)
    else:
        ice_cream_extreme_time = maxf(0.0, ice_cream_extreme_time - delta * 0.15)

func _near_freezer_unit() -> bool:
    return freezer != null and player_body.global_position.distance_to(freezer.global_position + Vector3(0, 2.0, -7.0)) < 3.5

func _enter_refrigerator() -> void:
    if interior == null:
        _build_interior()
    mission_phase = "INSIDE"
    temperature = 4.0
    objective_label.text = "OBJECTIVE  //  Explore the refrigerator"
    status_label.text = "ZONE  //  INTERIOR"
    $World.visible = false
    camera.position = Vector3(0, 0.65, 0.0)

func _complete_mission() -> void:
    final_report_shown = true
    mission_phase = "COMPLETE"
    objective_label.text = "MISSION COMPLETE  //  REFRIGERATOR STABILIZED"
    status_label.text = "FINAL READING  //  -273.15 C"
    interaction_hint.visible = false
    _show_final_report()

func _build_hud() -> void:
    var layer := CanvasLayer.new()
    add_child(layer)

    objective_label = Label.new()
    objective_label.position = Vector2(32, 28)
    objective_label.add_theme_font_size_override("font_size", 20)
    objective_label.text = "OBJECTIVE  //  Inspect the refrigerator"
    layer.add_child(objective_label)

    temp_label = Label.new()
    temp_label.position = Vector2(32, 62)
    temp_label.add_theme_font_size_override("font_size", 17)
    layer.add_child(temp_label)

    status_label = Label.new()
    status_label.position = Vector2(32, 92)
    status_label.add_theme_font_size_override("font_size", 15)
    status_label.text = "ZONE  //  KITCHEN"
    layer.add_child(status_label)

    scanner_label = Label.new()
    scanner_label.position = Vector2(32, 150)
    scanner_label.add_theme_font_size_override("font_size", 13)
    scanner_label.text = "CPST SCANNER  //  LINKED"
    layer.add_child(scanner_label)

    alert_label = Label.new()
    alert_label.position = Vector2(880, 28)
    alert_label.add_theme_font_size_override("font_size", 16)
    alert_label.text = "SYSTEMS NOMINAL"
    layer.add_child(alert_label)

    health_label = Label.new()
    health_label.position = Vector2(32, 120)
    health_label.add_theme_font_size_override("font_size", 15)
    health_label.text = "VITALS  //  100%"
    layer.add_child(health_label)

    interaction_hint = Label.new()
    interaction_hint.position = Vector2(540, 620)
    interaction_hint.text = "E  INTERACT"
    interaction_hint.add_theme_font_size_override("font_size", 18)
    interaction_hint.visible = false
    layer.add_child(interaction_hint)

func _show_final_report() -> void:
    var report_layer: CanvasLayer = CanvasLayer.new()
    add_child(report_layer)
    var panel: ColorRect = ColorRect.new()
    panel.position = Vector2(250, 150)
    panel.size = Vector2(780, 430)
    panel.color = Color(0.02, 0.025, 0.028, 0.96)
    report_layer.add_child(panel)

    var title: Label = Label.new()
    title.position = Vector2(34, 26)
    title.text = "CPST // MISSION DEBRIEF"
    title.add_theme_font_size_override("font_size", 26)
    panel.add_child(title)

    var body: Label = Label.new()
    body.position = Vector2(36, 82)
    body.size = Vector2(700, 270)
    body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    body.add_theme_font_size_override("font_size", 16)
    var technician_status: String = "CHUCK LOCATED" if outpost_discovered else "NOT LOCATED"
    var food_status: String = "MILK + ICE CREAM NEUTRALIZED" if milk_defeated and ice_cream_defeated else ("MILK NEUTRALIZED" if milk_defeated else ("ICE CREAM NEUTRALIZED" if ice_cream_defeated else "FOOD THREATS ACTIVE"))
    var assistance_status: String = "CHUCK ASSISTED CORE REPAIR" if chuck_assistance else "NO TECHNICIAN ASSISTANCE"
    body.text = "CASE  //  COLD CASE\nSTATUS  //  STABILIZED — MONITORING REQUIRED\n\nSYSTEMS REPAIRED  //  POWER / COOLING / CORE\nTECHNICIAN  //  " + technician_status + "\nASSISTANCE  //  " + assistance_status + "\nFOOD THREAT  //  " + food_status + "\nANOMALY  //  REFRIGERATOR REMAINS UNDER OBSERVATION\nFINAL READING  //  -273.15 C\n\nNOTE  //  CASE REMAINS OPEN"
    panel.add_child(body)

    var close_button: Button = Button.new()
    close_button.position = Vector2(36, 365)
    close_button.size = Vector2(210, 42)
    close_button.text = "RETURN TO CPI PARTY"
    close_button.pressed.connect(func(): report_layer.queue_free())
    panel.add_child(close_button)

func _build_briefing() -> void:
    briefing_layer = CanvasLayer.new()
    add_child(briefing_layer)
    briefing_overlay = ColorRect.new()
    briefing_overlay.position = Vector2(180, 110)
    briefing_overlay.size = Vector2(920, 500)
    briefing_overlay.color = Color(0.015, 0.02, 0.023, 0.97)
    briefing_layer.add_child(briefing_overlay)

    var header: Label = Label.new()
    header.position = Vector2(42, 30)
    header.text = "CPST // FIELD DEPLOYMENT BRIEFING"
    header.add_theme_font_size_override("font_size", 28)
    briefing_overlay.add_child(header)

    var case_label: Label = Label.new()
    case_label.position = Vector2(44, 82)
    case_label.text = "CASE  COLD CASE     PRIORITY  UNRESOLVED"
    case_label.add_theme_font_size_override("font_size", 14)
    briefing_overlay.add_child(case_label)

    var brief: Label = Label.new()
    brief.position = Vector2(44, 132)
    brief.size = Vector2(820, 250)
    brief.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    brief.add_theme_font_size_override("font_size", 18)
    brief.text = "A CPI refrigerator has developed anomalous internal behavior.\n\nEnter the appliance, restore its damaged systems, investigate the deeper interior, and stabilize the refrigerator.\n\nThe interior is largely uncharted. Temperature conditions may change the environment and the behavior of food inside.\n\nA CPI technician named Chuck was the last known technician assigned to the appliance. Locate him if possible.\n\nPRIMARY DIRECTIVE  //  STABILIZE THE REFRIGERATOR\nEXTRACTION  //  RETURN THROUGH THE ORIGINAL DOOR"
    briefing_overlay.add_child(brief)

    var prompt: Label = Label.new()
    prompt.position = Vector2(44, 420)
    prompt.text = "E  //  ACCEPT BRIEFING AND BEGIN DEPLOYMENT"
    prompt.add_theme_font_size_override("font_size", 17)
    briefing_overlay.add_child(prompt)
