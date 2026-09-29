extends Node3D
class_name ColdCaseFreezer

signal cooling_repair_complete

var temperature: float = -8.0
var repair_step: int = 0
var repaired: bool = false
var steps: Array[String] = ["VENT", "COIL", "PRESSURE", "START"]
var cooling_light: OmniLight3D
var unit: MeshInstance3D
var pulse: float = 0.0

func _ready() -> void:
    cooling_light = get_node_or_null("Light") as OmniLight3D
    unit = get_node_or_null("CoolingUnit") as MeshInstance3D

func _process(delta: float) -> void:
    pulse += delta
    if cooling_light != null and not repaired:
        cooling_light.light_energy = 2.8 + sin(pulse * 3.0) * 0.6
    if unit != null and not repaired:
        unit.rotation.y += delta * 0.04

func interact_repair() -> String:
    if repaired:
        return "COOLING STABLE"
    repair_step += 1
    if repair_step >= steps.size():
        repaired = true
        temperature = -2.0
        if cooling_light != null:
            cooling_light.light_energy = 1.2
        if unit != null:
            unit.rotation.y = 0.0
        cooling_repair_complete.emit()
        return "COOLING STABLE"
    return steps[repair_step]

func set_temperature(value: float) -> void:
    temperature = clamp(value, -30.0, 8.0)
