extends Node3D
class_name ColdCaseGame

var temperature := 21.0
var mission_phase := "BRIEFING"
var player_speed := 4.5
var mouse_sensitivity := 0.0025
var look_pitch := 0.0

var camera: Camera3D
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

var power_repaired := false
var cooling_repaired := false
var outpost_discovered := false
var checkpoint_active := false
var final_report_shown := false
var core_repaired := false

func _ready() -> void:
    camera = $Camera
    fridge_door = $World/Refrigerator/Door
    _build_hud()
    core_repair = load("res://games/cold_case/core_repair.gd").new()
    add_child(core_repair)
    core_repair.completed.connect(_on_core_repaired)
    Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
        rotate_y(-event.relative.x * mouse_sensitivity)
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
    temp_label.text = "TEMP  //  %0.1f C" % temperature
    interaction_hint.visible = _has_interaction()

func _move_player(delta: float) -> void:
    var x := 0.0
    var z := 0.0
    if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
        x -= 1.0
    if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
        x += 1.0
    if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
        z -= 1.0
    if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
        z += 1.0

    var input := Vector2(x, z).normalized()
    var direction := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
    position += direction * player_speed * delta
    position.x = clamp(position.x, -6.0, 6.0)
    position.y = 0.0
    position.z = clamp(position.z, -90.0, 4.0)

func _update_zone_state(delta: float) -> void:
    if mission_phase == "BRIEFING":
        temperature = move_toward(temperature, 21.0, delta * 0.3)
        if door_open:
            mission_phase = "INTERIOR_DISCOVERED"
            objective_label.text = "OBJECTIVE  //  Enter the refrigerator"
        return

    if mission_phase == "INTERIOR_DISCOVERED":
        temperature = move_toward(temperature, 4.0, delta * 0.7)
        if position.z < -1.0:
            mission_phase = "INSIDE"
            objective_label.text = "OBJECTIVE  //  Explore the refrigerator"
        return

    temperature = move_toward(temperature, -2.0 if position.z < -50.0 else 4.0, delta * 0.15)

    if position.z < -12.0 and mission_phase == "INSIDE":
        mission_phase = "PANTRY"
        objective_label.text = "OBJECTIVE  //  Investigate the food storage"
        status_label.text = "ZONE  //  PANTRY"
    elif position.z < -30.0 and mission_phase == "PANTRY":
        mission_phase = "POWER"
        objective_label.text = "OBJECTIVE  //  Restore refrigerator power"
        status_label.text = "ZONE  //  POWER SYSTEM"
    elif position.z < -49.0 and mission_phase == "POWER" and power_repaired:
        mission_phase = "FREEZER"
        objective_label.text = "OBJECTIVE  //  Repair the cooling system"
        status_label.text = "ZONE  //  FREEZER CAVERN"
    elif position.z < -63.0 and mission_phase == "FREEZER" and cooling_repaired:
        mission_phase = "DEEP_INTERIOR"
        objective_label.text = "OBJECTIVE  //  Investigate the deeper anomaly"
        status_label.text = "ZONE  //  DEEP INTERIOR"
    elif mission_phase == "DEEP_INTERIOR" and position.z < -72.0:
        mission_phase = "STABILIZING"
        objective_label.text = "OBJECTIVE  //  Repair the refrigerator core"
        status_label.text = "SYSTEM  //  CORE INSTABILITY"
    elif mission_phase == "STABILIZING" and core_repaired and position.z > -63.0:
        mission_phase = "STABILIZED"
        objective_label.text = "OBJECTIVE  //  Return to the refrigerator door"
        status_label.text = "SYSTEM  //  STABILIZED"
        temperature = -2.0
    if mission_phase == "STABILIZED" and position.z > -1.0 and not final_report_shown:
        _complete_mission()

func _interact() -> void:
    if mission_phase == "BRIEFING" and _near_fridge():
        _toggle_fridge()
        return

    if mission_phase == "INTERIOR_DISCOVERED" and position.z < -0.8:
        _enter_refrigerator()
        return

    if mission_phase == "PANTRY" and _near_milk():
        var pantry_script := pantry as ColdCasePantry
        pantry_script.trigger_milk_response()
        var milk_script := milk as ColdCaseMilk
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
            objective_label.text = "OBJECTIVE  //  Reach the deeper cooling system"
            status_label.text = "SYSTEM  //  POWER RESTORED"
        return

    if mission_phase == "DEEP_INTERIOR" and _near_outpost():
        _discover_outpost()
        return

    if mission_phase == "STABILIZING":
        _interact_core()
        return

    if mission_phase == "FREEZER" and _near_freezer_unit():
        var freezer_script := freezer as ColdCaseFreezer
        status_label.text = "REPAIR  //  " + freezer_script.interact_repair()
        if freezer_script.repaired:
            cooling_repaired = true
            objective_label.text = "OBJECTIVE  //  Return to the refrigerator door"
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

    var milk_scene := load("res://games/cold_case/milk.tscn") as PackedScene
    if milk_scene:
        milk = milk_scene.instantiate()
        milk.position = Vector3(0, 0.6, -26.0)
        add_child(milk)

func _has_interaction() -> bool:
    if mission_phase == "BRIEFING":
        return _near_fridge()
    if mission_phase == "INTERIOR_DISCOVERED":
        return position.z < -0.8
    if mission_phase == "PANTRY":
        return _near_milk()
    if mission_phase == "POWER":
        return _near_power_panel()
    if mission_phase == "FREEZER":
        return _near_freezer_unit()
    if mission_phase == "DEEP_INTERIOR":
        return _near_outpost()
    if mission_phase == "STABILIZING":
        return true
    return false

func _near_fridge() -> bool:
    return global_position.distance_to(fridge_door.global_position) < 2.8

func _near_milk() -> bool:
    return milk != null and global_position.distance_to(milk.global_position) < 3.0

func _near_power_panel() -> bool:
    return power_room != null and global_position.distance_to(power_room.global_position + Vector3(0, 1.6, -3.9)) < 3.5

func _near_outpost() -> bool:
    return outpost != null and global_position.distance_to(outpost.global_position + Vector3(0, 0.8, -4.0)) < 4.0

func _discover_outpost() -> void:
    if outpost_discovered:
        return
    outpost_discovered = true
    var script := outpost as ColdCaseOutpost
    script.discover()
    objective_label.text = "OBJECTIVE  //  Continue toward the refrigerator core"
    status_label.text = "TECHNICIAN AREA  //  OUTPOST DISCOVERED"

func _interact_core() -> void:
    if core_repair == null:
        return
    status_label.text = "CORE REPAIR  //  " + core_repair.interact()
    objective_label.text = "OBJECTIVE  //  " + ("Complete core stabilization" if not core_repaired else "Return to the refrigerator door")

func _on_core_repaired() -> void:
    core_repaired = true
    temperature = -2.0
    status_label.text = "SYSTEM  //  CORE STABILIZED"
    objective_label.text = "OBJECTIVE  //  Return to the refrigerator door"

func _near_freezer_unit() -> bool:
    return freezer != null and global_position.distance_to(freezer.global_position + Vector3(0, 2.0, -7.0)) < 3.5

func _enter_refrigerator() -> void:
    if interior == null:
        _build_interior()
    mission_phase = "INSIDE"
    temperature = 4.0
    objective_label.text = "OBJECTIVE  //  Explore the refrigerator"
    status_label.text = "ZONE  //  INTERIOR"
    $World.visible = false
    camera.position = Vector3(0, 1.65, 3.0)
    var tween := create_tween()
    tween.tween_property(camera, "position", Vector3(0, 1.65, -1.0), 1.4)
    tween.set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)

func _complete_mission() -> void:
    final_report_shown = true
    mission_phase = "COMPLETE"
    objective_label.text = "MISSION COMPLETE  //  REFRIGERATOR STABILIZED"
    status_label.text = "FINAL READING  //  -273.15 C"
    interaction_hint.visible = false

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

    interaction_hint = Label.new()
    interaction_hint.position = Vector2(540, 620)
    interaction_hint.text = "E  INTERACT"
    interaction_hint.add_theme_font_size_override("font_size", 18)
    interaction_hint.visible = false
    layer.add_child(interaction_hint)
