extends Node3D
class_name ColdCaseCheckpoint

var active := false
var label_text := "STABILIZED CHECKPOINT"

func activate() -> void:
    active = true

func is_active() -> bool:
    return active
