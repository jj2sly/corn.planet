extends Node3D
class_name ColdCaseMilk

signal awakened
signal defeated

var preferred_temperature: float = 4.0
var active: bool = false
var defeated_state: bool = false
var temperature: float = 4.0
var drift: float = 0.0

func set_temperature(value: float) -> void:
    temperature = value
    var extreme: bool = abs(temperature - preferred_temperature) >= 10.0
    if extreme and not active and not defeated_state:
        active = true
        awakened.emit()

func _process(delta: float) -> void:
    if defeated_state:
        return
    if active:
        drift += delta
        position.y += sin(drift * 4.0) * delta * 0.08
        rotation.y += delta * 0.7

func defeat() -> void:
    if defeated_state:
        return
    defeated_state = true
    active = false
    defeated.emit()
    queue_free()
