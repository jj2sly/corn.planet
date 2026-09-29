# First-person movement

This is the shared 3D foundation for CPI games such as CPI: Cold Case.

server/engine/movement.ts contains deterministic, renderer-independent movement. Keyboard, touch, gamepad, and native adapters can all feed the same forward/right actions. Movement is camera-relative, diagonal input is normalized, walk/sprint speeds are shared, acceleration is bounded, and gravity/jump/grounded/yaw/pitch live in one state object.

Collision is intentionally not in this module yet. The upcoming world layer will own floors, walls, slopes, doors, hazards, and streamed chunks, then feed collision-resolved positions back into this movement model.

public/js/cpi/first-person.js is the browser device adapter. It translates WASD/arrows, Shift, Space, mouse drag, touch joystick, touch swipe-look, and E/mouse/touch interaction into logical game actions.

Design rule: games ask for logical actions, never KeyboardEvent.key or a particular device. That is what lets Cold Case run in a browser now and move toward a native CPI runtime later without rewriting gameplay.