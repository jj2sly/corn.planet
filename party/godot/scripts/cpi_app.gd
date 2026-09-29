extends Node
class_name CPIApp

const SessionScript = preload("res://scripts/runtime/session.gd")

var current_game: Node = null
var current_game_id := ""
var library: Array[String] = ["cold-case"]
var menu_layer: CanvasLayer
var menu_root: Control
var session: Node
var online_label: Label
@export var server_url := "http://127.0.0.1:3000"

func _ready() -> void:
    print("CPI Party native runtime starting")
    session = SessionScript.new()
    add_child(session)
    session.connected_to_party.connect(_on_party_connected)
    show_library()

func _build_library_ui() -> void:
    if menu_layer:
        menu_layer.queue_free()
    menu_layer = CanvasLayer.new()
    add_child(menu_layer)

    menu_root = Control.new()
    menu_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    menu_layer.add_child(menu_root)

    var background := ColorRect.new()
    background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    background.color = Color(0.015, 0.018, 0.02)
    menu_root.add_child(background)

    var title := Label.new()
    title.position = Vector2(64, 54)
    title.text = "CPI PARTY"
    title.add_theme_font_size_override("font_size", 42)
    menu_root.add_child(title)

    var subtitle := Label.new()
    subtitle.position = Vector2(67, 108)
    subtitle.text = "CORN PLANET INSTITUTION  //  NATIVE CLIENT"
    subtitle.add_theme_font_size_override("font_size", 14)
    menu_root.add_child(subtitle)

    var mission := Label.new()
    mission.position = Vector2(70, 205)
    mission.text = "AVAILABLE MISSION"
    mission.add_theme_font_size_override("font_size", 13)
    menu_root.add_child(mission)

    var online := Button.new()
    online.position = Vector2(500, 240)
    online.size = Vector2(300, 78)
    online.text = "CREATE PARTY ROOM
Native server bridge"
    online.pressed.connect(func(): _create_party_room())
    menu_root.add_child(online)

    online_label = Label.new()
    online_label.position = Vector2(500, 330)
    online_label.text = "OFFLINE // native session not connected"
    online_label.add_theme_font_size_override("font_size", 13)
    menu_root.add_child(online_label)

    var cold_case := Button.new()
    cold_case.position = Vector2(70, 240)
    cold_case.size = Vector2(390, 78)
    cold_case.text = "CPI: COLD CASE
Refrigerator anomaly deployment"
    cold_case.add_theme_font_size_override("font_size", 18)
    cold_case.pressed.connect(func(): launch_game("cold-case"))
    menu_root.add_child(cold_case)

    var footer := Label.new()
    footer.position = Vector2(70, 650)
    footer.text = "CPST // AUTHORIZED PERSONNEL ONLY"
    footer.add_theme_font_size_override("font_size", 12)
    menu_root.add_child(footer)

func _create_party_room() -> void:
    if session:
        online_label.text = "CONNECTING // Party server"
        session.connect_host(server_url)

func _on_party_connected(_state: Dictionary) -> void:
    if online_label:
        online_label.text = "ONLINE // ROOM %s" % session.room_code

func show_library() -> void:
    current_game_id = ""
    if current_game:
        current_game.queue_free()
        current_game = null
    _build_library_ui()

func launch_game(game_id: String) -> void:
    if menu_layer:
        menu_layer.queue_free()
        menu_layer = null
    if current_game:
        current_game.queue_free()
        current_game = null
    current_game_id = game_id
    if game_id == "cold-case":
        var scene := load("res://games/cold_case/cold_case.tscn") as PackedScene
        if scene:
            current_game = scene.instantiate()
            add_child(current_game)
