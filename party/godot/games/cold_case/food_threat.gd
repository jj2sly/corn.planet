extends CharacterBody2D
class_name ColdCaseFoodThreat

signal damaged_player(amount: float)
signal defeated()

@export var preferred_temperature := 4.0
@export var speed := 115.0
@export var max_health := 3

var active := false
var health := 3
var target: Node2D
var contact_cooldown := 0.0

func _ready() -> void:
    health = max_health
    queue_redraw()

func set_target(value: Node2D) -> void:
    target = value

func set_temperature(value: float) -> void:
    active = abs(value - preferred_temperature) >= 10.0
    queue_redraw()

func _physics_process(delta: float) -> void:
    contact_cooldown = maxf(0.0, contact_cooldown - delta)
    if not active or target == null:
        velocity = velocity.move_toward(Vector2.ZERO, 500.0 * delta)
        move_and_slide()
        return

    var offset := target.global_position - global_position
    velocity = offset.normalized() * speed if offset.length() > 8.0 else Vector2.ZERO
    move_and_slide()

    if offset.length() < 34.0 and contact_cooldown <= 0.0:
        contact_cooldown = 0.8
        damaged_player.emit(10.0)

func hit() -> void:
    if not active:
        return
    health -= 1
    if health <= 0:
        active = false
        defeated.emit()
        queue_free()
    else:
        queue_redraw()

func _draw() -> void:
    var fill := Color(0.90, 0.94, 1.0, 1.0) if not active else Color(0.90, 0.35, 0.30, 1.0)
    draw_rect(Rect2(-18, -24, 36, 48), fill, true)
    draw_rect(Rect2(-18, -24, 36, 48), Color(0.08, 0.10, 0.12), false, 3.0)
    draw_line(Vector2(-9, -9), Vector2(9, -9), Color(0.10, 0.10, 0.12), 3.0)
