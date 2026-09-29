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
var interaction_hint: Label
var objective_label: Label
var temp_label: Label

func _ready() -> void:
    camera = $Camera
    fridge_door = $World/Refrigerator/Door
    _build_hud()
    Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
        rotate_y(-event.relative.x * mouse_sensitivity)
        look_pitch = clamp(look_pitch - event.relative.y * mouse_sensitivity, -1.35, 1.35)
        camera.rotation.x = look_pitch
    elif event is InputEventKey and event.pressed and event.keycode == KEY_E:
        if mission_phase == "INTERIOR_DISCOVERED" and door_open and _near_fridge():
            _enter_refrigerator()
        elif mission_phase == "BRIEFING" and _near_fridge():
            _toggle_fridge()
    elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
        Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _physics_process(delta: float) -> void:
    temperature = move_toward(temperature, 21.0 if mission_phase == "BRIEFING" else 4.0, delta * 0.3)
    temp_label.text = "TEMP  //  %0.1f C" % temperature
    if mission_phase == "INSIDE":
        return
    var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
    var direction := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
    position += direction * player_speed * delta
    position.x = clamp(position.x, -5.3, 5.3)
    position.z = clamp(position.z, -3.8, 4.0)
    interaction_hint.visible = _near_fridge()

func _near_fridge() -> bool:
    return global_position.distance_to(fridge_door.global_position) < 2.6

func _toggle_fridge() -> void:
    door_open = true
    var tween := create_tween()
    tween.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
    tween.tween_property(fridge_door, "rotation:y", deg_to_rad(105.0), 0.45)
    mission_phase = "INTERIOR_DISCOVERED"
    objective_label.text = "OBJECTIVE  //  Enter the refrigerator"
    interaction_hint.text = "E  ENTER"

func _enter_refrigerator() -> void:
    var packed := load("res://games/cold_case/interior.tscn") as PackedScene
    if packed == null:
        return
    interior = packed.instantiate()
    add_child(interior)
    mission_phase = "INSIDE"
    temperature = 4.0
    objective_label.text = "OBJECTIVE  //  Find the source of the instability"
    interaction_hint.visible = false
    $World.visible = false
    camera.position = Vector3(0, 1.65, -2.0)
    position = Vector3(0, 0, 0)
    var tween := create_tween()
    camera.position = Vector3(0, 1.65, -9.0)
    tween.tween_property(camera, "position", Vector3(0, 1.65, -2.0), 1.8)
    tween.set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)

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
    interaction_hint = Label.new()
    interaction_hint.position = Vector2(540, 620)
    interaction_hint.text = "E  OPEN"
    interaction_hint.add_theme_font_size_override("font_size", 18)
    interaction_hint.visible = false
    layer.add_child(interaction_hint)
