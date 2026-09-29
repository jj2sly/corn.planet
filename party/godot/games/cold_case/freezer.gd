extends Node3D
class_name ColdCaseFreezer

signal cooling_repair_complete

var temperature := -8.0
var repair_step := 0
var repaired := false
var steps := ["VENT", "COIL", "PRESSURE", "START"]

func interact_repair() -> String:
    if repaired:
        return "COOLING STABLE"
    repair_step += 1
    if repair_step >= steps.size():
        repaired = true
        temperature = -2.0
        cooling_repair_complete.emit()
        return "COOLING STABLE"
    return steps[repair_step]

func set_temperature(value: float) -> void:
    temperature = clamp(value, -30.0, 8.0)
