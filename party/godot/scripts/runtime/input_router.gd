extends Node
class_name CPIInputRouter

signal action_pressed(action: String)

func _unhandled_input(event: InputEvent) -> void:
    if event.is_action_pressed("ui_accept"):
        action_pressed.emit("interact")
    elif event.is_action_pressed("ui_cancel"):
        action_pressed.emit("pause")
