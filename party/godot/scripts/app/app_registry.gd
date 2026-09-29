extends RefCounted
class_name CPIAppRegistry

static func games() -> Array[Dictionary]:
    return [
        {
            "id": "cornlashing",
            "server_game_id": "chaos",
            "name": "CORNLASHING",
            "category": "PARTY",
            "description": "Write anonymous incident reports and vote on who caused the breach.",
            "players": "3–8",
            "status": "AVAILABLE",
            "scene": ""
        },
        {
            "id": "corn-or-shit",
            "server_game_id": "cornorshit",
            "name": "CORN OR SHIT",
            "category": "PARTY",
            "description": "Identify which claim actually exists in the CPST Database.",
            "players": "3–8",
            "status": "AVAILABLE",
            "scene": ""
        },
        {
            "id": "entity-auction",
            "server_game_id": "entityauction",
            "name": "ENTITY AUCTION",
            "category": "PARTY",
            "description": "Bid Kernels on sealed containment bays and survive the audit.",
            "players": "3–8",
            "status": "AVAILABLE",
            "scene": ""
        },
        {
            "id": "my-cob-escaped",
            "server_game_id": "mycob",
            "name": "MY COB ESCAPED",
            "category": "PARTY",
            "description": "Respond to a CPI breach before the Incident Director decides your fate.",
            "players": "3–8",
            "status": "AVAILABLE",
            "scene": ""
        },
        {
            "id": "steam-my-deck",
            "server_game_id": "steamdeck",
            "name": "ESCAPE THAD'S STEAM DECK",
            "category": "PARTY",
            "description": "Run, tilt, draw and survive a Steam Deck that has gone completely wrong.",
            "players": "2–8",
            "status": "IN DEVELOPMENT",
            "scene": ""
        },
        {
            "id": "angry-thuds-revenge",
            "server_game_id": "thud",
            "name": "ANGRY THUD'S REVENGE",
            "category": "PARTY",
            "description": "Launch your crew, destroy the defenses and stop the Red Cow.",
            "players": "2–8",
            "status": "IN DEVELOPMENT",
            "scene": ""
        },
        {
            "id": "cold-case",
            "name": "CPI: COLD CASE",
            "category": "PC GAME",
            "description": "Native CPI mission prototype. Development is paused while the desktop platform and Party catalog are finished.",
            "players": "1–8",
            "status": "BACK BURNER",
            "scene": "res://games/cold_case/cold_case.tscn"
        }
    ]

static func find_game(game_id: String) -> Dictionary:
    for game: Dictionary in games():
        if String(game.get("id", "")) == game_id:
            return game
    return {}

static func find_by_server_game_id(server_game_id: String) -> Dictionary:
    for game: Dictionary in games():
        if String(game.get("server_game_id", game.get("id", ""))) == server_game_id:
            return game
    return {}

static func navigation() -> Array[Dictionary]:
    return [
        {"id": "home", "label": "HOME", "icon": "⌂"},
        {"id": "games", "label": "GAMES", "icon": "▶"},
        {"id": "database", "label": "CPI DATABASE", "icon": "▣"},
        {"id": "rooms", "label": "ROOMS", "icon": "◈"},
        {"id": "profile", "label": "PROFILE", "icon": "●"},
        {"id": "notifications", "label": "NOTIFICATIONS", "icon": "!"},
        {"id": "settings", "label": "SETTINGS", "icon": "⚙"}
    ]
