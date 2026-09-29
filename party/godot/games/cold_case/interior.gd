extends Node3D
class_name ColdCaseInterior

var temperature := 4.0

func _ready() -> void:
    _build_atmosphere()

func _build_atmosphere() -> void:
    var env := WorldEnvironment.new()
    var environment := Environment.new()
    environment.background_mode = Environment.BG_COLOR
    environment.background_color = Color(0.025, 0.035, 0.04)
    environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    environment.ambient_light_color = Color(0.18, 0.22, 0.24)
    environment.ambient_light_energy = 0.5
    environment.fog_enabled = true
    environment.fog_light_color = Color(0.35, 0.42, 0.44)
    environment.fog_density = 0.008
    env.environment = environment
    add_child(env)

func set_temperature(value: float) -> void:
    temperature = value
