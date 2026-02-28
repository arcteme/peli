import { CameraMode, AircraftDef } from '../shared/types';
import { t } from '../i18n';

/**
 * HTML overlay HUD for flight information and combat feedback.
 */
export class HUD {
  private container: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private altEl: HTMLDivElement;
  private healthBar: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private throttleBar: HTMLDivElement;
  private throttleFill: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private killFeedEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private hitMarker: HTMLDivElement;
  private damageOverlay: HTMLDivElement;
  private respawnEl: HTMLDivElement;
  private minimap: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private msgEl: HTMLDivElement;
  
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'hud';
    this.container.innerHTML = `
      <style>
        #hud {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none;
          font-family: 'Segoe UI', 'Arial', sans-serif;
          color: white;
          z-index: 100;
        }
        #hud * { pointer-events: none; }
        
        .hud-speed {
          position: absolute;
          bottom: 80px; left: 30px;
          font-size: 18px;
          text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
        }
        .hud-speed .value { font-size: 32px; font-weight: bold; }
        .hud-speed .unit { font-size: 14px; opacity: 0.7; }
        
        .hud-alt {
          position: absolute;
          bottom: 80px; right: 30px;
          font-size: 18px;
          text-align: right;
          text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
        }
        .hud-alt .value { font-size: 32px; font-weight: bold; }
        .hud-alt .unit { font-size: 14px; opacity: 0.7; }
        
        .hud-health-bar {
          position: absolute;
          bottom: 40px; left: 50%; transform: translateX(-50%);
          width: 250px; height: 14px;
          background: rgba(0,0,0,0.5);
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 7px;
          overflow: hidden;
        }
        .hud-health-fill {
          height: 100%;
          background: linear-gradient(90deg, #44ff44, #88ff44);
          transition: width 0.2s;
          border-radius: 7px;
        }
        .hud-health-fill.low {
          background: linear-gradient(90deg, #ff4444, #ff8844);
        }
        
        .hud-throttle-bar {
          position: absolute;
          bottom: 100px; left: 30px;
          width: 12px; height: 120px;
          background: rgba(0,0,0,0.5);
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 6px;
          overflow: hidden;
        }
        .hud-throttle-fill {
          position: absolute;
          bottom: 0;
          width: 100%;
          background: linear-gradient(0deg, #4488ff, #44ddff);
          border-radius: 6px;
          transition: height 0.1s;
        }
        
        .hud-crosshair {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 40px; height: 40px;
        }
        .hud-crosshair::before, .hud-crosshair::after {
          content: '';
          position: absolute;
          background: rgba(255,255,255,0.7);
        }
        .hud-crosshair::before {
          top: 50%; left: 0; right: 0; height: 1px;
          transform: translateY(-0.5px);
        }
        .hud-crosshair::after {
          left: 50%; top: 0; bottom: 0; width: 1px;
          transform: translateX(-0.5px);
        }
        .hud-crosshair .dot {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 4px; height: 4px;
          border-radius: 50%;
          background: rgba(255,100,0,0.9);
        }
        .hud-crosshair .ring {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 24px; height: 24px;
          border: 1px solid rgba(255,255,255,0.4);
          border-radius: 50%;
        }
        
        .hud-kill-feed {
          position: absolute;
          top: 10px; right: 10px;
          font-size: 14px;
          text-align: right;
        }
        .hud-kill-feed .entry {
          padding: 3px 8px;
          margin-bottom: 2px;
          background: rgba(0,0,0,0.4);
          border-radius: 3px;
          animation: fadeIn 0.3s;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        
        .hud-score {
          position: absolute;
          top: 10px; left: 10px;
          font-size: 16px;
          text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
        }
        .hud-score .kills { color: #44ff44; }
        .hud-score .deaths { color: #ff4444; }
        
        .hud-hit-marker {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 30px; height: 30px;
          opacity: 0;
          transition: opacity 0.1s;
        }
        .hud-hit-marker.show { opacity: 1; }
        .hud-hit-marker::before, .hud-hit-marker::after {
          content: '';
          position: absolute;
          background: white;
        }
        .hud-hit-marker::before {
          top: 0; left: 50%; width: 2px; height: 8px; transform: translateX(-1px) rotate(45deg);
        }
        .hud-hit-marker::after {
          top: 0; right: 50%; width: 2px; height: 8px; transform: translateX(1px) rotate(-45deg);
        }
        
        .hud-damage {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: radial-gradient(ellipse at center, transparent 50%, rgba(255,0,0,0.3) 100%);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .hud-damage.show { opacity: 1; }
        
        .hud-respawn {
          position: absolute;
          top: 40%; left: 50%;
          transform: translate(-50%, -50%);
          font-size: 36px;
          font-weight: bold;
          text-shadow: 2px 2px 6px rgba(0,0,0,0.9);
          text-align: center;
          display: none;
        }
        .hud-respawn .timer {
          font-size: 48px;
          color: #ff6644;
        }
        
        .hud-minimap {
          position: absolute;
          bottom: 70px; right: 15px;
          width: 140px; height: 140px;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 8px;
          background: rgba(0,0,0,0.4);
        }
        
        .hud-msg {
          position: absolute;
          bottom: 250px; left: 50%;
          transform: translateX(-50%);
          font-size: 14px;
          text-align: center;
          opacity: 0.7;
          text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
        }

        .hud-controls {
          position: absolute;
          bottom: 8px; left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          font-size: 11px;
          color: rgba(255,255,255,0.52);
          text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
          white-space: nowrap;
          letter-spacing: 0.3px;
          user-select: none;
        }
        .hud-controls .ctrl-row {
          display: flex;
          gap: 14px;
          align-items: center;
        }
        .hud-controls kbd {
          display: inline-block;
          padding: 1px 5px;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.25);
          border-radius: 3px;
          font-family: inherit;
          font-size: 10px;
          line-height: 1.4;
          letter-spacing: 0;
        }
      </style>
      
      <div class="hud-damage"></div>
      
      <div class="hud-speed">
        <div class="value">0</div>
        <div class="unit">km/h</div>
      </div>
      
      <div class="hud-alt">
        <div class="value">0</div>
        <div class="unit hud-alt-unit">m ALT</div>
      </div>
      
      <div class="hud-health-bar"><div class="hud-health-fill"></div></div>
      
      <div class="hud-throttle-bar"><div class="hud-throttle-fill"></div></div>
      
      <div class="hud-crosshair">
        <div class="dot"></div>
        <div class="ring"></div>
      </div>
      
      <div class="hud-kill-feed"></div>
      <div class="hud-score"></div>
      <div class="hud-hit-marker"></div>
      <div class="hud-respawn"></div>
      <canvas class="hud-minimap" width="140" height="140"></canvas>
      <div class="hud-msg"></div>

      <div class="hud-controls">
        <div class="ctrl-row">
          <span><kbd>W</kbd><kbd>S</kbd> <span class="lbl-pitch"></span></span>
          <span><kbd>A</kbd><kbd>D</kbd> <span class="lbl-roll"></span></span>
          <span><kbd>Q</kbd><kbd>E</kbd> <span class="lbl-yaw"></span></span>
          <span><kbd>Shift</kbd> <span class="lbl-tup"></span></span>
          <span><kbd>Ctrl</kbd> <span class="lbl-tdown"></span></span>
        </div>
        <div class="ctrl-row">
          <span><kbd>Space</kbd> / <span class="lbl-fire"></span></span>
          <span><kbd>V</kbd> <span class="lbl-cam"></span></span>
          <span class="lbl-mouse"></span>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.container);
    
    this.speedEl = this.container.querySelector('.hud-speed .value')!;
    this.altEl = this.container.querySelector('.hud-alt .value')!;
    this.healthBar = this.container.querySelector('.hud-health-bar')!;
    this.healthFill = this.container.querySelector('.hud-health-fill')!;
    this.throttleBar = this.container.querySelector('.hud-throttle-bar')!;
    this.throttleFill = this.container.querySelector('.hud-throttle-fill')!;
    this.crosshair = this.container.querySelector('.hud-crosshair')!;
    this.killFeedEl = this.container.querySelector('.hud-kill-feed')!;
    this.scoreEl = this.container.querySelector('.hud-score')!;
    this.hitMarker = this.container.querySelector('.hud-hit-marker')!;
    this.damageOverlay = this.container.querySelector('.hud-damage')!;
    this.respawnEl = this.container.querySelector('.hud-respawn')!;
    this.minimap = this.container.querySelector('.hud-minimap')!;
    this.minimapCtx = this.minimap.getContext('2d')!;
    this.msgEl = this.container.querySelector('.hud-msg')!;
    this._applyLangLabels();
  }
  
  update(data: {
    speed: number;
    altitude: number;
    health: number;
    maxHealth: number;
    throttle: number;
    kills: number;
    deaths: number;
    alive: boolean;
    respawnTimer: number;
    hitMarker: boolean;
    damageIndicator: boolean;
    killFeed: { text: string; time: number }[];
    playerPos: { x: number; z: number };
    playerHeading: number;
    enemies: { x: number; z: number; alive: boolean }[];
    cameraMode: CameraMode;
  }) {
    // Speed & Altitude
    this.speedEl.textContent = Math.round(data.speed).toString();
    this.altEl.textContent = Math.round(data.altitude).toString();
    
    // Health bar
    const healthPercent = Math.max(0, data.health / data.maxHealth * 100);
    this.healthFill.style.width = `${healthPercent}%`;
    if (healthPercent < 30) {
      this.healthFill.classList.add('low');
    } else {
      this.healthFill.classList.remove('low');
    }
    
    // Throttle bar
    this.throttleFill.style.height = `${data.throttle * 100}%`;
    
    // Score
    this.scoreEl.innerHTML = `
      <span class="kills">✦ ${data.kills}</span> &nbsp;
      <span class="deaths">✖ ${data.deaths}</span>
    `;
    
    // Kill feed
    this.killFeedEl.innerHTML = data.killFeed
      .slice(-5)
      .map(k => `<div class="entry">${k.text}</div>`)
      .join('');
    
    // Hit marker
    if (data.hitMarker) {
      this.hitMarker.classList.add('show');
    } else {
      this.hitMarker.classList.remove('show');
    }
    
    // Damage overlay
    if (data.damageIndicator) {
      this.damageOverlay.classList.add('show');
    } else {
      this.damageOverlay.classList.remove('show');
    }
    
    // Respawn screen
    if (!data.alive) {
      this.respawnEl.style.display = 'block';
      this.respawnEl.innerHTML = `
        ${t('hud.shotDown')}<br>
        <div class="timer">${Math.ceil(data.respawnTimer)}</div>
        <div style="font-size:16px; opacity:0.7">${t('hud.respawning')}</div>
      `;
    } else {
      this.respawnEl.style.display = 'none';
    }
    
    // Minimap
    this.drawMinimap(data.playerPos, data.playerHeading, data.enemies);
  }
  
  private drawMinimap(
    playerPos: { x: number; z: number },
    playerHeading: number,
    enemies: { x: number; z: number; alive: boolean }[]
  ) {
    const ctx = this.minimapCtx;
    const w = 140;
    const h = 140;
    const scale = w / 1000; // 1000m map range
    
    ctx.clearRect(0, 0, w, h);
    
    // Background
    ctx.fillStyle = 'rgba(20, 40, 20, 0.6)';
    ctx.fillRect(0, 0, w, h);
    
    // Grid
    ctx.strokeStyle = 'rgba(100, 150, 100, 0.2)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < w; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(w, i);
      ctx.stroke();
    }
    
    // Center marker
    ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Enemies (red dots)
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = w / 2 + e.x * scale;
      const ez = h / 2 + e.z * scale;
      if (ex < 0 || ex > w || ez < 0 || ez > h) continue;
      
      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.arc(ex, ez, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Player (green triangle)
    const px = w / 2 + playerPos.x * scale;
    const pz = h / 2 + playerPos.z * scale;
    
    ctx.save();
    ctx.translate(px, pz);
    // World: euler.y=0 → facing +Z. On canvas +Z maps to canvas +Y (down).
    // Triangle tip points canvas −Y (up) at rotation=0, so apply (PI − heading)
    // to make it point in the true flight direction.
    ctx.rotate(Math.PI - playerHeading);
    ctx.fillStyle = '#44ff44';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(-3, 4);
    ctx.lineTo(3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  
  private _applyLangLabels() {
    const q = (sel: string) => this.container.querySelector(sel) as HTMLElement | null;
    const set = (sel: string, key: string) => { const el = q(sel); if (el) el.textContent = t(key); };
    set('.hud-alt-unit',  'hud.alt');
    set('.lbl-pitch',  'menu.ctrl.pitch');
    set('.lbl-roll',   'menu.ctrl.roll');
    set('.lbl-yaw',    'menu.ctrl.yaw');
    set('.lbl-tup',    'menu.ctrl.throttleUp');
    set('.lbl-tdown',  'menu.ctrl.throttleDown');
    set('.lbl-fire',   'menu.ctrl.fire');
    set('.lbl-cam',    'menu.ctrl.camera');
    set('.lbl-mouse',  'menu.ctrl.mouse');
  }

  showMessage(text: string, duration: number = 3000) {
    this.msgEl.textContent = text;
    this.msgEl.style.opacity = '0.9';
    setTimeout(() => {
      this.msgEl.style.opacity = '0';
    }, duration);
  }
  
  hide() {
    this.container.style.display = 'none';
  }
  
  show() {
    this.container.style.display = 'block';
  }
}
