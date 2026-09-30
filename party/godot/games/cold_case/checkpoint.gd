extends Node2D
class_name ColdCaseCheckpoint

var active := false
var label_text := "STABILIZED CHECKPOINT"

func activate() -> void:
    active = true
    queue_redraw()

func is_active() -> bool:
    return active

func _draw() -> void:
    var color := Color(0.55, 0.95, 0.45, 0.9) if active else Color(0.32, 0.38, 0.40, 0.65)
    draw_circle(Vector2.ZERO, 20.0, color)
    draw_arc(Vector2.ZERO, 28.0, 0.0, TAU, 32, color, 3.0)
