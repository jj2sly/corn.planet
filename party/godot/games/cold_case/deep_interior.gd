extends Node3D
class_name ColdCaseDeepInterior

var instability := 0.0
var pulse: float = 0.0
var core_light: OmniLight3D
var core_coil: MeshInstance3D

func _ready() -> void:
    core_light = $CoreLight
    core_coil = $CoreCoil

func _process(delta: float) -> void:
    pulse += delta
    instability = clamp(instability + delta * 0.01, 0.0, 1.0)
    if core_light != null:
        core_light.light_energy = 2.0 + sin(pulse * 4.0) * (0.8 + instability * 1.5)
    if core_coil != null:
        core_coil.rotation.y += delta * (0.35 + instability * 0.8)

func stabilize() -> void:
    instability = max(0.0, instability - 0.5)
