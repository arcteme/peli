import { AircraftId, AircraftDef } from '../shared/types';
import { AIRCRAFT_LIST } from '../shared/constants';

export class MainMenu {
  private overlay: HTMLDivElement;
  private onStart: ((aircraftId: AircraftId, playerName: string) => void) | null = null;
  
  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'main-menu';
    this.overlay.innerHTML = `
      <style>
        #main-menu {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(135deg, #1a2a3a 0%, #0d1520 50%, #1a1a2e 100%);
          z-index: 200;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: 'Segoe UI', 'Arial', sans-serif;
          color: white;
          overflow-y: auto;
        }
        
        .menu-title {
          font-size: 48px;
          font-weight: bold;
          margin-bottom: 5px;
          text-shadow: 0 0 20px rgba(100,180,255,0.5);
          letter-spacing: 2px;
        }
        .menu-subtitle {
          font-size: 18px;
          opacity: 0.6;
          margin-bottom: 40px;
          font-style: italic;
        }
        
        .menu-name-input {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 8px;
          padding: 12px 20px;
          font-size: 18px;
          color: white;
          width: 280px;
          text-align: center;
          margin-bottom: 30px;
          outline: none;
          transition: border-color 0.2s;
        }
        .menu-name-input:focus {
          border-color: rgba(100,180,255,0.7);
        }
        .menu-name-input::placeholder {
          color: rgba(255,255,255,0.4);
        }
        
        .menu-planes-title {
          font-size: 16px;
          text-transform: uppercase;
          letter-spacing: 3px;
          opacity: 0.6;
          margin-bottom: 15px;
        }
        
        .menu-planes {
          display: flex;
          gap: 20px;
          margin-bottom: 35px;
          flex-wrap: wrap;
          justify-content: center;
        }
        
        .plane-card {
          width: 200px;
          background: rgba(255,255,255,0.08);
          border: 2px solid rgba(255,255,255,0.15);
          border-radius: 12px;
          padding: 20px;
          cursor: pointer;
          transition: all 0.2s;
          text-align: center;
          pointer-events: auto;
        }
        .plane-card:hover {
          background: rgba(255,255,255,0.15);
          border-color: rgba(100,180,255,0.5);
          transform: translateY(-3px);
        }
        .plane-card.selected {
          border-color: #4488ff;
          background: rgba(68,136,255,0.15);
          box-shadow: 0 0 20px rgba(68,136,255,0.3);
        }
        
        .plane-icon {
          font-size: 40px;
          margin-bottom: 8px;
        }
        .plane-name {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 4px;
        }
        .plane-country {
          font-size: 14px;
          opacity: 0.6;
          margin-bottom: 12px;
        }
        
        .plane-stats {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .stat-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
        }
        .stat-label {
          width: 55px;
          text-align: right;
          opacity: 0.6;
        }
        .stat-bar-bg {
          flex: 1;
          height: 6px;
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
          overflow: hidden;
        }
        .stat-bar-fill {
          height: 100%;
          border-radius: 3px;
        }
        .stat-speed .stat-bar-fill { background: #44bbff; }
        .stat-agility .stat-bar-fill { background: #44ff88; }
        .stat-power .stat-bar-fill { background: #ff8844; }
        .stat-armor .stat-bar-fill { background: #aaaaaa; }
        
        .menu-start-btn {
          background: linear-gradient(135deg, #2266cc, #1144aa);
          border: none;
          border-radius: 10px;
          padding: 16px 60px;
          font-size: 20px;
          font-weight: bold;
          color: white;
          cursor: pointer;
          letter-spacing: 2px;
          text-transform: uppercase;
          transition: all 0.2s;
          pointer-events: auto;
          box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        }
        .menu-start-btn:hover {
          background: linear-gradient(135deg, #3377dd, #2255bb);
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(34,102,204,0.4);
        }
        .menu-start-btn:active {
          transform: translateY(0);
        }
        
        .menu-controls {
          margin-top: 30px;
          font-size: 13px;
          opacity: 0.5;
          text-align: center;
          line-height: 1.8;
        }
        .menu-controls kbd {
          background: rgba(255,255,255,0.15);
          padding: 2px 6px;
          border-radius: 3px;
          font-family: monospace;
        }
      </style>
      
      <div class="menu-title">✈ PLASTIC ACES</div>
      <div class="menu-subtitle">WW2 Model Aircraft Combat over Kerava, Finland</div>
      
      <input class="menu-name-input" type="text" placeholder="Enter your pilot name" maxlength="20" value="Pilot" />
      
      <div class="menu-planes-title">Choose your aircraft</div>
      <div class="menu-planes"></div>
      
      <button class="menu-start-btn">TAKE OFF</button>
      
      <div class="menu-controls">
        <kbd>W</kbd><kbd>S</kbd> Pitch &nbsp;
        <kbd>A</kbd><kbd>D</kbd> Roll &nbsp;
        <kbd>Q</kbd><kbd>E</kbd> Yaw &nbsp;
        <kbd>Shift</kbd> Throttle Up &nbsp;
        <kbd>Ctrl</kbd> Throttle Down<br>
        <kbd>Space</kbd> / Left Click: Fire &nbsp;
        <kbd>V</kbd> Toggle Camera &nbsp;
        Mouse moves for flight control
      </div>
    `;
    
    document.body.appendChild(this.overlay);
    this.buildPlaneCards();
    this.setupEvents();
  }
  
  private buildPlaneCards() {
    const container = this.overlay.querySelector('.menu-planes')!;
    
    for (const def of AIRCRAFT_LIST) {
      const maxSpeed = 140; // for normalization
      const maxPitch = 3;
      const maxDmg = 15;
      const maxHp = 120;
      
      const card = document.createElement('div');
      card.className = 'plane-card';
      card.dataset.id = def.id;
      card.innerHTML = `
        <div class="plane-icon">${def.countryFlag}</div>
        <div class="plane-name">${def.name}</div>
        <div class="plane-country">${def.country}</div>
        <div class="plane-stats">
          <div class="stat-row stat-speed">
            <span class="stat-label">Speed</span>
            <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${def.speedMax / maxSpeed * 100}%"></div></div>
          </div>
          <div class="stat-row stat-agility">
            <span class="stat-label">Agility</span>
            <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${(def.pitchRate + def.rollRate) / (maxPitch + 4) * 100}%"></div></div>
          </div>
          <div class="stat-row stat-power">
            <span class="stat-label">Power</span>
            <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${def.weaponDamage / maxDmg * 100}%"></div></div>
          </div>
          <div class="stat-row stat-armor">
            <span class="stat-label">Armor</span>
            <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${def.health / maxHp * 100}%"></div></div>
          </div>
        </div>
      `;
      container.appendChild(card);
    }
    
    // Select first by default
    const first = container.querySelector('.plane-card') as HTMLElement;
    if (first) first.classList.add('selected');
  }
  
  private setupEvents() {
    // Plane selection
    const cards = this.overlay.querySelectorAll('.plane-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });
    });
    
    // Start button
    const startBtn = this.overlay.querySelector('.menu-start-btn')!;
    startBtn.addEventListener('click', () => {
      const selected = this.overlay.querySelector('.plane-card.selected') as HTMLElement;
      const nameInput = this.overlay.querySelector('.menu-name-input') as HTMLInputElement;
      
      if (selected && this.onStart) {
        const aircraftId = selected.dataset.id as AircraftId;
        const name = nameInput.value.trim() || 'Pilot';
        this.onStart(aircraftId, name);
      }
    });
    
    // Enter key also starts
    const nameInput = this.overlay.querySelector('.menu-name-input') as HTMLInputElement;
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        (startBtn as HTMLElement).click();
      }
    });
  }
  
  onStartGame(callback: (aircraftId: AircraftId, playerName: string) => void) {
    this.onStart = callback;
  }
  
  hide() {
    this.overlay.style.display = 'none';
  }
  
  show() {
    this.overlay.style.display = 'flex';
  }
}
