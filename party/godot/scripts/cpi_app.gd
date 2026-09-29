extends Node
class_name CPIApp

const SessionScript = preload("res://scripts/runtime/session.gd")
const AppShellScript = preload("res://scripts/app/app_shell.gd")
const AppStateScript = preload("res://scripts/app/app_state.gd")

var current_game: Node = null
var current_game_id := ""
var pending_module_id := ""
var session: Node
var app_state: Node
var shell: Control
@export var server_url := "http://127.0.0.1:3000"

func _ready() -> void:
    print("CPI Party native platform starting")
    app_state = AppStateScript.new()
    add_child(app_state)
    server_url = app_state.server_url

    session = SessionScript.new()
    add_child(session)
    session.connected_to_party.connect(_on_party_connected)
    session.state_updated.connect(_on_party_state)
    _build_shell()

func _build_shell() -> void:
    shell = AppShellScript.new()
    add_child(shell)
    shell.setup(session, app_state)
    shell.launch_game_requested.connect(launch_game)
    shell.create_room_requested.connect(_create_party_room)
    shell.section_changed.connect(_on_section_changed)
    shell.canon_record_requested.connect(_on_canon_record_requested)
    session.canon_updated.connect(_on_canon_updated)
    session.canon_record_loaded.connect(_on_canon_record_loaded)

func _create_party_room() -> void:
    if session:
        session.connect_host(app_state.server_url if app_state else server_url)

func _on_party_connected(_state: Dictionary) -> void:
    if not pending_module_id.is_empty() and session:
        session.configure_game(pending_module_id)
        pending_module_id = ""
    if shell:
        if app_state:
            app_state.remember_room(session.room_code)
        shell.status_label.text = "ONLINE // ROOM %s" % session.room_code

func _on_section_changed(section: String) -> void:
    if section == "database" and session:
        session.fetch_canon()

func _on_canon_record_requested(ref: String) -> void:
    if session:
        session.fetch_canon_record(ref)

func _on_canon_record_loaded(record: Dictionary) -> void:
    if shell:
        shell.show_canon_record(record)

func _on_canon_updated(records: Array, status: Dictionary) -> void:
    if shell:
        shell.set_canon_records(records, status)
        shell.status_label.text = "CANON // %d RECORDS" % records.size()

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
        shell.show_section("rooms")
        shell.status_label.text = "%s // READY FOR ROOM" % game_id.to_upper()
    if session and not session.room_code.is_empty():
        session.configure_game(game_id)
    else:
        pending_module_id = game_id
        session.connect_host(app_state.server_url if app_state else server_url)

func return_to_platform() -> void:
    if current_game:
        current_game.queue_free()
        current_game = null
    current_game_id = ""
    if shell:
        shell.visible = true
        shell.show_section("games")
