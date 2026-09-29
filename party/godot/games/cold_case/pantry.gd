extends Node3D
class_name ColdCasePantry

var temperature := 4.0
var milk_awake := false
var player_near_milk := false

func _ready() -> void:
    _build_shelves()
    _build_temperature_control()

func _build_shelves() -> void:
    var box := BoxMesh.new()
    box.size = Vector3(0.16, 2.8, 7.0)
    for x in [-5.5, 5.5]:
        var shelf := MeshInstance3D.new()
        shelf.mesh = box
        shelf.position = Vector3(x, 2.0, -8.0)
        shelf.material_override = _metal_material()
        add_child(shelf)
    for y in [1.0, 2.7, 4.4, 5.9]:
        var shelf := MeshInstance3D.new()
        var mesh := BoxMesh.new()
        mesh.size = Vector3(10.5, 0.12, 1.2)
        shelf.mesh = mesh
        shelf.position = Vector3(0, y, -8.0)
        shelf.material_override = _metal_material()
        add_child(shelf)
        _add_food_row(y)

func _add_food_row(y: float) -> void:
    for i in range(6):
        var food := MeshInstance3D.new()
        var mesh := BoxMesh.new()
        mesh.size = Vector3(0.65, 0.85, 0.55)
        food.mesh = mesh
        food.position = Vector3(-4.3 + i * 1.7, y + 0.48, -7.75)
        food.material_override = _food_material(i)
        add_child(food)

func _build_temperature_control() -> void:
    var panel := MeshInstance3D.new()
    var mesh := BoxMesh.new()
    mesh.size = Vector3(0.7, 1.2, 0.15)
    panel.mesh = mesh
    panel.position = Vector3(4.8, 2.2, -1.0)
    panel.material_override = _metal_material()
    add_child(panel)

func _metal_material() -> StandardMaterial3D:
    var m := StandardMaterial3D.new()
    m.albedo_color = Color(0.36, 0.42, 0.44)
    m.metallic = 0.75
    m.roughness = 0.32
    return m

func _food_material(index: int) -> StandardMaterial3D:
    var m := StandardMaterial3D.new()
    m.albedo_color = [Color(0.82,0.82,0.76), Color(0.68,0.42,0.22), Color(0.72,0.75,0.78), Color(0.48,0.62,0.38)][index % 4]
    m.roughness = 0.7
    return m

func set_temperature(value: float) -> void:
    temperature = clamp(value, -25.0, 25.0)

func tick_temperature(delta: float) -> void:
    temperature = move_toward(temperature, 4.0, delta * 0.2)

func trigger_milk_response() -> void:
    if temperature > 10.0 or temperature < -5.0:
        milk_awake = true
