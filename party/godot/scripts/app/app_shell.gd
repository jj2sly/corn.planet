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
var notifications: Node
var identity: Node
var services: Node

var canon_records: Array = []
var canon_status: Dictionary = {}
var database_search := ""
var game_search := ""
var server_game_ids: Dictionary = {}

const BG := Color(0.012, 0.015, 0.018)
const PANEL := Color(0.035, 0.041, 0.047)
const LINE := Color(0.15, 0.17, 0.19)
const TEXT := Color(0.88, 0.89, 0.90)
const MUTED := Color(0.48, 0.51, 0.54)
const ACCENT := Color(1.0, 0.83, 0.0)

func setup(p_session: Node, p_state: Node, p_notifications: Node = null, p_identity: Node = null, p_services: Node = null) -> void:
    session = p_session
    app_state = p_state
    notifications = p_notifications
    identity = p_identity
    services = p_services
    if notifications and notifications.has_signal("notification_added"):
        notifications.notification_added.connect(_on_notification_added)
    if identity and identity.has_signal("identity_changed"):
        identity.identity_changed.connect(_on_identity_changed)
    if identity and identity.has_signal("stats_changed"):
        identity.stats_changed.connect(_on_stats_changed)
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
    status_label.position = Vector2(940, 25)
    status_label.size = Vector2(300, 24)
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
        var nav_button := Button.new()
        nav_button.position = Vector2(14, 62 + i * 50)
        nav_button.size = Vector2(190, 42)
        nav_button.text = "  %s    %s" % [String(item["icon"]), String(item["label"])]
        nav_button.alignment = HORIZONTAL_ALIGNMENT_LEFT
        nav_button.add_theme_font_size_override("font_size", 12)
        nav_button.add_theme_color_override("font_color", TEXT)
        nav_button.pressed.connect(func(section: String = String(item["id"])): show_section(section))
        sidebar.add_child(nav_button)
        nav_buttons[String(item["id"])] = nav_button

    var side_footer := Label.new()
    side_footer.position = Vector2(24, 570)
    side_footer.text = "CPST NETWORK\nAUTHORIZED PERSONNEL\nCLIENT v0.2"
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

func set_status(value: String) -> void:
    if status_label:
        status_label.text = value

func set_server_games(games: Array) -> void:
    server_game_ids.clear()
    for game_variant: Variant in games:
        if game_variant is Dictionary:
            var game: Dictionary = game_variant
            server_game_ids[String(game.get("id", ""))] = game
    if active_section == "games":
        _show_games()
    elif active_section == "home":
        _show_home()

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
        "notifications":
            _show_notifications()
        "settings":
            _show_settings()
        _:
            _show_home()
    for id: String in nav_buttons:
        var b: Button = nav_buttons[id]
        b.modulate = ACCENT if id == active_section else Color.WHITE

func _show_home() -> void:
    title_label.text = "COMMAND CENTER"
    section_label.text = "CPST // CPI PARTY PLATFORM"

    var hero := panel(Rect2(0, 0, 970, 165))
    label(hero, Vector2(24, 18), "CORN PLANET PARTY", 25, ACCENT)
    label(hero, Vector2(25, 54), "THE CPI OPERATIONS PLATFORM", 12, MUTED)
    label(hero, Vector2(25, 78), "Games, rooms, canon, personnel and shared services in one client.", 13)
    button(hero, Rect2(25, 116, 180, 34), "CREATE PARTY ROOM", func(): create_room_requested.emit())
    button(hero, Rect2(215, 116, 150, 34), "GAME LIBRARY", func(): show_section("games"))
    label(hero, Vector2(620, 28), "PLATFORM", 9, MUTED)
    label(hero, Vector2(620, 50), "NATIVE CLIENT", 18)
    label(hero, Vector2(620, 79), "SERVER BRIDGE", 11, MUTED)
    label(hero, Vector2(620, 101), "READY", 12, ACCENT)

    var cards := [
        ["GAMES", "%d MODULES" % RegistryScript.games().size(), "Launch party games and missions.", "games"],
        ["CPI DATABASE", "%d RECORDS" % canon_records.size(), "Read institution canon and records.", "database"],
        ["ROOMS", "MULTIPLAYER", "Create, join and resume sessions.", "rooms"]
    ]
    for i: int in cards.size():
        var card_data: Array = cards[i]
        var card := panel(Rect2(i * 320.0, 185, 300, 145))
        label(card, Vector2(20, 18), String(card_data[0]), 11, ACCENT)
        label(card, Vector2(20, 45), String(card_data[1]), 19)
        label(card, Vector2(20, 78), String(card_data[2]), 11, MUTED)
        button(card, Rect2(20, 105, 120, 26), "OPEN", func(target: String = String(card_data[3])): show_section(target))

    var activity := panel(Rect2(0, 350, 970, 145))
    label(activity, Vector2(20, 18), "PLATFORM STATUS", 11, ACCENT)
    label(activity, Vector2(20, 48), "CLIENT", 9, MUTED)
    label(activity, Vector2(150, 48), "GODOT NATIVE", 11)
    label(activity, Vector2(20, 76), "GAME REGISTRY", 9, MUTED)
    label(activity, Vector2(150, 76), "%d local / %d server" % [RegistryScript.games().size(), server_game_ids.size()], 11)
    label(activity, Vector2(20, 104), "CANON BRIDGE", 9, MUTED)
    label(activity, Vector2(150, 104), "READ-ONLY // READY", 11)
    label(activity, Vector2(520, 48), "PROFILE", 9, MUTED)
    label(activity, Vector2(650, 48), String(app_state.display_name) if app_state else "CPI OPERATIVE", 11)
    label(activity, Vector2(520, 76), "SERVER", 9, MUTED)
    label(activity, Vector2(650, 76), String(app_state.server_url) if app_state else "LOCAL", 10)
    label(activity, Vector2(520, 104), "LAST ROOM", 9, MUTED)
    label(activity, Vector2(650, 104), String(app_state.last_room_code) if app_state and not String(app_state.last_room_code).is_empty() else "NONE", 11)

func _show_games() -> void:
    title_label.text = "GAME LIBRARY"
    section_label.text = "CPST // ALL MODULES"

    var search := LineEdit.new()
    search.position = Vector2(0, 0)
    search.size = Vector2(700, 34)
    search.placeholder_text = "SEARCH GAMES..."
    search.text = game_search
    search.text_changed.connect(func(value: String):
        game_search = value
        _render_game_cards()
    )
    content.add_child(search)

    var recent_count := app_state.recent_games.size() if app_state else 0
    label(content, Vector2(730, 9), "%d RECENT" % recent_count, 10, MUTED)
    _render_game_cards()

func _render_game_cards() -> void:
    for child: Node in content.get_children():
        if child.position.y >= 42:
            child.queue_free()

    var query := game_search.strip_edges().to_lower()
    var visible_index := 0
    for game: Dictionary in RegistryScript.games():
        var haystack := "%s %s %s" % [String(game["name"]), String(game["category"]), String(game["description"])]
        if not query.is_empty() and not haystack.to_lower().contains(query):
            continue

        var row: int = visible_index / 2
        var col: int = visible_index % 2
        var card := panel(Rect2(col * 485.0, 48 + row * 118.0, 465, 105))
        var game_id := String(game["id"])
        var favorite := app_state.is_favorite(game_id) if app_state else false
        label(card, Vector2(18, 12), String(game["category"]), 9, ACCENT)
        label(card, Vector2(18, 30), ("%s  ★" if favorite else "%s") % String(game["name"]), 16)
        label(card, Vector2(18, 56), String(game["description"]), 10, MUTED)
        var server_ready := server_game_ids.has(game_id)
        var availability := "SERVER READY" if server_ready else String(game["status"])
        label(card, Vector2(18, 78), "%s  //  %s" % [String(game["players"]), availability], 9, MUTED)
        button(card, Rect2(300, 14, 34, 26), "★" if favorite else "☆", func(id: String = game_id):
            if app_state:
                app_state.toggle_favorite(id)
                _show_games()
        )
        button(card, Rect2(342, 64, 103, 26), "LAUNCH" if not String(game["scene"]).is_empty() else "OPEN ROOM", func(id: String = game_id): launch_game_requested.emit(id))
        visible_index += 1

func _show_database() -> void:
    title_label.text = "CPI DATABASE"
    section_label.text = "CPI // READ-ONLY CANON"

    var toolbar := panel(Rect2(0, 0, 970, 72))
    var search := LineEdit.new()
    search.position = Vector2(18, 18)
    search.size = Vector2(500, 34)
    search.placeholder_text = "SEARCH REF, TITLE OR TYPE..."
    search.text = database_search
    search.text_changed.connect(func(value: String):
        database_search = value
        _render_database_cards()
    )
    toolbar.add_child(search)
    button(toolbar, Rect2(535, 18, 155, 34), "REFRESH CANON", func():
        if session:
            session.fetch_canon()
        set_status("LOADING // CPI CANON")
    )
    label(toolbar, Vector2(715, 27), "%d LOADED" % canon_records.size(), 10, MUTED)
    _render_database_cards()

func _render_database_cards() -> void:
    for child: Node in content.get_children():
        if child.position.y >= 80:
            child.queue_free()

    var query := database_search.strip_edges().to_lower()
    var visible_index := 0
    for record_variant: Variant in canon_records:
        if not record_variant is Dictionary:
            continue
        var record: Dictionary = record_variant
        var haystack := "%s %s %s" % [String(record.get("ref", "")), String(record.get("title", "")), String(record.get("kind", ""))]
        if not query.is_empty() and not haystack.to_lower().contains(query):
            continue
        var row: int = visible_index / 2
        var col: int = visible_index % 2
        var card := panel(Rect2(col * 485.0, 84 + row * 92.0, 465, 78))
        label(card, Vector2(15, 11), String(record.get("ref", "UNKNOWN")), 10, ACCENT)
        label(card, Vector2(15, 30), String(record.get("title", "UNTITLED")), 14)
        label(card, Vector2(330, 12), String(record.get("kind", "canon")).to_upper(), 9, MUTED)
        button(card, Rect2(330, 31, 115, 28), "VIEW RECORD", func(ref: String = String(record.get("ref", ""))): canon_record_requested.emit(ref))
        visible_index += 1

    if visible_index == 0:
        var empty := panel(Rect2(0, 90, 970, 100))
        label(empty, Vector2(20, 20), "NO MATCHING RECORDS", 16, ACCENT)
        label(empty, Vector2(20, 52), "Refresh the canon or change the search.", 10, MUTED)

func show_canon_record(record: Dictionary) -> void:
    clear_content()
    title_label.text = String(record.get("ref", "CANON RECORD"))
    section_label.text = "CPI // CANON RECORD"

    var record_panel := panel(Rect2(0, 0, 970, 470))
    label(record_panel, Vector2(24, 22), String(record.get("title", "UNTITLED")), 24, ACCENT)
    label(record_panel, Vector2(24, 62), String(record.get("kind", "canon")).to_upper(), 10, MUTED)

    var fields_variant: Variant = record.get("fields", {})
    if fields_variant is Dictionary:
        var fields: Dictionary = fields_variant
        var y := 105.0
        for key: Variant in fields.keys():
            label(record_panel, Vector2(24, y), String(key).to_upper(), 9, MUTED)
            var value_label := label(record_panel, Vector2(180, y), String(fields[key]), 11)
            value_label.size = Vector2(740, 44)
            value_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
            y += 48.0
            if y > 405.0:
                break

    button(record_panel, Rect2(24, 425, 150, 30), "BACK TO DATABASE", func(): show_section("database"))

func _show_rooms() -> void:
    title_label.text = "PARTY ROOMS"
    section_label.text = "CPI PARTY // SESSION CONTROL"

    var create := panel(Rect2(0, 0, 470, 255))
    label(create, Vector2(24, 22), "HOST A PARTY", 20, ACCENT)
    label(create, Vector2(24, 60), "Start a server-authoritative room and\nbecome the host.", 12)
    button(create, Rect2(24, 125, 190, 38), "CREATE PARTY ROOM", func():
        create_room_requested.emit()
        set_status("CREATING // PARTY ROOM")
    )
    label(create, Vector2(24, 184), "SERVER", 9, MUTED)
    label(create, Vector2(24, 204), String(app_state.server_url) if app_state else "LOCAL", 10)

    var join := panel(Rect2(500, 0, 470, 255))
    label(join, Vector2(24, 22), "JOIN A PARTY", 20, ACCENT)
    label(join, Vector2(24, 60), "Enter the room code and your display name.", 12)
    label(join, Vector2(24, 96), "ROOM CODE", 9, MUTED)
    var code := LineEdit.new()
    code.position = Vector2(24, 114)
    code.size = Vector2(190, 34)
    code.placeholder_text = "ABCD"
    code.max_length = 4
    code.text = String(app_state.last_room_code) if app_state else ""
    join.add_child(code)

    label(join, Vector2(230, 96), "DISPLAY NAME", 9, MUTED)
    var name := LineEdit.new()
    name.position = Vector2(230, 114)
    name.size = Vector2(210, 34)
    name.placeholder_text = "CPI OPERATIVE"
    name.text = String(app_state.display_name) if app_state else "CPI OPERATIVE"
    join.add_child(name)

    button(join, Rect2(24, 170, 130, 34), "JOIN ROOM", func():
        if session:
            session.connect_player(code.text.strip_edges().to_upper(), name.text.strip_edges(), app_state.server_url if app_state else "http://127.0.0.1:3000")
        if app_state:
            app_state.set_display_name(name.text)
            app_state.remember_room(code.text.strip_edges().to_upper())
        set_status("CONNECTING // ROOM %s" % code.text.strip_edges().to_upper())
    )
    button(join, Rect2(166, 170, 130, 34), "USE LAST ROOM", func():
        code.text = String(app_state.last_room_code) if app_state else ""
    )

    var current := panel(Rect2(0, 280, 970, 205))
    var connected := session and not session.room_code.is_empty()
    var state: Dictionary = session.last_state if connected and session.last_state is Dictionary else {}
    var config_variant: Variant = state.get("config", {})
    var config: Dictionary = config_variant if config_variant is Dictionary else {}
    var module_id := String(config.get("gameId", ""))
    if module_id.is_empty() and services:
        var modules := services.get_service("modules")
        if modules:
            module_id = String(modules.active_game_id if not modules.active_game_id.is_empty() else modules.pending_game_id)

    var players_variant: Variant = state.get("players", [])
    var players: Array = players_variant if players_variant is Array else []
    var room_status := String(state.get("status", "LOBBY" if connected else "OFFLINE"))
    var max_players := int(state.get("maxPlayers", 8))
    var timer_variant: Variant = state.get("timer", null)
    var timer_text := "—"
    if timer_variant is Dictionary:
        var timer: Dictionary = timer_variant
        timer_text = "%ds" % int(ceil(float(timer.get("remainingMs", 0)) / 1000.0))

    label(current, Vector2(20, 18), "CURRENT SESSION", 11, ACCENT)
    label(current, Vector2(20, 48), "ROOM", 9, MUTED)
    label(current, Vector2(140, 48), session.room_code if connected else "NOT CONNECTED", 12)
    label(current, Vector2(20, 78), "ROLE", 9, MUTED)
    label(current, Vector2(140, 78), session.role.to_upper() if connected else "—", 12)
    label(current, Vector2(20, 108), "MODULE", 9, MUTED)
    label(current, Vector2(140, 108), module_id.to_upper() if not module_id.is_empty() else "NONE SELECTED", 11)
    label(current, Vector2(20, 138), "STATE", 9, MUTED)
    label(current, Vector2(140, 138), room_status, 11, ACCENT if room_status == "IN_GAME" else TEXT)
    label(current, Vector2(20, 168), "PLAYERS", 9, MUTED)
    label(current, Vector2(140, 168), "%d / %d" % [players.size(), max_players], 11)

    label(current, Vector2(390, 48), "TIMER", 9, MUTED)
    label(current, Vector2(470, 48), timer_text, 12)
    label(current, Vector2(390, 78), "HOST", 9, MUTED)
    label(current, Vector2(470, 78), "CONNECTED" if bool(state.get("hostConnected", false)) else "OFFLINE", 11)
    label(current, Vector2(390, 108), "STEP", 9, MUTED)
    label(current, Vector2(470, 108), str(state.get("step", 0)), 11)
    label(current, Vector2(390, 138), "AUTHORITY", 9, MUTED)
    label(current, Vector2(470, 138), "SERVER", 11, ACCENT)

    if connected:
        button(current, Rect2(650, 48, 130, 34), "LEAVE ROOM", func():
            session.leave()
            set_status("LEAVING // ROOM")
        )
        if session.role == "host" and not module_id.is_empty() and room_status == "LOBBY":
            button(current, Rect2(795, 48, 145, 34), "START GAME", func():
                session.start_game()
                set_status("STARTING // %s" % module_id.to_upper())
            )

func _on_identity_changed(_profile: Dictionary) -> void:
    if active_section == "profile":
        _show_profile()

func _on_stats_changed(_stats: Dictionary) -> void:
    if active_section == "profile":
        _show_profile()

func _show_profile() -> void:
    clear_content()
    title_label.text = "PROFILE"
    section_label.text = "CPI // PERSONNEL FILE"

    var account_profile: Dictionary = identity.profile if identity and identity.is_signed_in() else {}
    var account_stats: Dictionary = identity.stats if identity else {}
    var signed_in := not account_profile.is_empty()

    var profile := panel(Rect2(0, 0, 620, 300))
    label(profile, Vector2(24, 22), "CPI OPERATIVE PROFILE", 20, ACCENT)
    label(profile, Vector2(24, 58), "ACCOUNT STATUS", 9, MUTED)
    label(profile, Vector2(24, 78), "AUTHENTICATED" if signed_in else "LOCAL GUEST", 13, ACCENT if signed_in else TEXT)

    label(profile, Vector2(24, 118), "DISPLAY NAME", 9, MUTED)
    var name := LineEdit.new()
    name.position = Vector2(24, 138)
    name.size = Vector2(330, 34)
    name.text = String(account_profile.get("displayName", app_state.display_name if app_state else "CPI OPERATIVE"))
    name.editable = not signed_in
    profile.add_child(name)

    if signed_in:
        label(profile, Vector2(390, 58), "CLEARANCE", 9, MUTED)
        label(profile, Vector2(390, 78), String(account_profile.get("role", "VIEWER")), 13)
        label(profile, Vector2(390, 118), "USER ID", 9, MUTED)
        label(profile, Vector2(390, 138), String(account_profile.get("uid", "UNKNOWN")).left(18), 10, MUTED)
        button(profile, Rect2(24, 195, 140, 32), "REFRESH ACCOUNT", func():
            if identity:
                identity.refresh()
            set_status("REFRESHING // CPI ACCOUNT")
        )
        button(profile, Rect2(178, 195, 120, 32), "SIGN OUT", func():
            if identity:
                identity.sign_out()
            set_status("SIGNED OUT // LOCAL PROFILE")
        )
    else:
        button(profile, Rect2(24, 195, 150, 32), "SAVE LOCAL NAME", func():
            if app_state:
                app_state.set_display_name(name.text)
            set_status("PROFILE SAVED")
        )
        label(profile, Vector2(24, 248), "CPI account sign-in transport is ready; token acquisition UI is the next auth step.", 10, MUTED)

    var stats_panel := panel(Rect2(645, 0, 325, 300))
    label(stats_panel, Vector2(20, 22), "ACTIVITY", 12, ACCENT)
    label(stats_panel, Vector2(20, 58), "RECENT MODULES", 9, MUTED)
    label(stats_panel, Vector2(180, 56), str(app_state.recent_games.size() if app_state else 0), 16)
    label(stats_panel, Vector2(20, 92), "FAVORITES", 9, MUTED)
    label(stats_panel, Vector2(180, 90), str(app_state.favorite_games.size() if app_state else 0), 16)
    label(stats_panel, Vector2(20, 132), "SERVER STATS", 9, MUTED)
    if signed_in and not account_stats.is_empty():
        var y := 154.0
        for key: Variant in account_stats.keys():
            label(stats_panel, Vector2(20, y), String(key).to_upper(), 9, MUTED)
            label(stats_panel, Vector2(180, y), String(account_stats[key]), 11)
            y += 28.0
            if y > 258.0:
                break
    else:
        label(stats_panel, Vector2(20, 158), "Sign in to load persistent CPI Party stats.", 10, MUTED)

func _on_notification_added(_notification: Dictionary) -> void:
    if active_section == "notifications":
        _show_notifications()

func _show_notifications() -> void:
    clear_content()
    title_label.text = "NOTIFICATIONS"
    section_label.text = "CPI // SYSTEM ACTIVITY"

    var toolbar := panel(Rect2(0, 0, 970, 70))
    label(toolbar, Vector2(20, 18), "ACTIVITY CENTER", 16, ACCENT)
    label(toolbar, Vector2(20, 42), "Platform, network and module events.", 10, MUTED)
    if notifications:
        button(toolbar, Rect2(790, 18, 150, 32), "CLEAR ALL", func():
            notifications.clear()
            _show_notifications()
        )

    var items: Array[Dictionary] = []
    if notifications:
        items = notifications.recent(8)
    if items.is_empty():
        var empty := panel(Rect2(0, 90, 970, 100))
        label(empty, Vector2(20, 20), "NO NOTIFICATIONS", 16, ACCENT)
        label(empty, Vector2(20, 52), "System activity will appear here.", 10, MUTED)
        return

    for i: int in items.size():
        var item: Dictionary = items[i]
        var row := panel(Rect2(0, 84 + i * 52.0, 970, 44))
        var level := String(item.get("level", "info")).to_upper()
        label(row, Vector2(14, 8), level, 9, ACCENT if level == "SUCCESS" else MUTED)
        label(row, Vector2(90, 7), String(item.get("title", "CPI")), 11)
        label(row, Vector2(285, 7), String(item.get("message", "")), 10, MUTED)
        label(row, Vector2(800, 7), String(item.get("created_at", "")), 9, MUTED)

func _show_settings() -> void:
    title_label.text = "SETTINGS"
    section_label.text = "CPI // CLIENT CONFIGURATION"

    var settings_panel := panel(Rect2(0, 0, 700, 340))
    label(settings_panel, Vector2(24, 22), "CLIENT SETTINGS", 20, ACCENT)
    label(settings_panel, Vector2(24, 65), "SERVER URL", 9, MUTED)

    var server := LineEdit.new()
    server.position = Vector2(24, 85)
    server.size = Vector2(520, 34)
    server.text = String(app_state.server_url) if app_state else "http://127.0.0.1:3000"
    settings_panel.add_child(server)

    label(settings_panel, Vector2(24, 145), "QUALITY PROFILE", 9, MUTED)
    var quality := OptionButton.new()
    quality.position = Vector2(24, 165)
    quality.size = Vector2(220, 34)
    quality.add_item("AUTO")
    quality.add_item("PERFORMANCE")
    quality.add_item("QUALITY")
    if app_state:
        for i in quality.item_count:
            if quality.get_item_text(i) == String(app_state.quality):
                quality.select(i)
                break
    settings_panel.add_child(quality)

    label(settings_panel, Vector2(280, 145), "MASTER VOLUME", 9, MUTED)
    var volume := HSlider.new()
    volume.position = Vector2(280, 165)
    volume.size = Vector2(260, 34)
    volume.min_value = 0.0
    volume.max_value = 1.0
    volume.step = 0.05
    volume.value = float(app_state.master_volume) if app_state else 1.0
    settings_panel.add_child(volume)

    button(settings_panel, Rect2(24, 225, 160, 34), "SAVE SETTINGS", func():
        if app_state:
            app_state.set_server_url(server.text)
        if services:
            var quality_service := services.get_service("quality")
            if quality_service:
                quality_service.set_quality(quality.get_item_text(quality.selected))
            var audio_service := services.get_service("audio")
            if audio_service:
                audio_service.set_master_volume(volume.value)
        elif app_state:
            app_state.set_quality(quality.get_item_text(quality.selected))
            app_state.set_master_volume(volume.value)
        if session:
            session.check_health(server.text)
        set_status("SETTINGS SAVED // CHECKING SERVER")
    )
    label(settings_panel, Vector2(24, 292), "These settings are shared by every native CPI module.", 10, MUTED)
