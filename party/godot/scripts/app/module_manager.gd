extends Node
class_name CPIModuleManager

signal module_launch_requested(game_id: String)
signal module_started(game_id: String, module: Node)
signal module_stopped(game_id: String)
signal module_failed(game_id: String, reason: String)
signal module_exit_requested(game_id: String)

const RegistryScript = preload("res://scripts/app/app_registry.gd")
const GameModuleScript = preload("res://scripts/app/game_module.gd")

var services: Node
var session: Node
var active_module: Node
var active_game_id := ""
var pending_game_id := ""

func setup(p_services: Node, p_session: Node) -> void:
    services = p_services
    session = p_session

func request_launch(game_id: String) -> Dictionary:
    var metadata: Dictionary = RegistryScript.find_game(game_id)
    if metadata.is_empty():
        module_failed.emit(game_id, "Unknown game module")
        return {}

    pending_game_id = game_id
    module_launch_requested.emit(game_id)
    return metadata

func launch_native_scene(metadata: Dictionary, parent: Node) -> Node:
    stop_active()
    var game_id := String(metadata.get("id", ""))
    var scene_path := String(metadata.get("scene", ""))
    if scene_path.is_empty():
        module_failed.emit(game_id, "No native scene registered")
        return null

    var packed: PackedScene = load(scene_path) as PackedScene
    if packed == null:
        module_failed.emit(game_id, "Native scene could not be loaded")
        return null

    active_module = packed.instantiate()
    active_game_id = game_id
    parent.add_child(active_module)

    if active_module.has_method("bind_platform"):
        active_module.call("bind_platform", metadata, services, session)
    elif active_module.has_method("configure_platform"):
        active_module.call("configure_platform", metadata, services, session)

    if active_module.has_signal("exit_requested"):
        active_module.connect("exit_requested", func():
            module_exit_requested.emit(active_game_id)
        )

    pending_game_id = ""
    module_started.emit(active_game_id, active_module)
    return active_module

func prepare_server_module(game_id: String) -> void:
    pending_game_id = game_id
    if session and not session.room_code.is_empty():
        session.configure_game(game_id)
        active_game_id = game_id
        pending_game_id = ""

func on_session_connected() -> void:
    if pending_game_id.is_empty() or session == null:
        return
    session.configure_game(pending_game_id)
    active_game_id = pending_game_id
    pending_game_id = ""

func stop_active() -> void:
    var stopped_id := active_game_id
    if active_module and is_instance_valid(active_module):
        if active_module.has_method("stop"):
            active_module.call("stop")
        else:
            active_module.queue_free()
    active_module = null
    active_game_id = ""
    if not stopped_id.is_empty():
        module_stopped.emit(stopped_id)

func make_module_contract(metadata: Dictionary) -> Node:
    var module: Node = GameModuleScript.new()
    module.configure(metadata, services)
    return module
