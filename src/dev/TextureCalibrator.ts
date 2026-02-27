import * as THREE from 'three';
import { CityMap } from '../world/CityMap';
import { Sky } from '../world/Sky';

/**
 * Development tool for aligning the aerial ground texture with buildings.
 *
 * Activate/deactivate by pressing F4 during gameplay.
 *
 * Controls while active:
 *   Arrow keys          → move texture ±10 m
 *   Shift + Arrow keys  → move texture ±1 m (fine)
 *   Q / E               → rotate texture ±0.5°
 *   Shift + Q / E       → rotate texture ±0.1° (fine)
 *   R                   → reset offset and rotation to zero
 *   F4                  → exit and print calibration snippet
 */
export class TextureCalibrator {
  private active = false;
  private showingResult = false;

  private readonly camera: THREE.OrthographicCamera;
  private readonly fillMesh: THREE.Mesh;   // dark grey void outside texture coverage
  private readonly overlay: HTMLDivElement;
  private readonly resultBox: HTMLDivElement;

  private offsetX = 0;
  private offsetZ = 0;
  private rotationY = 0; // radians, rotation around world Y axis

  private savedFog: THREE.Fog | THREE.FogExp2 | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly cityMap: CityMap,
    private readonly sky: Sky,
  ) {
    // ── Orthographic top-down camera ──────────────────────────────────────
    // Frustum sized in activate() / resize() to always show the full terrain.
    this.camera = new THREE.OrthographicCamera(-600, 600, 600, -600, 1, 2000);
    this.camera.position.set(0, 700, 0);
    this.camera.lookAt(0, 0, 0);
    // lookAt resets quaternion — lock up-vector to -Z so north is up in the viewport
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);

    // ── Dark grey fill plane — always visible below the terrain ──────────
    // It sits at y = -2 so the aerial texture mesh (which sits at or near y = 0)
    // always occludes it where coverage exists.  Where the mesh doesn't reach
    // (after the player moves it) the dark grey shows through.
    const fillGeo = new THREE.PlaneGeometry(12000, 12000);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
    this.fillMesh = new THREE.Mesh(fillGeo, fillMat);
    this.fillMesh.name = 'calibration-fill';
    this.fillMesh.rotation.x = -Math.PI / 2;
    this.fillMesh.position.y = -2;
    this.fillMesh.renderOrder = -1;
    this.fillMesh.visible = false;
    scene.add(this.fillMesh);

    // ── HTML overlays ─────────────────────────────────────────────────────
    this.overlay    = this._buildHUD();
    this.resultBox  = this._buildResultBox();

    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize',  this._onResize);
  }

  isActive(): boolean { return this.active || this.showingResult; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(): void {
    if (this.active || this.showingResult) return;
    this.active = true;

    // Seed from whatever offset is currently in the mesh
    const cur = this.cityMap.getAerialOffset();
    this.offsetX   = cur.x;
    this.offsetZ   = cur.z;
    this.rotationY = this.cityMap.getAerialRotation();

    this._updateCamera();
    this.fillMesh.visible = true;
    this.sky.group.visible = false;
    // Remove fog for crisp texture view
    this.savedFog = this.scene.fog;
    this.scene.fog = null;
    this.resultBox.style.display = 'none';
    this.overlay.style.display = 'block';
    this._refreshHUD();
  }

  deactivate(): void {
    // If result box is already showing, dismiss it and resume the game
    if (this.showingResult) {
      this._dismiss();
      return;
    }
    if (!this.active) return;
    this.active = false;
    this.showingResult = true;

    // Hide movement HUD
    this.overlay.style.display = 'none';

    // Release pointer lock so the mouse is free for copy-paste
    if (document.pointerLockElement) document.exitPointerLock();

    this._printResult();
  }

  /** Fully restore game state and hide result box. */
  private _dismiss(): void {
    this.showingResult = false;
    this.fillMesh.visible = false;
    this.sky.group.visible = true;
    this.scene.fog = this.savedFog;
    this.resultBox.style.display = 'none';
  }

  /**
   * Call instead of the normal renderer.render() while the calibrator is active.
   * Renders the scene through the orthographic top-down camera (both during
   * alignment and while the result box is visible).
   */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private readonly _onResize = (): void => {
    if (this.active || this.showingResult) this._updateCamera();
  };

  private readonly _onKey = (e: KeyboardEvent): void => {
    // While the result box is visible, only listen for dismiss keys
    if (this.showingResult) {
      if (e.code === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        this._dismiss();
      }
      return;
    }

    if (!this.active) return;

    const step = e.shiftKey ? 0.2 : 2;
    const rotStep = e.shiftKey ? (0.1 * Math.PI / 180) : (0.5 * Math.PI / 180);
    switch (e.code) {
      case 'ArrowLeft':  e.preventDefault(); e.stopPropagation(); this.offsetX -= step; break;
      case 'ArrowRight': e.preventDefault(); e.stopPropagation(); this.offsetX += step; break;
      case 'ArrowUp':    e.preventDefault(); e.stopPropagation(); this.offsetZ -= step; break;
      case 'ArrowDown':  e.preventDefault(); e.stopPropagation(); this.offsetZ += step; break;
      case 'KeyQ':       e.preventDefault(); this.rotationY -= rotStep; break; // counterclockwise
      case 'KeyE':       e.preventDefault(); this.rotationY += rotStep; break; // clockwise
      case 'KeyR':       this.offsetX = 0; this.offsetZ = 0; this.rotationY = 0; break;
      default: return; // nothing changed
    }

    this.cityMap.setAerialOffset(this.offsetX, this.offsetZ);
    this.cityMap.setAerialRotation(this.rotationY);
    this._refreshHUD();
  };

  /** Resize ortho frustum so the full 1100 m terrain stays in view. */
  private _updateCamera(): void {
    const aspect = window.innerWidth / window.innerHeight;
    // Guarantee at least 580 half-metres in the smaller viewport dimension
    // so the 1100 m terrain is always fully visible.
    let halfW: number;
    let halfH: number;
    if (aspect >= 1) {
      halfH = 580;
      halfW = halfH * aspect;
    } else {
      halfW = 580;
      halfH = halfW / aspect;
    }
    this.camera.left   = -halfW;
    this.camera.right  =  halfW;
    this.camera.top    =  halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  // ── HUD overlay ───────────────────────────────────────────────────────────

  private _buildHUD(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'tex-calib-hud';
    el.style.cssText = [
      'display:none',
      'position:fixed',
      'top:0', 'left:0', 'width:100%', 'height:100%',
      'pointer-events:none',
      'font-family:monospace',
      'z-index:9000',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  private _refreshHUD(): void {
    const fmtN   = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1);
    const fmtDeg = (r: number) => (r >= 0 ? '+' : '') + (r * 180 / Math.PI).toFixed(2) + '°';

    this.overlay.innerHTML = `
      <!-- Status bar -->
      <div style="
        position:absolute; top:14px; left:50%; transform:translateX(-50%);
        background:rgba(0,0,0,0.78); color:#fff; padding:10px 22px;
        border-radius:8px; font-size:14px; line-height:1.8; text-align:center;
        border:1px solid rgba(255,220,50,0.5);
      ">
        <b style="color:#ffdd44; font-size:15px;">&#9733; TEXTURE CALIBRATOR</b>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <span style="color:#aaa; font-size:12px;">F4 = exit &amp; print result</span>
        <br>
        <span style="color:#aaa; font-size:12px;">
          Arrow = &plusmn;2 m &nbsp;|&nbsp; Shift+Arrow = &plusmn;0.2 m &nbsp;|&nbsp;
          Q/E = &plusmn;0.5&deg; &nbsp;|&nbsp; Shift+Q/E = &plusmn;0.1&deg; &nbsp;|&nbsp; R = reset all
        </span>
        <br>
        X: <b style="color:#55ddff">${fmtN(this.offsetX)} m</b>
        &nbsp;&nbsp;
        Z: <b style="color:#55ddff">${fmtN(this.offsetZ)} m</b>
        &nbsp;&nbsp;
        Rot: <b style="color:#ffaa44">${fmtDeg(this.rotationY)}</b>
      </div>

      <!-- Crosshair at world origin -->
      <div style="
        position:absolute; top:50%; left:50%;
        transform:translate(-50%,-50%);
        width:24px; height:24px;
        border:2px solid rgba(255,80,80,0.85);
        border-radius:50%;
        pointer-events:none;
      "></div>
      <div style="
        position:absolute; top:50%; left:calc(50% - 18px);
        width:36px; height:2px;
        background:rgba(255,80,80,0.85);
        transform:translateY(-50%);
        pointer-events:none;
      "></div>
      <div style="
        position:absolute; left:50%; top:calc(50% - 18px);
        height:36px; width:2px;
        background:rgba(255,80,80,0.85);
        transform:translateX(-50%);
        pointer-events:none;
      "></div>

      <!-- Corner label: world origin indicator -->
      <div style="
        position:absolute; bottom:14px; right:18px;
        color:rgba(255,80,80,0.7); font-size:11px;
      ">&#x2715; = world origin (0, 0)</div>
    `;
  }

  // ── Result box ────────────────────────────────────────────────────────────

  private _buildResultBox(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'tex-calib-result';
    el.style.cssText = [
      'display:none',
      'position:fixed',
      'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:rgba(0,0,0,0.95)',
      'color:#00ff88',
      'font-family:monospace',
      'font-size:13px',
      'padding:28px 36px',
      'border:2px solid #00ff88',
      'border-radius:8px',
      'white-space:pre',
      'z-index:9100',
      'line-height:1.6',
      'cursor:default',
      'user-select:text',          // allow text selection for copy-paste
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  private _printResult(): void {
    const ts   = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const fmtV = (n: number) => n.toFixed(1);

    const snippet = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║         AERIAL TEXTURE CALIBRATION — COPY RESULT            ║',
      `║  Generated: ${ts}                    ║`,
      '╠══════════════════════════════════════════════════════════════╣',
      '║  In CityMap._createGround(), replace the 3 calibration      ║',
      '║  lines with exactly the following (numbers only, no edits): ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `  mesh.position.x = ${fmtV(this.offsetX)};`,
      `  mesh.position.z = ${fmtV(this.offsetZ)};`,
      `  mesh.rotation.z = ${this.rotationY.toFixed(6)};`,
      '╠══════════════════════════════════════════════════════════════╣',
      `║  (rotation in RADIANS = ${(this.rotationY * 180 / Math.PI).toFixed(2)}°  —  paste the .toFixed(6) number above, NOT the degrees)`,
      '╚══════════════════════════════════════════════════════════════╝',
    ].join('\n');

    // Always echo to the dev console as well
    console.log('\n' + snippet + '\n');

    this.resultBox.innerHTML =
      // Wrap the pre-formatted text in a selectable span, then add a dismiss button below
      `<span style="user-select:text">${snippet}</span>` +
      `<div style="margin-top:18px; text-align:center">` +
      `<button id="tex-calib-dismiss" style="` +
        `background:#00ff88; color:#000; border:none; padding:8px 28px;` +
        `font-family:monospace; font-size:13px; font-weight:bold;` +
        `border-radius:4px; cursor:pointer;` +
      `">Dismiss &amp; resume game (Enter / Esc)</button>` +
      `</div>`;
    this.resultBox.style.display = 'block';

    // Wire up the dismiss button
    const btn = document.getElementById('tex-calib-dismiss');
    if (btn) btn.addEventListener('click', () => this._dismiss(), { once: true });
  }
}
