extends Node
class_name CPIAudioService

signal volume_changed(value: float)

var app_state: Node
var master_volume := 1.0

func setup(p_state: Node) -> void:
    app_state = p_state
    master_volume = clampf(float(app_state.master_volume) if app_state else 1.0, 0.0, 1.0)
    _apply()

func set_master_volume(value: float) -> void:
    master_volume = clampf(value, 0.0, 1.0)
    _apply()
    if app_state and app_state.has_method("set_master_volume"):
        app_state.set_master_volume(master_volume)
    volume_changed.emit(master_volume)

func get_master_volume() -> float:
    return master_volume

func _apply() -> void:
    var bus := AudioServer.get_bus_index("Master")
    if bus < 0:
        return
    AudioServer.set_bus_mute(bus, master_volume <= 0.001)
    if master_volume > 0.001:
        AudioServer.set_bus_volume_db(bus, linear_to_db(master_volume))
