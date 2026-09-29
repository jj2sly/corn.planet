extends Node
class_name CPIApp

const SessionScript = preload("res://scripts/runtime/session.gd")
const AppShellScript = preload("res://scripts/app/app_shell.gd")
const AppStateScript = preload("res://scripts/app/app_state.gd")
const PlatformServicesScript = preload("res://scripts/app/platform_services.gd")
const NotificationCenterScript = preload("res://scripts/app/notification_center.gd")
const ModuleManagerScript = preload("res://scripts/app/module_manager.gd")
const IdentityServiceScript = preload("res://scripts/app/identity_service.gd")
const AudioServiceScript = preload("res://scripts/app/audio_service.gd")
const QualityServiceScript = preload("res://scripts/app/quality_service.gd")
const NavigationServiceScript = preload("res://scripts/app/navigation_service.gd")

var current_game: Node = null
var current_game_id := ""
var session: Node
var app_state: Node
var shell: Control
var services: Node
var notifications: Node
var module_manager: Node
var identity: Node
var audio_service: Node
var quality_service: Node
var navigation: Node

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

    identity = IdentityServiceScript.new()
    add_child(identity)
    identity.setup(session)

    audio_service = AudioServiceScript.new()
    add_child(audio_service)
    audio_service.setup(app_state)

    quality_service = QualityServiceScript.new()
    add_child(quality_service)
    quality_service.setup(app_state)

    navigation = NavigationServiceScript.new()
    add_child(navigation)
    navigation.section_requested.connect(_on_navigation_section_requested)
    navigation.library_requested.connect(show_library)
    navigation.platform_return_requested.connect(return_to_platform)
    navigation.game_requested.connect(launch_game)

    services.register_service("state", app_state)
    services.register_service("notifications", notifications)
    services.register_service("session", session)
    services.register_service("modules", module_manager)
    services.register_service("identity", identity)
    services.register_service("audio", audio_service)
    services.register_service("quality", quality_service)
    services.register_service("navigation", navigation)

    session.connected_to_party.connect(_on_party_connected)
    session.disconnected_from_party.connect(_on_party_disconnected)
    session.state_updated.connect(_on_party_state)
    session.canon_updated.connect(_on_canon_updated)
    session.canon_record_loaded.connect(_on_canon_record_loaded)
    session.request_failed.connect(_on_request_failed)
    session.server_health_changed.connect(_on_server_health_changed)
    session.game_catalog_updated.connect(_on_game_catalog_updated)

    module_manager.module_started.connect(_on_module_started)
    module_manager.module_stopped.connect(_on_module_stopped)
    module_manager.module_failed.connect(_on_module_failed)
    module_manager.module_exit_requested.connect(_on_module_exit_requested)

    _build_shell()
    notifications.push("CPI PARTY", "Native platform initialized.", "success")
    session.check_health(app_state.server_url)

func _build_shell() -> void:
    shell = AppShellScript.new()
    add_child(shell)
    shell.setup(session, app_state, notifications, identity, services)
    shell.launch_game_requested.connect(launch_game)
    shell.launch_group_game_requested.connect(launch_group_game)
    shell.launch_party_host_requested.connect(launch_party_host)
    shell.create_room_requested.connect(_create_party_room)
    shell.section_changed.connect(_on_section_changed)
    shell.canon_record_requested.connect(_on_canon_record_requested)
    services.register_service("shell", shell)

func _on_navigation_section_requested(section: String) -> void:
    if shell:
        shell.show_section(section)

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
        if shell.active_section == "rooms":
            shell.show_section("rooms")

func _on_party_disconnected() -> void:
    if module_manager:
        module_manager.active_game_id = ""
        module_manager.pending_game_id = ""
    if shell:
        shell.set_status("OFFLINE // LOCAL CLIENT READY")
        if shell.active_section == "rooms":
            shell.show_section("rooms")
    if notifications:
        notifications.push("PARTY ROOM", "Disconnected from the current room.", "info")

func _on_server_health_changed(ok: bool, protocol: int) -> void:
    if shell:
        if ok:
            shell.set_status("SERVER ONLINE // PROTOCOL %d" % protocol)
        else:
            shell.set_status("SERVER OFFLINE")
    if notifications and ok:
        notifications.push("PARTY SERVER", "Backend reachable. Protocol %d." % protocol, "success")
    if ok and session:
        session.fetch_games()
    if ok and identity:
        identity.load_auth_config()

func _on_game_catalog_updated(games: Array) -> void:
    if shell:
        shell.set_server_games(games)
    if notifications:
        notifications.push("GAME CATALOG", "%d server modules discovered." % games.size(), "info")

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

func _on_module_exit_requested(_game_id: String) -> void:
    return_to_platform()

func _on_module_failed(game_id: String, reason: String) -> void:
    if shell:
        shell.set_status("MODULE ERROR // %s" % game_id.to_upper())
    if notifications:
        notifications.push("MODULE ERROR", "%s: %s" % [game_id, reason], "error")

func launch_party_host() -> void:
    var base := String(app_state.server_url if app_state else server_url).trim_suffix("/")
    OS.shell_open(base + "/host")
    if shell:
        shell.set_status("GROUP NIGHT // HOST OPENED")
    if notifications:
        notifications.push("GROUP NIGHT", "Opened the full Corn Planet Party host.", "success")

func launch_group_game(game_id: String) -> void:
    var metadata: Dictionary = module_manager.request_launch(game_id) if module_manager else {}
    if metadata.is_empty():
        return
    var server_game_id := String(metadata.get("server_game_id", game_id))
    var base := String(app_state.server_url if app_state else server_url).trim_suffix("/")
    var url := "%s/host?game=%s" % [base, server_game_id.uri_encode()]
    OS.shell_open(url)
    if app_state:
        app_state.remember_game(game_id)
    if shell:
        shell.set_status("%s // GROUP PLAY OPENED" % String(metadata.get("name", game_id)).to_upper())
    if notifications:
        notifications.push("GROUP PLAY", "Opened %s host lobby." % String(metadata.get("name", game_id)), "success")

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


func _unhandled_input(event: InputEvent) -> void:
    if current_game == null:
        return
    if event.is_action_pressed("ui_cancel"):
        return_to_platform()
        get_viewport().set_input_as_handled()
