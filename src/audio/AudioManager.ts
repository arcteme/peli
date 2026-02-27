import * as THREE from 'three';

/**
 * Spatial audio system using Three.js Audio + Web Audio API.
 * Lightweight: engine drone + gunfire + explosions + near-miss.
 */
export class AudioManager {
  private listener: THREE.AudioListener;
  private engineSound: THREE.Audio | null = null;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = false;
  
  // Sound pools
  private gunshotPool: THREE.Audio[] = [];
  private gunshotIndex = 0;
  
  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.audioContext = this.listener.context;
    
    if (this.audioContext) {
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.audioContext.destination);
    }
  }
  
  async init() {
    if (!this.audioContext) return;
    
    try {
      // Resume audio context (needs user gesture)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Create engine drone using oscillators
      this.createEngineDrone();
      
      // Create gunshot sound pool
      this.createGunshotPool();
      
      this.enabled = true;
    } catch (e) {
      console.warn('Audio init failed:', e);
    }
  }
  
  private createEngineDrone() {
    if (!this.audioContext) return;
    
    // Engine: layered oscillators for prop drone
    const engineGain = this.audioContext.createGain();
    engineGain.gain.value = 0.08;
    engineGain.connect(this.audioContext.destination);
    
    // Base drone
    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 80;
    osc1.connect(engineGain);
    osc1.start();
    
    // Higher harmonic
    const osc2 = this.audioContext.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 160;
    const osc2Gain = this.audioContext.createGain();
    osc2Gain.gain.value = 0.04;
    osc2.connect(osc2Gain);
    osc2Gain.connect(this.audioContext.destination);
    osc2.start();
    
    // Store references for throttle modulation
    (this as any)._engineOsc1 = osc1;
    (this as any)._engineOsc2 = osc2;
    (this as any)._engineGain = engineGain;
    (this as any)._engineGain2 = osc2Gain;
  }
  
  private createGunshotPool() {
    // Pre-create audio nodes for gunfire
    // Using synthetic sounds for MVP (no audio files needed)
    for (let i = 0; i < 5; i++) {
      const sound = new THREE.Audio(this.listener);
      this.gunshotPool.push(sound);
    }
  }
  
  updateEngine(throttle: number, speed: number, maxSpeed: number) {
    if (!this.enabled || !this.audioContext) return;
    
    const osc1 = (this as any)._engineOsc1 as OscillatorNode | undefined;
    const osc2 = (this as any)._engineOsc2 as OscillatorNode | undefined;
    const gain = (this as any)._engineGain as GainNode | undefined;
    const gain2 = (this as any)._engineGain2 as GainNode | undefined;
    
    if (!osc1 || !osc2 || !gain || !gain2) return;
    
    // Modulate frequency by throttle/speed
    const speedRatio = speed / maxSpeed;
    const baseFreq = 60 + throttle * 80 + speedRatio * 40;
    
    osc1.frequency.setTargetAtTime(baseFreq, this.audioContext.currentTime, 0.1);
    osc2.frequency.setTargetAtTime(baseFreq * 2, this.audioContext.currentTime, 0.1);
    
    // Modulate volume by throttle
    const vol = 0.04 + throttle * 0.08;
    gain.gain.setTargetAtTime(vol, this.audioContext.currentTime, 0.1);
    gain2.gain.setTargetAtTime(vol * 0.5, this.audioContext.currentTime, 0.1);
  }
  
  playGunshot() {
    if (!this.enabled || !this.audioContext) return;
    
    // Create a short noise burst for gunfire
    const ctx = this.audioContext;
    const duration = 0.05;
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // White noise burst with decay
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * (1 - t) * 0.3;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    
    // Add pitch variation
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.15;
    
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
  }
  
  playExplosion() {
    if (!this.enabled || !this.audioContext) return;
    
    const ctx = this.audioContext;
    const duration = 0.8;
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Low-frequency noise burst with longer decay
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      const envelope = Math.exp(-t * 5);
      data[i] = (Math.random() * 2 - 1) * envelope * 0.5;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.5 + Math.random() * 0.3;
    
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.3;
    
    // Low-pass filter for bassy explosion
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    
    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
  }
  
  playNearMiss() {
    if (!this.enabled || !this.audioContext) return;
    
    const ctx = this.audioContext;
    const duration = 0.3;
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Whoosh: filtered noise with pitch sweep
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      const envelope = Math.sin(t * Math.PI);
      data[i] = (Math.random() * 2 - 1) * envelope * 0.2;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1.5;
    
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.2;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    filter.Q.value = 2;
    
    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
  }
  
  playDamageHit() {
    if (!this.enabled || !this.audioContext) return;
    
    const ctx = this.audioContext;
    const duration = 0.15;
    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * (1 - t) * 0.4;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.6;
    
    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.25;
    
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
  }
  
  setMasterVolume(volume: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
    }
  }
}
