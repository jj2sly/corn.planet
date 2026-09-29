extends Node
class_name CPIIdentityService

signal identity_changed(profile: Dictionary)
signal stats_changed(stats: Dictionary)
signal auth_config_changed(config: Dictionary)
signal sign_in_state_changed(state: String)
signal signed_out()

var session: Node
var profile: Dictionary = {}
var stats: Dictionary = {}
var auth_config: Dictionary = {}
var sign_in_state := "SIGNED_OUT"
var refresh_token := ""
var token_expires_at := 0.0
var refresh_in_flight := false

func setup(p_session: Node) -> void:
    session = p_session
    if session:
        session.identity_updated.connect(_on_identity_updated)
        session.stats_updated.connect(_on_stats_updated)
        session.auth_config_updated.connect(_on_auth_config_updated)
        session.auth_token_received.connect(_on_auth_token_received)
        session.auth_session_received.connect(_on_auth_session_received)
        session.request_failed.connect(_on_request_failed)

func _process(_delta: float) -> void:
    if refresh_token.is_empty() or refresh_in_flight:
        return
    if token_expires_at <= 0.0 or Time.get_unix_time_from_system() < token_expires_at - 300.0:
        return
    var firebase_variant: Variant = auth_config.get("firebase", null)
    if not firebase_variant is Dictionary:
        return
    var firebase: Dictionary = firebase_variant
    var api_key := String(firebase.get("apiKey", ""))
    if api_key.is_empty():
        return
    refresh_in_flight = true
    session.refresh_auth_token(refresh_token, api_key)

func load_auth_config() -> void:
    if session:
        session.fetch_auth_config()

func sign_in_email(email: String, password: String) -> void:
    if session == null:
        return
    var firebase_variant: Variant = auth_config.get("firebase", null)
    if not firebase_variant is Dictionary:
        sign_in_state = "UNAVAILABLE"
        sign_in_state_changed.emit(sign_in_state)
        return
    var firebase: Dictionary = firebase_variant
    var api_key := String(firebase.get("apiKey", ""))
    if api_key.is_empty():
        sign_in_state = "UNAVAILABLE"
        sign_in_state_changed.emit(sign_in_state)
        return
    sign_in_state = "SIGNING_IN"
    sign_in_state_changed.emit(sign_in_state)
    session.sign_in_email(email.strip_edges(), password, api_key)

func authenticate(token: String) -> void:
    if session == null:
        return
    session.set_auth_token(token)
    _load_account()

func refresh() -> void:
    _load_account()

func sign_out() -> void:
    profile.clear()
    stats.clear()
    refresh_token = ""
    token_expires_at = 0.0
    refresh_in_flight = false
    sign_in_state = "SIGNED_OUT"
    if session:
        session.set_auth_token("")
    signed_out.emit()
    identity_changed.emit(profile)
    stats_changed.emit(stats)
    sign_in_state_changed.emit(sign_in_state)

func is_signed_in() -> bool:
    return not profile.is_empty()

func auth_mode() -> String:
    return String(auth_config.get("mode", "unknown"))

func _load_account() -> void:
    if session == null:
        return
    session.fetch_identity()
    session.fetch_stats()

func _on_auth_config_updated(value: Dictionary) -> void:
    auth_config = value.duplicate(true)
    auth_config_changed.emit(auth_config)

func _on_auth_session_received(value: Dictionary) -> void:
    var next_refresh := String(value.get("refresh_token", ""))
    if not next_refresh.is_empty():
        refresh_token = next_refresh
    var expires_in := max(60, int(value.get("expires_in", 3600)))
    token_expires_at = Time.get_unix_time_from_system() + float(expires_in)
    refresh_in_flight = false

func _on_auth_token_received(_token: String) -> void:
    sign_in_state = "LOADING_PROFILE"
    sign_in_state_changed.emit(sign_in_state)
    _load_account()

func _on_identity_updated(value: Dictionary) -> void:
    profile = value.duplicate(true)
    sign_in_state = "SIGNED_IN"
    identity_changed.emit(profile)
    sign_in_state_changed.emit(sign_in_state)

func _on_stats_updated(value: Dictionary) -> void:
    stats = value.duplicate(true)
    stats_changed.emit(stats)


func _on_request_failed(path: String, _message: String) -> void:
    if path == "auth:signin":
        sign_in_state = "FAILED"
        sign_in_state_changed.emit(sign_in_state)
    elif path == "auth:refresh":
        refresh_in_flight = false
        sign_in_state = "REFRESH_FAILED"
        sign_in_state_changed.emit(sign_in_state)
