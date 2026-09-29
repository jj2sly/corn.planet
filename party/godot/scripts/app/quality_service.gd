extends Node
class_name CPIQualityService

signal quality_changed(name: String, profile: Dictionary)

const QualityProfiles = preload("res://scripts/runtime/quality.gd")

var app_state: Node
var current_name := "AUTO"
var current_profile: Dictionary = {}

func setup(p_state: Node) -> void:
    app_state = p_state
    set_quality(String(app_state.quality) if app_state else "AUTO", false)

func set_quality(name: String, persist: bool = true) -> void:
    current_name = name.to_upper()
    match current_name:
        "PERFORMANCE":
            current_profile = QualityProfiles.LOW.duplicate(true)
        "QUALITY":
            current_profile = QualityProfiles.HIGH.duplicate(true)
        _:
            current_name = "AUTO"
            current_profile = QualityProfiles.MEDIUM.duplicate(true)
    if persist and app_state and app_state.has_method("set_quality"):
        app_state.set_quality(current_name)
    quality_changed.emit(current_name, current_profile)

func profile() -> Dictionary:
    return current_profile.duplicate(true)
