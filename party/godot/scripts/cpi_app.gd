extends Node
class_name CPIApp

var current_game: Node = null
var current_game_id := ""
var library: Array[String] = ["cold-case"]

func _ready() -> void:
    print("CPI Party native runtime starting")
    show_library()

func show_library() -> void:
    current_game_id = ""
    if current_game:
        current_game.queue_free()
        current_game = null
    print("CPI Party library ready: ", library)

func launch_game(game_id: String) -> void:
    if current_game:
        current_game.queue_free()
        current_game = null
    current_game_id = game_id
    if game_id == "cold-case":
        var scene := load("res://games/cold_case/cold_case.tscn") as PackedScene
        if scene:
            current_game = scene.instantiate()
            add_child(current_game)
