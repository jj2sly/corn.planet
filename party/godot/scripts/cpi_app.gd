extends Node
class_name CPIApp

const SessionScript = preload("res://scripts/runtime/session.gd")
const AppShellScript = preload("res://scripts/app/app_shell.gd")
const AppStateScript = preload("res://scripts/app/app_state.gd")
const PlatformServicesScript = preload("res://scripts/app/platform_services.gd")
const NotificationCenterScript = preload("res://scripts/app/notification_center.gd")
const ModuleManagerScript = preload("res://scripts/app/module_manager.gd")

var current_game: Node = null
var current_game_id := ""
var session: Node
var app_state: Node
var shell: Control
var services: Node
var notifications: Node
var module_manager: Node

@export var server_url := "http://127.0.0.1:3000"

func _ready() -> void:
    print("CPI Party native platform starting")

    app_state = AppStateScript.new()
    add_child(app_state)
    server_url = app_state.server_url

    services = PlatformServicesScript.new()
    add_child(services)

    notifications = NotificationCenterScript.new()
    add_child(notifications)

    session = SessionScript.new()
    add_child(session)

    module_manager = ModuleManagerScript.new()
    add_child(module_manager)
    module_manager.setup(services, session)

    services.register_service("state", app_state)
    services.register_service("notifications", notifications)
    services.register_service("session", session)
    services.register_service("modules", module_manager)

    session.connected_to_party.connect(_on_party_connected)
    session.state_updated.connect(_on_party_state)
    session.canon_updated.connect(_on_canon_updated)
    session.canon_record_loaded.connect(_on_canon_record_loaded)
    session.request_failed.connect(_on_request_failed)
    session.server_health_changed.connect(_on_server_health_changed)

    module_manager.module_started.connect(_on_module_started)
    module_manager.module_stopped.connect(_on_module_stopped)
    module_manager.module_failed.connect(_on_module_failed)

    _build_shell()
    notifications.push("CPI PARTY", "Native platform initialized.", "success")
    session.check_health(app_state.server_url)

func _build_shell() -> void:
    shell = AppShellScript.new()
    add_child(shell)
    shell.setup(session, app_state, notifications)
    shell.launch_game_requested.connect(launch_game)
    shell.create_room_requested.connect(_create_party_room)
    shell.section_changed.connect(_on_section_changed)
    shell.canon_record_requested.connect(_on_canon_record_requested)
    services.register_service("shell", shell)

func _create_party_room() -> void:
    if session:
        shell.set_status("CONNECTING // PARTY SERVER")
        session.connect_host(app_state.server_url if app_state else server_url)

func _on_party_connected(_state: Dictionary) -> void:
    if app_state:
        app_state.remember_room(session.room_code)
    if module_manager:
        module_manager.on_session_connected()
    if shell:
        shell.set_status("ONLINE // ROOM %s" % session.room_code)
        if shell.active_section == "rooms":
            shell.show_section("rooms")
    notifications.push("PARTY ROOM", "Connected to room %s." % session.room_code, "success")

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
        shell.set_status("CANON // %d RECORDS" % records.size())

func _on_party_state(_state: Dictionary) -> void:
    if shell and session and not session.room_code.is_empty():
        shell.set_status("ONLINE // ROOM %s" % session.room_code)

func _on_server_health_changed(ok: bool, protocol: int) -> void:
    if shell:
        if ok:
            shell.set_status("SERVER ONLINE // PROTOCOL %d" % protocol)
        else:
            shell.set_status("SERVER OFFLINE")
    if notifications and ok:
        notifications.push("PARTY SERVER", "Backend reachable. Protocol %d." % protocol, "success")

func _on_request_failed(path: String, message: String) -> void:
    if shell:
        if path == "/api/native/health":
            shell.set_status("SERVER OFFLINE // LOCAL CLIENT READY")
        else:
            shell.set_status("ERROR // %s" % message.to_upper())
    if notifications:
        notifications.push("NETWORK ERROR", "%s: %s" % [path, message], "error")

func _on_module_started(game_id: String, module: Node) -> void:
    current_game = module
    current_game_id = game_id
    if app_state:
        app_state.remember_game(game_id)
    if notifications:
        notifications.push("MODULE STARTED", game_id.to_upper(), "success")

func _on_module_stopped(game_id: String) -> void:
    if current_game_id == game_id:
        current_game = null
        current_game_id = ""
    if notifications:
        notifications.push("MODULE CLOSED", game_id.to_upper(), "info")

func _on_module_failed(game_id: String, reason: String) -> void:
    if shell:
        shell.set_status("MODULE ERROR // %s" % game_id.to_upper())
    if notifications:
        notifications.push("MODULE ERROR", "%s: %s" % [game_id, reason], "error")

func show_library() -> void:
    if shell:
        shell.show_section("games")

func launch_game(game_id: String) -> void:
    var metadata: Dictionary = module_manager.request_launch(game_id) if module_manager else {}
    if metadata.is_empty():
        return

    if app_state:
        app_state.remember_game(game_id)

    var scene_path := String(metadata.get("scene", ""))
    if not scene_path.is_empty():
        if shell:
            shell.visible = false
        current_game = module_manager.launch_native_scene(metadata, self)
        current_game_id = game_id
        return

    if shell:
        shell.visible = true
        shell.show_section("rooms")
        shell.set_status("%s // PREPARING ROOM" % game_id.to_upper())

    module_manager.prepare_server_module(game_id)
    if session.room_code.is_empty():
        session.connect_host(app_state.server_url if app_state else server_url)

func return_to_platform() -> void:
    if module_manager:
        module_manager.stop_active()
    current_game = null
    current_game_id = ""
    if shell:
        shell.visible = true
        shell.show_section("games")
