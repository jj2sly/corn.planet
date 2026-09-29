extends CharacterBody3D
class_name ColdCasePlayer

@export var speed := 4.5
@export var mouse_sensitivity := 0.0025
var pitch := 0.0
@onready var camera: Camera3D = $Camera

func _ready() -> void:
    Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseMotion:
        rotate_y(-event.relative.x * mouse_sensitivity)
        pitch = clamp(pitch - event.relative.y * mouse_sensitivity, -1.35, 1.35)
        camera.rotation.x = pitch
    elif event is InputEventKey and event.keycode == KEY_ESCAPE and event.pressed:
        Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _physics_process(delta: float) -> void:
    var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
    var direction := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
    velocity.x = direction.x * speed
    velocity.z = direction.z * speed
    velocity.y = 0.0
    move_and_slide()
