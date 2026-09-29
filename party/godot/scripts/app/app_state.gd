extends Node
class_name CPIAppState

const CONFIG_PATH := "user://cpi_party.cfg"

var display_name := "CPI OPERATIVE"
var server_url := "http://127.0.0.1:3000"
var quality := "AUTO"
var master_volume := 1.0
var last_room_code := ""
var recent_games: Array[String] = []
var favorite_games: Array[String] = []

func _ready() -> void:
    load_state()

func load_state() -> void:
    var config := ConfigFile.new()
    if config.load(CONFIG_PATH) != OK:
        return
    display_name = String(config.get_value("profile", "display_name", display_name))
    server_url = String(config.get_value("network", "server_url", server_url))
    quality = String(config.get_value("graphics", "quality", quality))
    master_volume = float(config.get_value("audio", "master_volume", master_volume))
    last_room_code = String(config.get_value("session", "last_room_code", last_room_code))
    recent_games = _string_array(config.get_value("library", "recent_games", recent_games))
    favorite_games = _string_array(config.get_value("library", "favorite_games", favorite_games))

func save_state() -> void:
    var config := ConfigFile.new()
    config.set_value("profile", "display_name", display_name)
    config.set_value("network", "server_url", server_url)
    config.set_value("graphics", "quality", quality)
    config.set_value("audio", "master_volume", master_volume)
    config.set_value("session", "last_room_code", last_room_code)
    config.set_value("library", "recent_games", recent_games)
    config.set_value("library", "favorite_games", favorite_games)
    config.save(CONFIG_PATH)

func set_display_name(value: String) -> void:
    display_name = value.strip_edges()
    if display_name.is_empty():
        display_name = "CPI OPERATIVE"
    save_state()

func set_server_url(value: String) -> void:
    var clean := value.strip_edges().trim_suffix("/")
    if clean.is_empty():
        clean = "http://127.0.0.1:3000"
    server_url = clean
    save_state()

func set_quality(value: String) -> void:
    quality = value
    save_state()

func set_master_volume(value: float) -> void:
    master_volume = clampf(value, 0.0, 1.0)
    save_state()

func remember_room(code: String) -> void:
    last_room_code = code
    save_state()

func remember_game(game_id: String) -> void:
    var clean := game_id.strip_edges()
    if clean.is_empty():
        return
    recent_games.erase(clean)
    recent_games.push_front(clean)
    if recent_games.size() > 8:
        recent_games.resize(8)
    save_state()

func toggle_favorite(game_id: String) -> bool:
    if favorite_games.has(game_id):
        favorite_games.erase(game_id)
        save_state()
        return false
    favorite_games.append(game_id)
    save_state()
    return true

func is_favorite(game_id: String) -> bool:
    return favorite_games.has(game_id)

func _string_array(value: Variant) -> Array[String]:
    var result: Array[String] = []
    if value is Array:
        for item: Variant in value:
            result.append(String(item))
    return result
