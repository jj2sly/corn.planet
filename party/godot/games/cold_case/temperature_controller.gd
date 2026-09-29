extends Node
class_name ColdCaseTemperatureController

signal temperature_changed(value: float)

var temperature := 21.0
var target := 21.0

func set_target(value: float) -> void:
    target = value

func tick(delta: float) -> void:
    temperature = move_toward(temperature, target, delta * 1.5)
    temperature_changed.emit(temperature)

func set_immediate(value: float) -> void:
    temperature = value
    target = value
    temperature_changed.emit(temperature)
