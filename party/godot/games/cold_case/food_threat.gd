extends Node3D
class_name ColdCaseFoodThreat

signal damaged_player(amount: float)
signal defeated()

var active := false
var health := 3
var preferred_temperature := 4.0
var speed := 0.8

func set_temperature(value: float) -> void:
    active = abs(value - preferred_temperature) >= 10.0
    if active:
        rotation.y += 0.05

func tick(delta: float, player_position: Vector3) -> void:
    if not active:
        return
    var offset := player_position - global_position
    offset.y = 0
    if offset.length() > 0.1:
        global_position += offset.normalized() * speed * delta
    if offset.length() < 1.4:
        damaged_player.emit(1.0)

func hit() -> void:
    if not active:
        return
    health -= 1
    if health <= 0:
        active = false
        defeated.emit()
        queue_free()
