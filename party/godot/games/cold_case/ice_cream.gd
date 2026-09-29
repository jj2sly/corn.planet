extends Node3D
class_name ColdCaseIceCream

var preferred_temperature: float = -12.0
var active: bool = false
var wobble: float = 0.0

func set_temperature(value: float) -> void:
    if absf(value - preferred_temperature) >= 8.0:
        active = true

func _process(delta: float) -> void:
    wobble += delta
    if active:
        position.y += sin(wobble * 3.0) * delta * 0.06
        rotation.y += delta * 0.45
