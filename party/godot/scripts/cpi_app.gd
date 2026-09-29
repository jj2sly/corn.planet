extends Node
class_name CPIApp

const SessionScript = preload("res://scripts/runtime/session.gd")
const AppShellScript = preload("res://scripts/app/app_shell.gd")

var current_game: Node = null
var current_game_id := ""
var session: Node
var shell: Control
@export var server_url := "http://127.0.0.1:3000"

func _ready() -> void:
    print("CPI Party native platform starting")
    session = SessionScript.new()
    add_child(session)
    session.connected_to_party.connect(_on_party_connected)
    session.state_updated.connect(_on_party_state)
    _build_shell()

func _build_shell() -> void:
    shell = AppShellScript.new()
    add_child(shell)
    shell.setup(session)
    shell.launch_game_requested.connect(launch_game)
    shell.create_room_requested.connect(_create_party_room)

func _create_party_room() -> void:
    if session:
        session.connect_host(server_url)

func _on_party_connected(_state: Dictionary) -> void:
    if shell:
        shell.status_label.text = "ONLINE // ROOM %s" % session.room_code

func _on_party_state(_state: Dictionary) -> void:
    if shell and session and not session.room_code.is_empty():
        shell.status_label.text = "ONLINE // ROOM %s" % session.room_code

func show_library() -> void:
    if shell:
        shell.show_section("games")

func launch_game(game_id: String) -> void:
    if current_game:
        current_game.queue_free()
        current_game = null

    current_game_id = game_id

    if game_id == "cold-case":
        if shell:
            shell.visible = false
        var scene := load("res://games/cold_case/cold_case.tscn") as PackedScene
        if scene:
            current_game = scene.instantiate()
            add_child(current_game)
        return

    if shell:
        shell.visible = true
        shell.status_label.text = "%s // SERVER MODULE READY" % game_id.to_upper()

func return_to_platform() -> void:
    if current_game:
        current_game.queue_free()
        current_game = null
    current_game_id = ""
    if shell:
        shell.visible = true
        shell.show_section("games")
