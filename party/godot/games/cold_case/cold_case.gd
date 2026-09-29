extends Node3D
class_name ColdCaseGame

## First native Cold Case shell.
## Gameplay migration happens behind this scene; the browser prototype remains intact.

var temperature := 21.0
var mission_phase := "BRIEFING"

func _ready() -> void:
    print("CPI: Cold Case native client loaded")

func start_mission() -> void:
    mission_phase = "ACTIVE"

func set_temperature(value: float) -> void:
    temperature = value
