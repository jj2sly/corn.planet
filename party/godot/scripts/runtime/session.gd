extends Node
class_name CPISession

signal connected_to_party(state: Dictionary)
signal state_updated(state: Dictionary)
signal disconnected_from_party()
signal canon_updated(records: Array, status: Dictionary)
signal canon_record_loaded(record: Dictionary)
signal request_failed(path: String, message: String)
signal server_health_changed(ok: bool, protocol: int)
signal game_catalog_updated(games: Array)
signal identity_updated(profile: Dictionary)
signal stats_updated(stats: Dictionary)

const NetworkClientScript = preload("res://scripts/runtime/network_client.gd")

var network: Node
var role := ""
var room_code := ""
var player_id := ""
var display_name := ""
var last_state: Dictionary = {}
var poll_elapsed := 0.0
var poll_interval := 0.5

func _ready() -> void:
    network = NetworkClientScript.new()
    add_child(network)
    network.request_completed.connect(_on_request)

func set_auth_token(token: String) -> void:
    network.set_auth_token(token)

func fetch_identity() -> void:
    network.fetch_identity()

func fetch_stats() -> void:
    network.fetch_stats()

func check_health(url := "") -> void:
    if not url.is_empty():
        network.configure(url)
    network.check_health()

func connect_host(url := "http://127.0.0.1:3000") -> void:
    network.configure(url)
    network.create_host()

func connect_player(code: String, name: String, url := "http://127.0.0.1:3000") -> void:
    network.configure(url)
    network.join_player(code, name)

func _process(delta: float) -> void:
    if network == null or network.session_token.is_empty():
        return
    poll_elapsed += delta
    if poll_elapsed >= poll_interval:
        poll_elapsed = 0.0
        network.fetch_state()

func fetch_games() -> void:
    network.fetch_games()

func fetch_canon(kind: String = "") -> void:
    network.fetch_canon(kind)

func fetch_canon_record(ref: String) -> void:
    network.fetch_canon_record(ref)

func poll() -> void:
    if not network.session_token.is_empty():
        network.fetch_state()

func configure_game(game_id: String, settings: Dictionary = {}) -> void:
    network.configure_game(game_id, settings)

func start_game() -> void:
    network.start_game()

func leave() -> void:
    network.leave()
    network.session_token = ""
    role = ""
    room_code = ""
    player_id = ""
    display_name = ""
    last_state = {}
    disconnected_from_party.emit()

func send_input(action: String, payload: Variant = {}) -> void:
    network.send_input(action, payload)

func _on_request(path: String, ok: bool, data: Variant) -> void:
    if not ok:
        var message := "Request failed"
        if data is Dictionary:
            message = String(data.get("error", data.get("message", message)))
        request_failed.emit(path, message)
        return
    if path == "/api/native/health":
        var protocol := int(data.get("protocol", 0)) if data is Dictionary else 0
        server_health_changed.emit(true, protocol)
    elif path == "/api/native/me":
        if data is Dictionary:
            identity_updated.emit(data)
    elif path == "/api/native/me/stats":
        if data is Dictionary:
            stats_updated.emit(data)
    elif path == "/api/native/games":
        if data is Dictionary:
            var games_variant: Variant = data.get("games", [])
            game_catalog_updated.emit(games_variant if games_variant is Array else [])
    elif path == "/api/native/host" or path == "/api/native/player":
        network.session_token = String(data.get("token", ""))
        role = String(data.get("role", ""))
        room_code = String(data.get("code", ""))
        player_id = String(data.get("playerId", ""))
        display_name = String(data.get("name", ""))
        last_state = data.get("state", {})
        connected_to_party.emit(last_state)
    elif path == "/api/native/state":
        last_state = data if data is Dictionary else {}
        state_updated.emit(last_state)
    elif path == "/api/native/canon":
        if data is Dictionary:
            var records_variant: Variant = data.get("records", [])
            var status_variant: Variant = data.get("status", {})
            var records: Array = records_variant if records_variant is Array else []
            var status: Dictionary = status_variant if status_variant is Dictionary else {}
            canon_updated.emit(records, status)
    elif path.begins_with("/api/native/canon/"):
        if data is Dictionary:
            canon_record_loaded.emit(data)
