extends CanvasLayer
class_name ColdCaseMissionHud

var objective_label: Label
var temperature_label: Label
var repair_label: Label
var status_label: Label
var interaction_label: Label

func _ready() -> void:
    objective_label = _label(Vector2(28, 24), 20)
    temperature_label = _label(Vector2(28, 56), 16)
    repair_label = _label(Vector2(28, 82), 15)
    status_label = _label(Vector2(28, 108), 14)
    interaction_label = _label(Vector2(0, 0), 18)
    interaction_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    interaction_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
    interaction_label.position = Vector2(-260, -76)
    interaction_label.size = Vector2(520, 40)

func set_objective(text: String) -> void:
    objective_label.text = "OBJECTIVE  //  " + text

func set_temperature(value: float) -> void:
    temperature_label.text = "TEMP  //  %0.1f C" % value

func set_repair(text: String) -> void:
    repair_label.text = "SYSTEM  //  " + text

func set_status(text: String) -> void:
    status_label.text = text

func set_interaction(text: String) -> void:
    interaction_label.text = text

func message(text: String) -> void:
    interaction_label.text = text
    interaction_label.modulate.a = 1.0
    var tween := create_tween()
    tween.tween_interval(1.8)
    tween.tween_property(interaction_label, "modulate:a", 0.0, 0.35)
    tween.finished.connect(func(): interaction_label.modulate.a = 1.0)

func _label(pos: Vector2, font_size: int) -> Label:
    var label := Label.new()
    label.position = pos
    label.add_theme_font_size_override("font_size", font_size)
    label.add_theme_color_override("font_color", Color(0.93, 0.95, 0.95))
    label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
    label.add_theme_constant_override("shadow_offset_x", 2)
    label.add_theme_constant_override("shadow_offset_y", 2)
    add_child(label)
    return label
