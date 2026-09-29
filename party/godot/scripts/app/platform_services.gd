extends Node
class_name CPIPlatformServices

signal service_registered(name: String, service: Node)

var _services: Dictionary = {}

func register_service(name: String, service: Node) -> void:
    if name.is_empty() or service == null:
        return
    _services[name] = service
    service_registered.emit(name, service)

func unregister_service(name: String) -> void:
    _services.erase(name)

func has_service(name: String) -> bool:
    return _services.has(name) and is_instance_valid(_services[name])

func get_service(name: String) -> Node:
    var service: Variant = _services.get(name)
    return service if service is Node and is_instance_valid(service) else null

func snapshot() -> Dictionary:
    var result: Dictionary = {}
    for key: Variant in _services.keys():
        var service: Variant = _services[key]
        result[String(key)] = is_instance_valid(service) if service is Object else false
    return result
