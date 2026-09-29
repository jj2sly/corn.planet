extends Node3D
class_name ColdCaseOutpost

signal chuck_found

var discovered := false
var repair_count := 0

func discover() -> void:
    if discovered:
        return
    discovered = true
    chuck_found.emit()

func record_repair() -> void:
    repair_count += 1

func repair_board_text() -> String:
    return "REPAIR BOARD  //  %d SYSTEMS STABILIZED" % repair_count
