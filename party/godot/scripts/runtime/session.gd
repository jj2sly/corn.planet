extends Node
class_name CPISession

signal connected_to_party(state: Dictionary)
signal state_updated(state: Dictionary)
signal disconnected_from_party()

var network: CPINetworkClient
var role := ""
var room_code := ""
var player_id := ""
var display_name := ""
var last_state: Dictionary = {}

func _ready() -> void:
    network = CPINetworkClient.new()
    add_child(network)
    network.request_completed.connect(_on_request)

func connect_host(url := "http://127.0.0.1:3000") -> void:
    network.configure(url)
    network.create_host()

func connect_player(code: String, name: String, url := "http://127.0.0.1:3000") -> void:
    network.configure(url)
    network.join_player(code, name)

func poll() -> void:
    if not network.session_token.is_empty():
        network.fetch_state()

func send_input(action: String, payload: Variant = {}) -> void:
    network.send_input(action, payload)

func _on_request(path: String, ok: bool, data: Variant) -> void:
    if not ok:
        return
    if path == "/api/native/host" or path == "/api/native/player":
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
