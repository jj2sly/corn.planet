extends Node
class_name ColdCaseCoreRepair

signal step_changed(step: int, label: String)
signal completed()

const STEPS: Array[String] = ["ALIGN COILS", "RESTORE PRESSURE", "STABILIZE TEMPERATURE", "HOLD CORE"]
var step: int = 0
var active: bool = true

func interact() -> String:
    if not active:
        return "CORE STABLE"
    var label: String = STEPS[step]
    step += 1
    if step >= STEPS.size():
        step = STEPS.size()
        active = false
        completed.emit()
        return "CORE REPAIR COMPLETE"
    step_changed.emit(step, STEPS[step])
    return "CORE // " + label + " COMPLETE"

func current_step() -> String:
    if not active:
        return "COMPLETE"
    return STEPS[step]
