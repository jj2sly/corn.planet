extends Node3D
class_name ColdCasePowerRoom

signal repair_completed

var repair_step := 0
var repaired := false
var step_names := ["OPEN PANEL", "COMPONENT A", "COMPONENT B", "RESET"]

func interact() -> void:
    if repaired:
        return
    repair_step += 1
    if repair_step >= step_names.size():
        repaired = true
        repair_completed.emit()

func current_step() -> String:
    if repaired:
        return "POWER RESTORED"
    return step_names[repair_step]
