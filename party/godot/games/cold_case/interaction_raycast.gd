extends RayCast3D
class_name ColdCaseInteractionRay

signal interacted(target: Node)
var interact_distance := 3.5

func try_interact() -> void:
    force_raycast_update()
    if is_colliding():
        var target := get_collider()
        if target is Node:
            interacted.emit(target)
