extends Node
class_name CPIApp

## Native CPI Party application shell.
## The shell owns platform lifecycle; individual games own their scenes and rules.

var current_game: Node = null
var current_game_id := ""
var connected := false

func _ready() -> void:
    print("CPI Party native runtime starting")
    show_library()

func show_library() -> void:
    current_game_id = ""
    if current_game:
        current_game.queue_free()
        current_game = null
    print("CPI Party library ready")

func launch_game(game_id: String) -> void:
    if current_game:
        current_game.queue_free()
        current_game = null

    current_game_id = game_id
    match game_id:
        "cold-case":
            var scene := load("res://games/cold_case/cold_case.tscn")
            current_game = scene.instantiate()
            add_child(current_game)
        _:
            push_warning("Game is not installed in native client: " + game_id)
