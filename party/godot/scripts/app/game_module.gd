extends Node
class_name CPIGameModule

signal exit_requested()
signal ready_for_players()
signal module_event(name: String, payload: Variant)

var game_id := ""
var display_name := ""
var server_game_id := ""
var version := "0.2.0"
var metadata: Dictionary = {}
var services: Node
var session: Node
var running := false

func bind_platform(p_metadata: Dictionary, p_services: Node, p_session: Node) -> void:
    configure(p_metadata, p_services)
    start(p_session)

func configure(p_metadata: Dictionary, p_services: Node = null) -> void:
    metadata = p_metadata.duplicate(true)
    game_id = String(metadata.get("id", ""))
    display_name = String(metadata.get("name", ""))
    server_game_id = String(metadata.get("server_game_id", game_id))
    services = p_services

func start(p_session: Node) -> void:
    session = p_session
    running = true
    ready_for_players.emit()

func service(name: String) -> Node:
    if services and services.has_method("get_service"):
        return services.get_service(name)
    return null

func notify(title: String, message: String, level: String = "info") -> void:
    var center := service("notifications")
    if center and center.has_method("push"):
        center.push(title, message, level)

func request_exit() -> void:
    exit_requested.emit()

func stop() -> void:
    running = false
    queue_free()
