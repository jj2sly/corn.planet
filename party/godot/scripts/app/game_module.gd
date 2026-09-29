extends Node
class_name CPIGameModule

var game_id := ""
var display_name := ""
var server_game_id := ""
var version := "0.1.0"

func configure(metadata: Dictionary) -> void:
    game_id = String(metadata.get("id", ""))
    display_name = String(metadata.get("name", ""))
    server_game_id = String(metadata.get("server_game_id", game_id))

func start(_session: Node) -> void:
    pass

func stop() -> void:
    queue_free()
