extends Node
class_name CPIIdentityService

signal identity_changed(profile: Dictionary)
signal stats_changed(stats: Dictionary)
signal signed_out()

var session: Node
var profile: Dictionary = {}
var stats: Dictionary = {}

func setup(p_session: Node) -> void:
    session = p_session
    if session:
        session.identity_updated.connect(_on_identity_updated)
        session.stats_updated.connect(_on_stats_updated)

func authenticate(token: String) -> void:
    if session == null:
        return
    session.set_auth_token(token)
    session.fetch_identity()
    session.fetch_stats()

func refresh() -> void:
    if session == null:
        return
    session.fetch_identity()
    session.fetch_stats()

func sign_out() -> void:
    profile.clear()
    stats.clear()
    if session:
        session.set_auth_token("")
    signed_out.emit()
    identity_changed.emit(profile)
    stats_changed.emit(stats)

func is_signed_in() -> bool:
    return not profile.is_empty()

func _on_identity_updated(value: Dictionary) -> void:
    profile = value.duplicate(true)
    identity_changed.emit(profile)

func _on_stats_updated(value: Dictionary) -> void:
    stats = value.duplicate(true)
    stats_changed.emit(stats)
