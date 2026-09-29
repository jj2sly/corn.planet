extends Node
class_name CPIGameRuntime

## Shared native game runtime. Games should use this instead of owning platform lifecycle.

signal game_started(game_id: String)
signal game_stopped(game_id: String)

var active_game_id := ""

func start_game(game_id: String) -> void:
    active_game_id = game_id
    game_started.emit(game_id)

func stop_game() -> void:
    if active_game_id.is_empty():
        return
    var old_id := active_game_id
    active_game_id = ""
    game_stopped.emit(old_id)
