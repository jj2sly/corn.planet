extends CanvasLayer
class_name ColdCaseMissionHud

var objective_label: Label
var temperature_label: Label
var repair_label: Label
var message_label: Label

func _ready() -> void:
    objective_label = _label(Vector2(32, 28), 20)
    temperature_label = _label(Vector2(32, 62), 17)
    repair_label = _label(Vector2(32, 94), 16)
    message_label = _label(Vector2(410, 620), 18)
    message_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    message_label.size = Vector2(460, 40)

func set_objective(text: String) -> void:
    objective_label.text = "OBJECTIVE  //  " + text

func set_temperature(value: float) -> void:
    temperature_label.text = "TEMP  //  %0.1f C" % value

func set_repair(text: String) -> void:
    repair_label.text = "SYSTEM  //  " + text

func message(text: String) -> void:
    message_label.text = text
    var tween := create_tween()
    tween.tween_interval(2.0)
    tween.tween_property(message_label, "modulate:a", 0.0, 0.4)
    tween.finished.connect(func(): message_label.modulate.a = 1.0)

func _label(pos: Vector2, size: int) -> Label:
    var label := Label.new()
    label.position = pos
    label.add_theme_font_size_override("font_size", size)
    add_child(label)
    return label
