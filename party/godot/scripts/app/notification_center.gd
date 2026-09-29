extends Node
class_name CPINotificationCenter

signal notification_added(notification: Dictionary)
signal notifications_cleared()

const MAX_NOTIFICATIONS := 40

var notifications: Array[Dictionary] = []

func push(title: String, message: String, level: String = "info") -> Dictionary:
    var item: Dictionary = {
        "id": Time.get_unix_time_from_system(),
        "title": title,
        "message": message,
        "level": level,
        "created_at": Time.get_datetime_string_from_system()
    }
    notifications.push_front(item)
    if notifications.size() > MAX_NOTIFICATIONS:
        notifications.resize(MAX_NOTIFICATIONS)
    notification_added.emit(item)
    return item

func clear() -> void:
    notifications.clear()
    notifications_cleared.emit()

func recent(limit: int = 5) -> Array[Dictionary]:
    var count: int = mini(maxi(limit, 0), notifications.size())
    var result: Array[Dictionary] = []
    for i: int in count:
        result.append(notifications[i])
    return result
