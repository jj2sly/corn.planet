extends Node3D
class_name ColdCasePowerRoom

signal repair_completed

var repair_step: int = 0
var repaired: bool = false
var step_names: Array[String] = ["OPEN PANEL", "COMPONENT A", "COMPONENT B", "RESET"]
var panel: MeshInstance3D
var warning_light: OmniLight3D

func _ready() -> void:
    panel = get_node_or_null("Panel") as MeshInstance3D
    warning_light = get_node_or_null("WarningLight") as OmniLight3D

func interact() -> void:
    if repaired:
        return
    repair_step += 1
    if warning_light != null:
        warning_light.light_energy = 2.5 + float(repair_step) * 0.6
    if repair_step >= step_names.size():
        repaired = true
        if warning_light != null:
            warning_light.light_energy = 0.4
        repair_completed.emit()

func current_step() -> String:
    if repaired:
        return "POWER RESTORED"
    return step_names[repair_step]
