// @ts-check
// Per-zone ambience loops, assembled from filtered-noise beds + slow LFOs.
// Crossfades on zone change; riot-distance layer scales with threat.
import { noiseBuffer } from '../music/instruments.js';

export class Ambience {
  /** @param {import('../engine.js').AudioEngine} engine */
  constructor(engine) {
    this.engine = engine;
    this.current = null;   // { id, nodes, gain }
    this.threat = 0.2;
    this._riotGain = null;
  }

  /** @param {'apartment'|'balcony'} id */
  play(id) {
    if (!this.engine.ctx || this.current?.id === id) return;
    const old = this.current;
    if (old) {
      old.gain.gain.linearRampToValueAtTime(0, this.engine.now + 1.5);
      setTimeout(() => old.nodes.forEach((n) => { try { n.stop?.(); } catch { } }), 1800);
    }
    this.current = this._build(id);
  }

  setThreat(v) {
    this.threat = v;
    if (this._riotGain) {
      this._riotGain.gain.linearRampToValueAtTime(0.008 + v * 0.05, this.engine.now + 2);
    }
  }

  _build(id) {
    const ctx = this.engine.ctx;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, this.engine.now);
    master.gain.linearRampToValueAtTime(1, this.engine.now + 2);
    master.connect(this.engine.bus('ambience'));
    /** @type {AudioScheduledSourceNode[]} */
    const nodes = [];

    const loopNoise = (dur = 4) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, dur);
      src.loop = true;
      src.start();
      nodes.push(src);
      return src;
    };

    if (id === 'apartment') {
      // HVAC hum: filtered saw + sub
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth'; hum.frequency.value = 58;
      const humF = ctx.createBiquadFilter();
      humF.type = 'lowpass'; humF.frequency.value = 130;
      const humG = ctx.createGain(); humG.gain.value = 0.015;
      hum.connect(humF); humF.connect(humG); humG.connect(master);
      hum.start(); nodes.push(hum);

      // rain on glass: highpassed noise with slow amplitude LFO
      const rain = loopNoise(3.7);
      const rainF = ctx.createBiquadFilter();
      rainF.type = 'highpass'; rainF.frequency.value = 3800;
      const rainG = ctx.createGain(); rainG.gain.value = 0.018;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.006;
      lfo.connect(lfoG); lfoG.connect(rainG.gain);
      lfo.start(); nodes.push(lfo);
      rain.connect(rainF); rainF.connect(rainG); rainG.connect(master);

      // electrical bed: very quiet 120Hz shimmer
      const buzz = ctx.createOscillator();
      buzz.type = 'triangle'; buzz.frequency.value = 120;
      const buzzG = ctx.createGain(); buzzG.gain.value = 0.004;
      buzz.connect(buzzG); buzzG.connect(master);
      buzz.start(); nodes.push(buzz);
    }

    if (id === 'balcony') {
      // wind: bandpassed noise with wandering center
      const wind = loopNoise(5.3);
      const windF = ctx.createBiquadFilter();
      windF.type = 'bandpass'; windF.frequency.value = 500; windF.Q.value = 0.4;
      const windG = ctx.createGain(); windG.gain.value = 0.04;
      const wLfo = ctx.createOscillator(); wLfo.frequency.value = 0.07;
      const wLfoG = ctx.createGain(); wLfoG.gain.value = 260;
      wLfo.connect(wLfoG); wLfoG.connect(windF.frequency);
      wLfo.start(); nodes.push(wLfo);
      wind.connect(windF); windF.connect(windG); windG.connect(master);

      // heavier rain outside
      const rain = loopNoise(4.1);
      const rainF = ctx.createBiquadFilter();
      rainF.type = 'highpass'; rainF.frequency.value = 2600;
      const rainG = ctx.createGain(); rainG.gain.value = 0.03;
      rain.connect(rainF); rainF.connect(rainG); rainG.connect(master);
    }

    if (id === 'server') {
      // dense equipment hum + fan wash
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth'; hum.frequency.value = 92;
      const humF = ctx.createBiquadFilter();
      humF.type = 'lowpass'; humF.frequency.value = 220;
      const humG = ctx.createGain(); humG.gain.value = 0.03;
      hum.connect(humF); humF.connect(humG); humG.connect(master);
      hum.start(); nodes.push(hum);
      const fan = loopNoise(3.3);
      const fanF = ctx.createBiquadFilter();
      fanF.type = 'bandpass'; fanF.frequency.value = 450; fanF.Q.value = 0.6;
      const fanG = ctx.createGain(); fanG.gain.value = 0.022;
      fan.connect(fanF); fanF.connect(fanG); fanG.connect(master);
    }

    if (id === 'medical') {
      const hum = ctx.createOscillator();
      hum.type = 'triangle'; hum.frequency.value = 120;
      const humG = ctx.createGain(); humG.gain.value = 0.006;
      hum.connect(humG); humG.connect(master);
      hum.start(); nodes.push(hum);
      // slow monitor beep: sine gated by a square LFO
      const beep = ctx.createOscillator();
      beep.frequency.value = 880;
      const beepG = ctx.createGain(); beepG.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square'; lfo.frequency.value = 0.38;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.006;
      lfo.connect(lfoG); lfoG.connect(beepG.gain);
      beep.connect(beepG); beepG.connect(master);
      beep.start(); lfo.start(); nodes.push(beep, lfo);
    }

    if (id === 'lobby') {
      const air = loopNoise(4.7);
      const airF = ctx.createBiquadFilter();
      airF.type = 'bandpass'; airF.frequency.value = 320; airF.Q.value = 0.4;
      const airG = ctx.createGain(); airG.gain.value = 0.03;
      air.connect(airF); airF.connect(airG); airG.connect(master);
    }

    if (id === 'carpark') {
      const rumble = loopNoise(5.9);
      const rF = ctx.createBiquadFilter();
      rF.type = 'lowpass'; rF.frequency.value = 150;
      const rG = ctx.createGain(); rG.gain.value = 0.05;
      rumble.connect(rF); rF.connect(rG); rG.connect(master);
      // drips: narrow ping resonance excited by noise bursts
      const drip = loopNoise(2.1);
      const dF = ctx.createBiquadFilter();
      dF.type = 'bandpass'; dF.frequency.value = 1700; dF.Q.value = 28;
      const dG = ctx.createGain(); dG.gain.value = 0.012;
      const dLfo = ctx.createOscillator(); dLfo.frequency.value = 0.09;
      const dLfoG = ctx.createGain(); dLfoG.gain.value = 0.010;
      dLfo.connect(dLfoG); dLfoG.connect(dG.gain);
      dLfo.start(); nodes.push(dLfo);
      drip.connect(dF); dF.connect(dG); dG.connect(master);
    }

    // distant riot: brown-ish noise rumble scaled by threat (both zones; louder outside)
    const riot = loopNoise(6.1);
    const riotF = ctx.createBiquadFilter();
    riotF.type = 'lowpass'; riotF.frequency.value = 240;
    const riotG = ctx.createGain();
    riotG.gain.value = (0.008 + this.threat * 0.05) * (id === 'balcony' ? 1.8 : 1);
    const rLfo = ctx.createOscillator(); rLfo.frequency.value = 0.05;
    const rLfoG = ctx.createGain(); rLfoG.gain.value = 0.004;
    rLfo.connect(rLfoG); rLfoG.connect(riotG.gain);
    rLfo.start(); nodes.push(rLfo);
    riot.connect(riotF); riotF.connect(riotG); riotG.connect(master);
    this._riotGain = riotG;

    return { id, nodes, gain: master };
  }
}
