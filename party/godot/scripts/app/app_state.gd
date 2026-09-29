extends Node
class_name CPIAppState

const CONFIG_PATH := "user://cpi_party.cfg"

var display_name := "CPI OPERATIVE"
var server_url := "http://127.0.0.1:3000"
var quality := "AUTO"
var master_volume := 1.0
var last_room_code := ""

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

func save_state() -> void:
    var config := ConfigFile.new()
    config.set_value("profile", "display_name", display_name)
    config.set_value("network", "server_url", server_url)
    config.set_value("graphics", "quality", quality)
    config.set_value("audio", "master_volume", master_volume)
    config.set_value("session", "last_room_code", last_room_code)
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

func remember_room(code: String) -> void:
    last_room_code = code
    save_state()
