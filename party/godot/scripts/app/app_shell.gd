extends Control
class_name CPIAppShell

signal launch_game_requested(game_id: String)
signal create_room_requested()
signal section_changed(section: String)
signal canon_record_requested(ref: String)

const RegistryScript = preload("res://scripts/app/app_registry.gd")

var content: Control
var title_label: Label
var section_label: Label
var status_label: Label
var nav_buttons: Dictionary = {}
var active_section := "home"
var session: Node
var app_state: Node

const BG := Color(0.012, 0.015, 0.018)
const PANEL := Color(0.035, 0.041, 0.047)
const PANEL_2 := Color(0.055, 0.062, 0.070)
const LINE := Color(0.15, 0.17, 0.19)
const TEXT := Color(0.88, 0.89, 0.90)
const MUTED := Color(0.48, 0.51, 0.54)
const ACCENT := Color(1.0, 0.83, 0.0)

func setup(p_session: Node, p_state: Node) -> void:
    session = p_session
    app_state = p_state
    _build_shell()
    show_section("home")

func _build_shell() -> void:
    set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

    var background := ColorRect.new()
    background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    background.color = BG
    add_child(background)

    var top := ColorRect.new()
    top.position = Vector2(0, 0)
    top.size = Vector2(1280, 72)
    top.color = PANEL
    add_child(top)

    var brand := Label.new()
    brand.position = Vector2(28, 16)
    brand.text = "CPI"
    brand.add_theme_font_size_override("font_size", 30)
    brand.add_theme_color_override("font_color", ACCENT)
    add_child(brand)

    var brand_detail := Label.new()
    brand_detail.position = Vector2(82, 18)
    brand_detail.text = "CORN PLANET INSTITUTION\nPARTY PLATFORM"
    brand_detail.add_theme_font_size_override("font_size", 11)
    brand_detail.add_theme_color_override("font_color", MUTED)
    add_child(brand_detail)

    status_label = Label.new()
    status_label.position = Vector2(1000, 25)
    status_label.size = Vector2(240, 24)
    status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    status_label.text = "OFFLINE // LOCAL CLIENT"
    status_label.add_theme_font_size_override("font_size", 11)
    status_label.add_theme_color_override("font_color", MUTED)
    add_child(status_label)

    var sidebar := ColorRect.new()
    sidebar.position = Vector2(0, 72)
    sidebar.size = Vector2(218, 648)
    sidebar.color = Color(0.022, 0.026, 0.030)
    add_child(sidebar)

    var nav_title := Label.new()
    nav_title.position = Vector2(24, 28)
    nav_title.text = "COMMAND"
    nav_title.add_theme_font_size_override("font_size", 10)
    nav_title.add_theme_color_override("font_color", MUTED)
    sidebar.add_child(nav_title)

    var nav: Array[Dictionary] = RegistryScript.navigation()
    for i: int in nav.size():
        var item: Dictionary = nav[i]
        var button := Button.new()
        button.position = Vector2(14, 62 + i * 50)
        button.size = Vector2(190, 42)
        button.text = "  %s    %s" % [String(item["icon"]), String(item["label"])]
        button.alignment = HORIZONTAL_ALIGNMENT_LEFT
        button.add_theme_font_size_override("font_size", 12)
        button.add_theme_color_override("font_color", TEXT)
        button.pressed.connect(func(section: String = String(item["id"])): show_section(section))
        sidebar.add_child(button)
        nav_buttons[String(item["id"])] = button

    var side_footer := Label.new()
    side_footer.position = Vector2(24, 570)
    side_footer.text = "CPST NETWORK\nAUTHORIZED PERSONNEL\nCLIENT v0.1"
    side_footer.add_theme_font_size_override("font_size", 9)
    side_footer.add_theme_color_override("font_color", MUTED)
    sidebar.add_child(side_footer)

    title_label = Label.new()
    title_label.position = Vector2(252, 98)
    title_label.add_theme_font_size_override("font_size", 28)
    title_label.add_theme_color_override("font_color", TEXT)
    add_child(title_label)

    section_label = Label.new()
    section_label.position = Vector2(254, 135)
    section_label.add_theme_font_size_override("font_size", 10)
    section_label.add_theme_color_override("font_color", ACCENT)
    add_child(section_label)

    content = Control.new()
    content.position = Vector2(252, 165)
    content.size = Vector2(1000, 525)
    add_child(content)

func clear_content() -> void:
    if content:
        for child: Node in content.get_children():
            child.queue_free()

func panel(rect: Rect2) -> Panel:
    var p := Panel.new()
    p.position = rect.position
    p.size = rect.size
    var style := StyleBoxFlat.new()
    style.bg_color = PANEL
    style.border_color = LINE
    style.set_border_width_all(1)
    style.corner_radius_top_left = 4
    style.corner_radius_top_right = 4
    style.corner_radius_bottom_left = 4
    style.corner_radius_bottom_right = 4
    p.add_theme_stylebox_override("panel", style)
    content.add_child(p)
    return p

func label(parent: Control, pos: Vector2, text_value: String, size: int = 13, color: Color = TEXT) -> Label:
    var l := Label.new()
    l.position = pos
    l.text = text_value
    l.add_theme_font_size_override("font_size", size)
    l.add_theme_color_override("font_color", color)
    parent.add_child(l)
    return l

func button(parent: Control, rect: Rect2, text_value: String, callback: Callable) -> Button:
    var b := Button.new()
    b.position = rect.position
    b.size = rect.size
    b.text = text_value
    b.pressed.connect(callback)
    b.add_theme_font_size_override("font_size", 12)
    parent.add_child(b)
    return b

func set_canon_records(records: Array, status: Dictionary) -> void:
    canon_records = records
    canon_status = status
    if active_section == "database":
        _show_database()

func show_section(section: String) -> void:
    active_section = section
    section_changed.emit(section)
    clear_content()
    match section:
        "home":
            _show_home()
        "games":
            _show_games()
        "database":
            _show_database()
        "rooms":
            _show_rooms()
        "profile":
            _show_profile()
        "settings":
            _show_settings()
        _:
            _show_home()
    for id: String in nav_buttons:
        var b: Button = nav_buttons[id]
        b.modulate = ACCENT if id == active_section else Color.WHITE

func _show_home() -> void:
    title_label.text = "COMMAND CENTER"
    section_label.text = "CPST // OVERVIEW"

    var hero := panel(Rect2(0, 0, 970, 165))
    label(hero, Vector2(24, 20), "CORN PLANET PARTY", 24, ACCENT)
    label(hero, Vector2(25, 58), "One application for the entire CPI ecosystem.", 16)
    label(hero, Vector2(25, 88), "Games, missions, rooms, database access, profiles and shared services live here.", 12, MUTED)
    button(hero, Rect2(25, 116, 180, 34), "CREATE PARTY ROOM", create_room_requested.emit)
    button(hero, Rect2(215, 116, 150, 34), "VIEW GAMES", func(): show_section("games"))

    var cards := [
        ["GAMES", "6 registered modules", "Launch CPI Party games and missions.", "games"],
        ["CPST DATABASE", "Canon + records", "Inspect entities and institution records.", "database"],
        ["ROOMS", "Multiplayer", "Create, join and resume party sessions.", "rooms"]
    ]
    for i: int in cards.size():
        var c: Array = cards[i]
        var p := panel(Rect2(i * 320.0, 185, 300, 145))
        label(p, Vector2(20, 18), String(c[0]), 12, ACCENT)
        label(p, Vector2(20, 45), String(c[1]), 19)
        label(p, Vector2(20, 78), String(c[2]), 11, MUTED)
        button(p, Rect2(20, 105, 120, 26), "OPEN", func(target: String = String(c[3])): show_section(target))

    var activity := panel(Rect2(0, 350, 970, 145))
    label(activity, Vector2(20, 18), "SYSTEM STATUS", 12, ACCENT)
    label(activity, Vector2(20, 50), "NATIVE RUNTIME", 11, MUTED)
    label(activity, Vector2(180, 50), "READY", 12)
    label(activity, Vector2(20, 78), "GAME REGISTRY", 11, MUTED)
    label(activity, Vector2(180, 78), "%d modules" % RegistryScript.games().size(), 12)
    label(activity, Vector2(20, 106), "CPST SERVICES", 11, MUTED)
    label(activity, Vector2(180, 106), "LOCAL / BRIDGE READY", 12)

func _show_games() -> void:
    title_label.text = "GAME LIBRARY"
    section_label.text = "CPST // OPERATIONS"
    var games: Array[Dictionary] = RegistryScript.games()
    for i: int in games.size():
        var g: Dictionary = games[i]
        var row: int = i / 2
        var col: int = i % 2
        var p := panel(Rect2(col * 485.0, row * 118.0, 465, 105))
        label(p, Vector2(18, 14), String(g["category"]), 9, ACCENT)
        label(p, Vector2(18, 32), String(g["name"]), 16)
        label(p, Vector2(18, 57), String(g["description"]), 10, MUTED)
        label(p, Vector2(18, 78), "%s  //  %s" % [String(g["players"]), String(g["status"])], 9, MUTED)
        if String(g["scene"]) != "":
            button(p, Rect2(335, 64, 110, 26), "LAUNCH", func(id: String = String(g["id"])): launch_game_requested.emit(id))
        else:
            button(p, Rect2(335, 64, 110, 26), "OPEN", func(): show_section("rooms"))

func show_canon_record(record: Dictionary) -> void:
    clear_content()
    title_label.text = String(record.get("ref", "CANON RECORD"))
    section_label.text = "CPI // CANON RECORD"
    var p := panel(Rect2(0, 0, 970, 470))
    label(p, Vector2(24, 22), String(record.get("title", "UNTITLED")), 24, ACCENT)
    label(p, Vector2(24, 62), String(record.get("kind", "canon")).to_upper(), 10, MUTED)
    var fields_variant: Variant = record.get("fields", {})
    if fields_variant is Dictionary:
        var fields: Dictionary = fields_variant
        var y := 105.0
        for key: Variant in fields.keys():
            label(p, Vector2(24, y), String(key).to_upper(), 9, MUTED)
            label(p, Vector2(180, y), String(fields[key]), 11)
            y += 48.0
            if y > 405.0:
                break
    button(p, Rect2(24, 425, 140, 30), "BACK TO DATABASE", func(): show_section("database"))

func _show_database() -> void:
    title_label.text = "CPST DATABASE"
    section_label.text = "CPI // CANON RECORDS"

    var p := panel(Rect2(0, 0, 970, 120))
    label(p, Vector2(20, 18), "CANON SNAPSHOT", 12, ACCENT)
    var record_count: int = canon_records.size()
    var loaded: int = int(canon_status.get("records", record_count))
    label(p, Vector2(20, 46), "%d RECORDS LOADED" % loaded, 20)
    label(p, Vector2(20, 78), "Read-only native view. Redacted material stays redacted.", 10, MUTED)
    button(p, Rect2(730, 42, 190, 34), "REFRESH CANON", func():
        if session:
            session.fetch_canon()
        status_label.text = "LOADING // CPST CANON"
    )

    if record_count == 0:
        var empty := panel(Rect2(0, 145, 970, 145))
        label(empty, Vector2(20, 20), "NO LOCAL SNAPSHOT YET", 18, ACCENT)
        label(empty, Vector2(20, 55), "Connect to the Party server and refresh the canon to populate the native database.", 11, MUTED)
        button(empty, Rect2(20, 92, 180, 30), "OPEN WEB DATABASE", func(): OS.shell_open("https://jj2sly.github.io/corn.planet"))
        return

    var shown: int = mini(record_count, 8)
    for i: int in shown:
        var record_variant: Variant = canon_records[i]
        if not record_variant is Dictionary:
            continue
        var record: Dictionary = record_variant
        var row: int = i / 2
        var col: int = i % 2
        var card := panel(Rect2(col * 485.0, 145 + row * 92.0, 465, 78))
        label(card, Vector2(15, 12), String(record.get("ref", "UNKNOWN")), 10, ACCENT)
        label(card, Vector2(15, 31), String(record.get("title", "UNTITLED")), 14)
        label(card, Vector2(330, 14), String(record.get("kind", "canon")).to_upper(), 9, MUTED)
        button(card, Rect2(330, 31, 115, 28), "VIEW RECORD", func(ref: String = String(record.get("ref", ""))): canon_record_requested.emit(ref))

func _show_rooms() -> void:
    title_label.text = "ROOMS"
    section_label.text = "CPI PARTY // MULTIPLAYER"
    var p := panel(Rect2(0, 0, 620, 205))
    label(p, Vector2(24, 22), "PARTY SESSION", 20, ACCENT)
    label(p, Vector2(24, 60), "Create a room for the current client and invite\nother CPI Party players.", 12)
    button(p, Rect2(24, 125, 190, 36), "CREATE PARTY ROOM", create_room_requested.emit)
    label(p, Vector2(24, 172), "The existing server bridge remains authoritative.", 10, MUTED)
    var r := panel(Rect2(645, 0, 325, 250))
    label(r, Vector2(20, 20), "JOIN", 12, ACCENT)
    label(r, Vector2(20, 50), "ROOM CODE", 11, MUTED)
    var code := LineEdit.new()
    code.position = Vector2(20, 72)
    code.size = Vector2(285, 34)
    code.placeholder_text = "ABCD"
    code.max_length = 4
    code.text = String(app_state.last_room_code) if app_state else ""
    r.add_child(code)

    label(r, Vector2(20, 120), "DISPLAY NAME", 11, MUTED)
    var name := LineEdit.new()
    name.position = Vector2(20, 142)
    name.size = Vector2(285, 34)
    name.placeholder_text = "CPI OPERATIVE"
    name.text = String(app_state.display_name) if app_state else "CPI OPERATIVE"
    r.add_child(name)

    button(r, Rect2(20, 192, 120, 32), "JOIN ROOM", func():
        if session:
            session.connect_player(code.text.strip_edges().to_upper(), name.text.strip_edges(), app_state.server_url if app_state else "http://127.0.0.1:3000")
        if app_state:
            app_state.set_display_name(name.text)
        status_label.text = "CONNECTING // ROOM %s" % code.text.strip_edges().to_upper()
    )

func _show_profile() -> void:
    title_label.text = "PROFILE"
    section_label.text = "CPI // PERSONNEL"
    var p := panel(Rect2(0, 0, 620, 250))
    label(p, Vector2(24, 22), "LOCAL PROFILE", 20, ACCENT)
    label(p, Vector2(24, 62), "DISPLAY NAME", 10, MUTED)
    label(p, Vector2(24, 82), String(app_state.display_name) if app_state else "CPI OPERATIVE", 16)
    label(p, Vector2(24, 125), "ACCOUNT", 10, MUTED)
    label(p, Vector2(24, 145), "Native client profile", 12)
    label(p, Vector2(330, 62), "STATS", 10, MUTED)
    label(p, Vector2(330, 82), "0 GAMES", 16)
    label(p, Vector2(330, 125), "ACHIEVEMENTS", 10, MUTED)
    label(p, Vector2(330, 145), "0 UNLOCKED", 12)
    label(p, Vector2(24, 205), "Account sync will use the existing CPI identity system.", 10, MUTED)

func _show_settings() -> void:
    title_label.text = "SETTINGS"
    section_label.text = "CPI // CLIENT CONFIGURATION"
    var p := panel(Rect2(0, 0, 620, 280))
    label(p, Vector2(24, 22), "CLIENT", 20, ACCENT)
    label(p, Vector2(24, 65), "SERVER URL", 10, MUTED)
    var server := LineEdit.new()
    server.position = Vector2(24, 87)
    server.size = Vector2(420, 34)
    server.text = String(app_state.server_url) if app_state else "http://127.0.0.1:3000"
    p.add_child(server)
    label(p, Vector2(24, 145), "QUALITY", 10, MUTED)
    var quality := OptionButton.new()
    quality.position = Vector2(24, 167)
    quality.size = Vector2(200, 34)
    quality.add_item("AUTO")
    quality.add_item("PERFORMANCE")
    quality.add_item("QUALITY")
    quality.select(quality.get_item_index(String(app_state.quality))) if app_state else 0
    p.add_child(quality)
    button(p, Rect2(24, 220, 140, 30), "SAVE SETTINGS", func():
        if app_state:
            app_state.set_server_url(server.text)
            app_state.set_quality(quality.get_item_text(quality.selected))
        status_label.text = "SETTINGS SAVED"
    )
    label(p, Vector2(180, 228), "Shared settings apply across every module.", 10, MUTED)
