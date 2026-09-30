extends CharacterBody2D
class_name ColdCasePlayer

signal interact_requested()

@export var speed := 260.0
@export var acceleration := 1600.0
@export var friction := 1900.0

func _physics_process(delta: float) -> void:
    var input := Vector2.ZERO
    if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
        input.x -= 1.0
    if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
        input.x += 1.0
    if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
        input.y -= 1.0
    if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
        input.y += 1.0
    input = input.normalized()

    var target := input * speed
    if input.length_squared() > 0.0:
        velocity = velocity.move_toward(target, acceleration * delta)
    else:
        velocity = velocity.move_toward(Vector2.ZERO, friction * delta)

    move_and_slide()

func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_E:
        interact_requested.emit()
