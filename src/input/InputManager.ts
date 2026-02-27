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
  
  getInput(): InputState {
    let pitch = 0;
    let yaw = 0;
    let roll = 0;
    let fire = false;
    let toggleCamera = false;
    
    // --- Keyboard input ---
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitch += 1;     // pitch up
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitch -= 1;   // pitch down
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) roll -= 1;    // roll left
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) roll += 1;   // roll right
    if (this.keys.has('KeyQ')) yaw += 1;               // yaw left
    if (this.keys.has('KeyE')) yaw -= 1;               // yaw right
    
    // Throttle (persistent)
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) {
      this._throttle = Math.min(1, this._throttle + 0.015);
    }
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) {
      this._throttle = Math.max(0, this._throttle - 0.015);
    }
    
    // Fire
    if (this.keys.has('Space')) fire = true;
    
    // --- Mouse input ---
    if (this.pointerLocked && this.mouseFlightControl) {
      // Mouse Y = pitch (inverted: push forward = nose down), Mouse X = roll
      pitch -= this.mouseMovementY * this.mouseSensitivity * 50;
      roll += this.mouseMovementX * this.mouseSensitivity * 30;
    }
    
    if (this.mouseDown) fire = true;
    
    // Reset mouse accumulation
    this.mouseMovementX = 0;
    this.mouseMovementY = 0;
    
    // --- Gamepad input ---
    const gp = this.getGamepad();
    if (gp) {
      const deadzone = 0.15;
      
      // Left stick: pitch (Y) and roll (X)
      const lx = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
      const ly = Math.abs(gp.axes[1]) > deadzone ? gp.axes[1] : 0;
      roll += lx;
      pitch -= ly;
      
      // Right stick X or bumpers for yaw
      const rx = Math.abs(gp.axes[2]) > deadzone ? gp.axes[2] : 0;
      yaw -= rx;
      
      // Triggers for throttle (RT = increase, LT = decrease)
      if (gp.buttons[7]?.value > 0.1) { // Right trigger
        this._throttle = Math.min(1, this._throttle + gp.buttons[7].value * 0.02);
      }
      if (gp.buttons[6]?.value > 0.1) { // Left trigger
        this._throttle = Math.max(0, this._throttle - gp.buttons[6].value * 0.02);
      }
      
      // A button = fire
      if (gp.buttons[0]?.pressed) fire = true;
      
      // Y button = toggle camera
      if (gp.buttons[3]?.pressed) {
        toggleCamera = true;
      }
    }
    
    // Camera toggle
    if (this._toggleCameraPressed) {
      toggleCamera = true;
      this._toggleCameraPressed = false;
    }
    
    // Clamp all values
    pitch = clamp(pitch, -1, 1);
    yaw = clamp(yaw, -1, 1);
    roll = clamp(roll, -1, 1);
    
    return {
      pitch,
      yaw,
      roll,
      throttle: this._throttle,
      fire,
      toggleCamera,
    };
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
