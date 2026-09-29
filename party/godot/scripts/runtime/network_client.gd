extends Node
class_name CPINetworkClient

signal request_completed(path: String, ok: bool, data: Variant)

var base_url: String = "http://127.0.0.1:3000"
var session_token: String = ""
var auth_token: String = ""

func configure(url: String) -> void:
    base_url = url.trim_suffix("/")

func _request_absolute(method: int, url: String, callback_path: String, payload: Variant = null) -> void:
    var http: HTTPRequest = HTTPRequest.new()
    add_child(http)
    var headers: PackedStringArray = PackedStringArray(["Content-Type: application/json"])
    var body: String = "" if payload == null else JSON.stringify(payload)
    var err: int = http.request(url, headers, method, body)
    if err != OK:
        request_completed.emit(callback_path, false, {"error": "HTTP request setup failed", "code": err})
        http.queue_free()
        return
    http.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, bytes: PackedByteArray):
        var data: Variant = {}
        var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
        if parsed != null:
            data = parsed
        var ok: bool = result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300
        request_completed.emit(callback_path, ok, data)
        http.queue_free()
    )

func _request_form_absolute(url: String, callback_path: String, body: String) -> void:
    var http: HTTPRequest = HTTPRequest.new()
    add_child(http)
    var headers: PackedStringArray = PackedStringArray(["Content-Type: application/x-www-form-urlencoded"])
    var err: int = http.request(url, headers, HTTPClient.METHOD_POST, body)
    if err != OK:
        request_completed.emit(callback_path, false, {"error": "HTTP request setup failed", "code": err})
        http.queue_free()
        return
    http.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, bytes: PackedByteArray):
        var data: Variant = {}
        var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
        if parsed != null:
            data = parsed
        var ok: bool = result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300
        request_completed.emit(callback_path, ok, data)
        http.queue_free()
    )

func _request(method: int, path: String, payload: Variant = null) -> void:
    var http: HTTPRequest = HTTPRequest.new()
    add_child(http)
    var headers: PackedStringArray = PackedStringArray(["Content-Type: application/json"])
    if not session_token.is_empty():
        headers.append("X-CPI-Session: " + session_token)
    if not auth_token.is_empty():
        headers.append("Authorization: Bearer " + auth_token)
    var body: String = "" if payload == null else JSON.stringify(payload)
    var err: int = http.request(base_url + path, headers, method, body)
    if err != OK:
        request_completed.emit(path, false, {"error": "HTTP request setup failed", "code": err})
        http.queue_free()
        return
    http.request_completed.connect(func(result: int, code: int, _headers: PackedStringArray, bytes: PackedByteArray):
        var data: Variant = {}
        var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
        if parsed != null:
            data = parsed
        var ok: bool = result == HTTPRequest.RESULT_SUCCESS and code >= 200 and code < 300
        request_completed.emit(path, ok, data)
        http.queue_free()
    )

func fetch_auth_config() -> void:
    _request(HTTPClient.METHOD_GET, "/api/native/auth-config")

func sign_in_email(email: String, password: String, api_key: String) -> void:
    var url := "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + api_key.uri_encode()
    _request_absolute(HTTPClient.METHOD_POST, url, "auth:signin", {
        "email": email,
        "password": password,
        "returnSecureToken": true
    })

func refresh_firebase_token(refresh_token: String, api_key: String) -> void:
    var url := "https://securetoken.googleapis.com/v1/token?key=" + api_key.uri_encode()
    var body := "grant_type=refresh_token&refresh_token=" + refresh_token.uri_encode()
    _request_form_absolute(url, "auth:refresh", body)

func set_auth_token(token: String) -> void:
    auth_token = token.strip_edges()

func fetch_identity() -> void:
    _request(HTTPClient.METHOD_GET, "/api/native/me")

func fetch_stats() -> void:
    _request(HTTPClient.METHOD_GET, "/api/native/me/stats")

func check_health() -> void:
    _request(HTTPClient.METHOD_GET, "/api/native/health")

func create_host() -> void:
    _request(HTTPClient.METHOD_POST, "/api/native/host", {})

func join_player(code: String, name: String) -> void:
    _request(HTTPClient.METHOD_POST, "/api/native/player", {"code": code, "name": name})

func fetch_games() -> void:
    _request(HTTPClient.METHOD_GET, "/api/native/games")

func fetch_canon(kind: String = "") -> void:
    var path := "/api/native/canon"
    if not kind.is_empty():
        path += "?kind=" + kind.uri_encode()
    _request(HTTPClient.METHOD_GET, path)

func fetch_canon_record(ref: String) -> void:
    _request(HTTPClient.METHOD_GET, "/api/native/canon/" + ref.uri_encode())

func fetch_state() -> void:
    _request(HTTPClient.METHOD_GET, "/api/native/state")

func configure_game(game_id: String, settings: Dictionary = {}) -> void:
    _request(HTTPClient.METHOD_POST, "/api/native/configure", {"gameId": game_id, "settings": settings})

func start_game() -> void:
    _request(HTTPClient.METHOD_POST, "/api/native/start", {})

func send_input(action: String, payload: Variant = {}) -> void:
    _request(HTTPClient.METHOD_POST, "/api/native/input", {"action": action, "payload": payload})

func send_host_action(action: String, payload: Variant = {}, step: Variant = null) -> void:
    var body: Dictionary = {"action": action, "payload": payload}
    if step != null:
        body["step"] = step
    _request(HTTPClient.METHOD_POST, "/api/native/host-action", body)

func leave() -> void:
    _request(HTTPClient.METHOD_POST, "/api/native/leave", {})
