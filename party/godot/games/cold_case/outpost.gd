extends Node3D
class_name ColdCaseOutpost

signal chuck_found

var discovered := false
var repair_count: int = 0
var chuck_present: bool = false
var board_label: Label

func _ready() -> void:
    _build_board()

func discover() -> void:
    if discovered:
        return
    discovered = true
    chuck_present = true
    if board_label != null:
        board_label.text = "CHUCK // TECHNICIAN\nSTATUS: LOCATED\n\nREPAIRS\nPOWER     [COMPLETE]\nCOOLING   [COMPLETE]\nCORE      [IN PROGRESS]\n\nNOTE: TECHNICIAN ASSISTANCE AVAILABLE"
    chuck_found.emit()

func record_repair() -> void:
    repair_count += 1

func repair_board_text() -> String:
    return "REPAIR BOARD  //  %d SYSTEMS STABILIZED" % repair_count

func _build_board() -> void:
    board_label = Label.new()
    board_label.position = Vector2(-145, 65)
    board_label.add_theme_font_size_override("font_size", 14)
    board_label.text = "TECHNICIAN OUTPOST\nSTATUS: UNDISCOVERED\n\nREPAIR BOARD\nPOWER     [ ]\nCOOLING   [ ]\nCORE      [ ]"
    add_child(board_label)
