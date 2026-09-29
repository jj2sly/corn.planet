extends Node
class_name CPINavigationService

signal section_requested(section: String)
signal library_requested()
signal platform_return_requested()
signal game_requested(game_id: String)

func open_section(section: String) -> void:
    section_requested.emit(section)

func open_library() -> void:
    library_requested.emit()

func return_to_platform() -> void:
    platform_return_requested.emit()

func launch_game(game_id: String) -> void:
    game_requested.emit(game_id)
