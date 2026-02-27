import { InputState } from '../shared/types';

/**
 * Handles keyboard, mouse, and gamepad input.
 * Normalizes all inputs to -1..1 range.
 */
export class InputManager {
  private keys: Set<string> = new Set();
  private mouseMovementX = 0;
  private mouseMovementY = 0;
  private mouseDown = false;
  private mouseSensitivity = 0.003;
  private gamepad: Gamepad | null = null;
  private pointerLocked = false;
  
  // Persistent throttle state (0-1)
  private _throttle = 0.5;
  
  // Smoothed keyboard axis state (-1..1)
  // Axes slew toward the keyboard target at INPUT_RATE and return to 0 at CENTER_RATE.
  private _axisPitch = 0;
  private _axisRoll  = 0;
  private _axisYaw   = 0;
  
  // Rates in units/second
  private readonly INPUT_RATE    = 3.0;  // 0→full in ~0.33 s
  private readonly CENTER_RATE   = 6.0;  // full→0 in ~0.17 s (snappy release)
  private readonly THROTTLE_RATE = 0.8;  // full range in ~1.25 s
  
  // Smoothed mouse deltas (low-pass filter to remove jitter)
  private _smoothMouseX = 0;
  private _smoothMouseY = 0;
  private readonly MOUSE_SMOOTH = 0.35; // lerp factor per frame (0=frozen, 1=raw)
  
  // Camera toggle (single press detection)
  private _toggleCameraPressed = false;
  private _toggleCameraConsumed = false;
  
  // Mouse control mode
  public mouseFlightControl = true;
  
  constructor(private canvas: HTMLCanvasElement) {
    this.setupKeyboard();
    this.setupMouse();
    this.setupGamepad();
  }
  
  private gameKeys = new Set([
    'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyV',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'Space', 'Tab',
  ]);
  
  private setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Prevent browser default for game keys (Ctrl+S, Ctrl+W, Tab, Space scroll, etc.)
      if (this.gameKeys.has(e.code)) {
        e.preventDefault();
      }
      
      this.keys.add(e.code);
      
      if (e.code === 'KeyV') {
        if (!this._toggleCameraConsumed) {
          this._toggleCameraPressed = true;
          this._toggleCameraConsumed = true;
        }
      }
    });
    
    window.addEventListener('keyup', (e) => {
      if (this.gameKeys.has(e.code)) {
        e.preventDefault();
      }
      
      this.keys.delete(e.code);
      
      if (e.code === 'KeyV') {
        this._toggleCameraConsumed = false;
      }
    });
  }
  
  private setupMouse() {
    this.canvas.addEventListener('click', () => {
      if (!this.pointerLocked) {
        this.canvas.requestPointerLock();
      }
    });
    
    // Also re-lock on any mousedown on canvas
    this.canvas.addEventListener('mousedown', () => {
      if (!this.pointerLocked) {
        this.canvas.requestPointerLock();
      }
    });
    
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseMovementX += e.movementX;
        this.mouseMovementY += e.movementY;
      }
    });
    
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
  }
  
  private setupGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log(`Gamepad connected: ${e.gamepad.id}`);
      this.gamepad = e.gamepad;
    });
    
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepad = null;
    });
  }
  
  private getGamepad(): Gamepad | null {
    const gamepads = navigator.getGamepads();
    for (const gp of gamepads) {
      if (gp) return gp;
    }
    return null;
  }
  
  /**
   * Returns the current control state.
   * @param dt  Delta time in seconds (from the game loop) — required for
   *            smooth axis slewing and dt-normalised throttle.
   */
  getInput(dt: number): InputState {
    let fire = false;
    let toggleCamera = false;
    
    // ── 1. Read raw keyboard targets (-1, 0, +1) ──────────────────────────
    // Joystick convention consistent across all camera views:
    //   W/↑ = nose down   S/↓ = nose up
    //   A/← = roll right  D/→ = roll left
    //   Q   = yaw left    E   = yaw right
    let kbPitch = 0, kbRoll = 0, kbYaw = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    kbPitch -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  kbPitch += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  kbRoll  += 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kbRoll  -= 1;
    if (this.keys.has('KeyQ')) kbYaw -= 1;
    if (this.keys.has('KeyE')) kbYaw += 1;
    
    // ── 2. Slew smoothed axes toward targets ──────────────────────────────
    // Ramps up at INPUT_RATE and snaps back to centre at CENTER_RATE.
    // This eliminates the binary on/off jerk of raw keyboard input.
    this._axisPitch = slewAxis(this._axisPitch, kbPitch, dt, this.INPUT_RATE, this.CENTER_RATE);
    this._axisRoll  = slewAxis(this._axisRoll,  kbRoll,  dt, this.INPUT_RATE, this.CENTER_RATE);
    this._axisYaw   = slewAxis(this._axisYaw,   kbYaw,   dt, this.INPUT_RATE, this.CENTER_RATE);
    
    // ── 3. Response curve (x^1.7) — fine control near centre ─────────────
    // Preserves sign, compresses small values for precision, expands large.
    let pitch = responseCurve(this._axisPitch);
    let roll  = responseCurve(this._axisRoll);
    let yaw   = responseCurve(this._axisYaw);
    
    // ── 4. Throttle (dt-normalised) ───────────────────────────────────────
    const throttleStep = this.THROTTLE_RATE * dt;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
      this._throttle = Math.min(1, this._throttle + throttleStep);
    }
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) {
      this._throttle = Math.max(0, this._throttle - throttleStep);
    }
    
    if (this.keys.has('Space')) fire = true;
    
    // ── 5. Mouse input (low-pass filtered, added on top of keyboard) ───────
    // Standard flight-sim: mouse up = nose up, mouse right = roll right.
    // A lerp filter smooths out micro-jitter without adding noticeable lag.
    if (this.pointerLocked && this.mouseFlightControl) {
      this._smoothMouseX = lerp(this._smoothMouseX, this.mouseMovementX, this.MOUSE_SMOOTH);
      this._smoothMouseY = lerp(this._smoothMouseY, this.mouseMovementY, this.MOUSE_SMOOTH);
      pitch -= this._smoothMouseY * this.mouseSensitivity * 35;
      roll  += this._smoothMouseX * this.mouseSensitivity * 35;
    } else {
      // Decay smoothed state when mouse is not in use
      this._smoothMouseX *= 0.5;
      this._smoothMouseY *= 0.5;
    }
    
    if (this.mouseDown) fire = true;
    
    // Reset raw mouse accumulation
    this.mouseMovementX = 0;
    this.mouseMovementY = 0;
    
    // ── 6. Gamepad ────────────────────────────────────────────────────────
    const gp = this.getGamepad();
    if (gp) {
      const deadzone = 0.15;
      
      const lx = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
      const ly = Math.abs(gp.axes[1]) > deadzone ? gp.axes[1] : 0;
      roll  += responseCurve(lx);
      pitch -= responseCurve(ly);
      
      const rx = Math.abs(gp.axes[2]) > deadzone ? gp.axes[2] : 0;
      yaw -= responseCurve(rx);
      
      if (gp.buttons[7]?.value > 0.1) {
        this._throttle = Math.min(1, this._throttle + gp.buttons[7].value * this.THROTTLE_RATE * dt);
      }
      if (gp.buttons[6]?.value > 0.1) {
        this._throttle = Math.max(0, this._throttle - gp.buttons[6].value * this.THROTTLE_RATE * dt);
      }
      
      if (gp.buttons[0]?.pressed) fire = true;
      if (gp.buttons[3]?.pressed) toggleCamera = true;
    }
    
    // ── 7. Camera toggle ──────────────────────────────────────────────────
    if (this._toggleCameraPressed) {
      toggleCamera = true;
      this._toggleCameraPressed = false;
    }
    
    // ── 8. Clamp ──────────────────────────────────────────────────────────
    pitch = clamp(pitch, -1, 1);
    yaw   = clamp(yaw,   -1, 1);
    roll  = clamp(roll,  -1, 1);
    
    return { pitch, yaw, roll, throttle: this._throttle, fire, toggleCamera };
  }
  
  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** Returns accumulated mouse movement since last call and resets it. */
  consumeMouseDelta(): { x: number; y: number } {
    const result = { x: this.mouseMovementX, y: this.mouseMovementY };
    this.mouseMovementX = 0;
    this.mouseMovementY = 0;
    return result;
  }

  /** Check whether a specific key is currently held down. */
  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  setThrottle(value: number) {
    this._throttle = clamp(value, 0, 1);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Slews `current` toward `target` at `inputRate` (when target ≠ 0) or
 * `centerRate` (when target = 0), both in units/second.
 */
function slewAxis(
  current: number,
  target: number,
  dt: number,
  inputRate: number,
  centerRate: number,
): number {
  const rate = target !== 0 ? inputRate : centerRate;
  const diff = target - current;
  const maxStep = rate * dt;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

/**
 * Non-linear response curve: x^1.7 (sign-preserving).
 * Gives finer control near centre while still reaching full deflection.
 */
function responseCurve(x: number): number {
  return Math.sign(x) * Math.pow(Math.abs(x), 1.7);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
