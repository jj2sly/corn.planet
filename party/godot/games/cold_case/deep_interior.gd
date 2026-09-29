extends Node3D
class_name ColdCaseDeepInterior

var instability := 0.0
var pulse := 0.0

func _process(delta: float) -> void:
    pulse += delta
    instability = clamp(instability + delta * 0.01, 0.0, 1.0)

func stabilize() -> void:
    instability = max(0.0, instability - 0.5)
