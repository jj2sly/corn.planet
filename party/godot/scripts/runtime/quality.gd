extends RefCounted
class_name CPIQuality

const LOW := {
    "pixel_scale": 0.75,
    "shadows": false,
    "particles": false,
    "max_dynamic_objects": 120
}
const MEDIUM := {
    "pixel_scale": 1.0,
    "shadows": true,
    "particles": true,
    "max_dynamic_objects": 300
}
const HIGH := {
    "pixel_scale": 1.25,
    "shadows": true,
    "particles": true,
    "max_dynamic_objects": 700
}
