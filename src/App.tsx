/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Play, 
  Square, 
  Save, 
  FolderOpen,
  Upload, 
  Mic, 
  Wand2, 
  Settings2, 
  Music2, 
  Drum, 
  Search, 
  Library, 
  Activity,
  Download,
  Trash2,
  ChevronRight,
  Plus,
  Minus,
  Layers,
  Zap,
  Volume2,
  Smartphone,
  X,
  LineChart,
  Pause,
  RotateCcw,
  Music
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DRUM_LIBRARY, SYNTH_PRESETS } from "./constants";
import { DrumType, SynthPreset, RecordedSound, SongSection, TabType, MusicClip, SongTrack, SongClip, AutomationPoint, MidiMapping } from "./types";
import { DSPProcessor, HPSSProcessor, StructureAnalyzer } from "./lib/dsp";
import { generateSynthPreset, suggestSampleName, generateDrumPattern } from "./services/aiService";

// --- HELPERS ---
const bufferToUrl = (buffer: AudioBuffer): string => {
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length * numberOfChannels * 2 + 44;
  const arrayBuffer = new ArrayBuffer(length);
  const view = new DataView(arrayBuffer);

  const writeString = (v: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      v.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + buffer.length * numberOfChannels * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * numberOfChannels, true);
  view.setUint16(32, numberOfChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, buffer.length * numberOfChannels * 2, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      let sample = buffer.getChannelData(channel)[i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
};

const WARP_PARAMS = [
  { label: "FUNDAMENTAL", key: "freq", min: 25, max: 90, unit: "Hz" },
  { label: "└ FINE TUNE", key: "freqFine", min: -10, max: 10, step: 0.01, unit: "Hz" },
  { label: "OCTAVE STRETCH", key: "octave", min: 0.4, max: 3, step: 0.1, unit: "x" },
  { label: "└ PRECISION", key: "octaveFine", min: -0.1, max: 0.1, step: 0.001, unit: "x" },
  { label: "WARP / WOBBLE", key: "warp", min: 0.2, max: 8, step: 0.1, unit: "Hz" },
  { label: "LOOP TIMING", key: "timing", min: 0.1, max: 4, step: 0.05, unit: "x" },
  { label: "RESONANCE", key: "res", min: 1, max: 40, unit: "Q" },
  { label: "DRIVE (DIST)", key: "drive", min: 0, max: 60, unit: "%" },
  { label: "ATTACK", key: "attack", min: 10, max: 400, unit: "ms" },
];

const AutomationCanvas: React.FC<{
  points: { time: number; value: number }[];
  pixelsPerBeat: number;
  onAddPoint: (beat: number, value: number) => void;
  onRemovePoint: (index: number) => void;
}> = ({ points, pixelsPerBeat, onAddPoint, onRemovePoint }) => {
  return (
    <svg 
      className="w-full h-full cursor-crosshair overflow-visible"
      onClick={(e) => {
        if ((e.target as any).tagName !== 'circle') {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const beat = x / pixelsPerBeat;
          const value = 1 - (y / rect.height);
          onAddPoint(beat, Math.max(0, Math.min(1, value)));
        }
      }}
    >
      {/* Background Line */}
      <line 
        x1={0} 
        y1="50%" 
        x2="1000%" 
        y2="50%" 
        className="stroke-white/5 stroke-1" 
      />
      
      {/* Connection Lines */}
      {points.length > 0 && (
        <polyline
          points={[
            `0,${(1 - (points[0]?.value ?? 0.5)) * 100}%`,
            ...points.map(p => `${p.time * pixelsPerBeat},${(1 - p.value) * 100}%`),
            `10000,${(1 - (points[points.length - 1]?.value ?? 0.5)) * 100}%`
          ].join(' ')}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="1.5"
          className="opacity-40"
          strokeDasharray="4 2"
        />
      )}

      {/* Main Automation Line */}
      {points.length > 1 && (
        <polyline
          points={points.map(p => `${p.time * pixelsPerBeat},${(1 - p.value) * 100}%`).join(' ')}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]"
        />
      )}
      
      {/* Automation Points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.time * pixelsPerBeat}
          cy={`${(1 - p.value) * 100}%`}
          r="5"
          fill="#22d3ee"
          className="hover:r-7 transition-all cursor-pointer filter drop-shadow-md"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onRemovePoint(i);
          }}
        />
      ))}
    </svg>
  );
};


/// --- AUDIO ENGINE ---
class AudioEngine {
  ctx: AudioContext;
  masterGain: GainNode;
  limiter: DynamicsCompressorNode;
  processor: DSPProcessor;
  noiseBuffer: AudioBuffer | null = null;
  reverbNode: ConvolverNode;
  masterFilter: BiquadFilterNode;
  hpss: HPSSProcessor;
  
  // FX Chain
  fxChain: { [key: string]: AudioNode } = {};
  activeFX: string[] = [];

  warpSource: AudioBufferSourceNode | null = null;
  warpGain: GainNode | null = null;
  warpFilter: BiquadFilterNode | null = null;
  warpLFO: OscillatorNode | null = null;
  warpLFOGain: GainNode | null = null;
  warpDistortion: WaveShaperNode | null = null;
  warpAnalyzer: AnalyserNode | null = null;
  trackGains: Map<string, GainNode> = new Map();

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.limiter = this.ctx.createDynamicsCompressor();
    this.processor = new DSPProcessor({ sampleRate: this.ctx.sampleRate, blockSize: 128 });
    this.masterFilter = this.ctx.createBiquadFilter();
    this.reverbNode = this.ctx.createConvolver();
    this.hpss = new HPSSProcessor();

    this.masterFilter.type = "lowpass";
    this.masterFilter.frequency.setValueAtTime(20000, this.ctx.currentTime);

    this.limiter.threshold.setValueAtTime(-1, this.ctx.currentTime);
    this.limiter.knee.setValueAtTime(40, this.ctx.currentTime);
    this.limiter.ratio.setValueAtTime(12, this.ctx.currentTime);
    
    this.masterGain.connect(this.masterFilter);
    this.masterFilter.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    
    this.setupNoiseBuffer();
    this.setupReverb();
    this.initFX();
  }

  getTrackGain(trackId: string): GainNode {
    if (!this.trackGains.has(trackId)) {
      const gain = this.ctx.createGain();
      gain.connect(this.masterGain);
      this.trackGains.set(trackId, gain);
    }
    return this.trackGains.get(trackId)!;
  }

  setTrackVolume(trackId: string, volume: number, time: number = 0) {
    const gain = this.getTrackGain(trackId);
    if (time === 0) {
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    } else {
      gain.gain.linearRampToValueAtTime(volume, time);
    }
  }

  setTrackParameter(trackId: string, param: string, value: number) {
    if (param === "volume") {
      this.setTrackVolume(trackId, value);
    } else if (param === "cutoff") {
      if (this.warpFilter) {
        // Map 0..1 to 50..10000 Hz
        const freq = 50 + (value * 9950);
        this.warpFilter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02);
      }
    } else if (param === "resonance") {
       if (this.warpFilter) {
         this.warpFilter.Q.setTargetAtTime(value * 20, this.ctx.currentTime, 0.02);
       }
    }
  }

  initFX() {
    // Create pre-allocated nodes for the chain
    const bitCrusher = this.ctx.createWaveShaper();
    const curve = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) {
        const x = (i * 2 / 4096) - 1;
        curve[i] = Math.round(x * 16) / 16; // 4-bit simulation
    }
    bitCrusher.curve = curve;
    this.fxChain["BITCRUSHER"] = bitCrusher;

    const distortion = this.ctx.createWaveShaper();
    const distCurve = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) {
        const x = (i * 2 / 4096) - 1;
        distCurve[i] = Math.tanh(x * 2);
    }
    distortion.curve = distCurve;
    this.fxChain["DISTORTION"] = distortion;

    const delay = this.ctx.createDelay(1.0);
    delay.delayTime.value = 0.3;
    const delayFeedback = this.ctx.createGain();
    delayFeedback.gain.value = 0.4;
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    this.fxChain["DELAY"] = delay;
  }

  updateRouting(chain: string[]) {
    this.activeFX = chain;
    // Disconnect everything first
    this.masterGain.disconnect();
    this.masterFilter.disconnect();
    this.limiter.disconnect();
    
    // Rebuild chain
    let lastNode: AudioNode = this.masterGain;

    chain.forEach(fxType => {
      const node = this.fxChain[fxType];
      if (node) {
        lastNode.connect(node);
        lastNode = node;
      }
    });

    lastNode.connect(this.masterFilter);
    this.masterFilter.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
  }

  stopWarpEngine() {
    if (this.warpSource) {
      try { this.warpSource.stop(); } catch(e) {}
      this.warpSource.disconnect();
      this.warpSource = null;
    }
    if (this.warpLFO) {
      try { this.warpLFO.stop(); } catch(e) {}
      this.warpLFO.disconnect();
      this.warpLFO = null;
    }
    if (this.warpGain) {
      this.warpGain.disconnect();
    }
  }

  startWarpEngine(settings: any, hexMatrix: string[], trackId?: string) {
    this.stopWarpEngine();
    const now = this.ctx.currentTime;

    const getSignedVal = (hex: string) => {
      let v = parseInt(hex, 16) & 0xFFFF;
      return (v > 0x7FFF) ? v - 0x10000 : v;
    };

    const buf = this.ctx.createBuffer(1, hexMatrix.length, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    hexMatrix.forEach((h, i) => data[i] = getSignedVal(h) / 32768);

    this.warpSource = this.ctx.createBufferSource();
    this.warpSource.buffer = buf;
    this.warpSource.loop = true;
    
    // Finer playback rate calculation
    const baseFreq = settings.freq + (settings.freqFine || 0);
    const finalOctaveMult = settings.octave + (settings.octaveFine || 0);
    const timingMult = settings.timing || 1.0;
    this.warpSource.playbackRate.value = ((baseFreq * finalOctaveMult) / (this.ctx.sampleRate / hexMatrix.length)) * timingMult;

    this.warpGain = this.ctx.createGain();
    this.warpGain.gain.setValueAtTime(0, now);
    this.warpGain.gain.linearRampToValueAtTime(0.8, now + settings.attack / 1000);

    this.warpFilter = this.ctx.createBiquadFilter();
    this.warpFilter.type = "lowpass";
    this.warpFilter.frequency.value = 650;
    this.warpFilter.Q.value = settings.res;

    this.warpLFO = this.ctx.createOscillator();
    this.warpLFO.type = "sine";
    this.warpLFO.frequency.value = settings.warp;
    
    this.warpLFOGain = this.ctx.createGain();
    this.warpLFOGain.gain.value = 420;
    
    this.warpLFO.connect(this.warpLFOGain);
    this.warpLFOGain.connect(this.warpFilter.frequency);

    this.warpDistortion = this.ctx.createWaveShaper();
    const n = 44100;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i * 2 / n) - 1;
        curve[i] = Math.tanh(x * (1 + settings.drive / 12));
    }
    this.warpDistortion.curve = curve;

    this.warpAnalyzer = this.ctx.createAnalyser();
    this.warpAnalyzer.fftSize = 1024;

    this.warpSource.connect(this.warpDistortion);
    this.warpDistortion.connect(this.warpFilter);
    this.warpFilter.connect(this.warpGain);
    this.warpGain.connect(this.warpAnalyzer);
    
    if (trackId) {
      this.warpAnalyzer.connect(this.getTrackGain(trackId));
    } else {
      this.warpAnalyzer.connect(this.masterGain);
    }

    this.warpSource.start();
    this.warpLFO.start();
  }

  playSample(buffer: AudioBuffer, volume: number = 1.0, startTime: number = 0, duration: number = 0, trackId?: string) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    
    src.connect(gain);
    if (trackId) {
      gain.connect(this.getTrackGain(trackId));
    } else {
      gain.connect(this.masterGain);
    }
    
    if (duration > 0) {
      src.start(startTime, 0, duration);
    } else {
      src.start(startTime);
    }
    return src;
  }

  setupNoiseBuffer() {
    const bufferSize = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
       output[i] = Math.random() * 2 - 1;
    }
  }

  setupReverb() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
    }
    this.reverbNode.buffer = buf;
    
    const wet = this.ctx.createGain();
    wet.gain.setValueAtTime(0.05, this.ctx.currentTime);
    this.masterGain.connect(this.reverbNode);
    this.reverbNode.connect(wet);
    wet.connect(this.masterFilter);
  }

  resume() {
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  playDrum(drum: DrumType) {
    const now = this.ctx.currentTime;
    if (drum.buffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = drum.buffer;
      source.connect(this.masterGain);
      source.start(now);
      return;
    }

    const triggerTone = (type: OscillatorType, freq: number, endFreq: number, decay: number, volume: number) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + decay);
      g.gain.setValueAtTime(volume, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + decay);
      osc.connect(g).connect(this.masterGain);
      osc.start(now);
      osc.stop(now + decay + 0.1);
    };

    const triggerNoise = (filterType: BiquadFilterType, filterFreq: number, decay: number, volume: number) => {
      if (!this.noiseBuffer) return;
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      f.type = filterType;
      f.frequency.setValueAtTime(filterFreq, now);
      g.gain.setValueAtTime(volume, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + decay);
      source.connect(f).connect(g).connect(this.masterGain);
      source.start(now);
      source.stop(now + decay + 0.1);
    };

    switch (drum.type) {
      case "kick":
        triggerTone("sine", drum.freq || 150, 30, drum.decay || 0.5, 1.0);
        triggerNoise("lowpass", 2000, 0.02, 0.2);
        break;
      case "snare":
        triggerTone("triangle", 180, 140, 0.1, 0.5);
        triggerNoise("highpass", 1500, 0.25, 0.7);
        break;
      case "closedHat": triggerNoise("highpass", 10000, 0.05, 0.3); break;
      case "openHat": triggerNoise("highpass", 9000, 0.4, 0.3); break;
      case "clap": 
        for(let i=0; i<3; i++) triggerNoise("bandpass", 1200, 0.03, 0.4); 
        triggerNoise("bandpass", 1000, 0.2, 0.6);
        break;
      case "tom": triggerTone("sine", drum.freq || 100, (drum.freq || 100) * 0.6, 0.5, 0.8); break;
      case "rim": triggerTone("triangle", 800, 700, 0.05, 0.4); break;
      case "cowbell": 
        triggerTone("square", 560, 560, 0.2, 0.3);
        triggerTone("square", 840, 840, 0.2, 0.2);
        break;
      case "crash": 
        triggerNoise("highpass", 4000, 1.5, 0.4);
        triggerNoise("bandpass", 8000, 1.0, 0.2);
        break;
      case "shaker": triggerNoise("highpass", 12000, 0.08, 0.2); break;
      case "tamb": 
        triggerNoise("highpass", 10000, 0.1, 0.3);
        triggerTone("sine", 6000, 6000, 0.05, 0.1);
        break;
      case "conga": triggerTone("sine", drum.freq || 190, (drum.freq || 190)*0.9, 0.3, 0.6); break;
      case "wood": triggerTone("triangle", 1200, 1100, 0.04, 0.5); break;
      default: triggerTone("triangle", drum.freq || 440, (drum.freq || 440) * 0.8, 0.15, 0.5);
    }
  }

  playNote(midiNote: number, preset: SynthPreset) {
    const now = this.ctx.currentTime;
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    
    const createOsc = (type: OscillatorType | "noise", detune: number, pan: number) => {
      const g = this.ctx.createGain();
      const p = this.ctx.createStereoPanner();
      p.pan.setValueAtTime(pan, now);
      
      let source: AudioBufferSourceNode | OscillatorNode;
      if (type === "noise" && this.noiseBuffer) {
        source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.loop = true;
      } else {
        source = this.ctx.createOscillator();
        source.type = (type as OscillatorType) || "sine";
        source.frequency.setValueAtTime(freq * Math.pow(2, detune / 1200), now);
      }
      
      source.connect(g).connect(p);
      return { source, gain: g, panner: p };
    };

    const oscA = createOsc(preset.waveA, preset.detuneA, preset.panA);
    const oscB = createOsc(preset.waveB, preset.detuneB, preset.panB);
    
    oscA.gain.gain.setValueAtTime(1.0 - preset.mix, now);
    oscB.gain.gain.setValueAtTime(preset.mix, now);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(preset.filter, now);
    filter.Q.setValueAtTime(preset.resonance, now);

    const mainGain = this.ctx.createGain();
    mainGain.gain.setValueAtTime(0, now);
    mainGain.gain.linearRampToValueAtTime(0.3, now + preset.attack);
    mainGain.gain.exponentialRampToValueAtTime(preset.sustain * 0.3, now + preset.attack + preset.decay);
    
    oscA.panner.connect(filter);
    oscB.panner.connect(filter);
    filter.connect(mainGain).connect(this.masterGain);
    
    oscA.source.start(now);
    oscB.source.start(now);
    
    setTimeout(() => {
      const stopNow = this.ctx.currentTime;
      mainGain.gain.cancelScheduledValues(stopNow);
      mainGain.gain.setValueAtTime(mainGain.gain.value, stopNow);
      mainGain.gain.exponentialRampToValueAtTime(0.001, stopNow + preset.release);
      oscA.source.stop(stopNow + preset.release + 0.1);
      oscB.source.stop(stopNow + preset.release + 0.1);
    }, (preset.attack + preset.decay + 0.2) * 1000);
  }
}

let engine: AudioEngine | null = null;

// --- MAIN COMPONENT ---
export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("DRUM STUDIO");
  const [bpm, setBpm] = useState(128);
  const [bpmInput, setBpmInput] = useState("128");
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth && window.innerWidth < 1024);
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    return () => window.removeEventListener("resize", checkOrientation);
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [drumPattern, setDrumPattern] = useState<boolean[][]>(
    Array.from({ length: 16 }, () => Array(16).fill(false))
  );
  const [drumLibrary, setDrumLibrary] = useState<DrumType[]>(DRUM_LIBRARY);
  const [synthPreset, setSynthPreset] = useState<SynthPreset>(SYNTH_PRESETS[1]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSounds, setRecordedSounds] = useState<RecordedSound[]>([]);
  const [songChain, setSongChain] = useState<SongSection[]>([]);
  const [recordingStatus, setRecordingStatus] = useState("READY");
  
  const [sessionClips, setSessionClips] = useState<(MusicClip | null)[][]>(() => {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    // Initial content for professional demo
    grid[0][0] = { id: 1, name: "TECHNO KICK", pattern: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false] };
    grid[1][0] = { id: 2, name: "GHOST SNARE", pattern: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false] };
    grid[2][0] = { id: 3, name: "PULSE BASS", pattern: [true, true, false, true, true, true, false, true, true, true, false, true, true, true, false, true] };
    return grid;
  });
  const [activeSessionClips, setActiveSessionClips] = useState<(number | null)[]>(new Array(8).fill(null));
  
  const [assigningSound, setAssigningSound] = useState<RecordedSound | null>(null);
  
  const [aiPrompt, setAiPrompt] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [songSections, setSongSections] = useState<{ time: number, label: string }[]>([]);
  const [draggedSoundId, setDraggedSoundId] = useState<string | null>(null);

  // Warp Engine State
  const [warpSettings, setWarpSettings] = useState({
    freq: 45,
    freqFine: 0,
    octave: 1.0,
    octaveFine: 0,
    warp: 1.8,
    timing: 1.0,
    res: 18,
    drive: 22,
    attack: 65
  });
  const [hexMatrix, setHexMatrix] = useState<string[]>([
    "0000","310B","6016","8A21","AD2C","BA36","A03F","FC48","EC50","B557",
    "F85C","7160","7D63","7E64","7E64","7D63","7160","5C78","57B5","50EC",
    "48FC","3FA0","36BA","2CAD","218A","1631","0B31","00CF","F404","E9A0",
    "DE76","D353","C946","C036","0420","1411","0908","F7A0","E6C1","DFB7",
    "D997","D99C","D997","D9B7","E6C1","EF08","F700","0911","1420","0436",
    "C046","C953","D376","DEC1","E9CF","0400","000B","3116","6021","8A2C",
    "AD36","BA3F","A048","FCE0","ECE5","7B55","CF86","0716","37D6","47E6",
    "47E6","37D6","0717","85CB","557E","C50F","C48A","03FB","A36A","D2C8"
  ]);
  const [isWarpEngineActive, setIsWarpEngineActive] = useState(false);
  const [routingChain, setRoutingChain] = useState<string[]>([]);
  const [snapValue, setSnapValue] = useState(1); // 1 = full beat, 0.25 = 1/16, etc.
  const [warpPresets, setWarpPresets] = useState<{name: string, matrix: string[], settings: typeof warpSettings}[]>(() => {
    const saved = localStorage.getItem('warp_presets');
    if (saved) return JSON.parse(saved);
    return [
      { 
        name: 'INITIAL', 
        matrix: [...hexMatrix], 
        settings: { ...warpSettings } 
      }
    ];
  });

  const saveWarpPreset = () => {
    const name = prompt("Preset Name:");
    if (name) {
      const newPresets = [...warpPresets, { 
        name, 
        matrix: [...hexMatrix], 
        settings: { ...warpSettings } 
      }];
      setWarpPresets(newPresets);
      localStorage.setItem('warp_presets', JSON.stringify(newPresets));
    }
  };

  const loadWarpPreset = (name: string) => {
    const preset = warpPresets.find(p => p.name === name);
    if (preset) {
      setHexMatrix([...preset.matrix]);
      setWarpSettings({ 
        ...preset.settings,
        freqFine: preset.settings.freqFine || 0,
        octaveFine: preset.settings.octaveFine || 0
      });
    }
  };

  const deleteWarpPreset = (name: string) => {
    if (name === 'INITIAL') return;
    const newPresets = warpPresets.filter(p => p.name !== name);
    setWarpPresets(newPresets);
    localStorage.setItem('warp_presets', JSON.stringify(newPresets));
  };
  const [songTracks, setSongTracks] = useState<SongTrack[]>(() => [
    { id: "track-1", name: "DRUMS", clips: [], volume: 0.8, automation: { volume: [] }, isAutomationOpen: false, selectedAutomationParam: 'volume' },
    { id: "track-2", name: "BASS", clips: [], volume: 0.8, automation: { volume: [] }, isAutomationOpen: false, selectedAutomationParam: 'volume' },
    { id: "track-3", name: "LEAD", clips: [], volume: 0.7, automation: { volume: [] }, isAutomationOpen: false, selectedAutomationParam: 'volume' },
    { id: "track-4", name: "FX", clips: [], volume: 0.5, automation: { volume: [] }, isAutomationOpen: false, selectedAutomationParam: 'volume' },
  ]);
  const [arrangementBpm, setArrangementBpm] = useState(120);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(80);
  const [arrangementPlayhead, setArrangementPlayhead] = useState(0);
  const [isArrangementPlaying, setIsArrangementPlaying] = useState(false);
  const arrangementStartTimeRef = useRef<number>(0);
  const arrangementAnimationFrameRef = useRef<number>(0);

  // MIDI State
  const [midiMappings, setMidiMappings] = useState<Record<number, MidiMapping>>(() => {
    const saved = localStorage.getItem('hybrid_daw_midi');
    return saved ? JSON.parse(saved) : {};
  });
  const [midiLearnTarget, setMidiLearnTarget] = useState<MidiMapping | null>(null);
  const [lastMidiValue, setLastMidiValue] = useState<Record<number, number>>({});

  // DJ DECKS STATE
  const [deckA, setDeckA] = useState({ trackUrl: null as string | null, trackName: "Deck A Empty", isPlaying: false, currentTime: 0, duration: 0, pitch: 1 });
  const [deckB, setDeckB] = useState({ trackUrl: null as string | null, trackName: "Deck B Empty", isPlaying: false, currentTime: 0, duration: 0, pitch: 1 });
  const [crossfade, setCrossfade] = useState(0.5);
  const audioDeckARef = useRef<HTMLAudioElement | null>(null);
  const audioDeckBRef = useRef<HTMLAudioElement | null>(null);

  // Project Assets State
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>(() => {
    const saved = localStorage.getItem('project_assets');
    // Note: AudioBuffers can't be stringified, so we'll need to handle them carefully if they are stored here.
    // For now, we mainly store references or small data structures.
    return saved ? JSON.parse(saved) : [];
  });
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('project_assets', JSON.stringify(projectAssets));
  }, [projectAssets]);

  const addAsset = (asset: Omit<ProjectAsset, "id" | "timestamp">) => {
    const newAsset: ProjectAsset = {
      ...asset,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };
    setProjectAssets(prev => [newAsset, ...prev]);
    setRecordingStatus("SAVED TO LIBRARY");
    setTimeout(() => setRecordingStatus("READY"), 2000);
  };

  useEffect(() => {
    localStorage.setItem('hybrid_daw_midi', JSON.stringify(midiMappings));
  }, [midiMappings]);

  useEffect(() => {
    const audioA = audioDeckARef.current;
    const audioB = audioDeckBRef.current;

    const updateA = () => setDeckA(prev => ({ ...prev, currentTime: audioA?.currentTime || 0, duration: audioA?.duration || 0 }));
    const updateB = () => setDeckB(prev => ({ ...prev, currentTime: audioB?.currentTime || 0, duration: audioB?.duration || 0 }));

    if (audioA) audioA.ontimeupdate = updateA;
    if (audioB) audioB.ontimeupdate = updateB;

    return () => {
      if (audioA) audioA.ontimeupdate = null;
      if (audioB) audioB.ontimeupdate = null;
    };
  }, [deckA.trackUrl, deckB.trackUrl]);

  useEffect(() => {
    if (audioDeckARef.current) {
      audioDeckARef.current.volume = 1 - crossfade;
      audioDeckARef.current.playbackRate = deckA.pitch;
    }
    if (audioDeckBRef.current) {
      audioDeckBRef.current.volume = crossfade;
      audioDeckBRef.current.playbackRate = deckB.pitch;
    }
  }, [crossfade, deckA.pitch, deckB.pitch]);

  const togglePlayDeck = (deck: 'A' | 'B') => {
    const audio = deck === 'A' ? audioDeckARef.current : audioDeckBRef.current;
    const setDeck = deck === 'A' ? setDeckA : setDeckB;
    
    if (audio && audio.src) {
       if (audio.paused) {
          audio.play().then(() => {
            setDeck(prev => ({ ...prev, isPlaying: true }));
          }).catch(console.error);
       } else {
          audio.pause();
          setDeck(prev => ({ ...prev, isPlaying: false }));
       }
    }
  };

  const stopDeck = (deck: 'A' | 'B') => {
    const audio = deck === 'A' ? audioDeckARef.current : audioDeckBRef.current;
    const setDeck = deck === 'A' ? setDeckA : setDeckB;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      setDeck(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
    }
  };

  const loadToDeck = (deck: 'A' | 'B', sound: RecordedSound) => {
    const setDeck = deck === 'A' ? setDeckA : setDeckB;
    const audio = deck === 'A' ? audioDeckARef.current : audioDeckBRef.current;
    if (audio) {
      audio.src = sound.url;
      audio.load();
      setDeck(prev => ({ ...prev, trackUrl: sound.url, trackName: sound.name, isPlaying: false }));
    }
  };

  // Arrangement Helper Functions
  const addSongTrack = () => {
    const newTrack: SongTrack = {
      id: Math.random().toString(36).substr(2, 9),
      name: `TRACK ${songTracks.length + 1}`,
      volume: 0.8,
      clips: [],
      automation: { volume: [] },
      isAutomationOpen: false,
      selectedAutomationParam: 'volume'
    };
    setSongTracks(prev => [...prev, newTrack]);
  };

  const snapToGrid = (val: number) => {
    return Math.round(val / snapValue) * snapValue;
  };

  const addEngineClipToArrangement = (trackId: string, startBeat: number) => {
    const snappedBeat = snapToGrid(startBeat);
    setSongTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const newClip: SongClip = {
          id: Math.random().toString(36).substr(2, 9),
          type: "warp",
          startBeat: snappedBeat,
          durationBeats: 4,
          trackIndex: songTracks.findIndex(tr => tr.id === trackId),
          data: hexMatrix
        };
        return { ...t, clips: [...t.clips, newClip] };
      }
      return t;
    }));
  };

  const addLibraryAssetToArrangement = (assetId: string, trackId: string, startBeat: number) => {
    const asset = projectAssets.find(a => a.id === assetId);
    if (!asset) return;

    const snappedBeat = snapToGrid(startBeat);
    setSongTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const newClip: SongClip = {
          id: Math.random().toString(36).substr(2, 9),
          type: asset.type === 'warped_buffer' ? "warp" : "audio",
          startBeat: snappedBeat,
          durationBeats: asset.metadata.duration || 4,
          trackIndex: songTracks.findIndex(tr => tr.id === trackId),
          data: asset.data,
          metadata: asset.metadata
        } as any; // Cast as any if metadata is missing in SongClip but we want to carry it
        return { ...t, clips: [...t.clips, newClip] };
      }
      return t;
    }));
  };

  const updateClipPosition = (trackId: string, clipId: string, newBeat: number) => {
    const snappedBeat = Math.max(0, snapToGrid(newBeat));
    setSongTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const existingClip = t.clips.find(c => c.id === clipId);
      if (existingClip?.startBeat === snappedBeat) return t;
      return {
        ...t,
        clips: t.clips.map(c => c.id === clipId ? { ...c, startBeat: snappedBeat } : c)
      };
    }));
  };

  const updateClipDuration = (trackId: string, clipId: string, newDuration: number) => {
    const snappedDuration = Math.max(snapValue, snapToGrid(newDuration));
    setSongTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const existingClip = t.clips.find(c => c.id === clipId);
      if (existingClip?.durationBeats === snappedDuration) return t;
      return {
        ...t,
        clips: t.clips.map(c => c.id === clipId ? { ...c, durationBeats: snappedDuration } : c)
      };
    }));
  };

  const addAutomationPointToTrack = (trackId: string, param: string, beat: number, value: number) => {
    setSongTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const currentPoints = t.automation?.[param] || [];
        // Keep points sorted by beat
        const newPoints = [...currentPoints, { time: beat, value }].sort((a, b) => a.time - b.time);
        return {
          ...t,
          automation: {
            ...t.automation,
            [param]: newPoints
          }
        };
      }
      return t;
    }));
  };

  const removeAutomationPointFromTrack = (trackId: string, param: string, index: number) => {
    setSongTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const currentPoints = t.automation?.[param] || [];
        const newPoints = currentPoints.filter((_, i) => i !== index);
        return {
          ...t,
          automation: {
            ...t.automation,
            [param]: newPoints
          }
        };
      }
      return t;
    }));
  };

  const setTrackAutomationParam = (trackId: string, param: string) => {
    setSongTracks(prev => prev.map(t => t.id === trackId ? { ...t, selectedAutomationParam: param } : t));
  };

  const toggleTrackAutomation = (trackId: string) => {
    setSongTracks(prev => prev.map(t => t.id === trackId ? { ...t, isAutomationOpen: !t.isAutomationOpen } : t));
  };

  const updateTrackVolume = (trackId: string, volume: number) => {
    setSongTracks(prev => prev.map(t => t.id === trackId ? { ...t, volume } : t));
    if (engine) engine.setTrackVolume(trackId, volume);
  };

  const updateParamFromMidi = useCallback((mapping: MidiMapping, value: number) => {
    if (mapping.type === 'warp') {
      const paramConfig = WARP_PARAMS.find(p => p.key === mapping.paramKey);
      if (paramConfig) {
        const mappedValue = paramConfig.min + (value * (paramConfig.max - paramConfig.min));
        setWarpSettings(prev => {
          const next = { ...prev, [mapping.paramKey]: mappedValue };
          if (isWarpEngineActive && engine) {
            engine.startWarpEngine(next, hexMatrix);
          }
          return next;
        });
      }
    } else if (mapping.type === 'track') {
      if (mapping.paramKey === 'volume' && mapping.targetId) {
        updateTrackVolume(mapping.targetId, value);
      }
    } else if (mapping.type === 'dj') {
      if (mapping.paramKey === 'crossfade') {
        setCrossfade(value);
      } else if (mapping.paramKey === 'pitch') {
        if (mapping.targetId === 'deckA') setDeckA(prev => ({ ...prev, pitch: 0.5 + value }));
        if (mapping.targetId === 'deckB') setDeckB(prev => ({ ...prev, pitch: 0.5 + value }));
      }
    }
    setLastMidiValue(prev => ({ ...prev, [mapping.cc]: value }));
  }, [engine, isWarpEngineActive, hexMatrix]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) return;

    let midiAccess: any;

    const onMidiMessage = (event: any) => {
      const [status, data1, data2] = event.data;
      const type = status & 0xf0;
      
      if (type === 176) { // CC
        const cc = data1;
        const value = data2 / 127;

        if (midiLearnTarget) {
          setMidiMappings(prev => ({
            ...prev,
            [cc]: { ...midiLearnTarget, cc }
          }));
          setMidiLearnTarget(null);
        } else {
          const mapping = midiMappings[cc];
          if (mapping) {
            updateParamFromMidi(mapping, value);
          }
        }
      }
    };

    navigator.requestMIDIAccess().then((access: any) => {
      midiAccess = access;
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = onMidiMessage;
      }
    });

    return () => {
      if (midiAccess) {
        for (const input of midiAccess.inputs.values()) {
          input.onmidimessage = null;
        }
      }
    };
  }, [midiMappings, midiLearnTarget, updateParamFromMidi]);

  const getAutomationValue = (points: { time: number; value: number }[], beat: number, defaultValue: number = 0.5): number => {
    if (!points || points.length === 0) return defaultValue;
    if (beat <= points[0].time) return points[0].value;
    if (beat >= points[points.length - 1].time) return points[points.length - 1].value;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i+1];
      if (beat >= p1.time && beat <= p2.time) {
        if (p2.time === p1.time) return p2.value;
        const t = (beat - p1.time) / (p2.time - p1.time);
        return p1.value + (p2.value - p1.value) * t;
      }
    }
    return defaultValue;
  };

  const loadProject = () => {
    const saved = localStorage.getItem("hybrid_daw_project");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.songTracks) setSongTracks(data.songTracks);
        if (data.arrangementBpm) setArrangementBpm(data.arrangementBpm);
        if (data.warpSettings) setWarpSettings(data.warpSettings);
        if (data.hexMatrix) setHexMatrix(data.hexMatrix);
        if (data.drumPattern) setDrumPattern(data.drumPattern);
        if (data.sessionClips) setSessionClips(data.sessionClips);
        alert("Project loaded successfully!");
      } catch (e) {
        console.error("Failed to load project", e);
      }
    }
  };

  const saveProject = () => {
    const projectData = {
      songTracks,
      arrangementBpm,
      warpSettings,
      hexMatrix,
      drumPattern,
      sessionClips,
      bpm,
      synthPreset: synthPreset.id,
      songChain
    };
    localStorage.setItem("hybrid_daw_project", JSON.stringify(projectData));
    alert("Project saved to local storage!");
  };

  const toggleArrangementPlay = () => {
    if (!engine) return;
    initEngine();
    
    if (isArrangementPlaying) {
      setIsArrangementPlaying(false);
      cancelAnimationFrame(arrangementAnimationFrameRef.current);
      engine.stopWarpEngine();
    } else {
      setIsArrangementPlaying(true);
      const startTime = engine.ctx.currentTime;
      arrangementStartTimeRef.current = startTime;
      
      const beatDur = 60 / arrangementBpm;

      // Start clips logic
      songTracks.forEach(track => {
        track.clips.forEach(clip => {
          const startSec = clip.startBeat * beatDur;
          const durSec = clip.durationBeats * beatDur;

          if (clip.type === "warp") {
            const triggerTime = (startTime + startSec) * 1000 - (engine.ctx.currentTime * 1000);
            setTimeout(() => {
               if (arrangementStartTimeRef.current === startTime) {
                 engine.startWarpEngine(warpSettings, clip.data, track.id);
                 setTimeout(() => {
                   if (arrangementStartTimeRef.current === startTime) engine.stopWarpEngine();
                 }, durSec * 1000);
               }
            }, Math.max(0, triggerTime));
          } else if (clip.type === "audio") {
            const sound = recordedSounds.find(s => s.id === clip.data);
            if (sound) {
              engine.playSample(sound.buffer, track.volume, startTime + startSec, durSec, track.id);
            }
          }
        });
      });
    }
  };

  useEffect(() => {
    const updatePlayhead = () => {
      if (isArrangementPlaying && engine) {
        const elapsed = engine.ctx.currentTime - arrangementStartTimeRef.current;
        const beats = elapsed / (60 / arrangementBpm);
        setArrangementPlayhead(beats);

        // Process Automation
        songTracks.forEach(track => {
          if (track.automation) {
            Object.entries(track.automation).forEach(([param, p]) => {
              const points = p as AutomationPoint[];
              if (points && points.length > 0) {
                const automatedValue = getAutomationValue(points, beats, param === 'volume' ? track.volume : 0.5);
                engine.setTrackParameter(track.id, param, automatedValue);
              }
            });
          }
        });
      }
      arrangementAnimationFrameRef.current = requestAnimationFrame(updatePlayhead);
    };
    if (isArrangementPlaying) updatePlayhead();
    return () => cancelAnimationFrame(arrangementAnimationFrameRef.current);
  }, [isArrangementPlaying, arrangementBpm]);

  // Music Structure Engine Actions
  const analyzeStructure = async (sound: RecordedSound) => {
    if (!sound.buffer) return;
    try {
      const result = StructureAnalyzer.analyze(sound.buffer, 6);
      const labels = ["INTRO", "VERSE", "CHORUS", "VERSE 2", "CHORUS 2", "OUTRO"];
      const sections = result.boundaries.map((time, i) => ({
        time,
        label: labels[i] || `SEC ${i+1}`
      }));
      setSongSections(sections);
      alert(`Analysis complete: Found ${sections.length} song sections.`);
    } catch (e) {
      console.error("Analysis failed", e);
    }
  };

  const handleDeepSplit = async (sound: RecordedSound) => {
    if (!sound.buffer) return;
    setIsSplitting(true);
    try {
      const hpss = new HPSSProcessor();
      const results = await hpss.separateMultiClass(sound.buffer.getChannelData(0), sound.buffer.sampleRate);
      
      const createSound = (data: Float32Array, suffix: string) => {
        const newBuffer = engine!.ctx.createBuffer(1, data.length, sound.buffer.sampleRate);
        newBuffer.getChannelData(0).set(data);
        const newSound: RecordedSound = {
          id: Math.random().toString(36).substr(2, 9),
          name: `${sound.name} (${suffix})`,
          buffer: newBuffer,
          url: bufferToUrl(newBuffer),
          emoji: suffix === "DRUMS" ? "🥁" : suffix === "BASS" ? "🎸" : "🎤",
          timestamp: Date.now(),
          params: { ...sound.params }
        };
        return newSound;
      };

      const drums = createSound(results.drums, "DRUMS");
      const bass = createSound(results.bass, "BASS");
      const vocals = createSound(results.vocals, "VOCALS");

      setRecordedSounds(prev => [...prev, drums, bass, vocals]);
      alert("Multi-class separation finished! Check your library for Drums, Bass, and Vocals.");
    } catch (e) {
      console.error("Deep split failed", e);
    } finally {
      setIsSplitting(false);
    }
  };


  // Warp Engine Drawing Loop
  useEffect(() => {
    let animationFrame: number;
    const draw = () => {
      if (activeTab === "WARP ENGINE" && isWarpEngineActive && engine && engine.warpAnalyzer) {
        const waveCanvas = document.getElementById("warpWaveform") as HTMLCanvasElement;
        const specCanvas = document.getElementById("warpSpectrum") as HTMLCanvasElement;
        
        if (waveCanvas && specCanvas) {
          const analyzer = engine.warpAnalyzer;
          const bufferLength = analyzer.frequencyBinCount;
          
          // Waveform
          const waveData = new Uint8Array(bufferLength);
          analyzer.getByteTimeDomainData(waveData);
          const wctx = waveCanvas.getContext("2d");
          if (wctx) {
            waveCanvas.width = waveCanvas.offsetWidth;
            waveCanvas.height = waveCanvas.offsetHeight;
            wctx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
            wctx.strokeStyle = "#22d3ee"; // cyan-400
            wctx.lineWidth = 2;
            wctx.beginPath();
            const sliceWidth = waveCanvas.width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
              const v = waveData[i] / 128.0;
              const y = v * (waveCanvas.height / 2);
              if (i === 0) wctx.moveTo(x, y);
              else wctx.lineTo(x, y);
              x += sliceWidth;
            }
            wctx.stroke();
          }

          // Spectrum (Advanced Frequency Visualization)
          const specData = new Uint8Array(bufferLength);
          analyzer.getByteFrequencyData(specData);
          const sctx = specCanvas.getContext("2d");
          if (sctx) {
            specCanvas.width = specCanvas.offsetWidth;
            specCanvas.height = specCanvas.offsetHeight;
            sctx.clearRect(0, 0, specCanvas.width, specCanvas.height);
            
            const gradient = sctx.createLinearGradient(0, specCanvas.height, 0, 0);
            gradient.addColorStop(0, "rgba(34, 211, 238, 0)"); // cyan-400 transparent
            gradient.addColorStop(0.5, "rgba(34, 211, 238, 0.5)"); 
            gradient.addColorStop(1, "rgba(192, 38, 211, 0.8)"); // fuchsia-600

            sctx.fillStyle = gradient;
            sctx.beginPath();
            sctx.moveTo(0, specCanvas.height);

            const barWidth = specCanvas.width / (bufferLength / 2); // Show lower half more clearly
            let x = 0;
            for (let i = 0; i < bufferLength / 2; i++) {
              const barHeight = (specData[i] / 255) * specCanvas.height;
              sctx.lineTo(x, specCanvas.height - barHeight);
              x += barWidth;
            }
            sctx.lineTo(specCanvas.width, specCanvas.height);
            sctx.closePath();
            sctx.fill();

            // Accent line on top
            sctx.strokeStyle = "#c026d3";
            sctx.lineWidth = 1;
            sctx.beginPath();
            x = 0;
            for (let i = 0; i < bufferLength / 2; i++) {
              const barHeight = (specData[i] / 255) * specCanvas.height;
              if (i === 0) sctx.moveTo(x, specCanvas.height - barHeight);
              else sctx.lineTo(x, specCanvas.height - barHeight);
              x += barWidth;
            }
            sctx.stroke();
          }
        }
      }
      animationFrame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [activeTab, isWarpEngineActive]);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const initEngine = () => {
    if (!engine) {
      engine = new AudioEngine();
    }
    engine.resume();
  };

  // Sequencer loop
  useEffect(() => {
    if (isPlaying) {
      const stepTime = (60 / bpm / 4) * 1000;
      timerRef.current = setInterval(() => {
        setCurrentStep((prev) => (prev + 1) % 16);
      }, stepTime);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setCurrentStep(-1);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, bpm]);

  // Trigger sounds on step change
  useEffect(() => {
    if (isPlaying && currentStep >= 0 && engine) {
      // 1. Trigger Manual Drum Pattern
      drumPattern.forEach((row, rowIndex) => {
        if (row[currentStep] && drumLibrary[rowIndex]) {
          engine!.playDrum(drumLibrary[rowIndex]);
        }
      });

      // 2. Trigger Session Clips
      activeSessionClips.forEach((sceneIdx, trackIdx) => {
        if (sceneIdx !== null) {
          const clip = sessionClips[trackIdx][sceneIdx];
          if (clip && clip.pattern[currentStep]) {
            if (trackIdx < 2) {
              // Drum Tracks (0-1)
              engine!.playDrum(drumLibrary[trackIdx === 0 ? 0 : 3]);
            } else {
              // Synth Tracks (2-7) - Play a base note for now
              engine!.playNote(48 + trackIdx, synthPreset);
            }
          }
        }
      });
    }
  }, [currentStep, isPlaying, drumPattern, drumLibrary, activeSessionClips, sessionClips, synthPreset]);

  const togglePlay = () => {
    initEngine();
    setIsPlaying(!isPlaying);
  };

  const handleBpmUpdate = (val: number) => {
    const clamped = Math.max(50, Math.min(500, val));
    setBpm(clamped);
    setBpmInput(clamped.toString());
  };

  const handleBpmInputChange = (val: string) => {
    // Only allow numbers
    const numeric = val.replace(/[^0-9]/g, "");
    setBpmInput(numeric);
  };

  const finalizeBpm = () => {
    if (!bpmInput) {
      setBpmInput(bpm.toString());
      return;
    }
    let val = parseInt(bpmInput, 10);
    if (isNaN(val)) val = bpm;
    
    // Auto-correction logic
    if (val < 50) val = 50;
    if (val > 500) val = 500;
    
    handleBpmUpdate(val);
  };

  const handleTimelineWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomSpeed = 0.05;
      const factor = e.deltaY > 0 ? (1 - zoomSpeed) : (1 + zoomSpeed);
      setPixelsPerBeat(prev => Math.min(Math.max(prev * factor, 20), 400));
    }
  };

  const addFXToChain = (fx: string) => {
    initEngine();
    const newChain = [...routingChain, fx].slice(0, 4); // Max 4 fx
    setRoutingChain(newChain);
    engine!.updateRouting(newChain);
  };

  const clearRoutingChain = () => {
    setRoutingChain([]);
    if (engine) engine.updateRouting([]);
  };

  const startRecording = async () => {
    initEngine();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : MediaRecorder.isTypeSupported('audio/webm') 
          ? 'audio/webm' 
          : 'audio/ogg';
          
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          if (audioChunksRef.current.length === 0) {
            setRecordingStatus("ERR: NO DATA");
            return;
          }
          
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          const arrayBuffer = await audioBlob.arrayBuffer();
          
          if (!engine) initEngine();
          if (engine!.ctx.state === 'suspended') {
            await engine!.ctx.resume();
          }

          const audioBuffer = await engine!.ctx.decodeAudioData(arrayBuffer);
          
          let sampleName = `RECO_${recordedSounds.length + 1}`;
          try {
            sampleName = await suggestSampleName(audioBuffer.duration, "microphone capture");
          } catch (e) {
            console.error("AI naming failed", e);
          }

          const audioUrl = bufferToUrl(audioBuffer);

          const newSound: RecordedSound = {
            id: Math.random().toString(36).substr(2, 9),
            name: sampleName,
            buffer: audioBuffer,
            url: audioUrl,
            emoji: "🎤",
            timestamp: Date.now(),
            params: { pitch: 0, speed: 1, filter: 4000, reverb: 0.3 }
          };
          setRecordedSounds((prev) => [...prev, newSound]);
          setRecordingStatus("SAVED");
        } catch (decodeError) {
          console.error("Audio recording/decoding failed", decodeError);
          setRecordingStatus("ERR: DECODE FAIL");
        }
        
        setTimeout(() => setRecordingStatus("READY"), 2000);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingStatus("RECORDING...");
    } catch (err) {
      console.error("Microphone access denied", err);
      setRecordingStatus("ERR: ALLOW MIC");
      setIsRecording(false);
      setTimeout(() => setRecordingStatus("READY"), 4000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const launchScene = (sceneIdx: number) => {
    initEngine();
    const newActive = [...activeSessionClips];
    for (let i = 0; i < 8; i++) {
      if (sessionClips[i] && sessionClips[i][sceneIdx]) {
        newActive[i] = sceneIdx;
      }
    }
    setActiveSessionClips(newActive);
  };

  const addScene = () => {
    setSessionClips(prev => {
      return prev.map(track => [...track, null]);
    });
  };

  const handleWarpAll = () => {
    initEngine();
    recordedSounds.forEach(sound => {
      const data = sound.buffer.getChannelData(0);
      const newData = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        newData[i] = Math.tanh(data[i] * 1.5);
      }
      const newBuf = engine!.ctx.createBuffer(1, data.length, sound.buffer.sampleRate);
      newBuf.getChannelData(0).set(newData);
      
      const newSound: RecordedSound = {
        id: Math.random().toString(36).substr(2, 9),
        name: `${sound.name}_WARPED`,
        buffer: newBuf,
        emoji: "🌀",
        timestamp: Date.now(),
        params: { ...sound.params }
      };
      setRecordedSounds(prev => [...prev, newSound]);
    });
    alert("Spectral batch warping complete!");
  };

  const injectToWarpEngine = (sound: RecordedSound) => {
    const data = sound.buffer.getChannelData(0);
    const step = Math.floor(data.length / 80);
    const newMatrix: string[] = [];
    for (let i = 0; i < 80; i++) {
      const val = data[i * step] || 0;
      const hex = Math.floor((val + 1) * 32767).toString(16).toUpperCase().padStart(4, "0");
      newMatrix.push(hex);
    }
    setHexMatrix(newMatrix);
    setActiveTab("WARP ENGINE");
    alert(`Sample ${sound.name} injected into Binary Matrix!`);
  };

  const handleDragStart = (e: React.DragEvent, sound: RecordedSound) => {
    e.dataTransfer.setData("soundId", sound.id);
  };

  const handleDrop = (e: React.DragEvent, rowIndex: number) => {
    e.preventDefault();
    const soundId = e.dataTransfer.getData("soundId");
    const sound = recordedSounds.find((s) => s.id === soundId);
    if (sound) {
      assignSoundToTrack(sound, rowIndex);
    }
  };

  const assignSoundToTrack = (sound: RecordedSound, rowIndex: number) => {
    setDrumLibrary((prev) => {
      const next = [...prev];
      next[rowIndex] = {
        ...next[rowIndex],
        name: sound.name,
        symbol: sound.emoji,
        buffer: sound.buffer,
        type: "sample"
      };
      return next;
    });
    setAssigningSound(null);
  };

  const addSongSection = () => {
    const newSection: SongSection = {
      id: Math.random().toString(36).substr(2, 9),
      type: "Drum Pattern",
      index: songChain.length,
      length: 4
    };
    setSongChain([...songChain, newSection]);
  };

  const handleDrumToggle = (row: number, step: number) => {
    const newPattern = [...drumPattern];
    newPattern[row] = [...newPattern[row]];
    newPattern[row][step] = !newPattern[row][step];
    setDrumPattern(newPattern);
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    try {
      const result = await generateSynthPreset(aiPrompt);
      const newPreset: SynthPreset = {
        ...synthPreset,
        ...result,
        id: Date.now(),
      } as SynthPreset;
      setSynthPreset(newPreset);
      setAiPrompt("");
    } catch (e) {
      console.error("AI Generation failed", e);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAiDrumPattern = async () => {
    const stylePrompt = window.prompt("Describe the drum style (e.g. 'Heavy Industrial', 'Lo-fi Hip Hop')");
    if (!stylePrompt) return;
    setIsAiLoading(true);
    try {
      const pattern = await generateDrumPattern(stylePrompt);
      setDrumPattern(pattern);
    } catch (e) {
      console.error("AI Drum Generation failed", e);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSplitSample = async (sound: RecordedSound) => {
    if (!engine) return;
    setRecordingStatus("SPLITTING...");
    try {
      const channelData = sound.buffer.getChannelData(0);
      const { harmonic, percussive } = await engine.hpss.separate(channelData, sound.buffer.sampleRate);
      
      const createBuffer = (data: Float32Array) => {
        const buf = engine!.ctx.createBuffer(1, data.length, sound.buffer.sampleRate);
        buf.getChannelData(0).set(data);
        return buf;
      };

      const hBuffer = createBuffer(harmonic);
      const pBuffer = createBuffer(percussive);

      const hSound: RecordedSound = {
        id: Math.random().toString(36).substring(2, 9),
        name: `${sound.name}_H`,
        buffer: hBuffer,
        url: bufferToUrl(hBuffer),
        emoji: "🎹",
        timestamp: Date.now(),
        params: { ...sound.params }
      };

      const pSound: RecordedSound = {
        id: Math.random().toString(36).substring(2, 9),
        name: `${sound.name}_P`,
        buffer: pBuffer,
        url: bufferToUrl(pBuffer),
        emoji: "🥁",
        timestamp: Date.now(),
        params: { ...sound.params }
      };

      setRecordedSounds(prev => [...prev, hSound, pSound]);
      setRecordingStatus("DONE");
      setTimeout(() => setRecordingStatus("READY"), 2000);
    } catch (e) {
      console.error("Split failed", e);
      setRecordingStatus("ERR: SPLIT");
      setTimeout(() => setRecordingStatus("READY"), 2000);
    }
  };

  const addAudioClipToArrangement = (trackId: string, startBeat: number, soundId?: string) => {
    const snappedBeat = snapToGrid(startBeat);
    let sound;
    if (soundId) {
      sound = recordedSounds.find(s => s.id === soundId);
    } else {
      if (recordedSounds.length === 0) {
        alert("No recorded sounds found. Go to SOUND EXPLORER to record something!");
        return;
      }
      sound = recordedSounds[recordedSounds.length - 1];
    }
    
    if (!sound) return;

    setSongTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const newClip: SongClip = {
          id: Math.random().toString(36).substr(2, 9),
          type: "audio",
          startBeat: snappedBeat,
          durationBeats: Math.ceil(sound.buffer.duration / (60 / arrangementBpm)),
          trackIndex: songTracks.findIndex(tr => tr.id === trackId),
          data: sound.id
        };
        return { ...t, clips: [...t.clips, newClip] };
      }
      return t;
    }));
  };

  const removeSongClip = (trackId: string, clipId: string) => {
    setSongTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        return { ...t, clips: t.clips.filter(c => c.id !== clipId) };
      }
      return t;
    }));
  };

  const exportProject = () => {
    const projectData = {
      bpm,
      drumPattern,
      synthPreset: synthPreset.id,
      songChain,
      songTracks,
      arrangementBpm,
      warpSettings,
      hexMatrix
    };
    const blob = new Blob([JSON.stringify(projectData)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `DAW_Project_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden selection:bg-cyan-500/30">
      {/* Orientation Guard */}
      <AnimatePresence>
        {isPortrait && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-zinc-950 flex flex-col items-center justify-center p-8 text-center"
          >
            <div className="relative mb-8">
              <Smartphone size={64} className="text-cyan-400 animate-rotate-phone" />
              <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_#22d3ee]" />
            </div>
            <h1 className="text-xl font-retro text-cyan-400 mb-4 tracking-tighter">ROTATION REQUIRED</h1>
            <p className="text-[10px] font-mono text-slate-500 max-w-[240px] leading-relaxed uppercase">
              The Production Lab requires landscape orientation for the best studio experience. Please rotate your device.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER */}
      <header className="flex flex-col sm:flex-row items-center justify-between px-4 sm:px-8 py-3 sm:py-4 gap-4 border-b border-white/10 bg-black/50 sticky top-0 z-50 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4 self-start sm:self-center">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-cyan-400 rounded-xl flex items-center justify-center text-black shadow-[0_0_20px_#22d3ee]">
            <Music2 size={20} />
          </div>
          <div>
            <h1 className="font-retro text-[10px] sm:text-sm tracking-widest text-cyan-400 neon-cyan uppercase">
              Searching for the Sound
            </h1>
            <p className="hidden sm:block text-[10px] text-slate-500 font-mono mt-1">2026 EDITION • v1.0.5</p>
          </div>
        </div>

        <div className="flex bg-zinc-900/80 rounded-2xl p-1 border border-white/5 shadow-inner scale-90 sm:scale-100">
          <button
            onClick={togglePlay}
            className={`w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-xl transition-all ${
              isPlaying ? "bg-red-500 text-white shadow-[0_0_15px_#ef4444]" : "bg-emerald-500 text-black shadow-[0_0_15px_#10b981]"
            }`}
          >
            {isPlaying ? <Square size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          
          <div className="flex items-center gap-3 px-4 sm:px-6 border-l border-white/10 ml-2">
            <span className="text-[10px] font-retro text-cyan-400/60 hidden xs:block">BPM</span>
            <div className="flex items-center bg-black/40 rounded-lg p-1 border border-white/10 group focus-within:border-cyan-400/50 transition-all">
              <button 
                onClick={() => handleBpmUpdate(bpm - 1)}
                className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-cyan-400 transition-colors"
                title="Decrease BPM"
              >
                <Minus size={14} />
              </button>
              <input
                type="text"
                value={bpmInput}
                onChange={(e) => handleBpmInputChange(e.target.value)}
                onBlur={finalizeBpm}
                onKeyDown={(e) => e.key === 'Enter' && finalizeBpm()}
                className="bg-transparent text-lg font-mono text-cyan-400 w-12 text-center focus:outline-none"
              />
              <button 
                onClick={() => handleBpmUpdate(bpm + 1)}
                className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-cyan-400 transition-colors"
                title="Increase BPM"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 sm:gap-3 sm:self-center self-end">
          <button onClick={saveProject} className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[10px] sm:text-xs font-semibold border border-white/5 transition-colors">
            <Save size={12} /> <span className="hidden xs:inline">SAVE</span>
          </button>
          <button onClick={loadProject} className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[10px] sm:text-xs font-semibold border border-white/5 transition-colors">
            <FolderOpen size={12} /> <span className="hidden xs:inline">LOAD</span>
          </button>
        </div>
      </header>

      {/* TABS NAVIGATION */}
      <nav className="flex px-4 sm:px-8 border-b border-white/5 bg-black/20 overflow-x-auto whitespace-nowrap custom-scrollbar shrink-0">
        {(["DRUM STUDIO", "SYNTH LAB", "SESSION GRID", "SONG MODE", "SOUND EXPLORER", "ROUTING", "WARP ENGINE", "DJ DECKS"] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 sm:px-6 py-3 sm:py-4 text-[10px] font-retro tracking-widest transition-all relative inline-block ${
              activeTab === tab ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {tab}
            {activeTab === tab && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400 shadow-[0_0_10px_#22d3ee]"
              />
            )}
          </button>
        ))}
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative">
        <AnimatePresence mode="wait">
          {activeTab === "DRUM STUDIO" && (
            <motion.div
              key="drum"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-screen-2xl mx-auto"
            >
              <div className="glass rounded-[2rem] border border-cyan-500/20 p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />
                
          {/* Tracks and Grid */}
          <div className="flex overflow-x-auto custom-scrollbar pb-4">
            {/* AI Floating Button */}
            <div className="fixed bottom-12 right-12 flex flex-col gap-3 items-end z-[60]">
              <button 
                onClick={() => {
                  addAsset({
                    name: `DRUM BEAT ${projectAssets.length + 1}`,
                    type: "drum_pattern",
                    data: JSON.parse(JSON.stringify(drumPattern)),
                    metadata: { bpm, kitName: "Current Studio Kit", duration: 4 }
                  });
                  setIsLibraryOpen(true);
                }}
                className="group h-16 px-6 bg-zinc-900 border border-cyan-400/30 rounded-full flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.2)] hover:bg-cyan-400 hover:text-black hover:scale-105 active:scale-95 transition-all overflow-hidden"
                title="Commit Pattern to Library"
              >
                <Music2 size={24} className="mr-2 group-hover:rotate-12 transition-transform" />
                <span className="font-retro text-[10px] tracking-widest hidden group-hover:inline">SAVE TO ASSETS</span>
              </button>
              <button 
                onClick={handleAiDrumPattern}
                disabled={isAiLoading}
                className="w-16 h-16 bg-cyan-400 rounded-full flex items-center justify-center text-black shadow-[0_0_30px_rgba(34,211,238,0.5)] hover:scale-110 active:scale-95 transition-all group"
                title="AI Generate Drum Pattern"
              >
                <Zap size={28} className={isAiLoading ? "animate-spin" : "group-hover:rotate-12 transition-transform"} />
              </button>
            </div>

            {/* Track Labels (Sticky Left for better mobile experience) */}
            <div className="flex flex-col gap-2 sticky left-0 z-10 bg-zinc-950/20 backdrop-blur-sm pr-4 min-w-[200px]">
              <div className="flex items-center justify-center p-2 text-[10px] font-retro text-cyan-400/40 h-10">TRACKS</div>
              {drumLibrary.slice(0, 16).map((drum, rowIndex) => (
                <div 
                  key={drum.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, rowIndex)}
                  onClick={() => {
                    initEngine();
                    engine!.playDrum(drum);
                  }}
                  className={`flex items-center gap-3 bg-zinc-900/60 hover:bg-zinc-800 p-3 rounded-xl cursor-pointer border border-white/5 transition-all group active:scale-95 h-16 ${drum.buffer ? "border-emerald-500/30" : ""}`}
                >
                  <span className="text-xl group-hover:scale-110 transition-transform">{drum.symbol}</span>
                  <div className="overflow-hidden">
                    <p className={`text-[9px] font-retro truncate tracking-tight ${drum.buffer ? "text-emerald-400" : "text-cyan-400"}`}>{drum.name}</p>
                    <p className="text-[8px] font-mono text-slate-500 uppercase">{drum.type}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Steps Grid */}
            <div className="flex flex-col gap-2 min-w-[600px] flex-1">
              <div className="flex gap-2 h-10">
                {Array.from({ length: 16 }).map((_, i) => (
                  <div key={i} className={`flex-1 flex items-center justify-center text-[10px] font-mono ${currentStep === i ? "text-yellow-400 border-b-2 border-yellow-400" : "text-slate-600"}`}>
                    {(i + 1).toString().padStart(2, "0")}
                  </div>
                ))}
              </div>
              {drumLibrary.slice(0, 16).map((drum, rowIndex) => (
                <div key={`row-${rowIndex}`} className="flex gap-2 h-16">
                  {Array.from({ length: 16 }).map((_, stepIndex) => (
                    <button
                      key={stepIndex}
                      onClick={() => handleDrumToggle(rowIndex, stepIndex)}
                      className={`flex-1 min-w-[40px] rounded-lg border flex items-center justify-center transition-all ${
                        drumPattern[rowIndex][stepIndex] 
                          ? "bg-cyan-400 border-cyan-300 shadow-[0_0_8px_#22d3ee] scale-105" 
                          : "bg-zinc-800/40 border-white/5 hover:bg-zinc-800"
                      } ${currentStep === stepIndex ? "ring-1 ring-yellow-400" : ""}`}
                    >
                      {drumPattern[rowIndex][stepIndex] && <div className="w-1.5 h-1.5 rounded-full bg-black/60" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
              </div>
            </motion.div>
          )}

          {activeTab === "SYNTH LAB" && (
            <motion.div
              key="synth"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-screen-2xl mx-auto h-full flex flex-col gap-8"
            >
              <div className="grid grid-cols-12 gap-8">
                {/* Visual Keyboard */}
                <div className="col-span-12 lg:col-span-9 space-y-6">
                  <div className="glass rounded-[2rem] border border-fuchsia-500/20 p-8 shadow-2xl relative">
                    <h2 className="text-[10px] font-retro text-cyan-400 tracking-widest uppercase flex items-center gap-2">
                       <Zap size={14} className="animate-pulse" /> DUAL_ENGINE SYNTH // MELD CORE
                    </h2>
                    
                    <div className="relative h-64 flex justify-center bg-black/40 rounded-2xl p-4 border border-white/5">
                      {/* Piano Implementation */}
                      <div className="flex gap-px relative">
                         {Array.from({length: 24}).map((_, i) => {
                           const midi = 48 + i;
                           const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
                           if (!isBlack) {
                             return (
                               <div 
                                 key={midi}
                                 onPointerDown={() => {
                                   initEngine();
                                   engine!.playNote(midi, synthPreset);
                                 }}
                                 className="key white w-12 h-56 rounded-b-lg border border-slate-400 hover:bg-slate-200 active:bg-cyan-400 flex items-end justify-center pb-2 text-[8px] font-mono"
                               >
                                 {["C","D","E","F","G","A","B"][i % 7]}
                               </div>
                             );
                           }
                           return null;
                         })}
                      </div>
                    </div>
                  </div>
                  
                  {/* Pads */}
                  <div className="grid grid-cols-4 lg:grid-cols-8 gap-4">
                     {Array.from({length: 16}).map((_, i) => (
                       <button
                         key={i}
                         onPointerDown={() => {
                           initEngine();
                           engine!.playNote(48 + i, synthPreset);
                         }}
                         className="aspect-square glass rounded-2xl border border-white/10 hover:border-fuchsia-400/50 transition-all flex flex-col items-center justify-center group active:bg-fuchsia-400/20"
                       >
                         <div className="w-2 h-2 rounded-full bg-fuchsia-500 mb-2 opacity-30 group-hover:opacity-100 transition-opacity" />
                         <span className="text-[8px] font-mono text-slate-500">PAD {i+1}</span>
                       </button>
                     ))}
                  </div>
                </div>

                {/* Preset Controls */}
                <div className="col-span-12 lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-6">
                   <div className="glass rounded-[2rem] border border-cyan-400/20 p-6 bg-cyan-400/5">
                      <h3 className="text-[10px] font-retro text-cyan-400 mb-4 tracking-widest flex items-center gap-2">
                        <Zap size={14} className="animate-pulse" /> AI SOUND ARCHITECT
                      </h3>
                      <div className="space-y-4">
                        <textarea
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          placeholder="Describe the sound... e.g. 'Dark atmospheric pads for techno'"
                          className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-3 text-[10px] font-mono text-cyan-400 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/50 resize-none"
                        />
                        <button
                          onClick={handleAiGenerate}
                          disabled={isAiLoading || !aiPrompt.trim()}
                          className={`w-full py-4 rounded-xl font-retro text-[10px] tracking-widest transition-all mb-3 ${
                            isAiLoading 
                              ? "bg-zinc-800 text-slate-500 animate-pulse" 
                              : "bg-cyan-400 text-black hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                          }`}
                        >
                          {isAiLoading ? "CONSULTING..." : "GENERATE SOUND"}
                        </button>
                         <button
                           onClick={() => {
                             addAsset({
                               name: `SYNTH_${synthPreset.name}_${projectAssets.length + 1}`,
                               type: "synth_preset",
                               data: { ...synthPreset },
                               metadata: { description: "Saved synth sound" }
                             });
                             setIsLibraryOpen(true);
                           }}
                           className="w-full py-4 bg-zinc-900 border border-fuchsia-400/30 rounded-xl font-retro text-[10px] text-fuchsia-400 tracking-widest hover:bg-fuchsia-400 hover:text-black transition-all active:scale-95 flex items-center justify-center gap-2"
                         >
                           <Library size={14} /> SAVE TO ASSETS
                         </button>
                      </div>
                   </div>

                   <div className="glass rounded-[2rem] border border-white/10 p-6">
                      <h3 className="text-[10px] font-retro text-slate-400 mb-4 tracking-tighter">OSCILLATOR PRESETS</h3>
                      <div className="space-y-2 max-h-[300px] lg:max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                         {SYNTH_PRESETS.map((p) => (
                           <button
                             key={p.id}
                             onClick={() => setSynthPreset(p)}
                             className={`w-full text-left p-3 rounded-xl text-[10px] font-mono border transition-all ${
                               synthPreset.id === p.id 
                                ? "bg-fuchsia-400 text-black border-fuchsia-300 shadow-[0_0_15px_rgba(192,38,211,0.3)]" 
                                : "bg-zinc-900 text-slate-400 border-white/5 hover:border-white/20"
                             }`}
                           >
                              {p.name}
                           </button>
                         ))}
                      </div>
                   </div>

                   <div className="glass rounded-[2rem] border border-white/10 p-6">
                      <h3 className="text-[10px] font-retro text-slate-400 mb-6 tracking-tighter uppercase">Signal Matrix</h3>
                      <div className="space-y-6">
                        {["FILTER", "WARP", "REVERB"].map((param) => {
                          const key = param.toLowerCase();
                          return (
                            <div key={param}>
                              <div className="flex justify-between text-[8px] font-mono text-slate-500 uppercase mb-2">
                                <span>{param}</span>
                                <span className="text-cyan-400">{(synthPreset as any)[key]?.toFixed(2) || "0.00"}</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" max="1" step="0.01"
                                value={(synthPreset as any)[key] || 0}
                                onChange={(e) => setSynthPreset({...synthPreset, [key]: parseFloat(e.target.value)})}
                                className="w-full accent-cyan-400 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                              />
                            </div>
                          );
                        })}
                      </div>
                   </div>

                   <div className="glass rounded-[2rem] border border-white/10 p-6">
                      <h3 className="text-[10px] font-retro text-slate-400 mb-6 tracking-tighter">ENVELOPE (ADSR)</h3>
                      <div className="space-y-6">
                        {["attack", "decay", "sustain", "release"].map((param) => (
                          <div key={param}>
                            <div className="flex justify-between text-[8px] font-mono text-slate-500 uppercase mb-2">
                              <span>{param}</span>
                              <span className="text-fuchsia-400">{(synthPreset as any)[param]}s</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="2" step="0.01" 
                              value={(synthPreset as any)[param]}
                              onChange={(e) => setSynthPreset({...synthPreset, [param]: parseFloat(e.target.value)})}
                              className="w-full accent-fuchsia-400 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        ))}
                      </div>
                   </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "WARP ENGINE" && (
            <motion.div
              key="warp-engine"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-screen-2xl mx-auto h-full flex flex-col gap-8"
            >
              <div className="grid grid-cols-12 gap-8 h-full">
                {/* Control Panel */}
                <div className="col-span-12 lg:col-span-4 glass rounded-[3rem] border border-cyan-400/20 p-8 flex flex-col gap-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-[10px] font-retro text-cyan-400 flex items-center gap-2">
                       <Zap size={14} className="animate-pulse" /> BINARY_MATRIX // WARP_BASS
                    </h2>
                    <div className="flex gap-2">
                       <button 
                         onClick={() => {
                            initEngine();
                            if (isWarpEngineActive) {
                              engine!.stopWarpEngine();
                              setIsWarpEngineActive(false);
                            } else {
                              engine!.startWarpEngine(warpSettings, hexMatrix);
                              setIsWarpEngineActive(true);
                            }
                         }}
                         className={`px-4 py-2 rounded-xl text-[8px] font-retro flex items-center gap-2 transition-all ${isWarpEngineActive ? "bg-red-500 text-white" : "bg-cyan-400 text-black hover:scale-105"}`}
                       >
                         {isWarpEngineActive ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                         {isWarpEngineActive ? "STOP ENGINE" : "START ENGINE"}
                       </button>
                       <button 
                         onClick={() => {
                           addAsset({
                             name: `WARP_BASS_${projectAssets.length + 1}`,
                             type: "warped_buffer",
                             data: { matrix: [...hexMatrix], settings: { ...warpSettings } },
                             metadata: { description: "Warp Engine Binary Matrix" }
                           });
                           setIsLibraryOpen(true);
                         }}
                         className="px-4 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-[8px] font-retro hover:bg-amber-500 hover:text-black transition-all active:scale-95 flex items-center gap-2"
                       >
                         <Library size={12} /> COMMIT
                       </button>
                    </div>
                  </div>

                  <div className="bg-black/40 p-4 rounded-3xl border border-white/5 space-y-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[8px] font-retro text-slate-500 uppercase">PRESETS</span>
                      <button 
                        onClick={saveWarpPreset}
                        className="text-[10px] font-retro text-cyan-400 hover:text-white transition-colors"
                      >
                        [ SAVE ]
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                       {warpPresets.map(preset => (
                         <div key={preset.name} className="flex items-center gap-1">
                           <button 
                             onClick={() => loadWarpPreset(preset.name)}
                             className="px-3 py-1 bg-zinc-800/80 rounded-lg border border-white/10 text-[9px] font-mono text-slate-400 hover:bg-cyan-400 hover:text-black transition-all"
                           >
                              {preset.name}
                           </button>
                           {preset.name !== 'INITIAL' && (
                             <button 
                               onClick={() => deleteWarpPreset(preset.name)}
                               className="text-red-500/50 hover:text-red-500 p-1"
                             >
                               <X size={10} />
                             </button>
                           )}
                         </div>
                       ))}
                    </div>
                  </div>

                  <div className="space-y-6 overflow-y-auto pr-2 custom-scrollbar flex-1">
                    {WARP_PARAMS.map((param) => {
                      const mappingsList = Object.values(midiMappings) as MidiMapping[];
                      const mapping = mappingsList.find(m => m.type === 'warp' && m.paramKey === param.key);
                      const isLearning = midiLearnTarget?.type === 'warp' && midiLearnTarget?.paramKey === param.key;
                      
                      return (
                        <div key={param.key} className={`space-y-4 bg-black/20 p-4 rounded-2xl border border-white/5 transition-all ${param.label.startsWith('└') ? 'ml-6 border-cyan-400/10 opacity-80' : ''}`}>
                          <div className="flex justify-between items-center">
                             <div className="flex items-center gap-2">
                               <span className={`text-[9px] font-retro tracking-tighter ${param.label.startsWith('└') ? 'text-cyan-400/60' : 'text-slate-500'}`}>{param.label}</span>
                               <button 
                                 onClick={() => setMidiLearnTarget({ type: 'warp', paramKey: param.key, label: param.label, cc: -1 })}
                                 className={`w-4 h-4 rounded flex items-center justify-center text-[7px] border transition-all ${isLearning ? "bg-red-500 border-red-400 text-white animate-pulse" : mapping ? "bg-cyan-400/20 border-cyan-400 text-cyan-400" : "bg-zinc-800 border-white/10 text-slate-500 hover:border-white/30"}`}
                                 title="MIDI LEARN"
                               >
                                 M
                               </button>
                               {mapping && (
                                 <span className="text-[7px] font-mono text-cyan-400/60 uppercase">CC{(mapping as any).cc}</span>
                               )}
                             </div>
                             <span className="text-[10px] font-mono text-cyan-400 font-bold">
                               {typeof (warpSettings as any)[param.key] === 'number' ? (warpSettings as any)[param.key].toFixed(param.step === 1 ? 0 : 2) : (warpSettings as any)[param.key]}
                               {param.unit}
                             </span>
                          </div>
                          <input 
                            type="range"
                            min={param.min}
                            max={param.max}
                            step={param.step || 1}
                            value={(warpSettings as any)[param.key]}
                            onChange={(e) => {
                              const newSettings = { ...warpSettings, [param.key]: parseFloat(e.target.value) };
                              setWarpSettings(newSettings);
                              if (isWarpEngineActive && engine) {
                                engine.startWarpEngine(newSettings, hexMatrix);
                              }
                            }}
                            className="w-full accent-cyan-400"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* MIDI MONITOR */}
                  <div className="mt-auto pt-4 border-t border-white/5 flex flex-col gap-3">
                    <div className="flex justify-between items-center text-[7px] font-retro text-slate-500 uppercase tracking-widest">
                      <span>MIDI_INPUT_MONITOR</span>
                      <div className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${Object.keys(lastMidiValue).length > 0 ? "bg-cyan-400 animate-ping" : "bg-slate-700"}`} />
                        <span>ACTIVE</span>
                      </div>
                    </div>
                    <div className="bg-black/40 rounded-xl border border-white/5 p-3 flex flex-col gap-1.5">
                      {Object.keys(midiMappings).length === 0 ? (
                        <span className="text-[8px] font-mono text-slate-600 italic">No mappings defined...</span>
                      ) : (
                        <div className="grid grid-cols-1 gap-y-1">
                          {(Object.values(midiMappings) as MidiMapping[]).map(mapping => (
                            <div key={mapping.cc} className="flex justify-between items-center bg-zinc-900/50 px-2 py-1 rounded">
                              <span className="text-[7px] font-mono text-cyan-400/80 truncate w-32 uppercase">{mapping.label}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[7px] font-mono text-slate-500">CC{mapping.cc}</span>
                                <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-cyan-400 transition-all duration-75"
                                    style={{ width: `${(lastMidiValue[mapping.cc] || 0) * 100}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {midiLearnTarget && (
                        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-center animate-pulse">
                          <span className="text-[8px] font-retro text-red-400 uppercase">LEARNING: {midiLearnTarget.label}</span>
                          <p className="text-[6px] font-mono text-slate-500 mt-1 uppercase">Move any knob/slider to assign CC</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Matrix & Visualizers */}
                <div className="col-span-12 lg:col-span-8 flex flex-col gap-8">
                   {/* HEX MATRIX GRID */}
                   <div className="bg-zinc-950 p-8 rounded-[3rem] border border-white/5 shadow-2xl">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-[9px] font-retro text-slate-500 uppercase">WAVEFORM_BINARY_MATRIX</h3>
                        <div className="text-[8px] font-mono text-cyan-500/40">80 SAMPLE POINTS // 16-BIT HEX</div>
                      </div>
                      <div className="grid grid-cols-10 gap-2">
                        {hexMatrix.map((hex, i) => (
                          <div key={i} className="group relative">
                            <input 
                              type="text"
                              value={hex}
                              maxLength={4}
                              onChange={(e) => {
                                const newMatrix = [...hexMatrix];
                                newMatrix[i] = e.target.value.toUpperCase().slice(0, 4);
                                setHexMatrix(newMatrix);
                                if (isWarpEngineActive && engine) {
                                  engine.startWarpEngine(warpSettings, newMatrix);
                                }
                              }}
                              className="w-full bg-black/40 border border-white/5 rounded-md p-2 text-[10px] font-mono text-cyan-400 text-center outline-none focus:border-cyan-400/50 transition-colors"
                            />
                            <div className="absolute -top-1 -left-1 w-2 h-2 bg-cyan-400/20 rounded-full scale-0 group-hover:scale-100 transition-transform" />
                          </div>
                        ))}
                      </div>
                   </div>

                   {/* VISUALIZERS */}
                   <div className="grid grid-cols-2 gap-8 flex-1 min-h-[300px]">
                      <div className="bg-black/60 rounded-[3rem] border border-white/5 p-8 flex flex-col relative overflow-hidden group">
                        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-cyan-400 via-transparent to-transparent pointer-events-none" />
                        <h3 className="text-[8px] font-retro text-slate-500 mb-6 uppercase">TIME_DOMAIN</h3>
                        <canvas id="warpWaveform" className="w-full h-full min-h-[150px] image-rendering-pixelated" />
                      </div>
                      <div className="bg-black/60 rounded-[3rem] border border-white/5 p-8 flex flex-col relative overflow-hidden group">
                        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-fuchsia-400 via-transparent to-transparent pointer-events-none" />
                        <h3 className="text-[8px] font-retro text-slate-500 mb-6 uppercase">FREQUENCY_SPECTRUM</h3>
                        <canvas id="warpSpectrum" className="w-full h-full min-h-[150px] image-rendering-pixelated" />
                      </div>
                   </div>
                </div>
              </div>
            </motion.div>
          )}
          {activeTab === "DJ DECKS" && (
            <motion.div
              key="dj-decks"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="flex-1 flex flex-col h-full overflow-hidden p-4 sm:p-8 bg-[#0b0f14]"
            >
              <div className="flex flex-col lg:flex-row gap-8 h-full overflow-hidden">
                {/* DECK A */}
                <div className="flex-1 glass rounded-[3rem] border border-blue-500/20 p-8 flex flex-col bg-zinc-950/40 relative group">
                  <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-retro text-[10px]">A</div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-retro text-slate-500 uppercase">Deck Alpha</span>
                        <span className="text-xs font-mono text-blue-400 truncate max-w-[150px]">{deckA.trackName}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono text-slate-600">PITCH</span>
                      <span className="text-xs font-mono text-blue-400">{((deckA.pitch - 1) * 100).toFixed(1)}%</span>
                    </div>
                  </div>

                  {/* PLATTER A */}
                  <div className="relative flex-1 flex items-center justify-center py-8">
                    <div className={`w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-zinc-900 border-[10px] border-zinc-950 shadow-2xl relative flex items-center justify-center ${deckA.isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: `${1.8 / deckA.pitch}s`, filter: 'drop-shadow(0 0 30px rgba(59, 130, 246, 0.1))' }}>
                       {/* Grooves */}
                       <div className="absolute inset-4 rounded-full border border-white/5 opacity-40 shadow-[inset_0_0_40px_rgba(0,0,0,0.8)]" />
                       <div className="absolute inset-12 rounded-full border border-white/5 opacity-30" />
                       <div className="absolute inset-20 rounded-full border border-white/5 opacity-20" />
                       
                       {/* Label */}
                       <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center text-zinc-950 font-retro text-xl border-4 border-zinc-950">
                          A
                       </div>
                    </div>
                  </div>

                  <div className="space-y-6 mt-8">
                    {/* Controls A */}
                    <div className="flex items-center justify-center gap-6">
                      <button onClick={() => stopDeck('A')} className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-blue-400 hover:bg-blue-500/10 transition-all">
                        <RotateCcw size={18} />
                      </button>
                      <button 
                        onClick={() => togglePlayDeck('A')}
                        className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all ${deckA.isPlaying ? "bg-zinc-900 text-blue-400 border border-blue-500/40" : "bg-white text-black hover:scale-105"}`}
                      >
                        {deckA.isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                      </button>
                      <button className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-blue-400 opacity-40 cursor-not-allowed">
                         <span className="text-[10px] font-retro">CUE</span>
                      </button>
                    </div>

                    {/* Pitch Slider A */}
                    <div className="space-y-2">
                       <input 
                         type="range" min="0.5" max="1.5" step="0.001" value={deckA.pitch}
                         onChange={(e) => setDeckA(prev => ({ ...prev, pitch: parseFloat(e.target.value) }))}
                         className="w-full accent-blue-500"
                       />
                       <div className="flex justify-between text-[8px] font-mono text-slate-600">
                          <span>-50%</span>
                          <span>CENTER</span>
                          <span>+50%</span>
                       </div>
                    </div>

                    {/* Progress A */}
                    <div className="space-y-2">
                       <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all duration-75" style={{ width: `${(deckA.currentTime / deckA.duration) * 100}%` }} />
                       </div>
                       <div className="flex justify-between text-[10px] font-mono text-slate-500">
                          <span>{Math.floor(deckA.currentTime / 60)}:{(Math.floor(deckA.currentTime % 60)).toString().padStart(2, '0')}</span>
                          <span>{Math.floor(deckA.duration / 60)}:{(Math.floor(deckA.duration % 60)).toString().padStart(2, '0')}</span>
                       </div>
                    </div>
                  </div>
                </div>

                {/* CENTRAL MIXER */}
                <div className="w-full lg:w-48 xl:w-64 glass rounded-[3rem] border border-white/5 p-6 flex flex-col items-center bg-zinc-950/80">
                  <div className="text-[10px] font-retro text-slate-600 mb-8 tracking-[0.4em] uppercase">Pro_Mixer</div>
                  
                  <div className="flex-1 flex flex-col items-center justify-center gap-12 w-full">
                     {/* Master VU Meters */}
                     <div className="flex gap-2 h-48">
                        <div className="w-2 h-full bg-zinc-900 rounded-full relative overflow-hidden">
                           <div className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 transition-all duration-75" style={{ height: `${deckA.isPlaying ? 20 + Math.random() * 60 : 0}%` }} />
                        </div>
                        <div className="w-2 h-full bg-zinc-900 rounded-full relative overflow-hidden">
                           <div className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 transition-all duration-75" style={{ height: `${deckB.isPlaying ? 20 + Math.random() * 60 : 0}%` }} />
                        </div>
                     </div>

                     {/* CRATE DROPDOWN / SELECT */}
                     <div className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 flex flex-col gap-4">
                        <h4 className="text-[8px] font-retro text-slate-500 uppercase text-center">Load_Crate</h4>
                        <div className="max-h-[200px] overflow-y-auto space-y-2 custom-scrollbar">
                           {recordedSounds.length === 0 ? (
                             <div className="text-[10px] font-mono text-slate-700 text-center py-4 uppercase tracking-tighter">No Audio Samples Found</div>
                           ) : (
                             recordedSounds.map(sound => (
                               <div key={sound.id} className="group flex flex-col gap-1 p-2 bg-zinc-900/50 rounded-xl hover:bg-zinc-800 transition-colors">
                                  <span className="text-[9px] font-mono text-cyan-400/80 truncate uppercase">{sound.name}</span>
                                  <div className="flex gap-1">
                                     <button onClick={() => loadToDeck('A', sound)} className="flex-1 bg-blue-500/10 border border-blue-500/20 text-[8px] font-retro text-blue-500 py-1 rounded-md hover:bg-blue-500 hover:text-black transition-all">LOAD A</button>
                                     <button onClick={() => loadToDeck('B', sound)} className="flex-1 bg-red-500/10 border border-red-500/20 text-[8px] font-retro text-red-500 py-1 rounded-md hover:bg-red-500 hover:text-black transition-all">LOAD B</button>
                                  </div>
                               </div>
                             ))
                           )}
                        </div>
                     </div>

                     {/* CROSSFADER */}
                     <div className="w-full space-y-4">
                        <div className="flex justify-between items-center text-[8px] font-retro text-slate-600 px-2">
                           <span>DECK_A</span>
                           <div className="flex items-center gap-2">
                              {(() => {
                                const mappings = Object.values(midiMappings) as MidiMapping[];
                                const mapping = mappings.find(m => m.type === 'dj' && m.paramKey === 'crossfade');
                                return (
                                  <>
                                    <button 
                                      onClick={() => setMidiLearnTarget({ type: 'dj', paramKey: 'crossfade', label: 'CROSSFADER', cc: -1 })}
                                      className={`w-3 h-3 rounded flex items-center justify-center text-[6px] border transition-all ${midiLearnTarget?.paramKey === 'crossfade' ? "bg-red-500 border-red-400 text-white animate-pulse" : mapping ? "bg-cyan-400 text-black border-cyan-400" : "bg-zinc-800 border-white/10 text-slate-500"}`}
                                    >
                                      M
                                    </button>
                                    {mapping && <span className="text-[6px] font-mono text-cyan-400">CC{mapping.cc}</span>}
                                  </>
                                );
                              })()}
                           </div>
                           <span>DECK_B</span>
                        </div>
                        <input 
                           type="range" min="0" max="1" step="0.001" value={crossfade}
                           onChange={(e) => setCrossfade(parseFloat(e.target.value))}
                           className="w-full accent-white h-8"
                        />
                     </div>
                  </div>
                  <div className="mt-8 text-[8px] font-mono text-cyan-500/40">PRO SYNC v2.4</div>
                </div>

                {/* DECK B */}
                <div className="flex-1 glass rounded-[3rem] border border-red-500/20 p-8 flex flex-col bg-zinc-950/40 relative group">
                  <div className="flex justify-between items-center mb-8">
                    <div className="flex flex-col items-start">
                      <span className="text-[10px] font-mono text-slate-600">PITCH</span>
                      <span className="text-xs font-mono text-red-400">{((deckB.pitch - 1) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] font-retro text-slate-500 uppercase">Deck Beta</span>
                        <span className="text-xs font-mono text-red-400 truncate max-w-[150px]">{deckB.trackName}</span>
                      </div>
                      <div className="w-8 h-8 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 font-retro text-[10px]">B</div>
                    </div>
                  </div>

                  {/* PLATTER B */}
                  <div className="relative flex-1 flex items-center justify-center py-8">
                    <div className={`w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-zinc-900 border-[10px] border-zinc-950 shadow-2xl relative flex items-center justify-center ${deckB.isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: `${1.8 / deckB.pitch}s`, filter: 'drop-shadow(0 0 30px rgba(239, 68, 68, 0.1))' }}>
                       <div className="absolute inset-4 rounded-full border border-white/5 opacity-40 shadow-[inset_0_0_40px_rgba(0,0,0,0.8)]" />
                       <div className="absolute inset-12 rounded-full border border-white/5 opacity-30" />
                       <div className="absolute inset-20 rounded-full border border-white/5 opacity-20" />
                       <div className="w-24 h-24 rounded-full bg-red-500 flex items-center justify-center text-zinc-950 font-retro text-xl border-4 border-zinc-950">
                          B
                       </div>
                    </div>
                  </div>

                  <div className="space-y-6 mt-8">
                    <div className="flex items-center justify-center gap-6">
                      <button className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-red-400 opacity-40 cursor-not-allowed">
                         <span className="text-[10px] font-retro">CUE</span>
                      </button>
                      <button 
                        onClick={() => togglePlayDeck('B')}
                        className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all ${deckB.isPlaying ? "bg-zinc-900 text-red-400 border border-red-500/40" : "bg-white text-black hover:scale-105"}`}
                      >
                        {deckB.isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                      </button>
                      <button onClick={() => stopDeck('B')} className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/5 flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-all">
                        <RotateCcw size={18} />
                      </button>
                    </div>

                    <div className="space-y-2">
                       <input 
                         type="range" min="0.5" max="1.5" step="0.001" value={deckB.pitch}
                         onChange={(e) => setDeckB(prev => ({ ...prev, pitch: parseFloat(e.target.value) }))}
                         className="w-full accent-red-500"
                       />
                       <div className="flex justify-between text-[8px] font-mono text-slate-600">
                          <span>-50%</span>
                          <span>CENTER</span>
                          <span>+50%</span>
                       </div>
                    </div>

                    <div className="space-y-2">
                       <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                          <div className="h-full bg-red-500 transition-all duration-75" style={{ width: `${(deckB.currentTime / deckB.duration) * 100}%` }} />
                       </div>
                       <div className="flex justify-between text-[10px] font-mono text-slate-500">
                          <span>{Math.floor(deckB.currentTime / 60)}:{(Math.floor(deckB.currentTime % 60)).toString().padStart(2, '0')}</span>
                          <span>{Math.floor(deckB.duration / 60)}:{(Math.floor(deckB.duration % 60)).toString().padStart(2, '0')}</span>
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "SONG MODE" && (
            <motion.div
              key="arrangement"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-screen-2xl mx-auto h-full flex flex-col gap-4"
            >
              <div className="glass rounded-[3rem] border border-white/5 p-6 bg-zinc-950/60 flex flex-col h-full overflow-hidden">
                {/* TOOLBAR */}
                <div className="flex items-center justify-between mb-6 pb-6 border-b border-white/5">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={toggleArrangementPlay}
                      className={`p-4 rounded-full transition-all ${isArrangementPlaying ? "bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]" : "bg-cyan-400 text-black hover:scale-105"}`}
                    >
                      {isArrangementPlaying ? <Square size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                    </button>
                    <div className="flex flex-col">
                      <span className="text-[8px] font-retro text-slate-500 uppercase tracking-widest">Arrangement</span>
                      <span className="text-[12px] font-mono text-cyan-400">
                        {(() => {
                          const time = arrangementPlayhead * (60 / arrangementBpm);
                          const mins = Math.floor(time / 60);
                          const secs = Math.floor(time % 60);
                          const ms = Math.floor((time % 1) * 100);
                          return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
                        })()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                      <span className="text-[8px] font-retro text-slate-500 uppercase">ZOOM</span>
                      <input 
                        type="range" 
                        min="20" max="200"
                        value={pixelsPerBeat}
                        onChange={(e) => setPixelsPerBeat(parseInt(e.target.value))}
                        className="accent-cyan-400 w-24 scale-y-75"
                      />
                    </div>
                    <div className="h-8 w-px bg-white/10" />
                    <div className="flex items-center gap-3">
                      <span className="text-[8px] font-retro text-slate-500 uppercase">SNAP</span>
                      <select 
                        value={snapValue}
                        onChange={(e) => setSnapValue(parseFloat(e.target.value))}
                        className="bg-black/40 border border-white/10 rounded-lg p-2 text-[10px] text-cyan-400 font-mono outline-none"
                      >
                         <option value="1">1/4</option>
                         <option value="0.5">1/8</option>
                         <option value="0.25">1/16</option>
                         <option value="0.125">1/32</option>
                         <option value="4">BAR</option>
                      </select>
                    </div>
                    <div className="h-8 w-px bg-white/10" />
                    <div className="flex items-center gap-3">
                      <span className="text-[8px] font-retro text-slate-500 uppercase">BPM</span>
                      <input 
                        type="number" 
                        value={arrangementBpm}
                        onChange={(e) => setArrangementBpm(parseInt(e.target.value) || 120)}
                        className="bg-black/40 border border-white/10 rounded-lg p-2 w-16 text-xs text-cyan-400 font-mono text-center outline-none"
                      />
                    </div>
                    <div className="h-8 w-px bg-white/10" />
                    <button 
                      onClick={addSongTrack}
                      className="px-4 py-2 bg-zinc-800 text-slate-300 rounded-xl text-[9px] font-retro border border-white/5 hover:bg-zinc-700 transition-colors flex items-center gap-2"
                    >
                      <Plus size={14} /> ADD TRACK
                    </button>
                    <button 
                      onClick={() => addEngineClipToArrangement(songTracks[0]?.id, 0)}
                      className="px-4 py-2 bg-fuchsia-600/20 text-fuchsia-400 rounded-xl text-[9px] font-retro border border-fuchsia-500/30 hover:bg-fuchsia-600/30 transition-colors flex items-center gap-2"
                    >
                      <Zap size={14} /> +ENGINE
                    </button>
                    <button 
                      onClick={() => addAudioClipToArrangement(songTracks[0]?.id, 0)}
                      className="px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-xl text-[9px] font-retro border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors flex items-center gap-2"
                    >
                      <Mic size={14} /> +AUDIO
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={saveProject} className="p-3 bg-zinc-800 rounded-xl border border-white/5 text-slate-400 hover:text-white" title="Save Project"><Save size={16} /></button>
                    <button onClick={loadProject} className="p-3 bg-zinc-800 rounded-xl border border-white/5 text-slate-400 hover:text-white" title="Load Project"><FolderOpen size={16} /></button>
                  </div>
                </div>

                {/* TIMELINE AREA */}
                <div 
                  className="flex-1 relative bg-black/40 rounded-[2rem] border border-white/5 overflow-auto custom-scrollbar"
                  onWheel={handleTimelineWheel}
                >
                  {/* Ruler Lane */}
                  <div className="h-8 bg-zinc-900 border-b border-white/10 sticky top-0 z-40 flex">
                    <div className="w-48 bg-zinc-900 border-r border-white/10 flex items-center px-4">
                       <span className="text-[8px] font-retro text-slate-500">TIMELINE</span>
                    </div>
                    <div className="flex-1 relative">
                       {Array.from({ length: 512 }).map((_, i) => {
                         const isBar = i % 4 === 0;
                         const showBeat = pixelsPerBeat > 40;
                         return (
                           <div 
                             key={i}
                             className={`absolute top-0 bottom-0 border-l transition-all duration-300 ${isBar ? 'border-white/30 h-full' : 'border-white/10 h-1/2 mt-auto'}`}
                             style={{ left: i * pixelsPerBeat }}
                           >
                              {isBar ? (
                                <span className="text-[7px] font-retro text-cyan-400/80 ml-1 mt-1 block">
                                  {Math.floor(i / 4) + 1}
                                </span>
                              ) : (
                                showBeat && (
                                  <span className="text-[6px] font-mono text-slate-600 ml-1 mt-1 block">
                                    {(i % 4) + 1}
                                  </span>
                                )
                              )}
                           </div>
                         );
                       })}
                    </div>
                  </div>

                  {/* Structure Markers Lane */}
                  <div className="h-6 bg-zinc-950/80 border-b border-white/5 sticky top-8 z-30 flex">
                    <div className="w-48 bg-zinc-900 border-r border-white/10 flex items-center px-4">
                       <span className="text-[8px] font-retro text-amber-400">STRUCTURE</span>
                    </div>
                    <div className="flex-1 relative">
                       {songSections.map((section, idx) => (
                         <div 
                           key={idx}
                           className="absolute top-0 bottom-0 border-l border-amber-500/30 flex items-center px-2"
                           style={{ left: (section.time / (60/arrangementBpm)) * pixelsPerBeat }}
                         >
                            <span className="text-[7px] font-mono text-amber-500 whitespace-nowrap bg-amber-500/10 px-1 rounded">{section.label}</span>
                         </div>
                       ))}
                    </div>
                  </div>

                  {/* GRID BACKGROUND */}
                  <div className="absolute inset-0 pointer-events-none z-0" style={{ 
                    backgroundImage: `
                      linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px),
                      linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px)
                    `,
                    backgroundSize: `${pixelsPerBeat * 4}px 100%, ${pixelsPerBeat}px 100%`,
                    backgroundPositionX: '192px',
                    top: '56px'
                  }} />
                  
                  <div className="min-w-full inline-block">
                    {songTracks.length === 0 ? (
                      <div className="h-64 flex flex-col items-center justify-center opacity-20 gap-4">
                        <Activity size={48} />
                        <p className="font-retro text-[10px] tracking-widest">NO TRACKS INITIALIZED</p>
                      </div>
                    ) : (
                      songTracks.map((track) => (
                        <React.Fragment key={track.id}>
                          <div className="h-28 border-b border-white/5 relative group flex items-center">
                            {/* Track Control */}
                            <div className="sticky left-0 z-20 w-48 h-full bg-zinc-900/90 border-r border-white/10 p-4 flex flex-col justify-between shadow-xl">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] font-retro text-cyan-400 truncate w-32">{track.name}</span>
                                <div className="flex gap-1">
                                  <button 
                                    onClick={() => toggleTrackAutomation(track.id)}
                                    className={`p-1.5 rounded-md transition-colors ${track.isAutomationOpen ? "bg-cyan-400 text-black" : "text-slate-600 hover:text-white"}`}
                                  >
                                    <LineChart size={12} />
                                  </button>
                                  <Settings2 size={12} className="text-slate-600 hover:text-white cursor-pointer mt-1.5" />
                                </div>
                              </div>
                            <div className="space-y-1">
                                <div className="flex justify-between text-[8px] font-mono text-slate-500">
                                  <div className="flex items-center gap-1.5">
                                    <span>VOL</span>
                                    {(() => {
                                      const mappings = Object.values(midiMappings) as MidiMapping[];
                                      const mapping = mappings.find(m => m.type === 'track' && m.targetId === track.id && m.paramKey === 'volume');
                                      return (
                                        <>
                                          <button 
                                            onClick={() => setMidiLearnTarget({ type: 'track', targetId: track.id, paramKey: 'volume', label: `${track.name} VOL`, cc: -1 })}
                                            className={`w-3 h-3 rounded flex items-center justify-center text-[6px] border transition-all ${midiLearnTarget?.targetId === track.id && midiLearnTarget?.paramKey === 'volume' ? "bg-red-500 border-red-400 text-white animate-pulse" : mapping ? "bg-cyan-400 text-black border-cyan-400" : "bg-zinc-800 border-white/10 text-slate-500"}`}
                                          >
                                            M
                                          </button>
                                          {mapping && <span className="text-cyan-400/60 font-mono text-[7px]">CC{mapping.cc}</span>}
                                        </>
                                      );
                                    })()}
                                  </div>
                                  <span>{Math.round(track.volume * 100)}%</span>
                                </div>
                              <input 
                                type="range" 
                                min="0" max="1" step="0.01" 
                                value={track.volume}
                                onChange={(e) => updateTrackVolume(track.id, parseFloat(e.target.value))}
                                className="w-full accent-cyan-400 scale-y-75" 
                              />
                            </div>
                          </div>

                          {/* Clips Container */}
                          <div 
                            className="flex-1 h-full relative overflow-visible cursor-crosshair"
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "copy";
                            }}
                            onDrop={(e) => {
                              const sId = e.dataTransfer.getData("soundId");
                              const assetData = e.dataTransfer.getData("application/json");
                              
                              const rect = e.currentTarget.getBoundingClientRect();
                              const x = e.clientX - rect.left;
                              const beat = x / pixelsPerBeat;

                              if (assetData) {
                                try {
                                  const parsed = JSON.parse(assetData);
                                  if (parsed.assetId) {
                                    addLibraryAssetToArrangement(parsed.assetId, track.id, beat);
                                  }
                                } catch (err) {}
                              } else if (sId) {
                                addAudioClipToArrangement(track.id, beat, sId);
                              }
                            }}
                            onDoubleClick={(e) => {
                              if (e.target === e.currentTarget) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const x = e.clientX - rect.left;
                                const beat = x / pixelsPerBeat;
                                addEngineClipToArrangement(track.id, beat);
                              }
                            }}
                          >
                            {track.clips.map((clip) => (
                              <React.Fragment key={clip.id}>
                                <div
                                  onMouseDown={(e) => {
                                    const startX = e.clientX;
                                    const initialBeat = clip.startBeat;
                                    const onMouseMove = (moveEvent: MouseEvent) => {
                                      const deltaX = moveEvent.clientX - startX;
                                      const deltaBeats = deltaX / pixelsPerBeat;
                                      updateClipPosition(track.id, clip.id, initialBeat + deltaBeats);
                                    };
                                    const onMouseUp = () => {
                                      window.removeEventListener("mousemove", onMouseMove);
                                      window.removeEventListener("mouseup", onMouseUp);
                                    };
                                    window.addEventListener("mousemove", onMouseMove);
                                    window.addEventListener("mouseup", onMouseUp);
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    removeSongClip(track.id, clip.id);
                                  }}
                                  className={`absolute top-4 bottom-4 rounded-xl border flex items-center justify-center cursor-grab active:cursor-grabbing select-none overflow-hidden group/clip ${
                                    clip.type === "audio" 
                                    ? "bg-emerald-500 border-emerald-400/50" 
                                    : "bg-fuchsia-500 border-fuchsia-400/50"
                                  } shadow-lg shadow-black/40`}
                                  style={{ 
                                    left: clip.startBeat * pixelsPerBeat, 
                                    width: clip.durationBeats * pixelsPerBeat 
                                  }}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeSongClip(track.id, clip.id);
                                    }}
                                    className="absolute top-1 right-1 w-5 h-5 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover/clip:opacity-100 transition-opacity z-20"
                                  >
                                    <X size={10} className="text-white" />
                                  </button>
                                  <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-50" />
                                  <div className="absolute inset-x-0 bottom-0 top-1/2 bg-black/20" />
                                  <span className="text-[9px] font-retro text-white drop-shadow-md z-10 p-2 truncate">
                                    {clip.type === "audio" ? (recordedSounds.find(s => s.id === clip.data)?.name || "AUDIO") : "WARP"}
                                  </span>
                                  
                                  {/* Resize Handle Right */}
                                  <div 
                                    className="absolute top-0 right-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/20 transition-colors z-30 flex items-center justify-center"
                                    onMouseDown={(e) => {
                                      e.stopPropagation();
                                      const startX = e.clientX;
                                      const initialDuration = clip.durationBeats;
                                      const onMouseMove = (moveEvent: MouseEvent) => {
                                        const deltaX = moveEvent.clientX - startX;
                                        const deltaBeats = deltaX / pixelsPerBeat;
                                        updateClipDuration(track.id, clip.id, initialDuration + deltaBeats);
                                      };
                                      const onMouseUp = () => {
                                        window.removeEventListener("mousemove", onMouseMove);
                                        window.removeEventListener("mouseup", onMouseUp);
                                      };
                                      window.addEventListener("mousemove", onMouseMove);
                                      window.addEventListener("mouseup", onMouseUp);
                                    }}
                                  >
                                     <div className="w-1 h-8 bg-white/20 rounded-full" />
                                  </div>

                                  {clip.type === "warp" ? <Zap size={10} className="absolute right-4 top-2 text-white/50" /> : <Mic size={10} className="absolute right-4 top-2 text-white/50" />}
                                </div>
                              </React.Fragment>
                            ))}

                          </div>
                        </div>

                        {/* AUTOMATION LANE */}
                        <AnimatePresence>
                          {track.isAutomationOpen && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 80, opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="border-b border-white/5 relative flex overflow-hidden bg-black/20"
                            >
                              <div className="sticky left-0 z-20 w-48 h-full bg-zinc-950/40 border-r border-white/10 p-3 flex flex-col justify-between">
                                <select 
                                  className="bg-black/60 border border-white/10 rounded-md p-1.5 text-[8px] text-cyan-400 font-retro outline-none"
                                  value={track.selectedAutomationParam}
                                  onChange={(e) => setTrackAutomationParam(track.id, e.target.value)}
                                >
                                  <option value="volume">VOLUME</option>
                                  <option value="cutoff">CUTOFF (ENGINE)</option>
                                </select>
                                <span className="text-[7px] font-mono text-slate-600 uppercase tracking-widest text-center">Click to add points</span>
                              </div>
                              <div className="flex-1 h-full relative">
                                <AutomationCanvas 
                                  points={track.automation?.[track.selectedAutomationParam || 'volume'] || []}
                                  pixelsPerBeat={pixelsPerBeat}
                                  onAddPoint={(beat, val) => addAutomationPointToTrack(track.id, track.selectedAutomationParam || 'volume', beat, val)}
                                  onRemovePoint={(idx) => removeAutomationPointFromTrack(track.id, track.selectedAutomationParam || 'volume', idx)}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    ))
                    )}
                    
                    {/* GLOBAL PLAYHEAD */}
                    {isArrangementPlaying && (
                      <div 
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)] z-50 pointer-events-none"
                        style={{ left: (arrangementPlayhead * pixelsPerBeat) + 192 }} // 192 is track header width (48px * 4?) wait, w-48 is 12rem = 192px
                      />
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "SOUND EXPLORER" && (
            <motion.div
              key="explorer"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-screen-xl mx-auto h-full"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
                {/* Sampling Station */}
                <div className="glass rounded-[3rem] border border-emerald-500/20 p-12 flex flex-col items-center justify-center text-center">
                  <div className="w-32 h-32 bg-emerald-500/10 rounded-full flex items-center justify-center mb-8 border-4 border-dashed border-emerald-500/30">
                    <Mic size={48} className={`text-emerald-500 ${isRecording ? "animate-pulse" : ""}`} />
                  </div>
                  <h2 className="font-retro text-xl text-emerald-400 mb-4">REAL-WORLD CAPTURE</h2>
                  <p className="text-slate-400 text-sm max-w-xs mb-10 leading-relaxed font-mono uppercase tracking-tighter">
                    Status: <span className={isRecording ? "text-red-500" : "text-emerald-400"}>{recordingStatus}</span>
                  </p>
                  <button 
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={stopRecording}
                    className={`px-12 py-5 font-retro text-[10px] rounded-2xl transition-all flex items-center gap-3 ${
                      isRecording 
                        ? "bg-red-500 text-white shadow-[0_0_30px_#ef4444] scale-95" 
                        : "bg-emerald-500 text-black shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:scale-105"
                    }`}
                  >
                    {isRecording ? "RELEASE TO SAVE" : "HOLD TO RECORD"}
                  </button>
                </div>

                {/* Library/Warping */}
                <div className="flex flex-col gap-6">
                  <div className="flex-1 glass rounded-[2.5rem] border border-white/5 p-8 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="font-retro text-[10px] text-slate-400 tracking-widest">RECORDED SAMPLES</h3>
                      <button 
                        onClick={handleWarpAll}
                        className="text-emerald-400 text-[8px] font-retro flex items-center gap-2 hover:underline"
                      >
                        <Wand2 size={12} /> WARP ALL
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto pr-2 custom-scrollbar">
                      {recordedSounds.length === 0 ? (
                        <div className="col-span-full py-12 flex flex-col items-center opacity-20">
                           <Volume2 size={48} />
                           <p className="text-[8px] font-retro mt-4 text-center">NO SAMPLES FOUND<br/>RECORD SOMETHING!</p>
                        </div>
                      ) : (
                        recordedSounds.map((sound) => (
                          <div 
                            key={sound.id} 
                            draggable
                            onDragStart={(e) => handleDragStart(e, sound)}
                            onClick={() => {
                               initEngine();
                               const source = engine!.ctx.createBufferSource();
                               source.buffer = sound.buffer;
                               source.connect(engine!.masterGain);
                               source.start();
                            }}
                            className="bg-zinc-900/80 rounded-2xl p-4 border border-white/5 flex items-center gap-4 group cursor-grab active:cursor-grabbing hover:border-emerald-500/30 transition-all hover:bg-zinc-800"
                          >
                            <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
                              {sound.emoji}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-mono text-emerald-400 truncate uppercase">{sound.name}</p>
                              <p className="text-[8px] font-mono text-slate-500 uppercase">{sound.buffer.duration.toFixed(1)}s • {sound.buffer.sampleRate/1000}kHz</p>
                            </div>
                            <div className="flex flex-col gap-2 items-end">
                              <div className="flex gap-2">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAssigningSound(sound);
                                  }}
                                  className="p-2 hover:bg-emerald-500/20 rounded-lg group/btn"
                                  title="Assign to Track"
                                >
                                   <Plus size={16} className="text-emerald-500 group-hover/btn:scale-125 transition-transform" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSplitSample(sound);
                                  }}
                                  className="p-2 hover:bg-cyan-500/20 rounded-lg group/btn flex items-center gap-2"
                                  title="HPSS Split: Harmonic + Percussive"
                                >
                                  <motion.div
                                    whileHover={{ rotate: 180 }}
                                    transition={{ duration: 0.5 }}
                                  >
                                    <Layers size={16} className="text-cyan-400" />
                                  </motion.div>
                                  <span className="hidden xl:inline text-[8px] font-retro text-cyan-400">HPSS SPLIT</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    loadToDeck('A', sound);
                                    setActiveTab("DJ DECKS");
                                  }}
                                  className="p-2 hover:bg-blue-500/20 rounded-lg group/btn flex items-center gap-1"
                                  title="Load to DJ Deck A"
                                >
                                  <Music2 size={14} className="text-blue-400" />
                                  <span className="text-[8px] font-retro text-blue-400">LOAD A</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    loadToDeck('B', sound);
                                    setActiveTab("DJ DECKS");
                                  }}
                                  className="p-2 hover:bg-red-500/20 rounded-lg group/btn flex items-center gap-1"
                                  title="Load to DJ Deck B"
                                >
                                  <Music2 size={14} className="text-red-400" />
                                  <span className="text-[8px] font-retro text-red-400">LOAD B</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeepSplit(sound);
                                  }}
                                  disabled={isSplitting}
                                  className="p-2 hover:bg-fuchsia-500/20 rounded-lg group/btn flex items-center gap-2"
                                  title="Deep Multi-class Split (Drums/Bass/Vocals)"
                                >
                                  <motion.div
                                    animate={isSplitting ? { rotate: 360 } : {}}
                                    transition={isSplitting ? { repeat: Infinity, duration: 1, ease: "linear" } : { duration: 0.5 }}
                                  >
                                    <Wand2 size={16} className="text-fuchsia-400" />
                                  </motion.div>
                                  <span className="hidden xl:inline text-[8px] font-retro text-fuchsia-400">DEEP SPLIT</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    injectToWarpEngine(sound);
                                  }}
                                  className="p-2 hover:bg-orange-500/20 rounded-lg group/btn flex items-center gap-2"
                                  title="Inject into Binary Matrix"
                                >
                                  <Zap size={16} className="text-orange-400" />
                                  <span className="hidden xl:inline text-[8px] font-retro text-orange-400">WARP ENGINE</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    analyzeStructure(sound);
                                  }}
                                  className="p-2 hover:bg-amber-500/20 rounded-lg group/btn flex items-center gap-2"
                                  title="Analyze Song Structure"
                                >
                                  <Activity size={16} className="text-amber-400" />
                                  <span className="hidden xl:inline text-[8px] font-retro text-amber-400">ANALYZE</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                      {/* Track Assignment Modal */}
                      <AnimatePresence>
                        {assigningSound && (
                          <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                          >
                            <motion.div 
                              initial={{ scale: 0.9, y: 20 }}
                              animate={{ scale: 1, y: 0 }}
                              exit={{ scale: 0.9, y: 20 }}
                              className="bg-zinc-900 border border-white/10 p-6 rounded-[2rem] max-w-md w-full shadow-2xl"
                            >
                              <h3 className="font-retro text-xs text-emerald-400 mb-2 uppercase tracking-widest">ASSIGN TO TRACK</h3>
                              <p className="text-[10px] text-slate-500 font-mono mb-6">SELECT A DESTINATION FOR {assigningSound.name}</p>
                              
                              <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                                {drumLibrary.slice(0, 16).map((drum, i) => (
                                  <button
                                    key={drum.id}
                                    onClick={() => assignSoundToTrack(assigningSound, i)}
                                    className="flex items-center gap-3 p-3 bg-white/5 hover:bg-emerald-500/20 rounded-xl border border-white/5 transition-all text-left group"
                                  >
                                    <span className="text-lg grayscale group-hover:grayscale-0">{drum.symbol}</span>
                                    <span className="text-[9px] font-retro text-slate-300 group-hover:text-white truncate">TRK {i+1}</span>
                                  </button>
                                ))}
                              </div>
                              
                              <button 
                                onClick={() => setAssigningSound(null)}
                                className="w-full mt-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[10px] font-retro text-slate-400"
                              >
                                CANCEL
                              </button>
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                  </div>

                  <div className="glass rounded-[2rem] border border-amber-500/20 p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <Settings2 size={16} className="text-amber-500" />
                      <h3 className="font-retro text-[10px] text-amber-500 tracking-tighter">SPECTRAL TRANSFORM</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                      {["Grain Size", "Density", "Spread", "Harmonics"].map(label => (
                        <div key={label}>
                          <div className="flex justify-between text-[8px] font-mono text-slate-500 uppercase mb-2">
                            <span>{label}</span>
                            <span className="text-amber-400">50%</span>
                          </div>
                          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="w-1/2 h-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "SESSION GRID" && (
            <motion.div
              key="session"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-screen-2xl mx-auto h-full flex flex-col"
            >
              <div className="flex-1 glass rounded-[3rem] border border-white/5 p-8 bg-zinc-950/60 overflow-hidden flex flex-col min-h-[600px]">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex gap-4 items-center">
                    <h2 className="text-[10px] font-retro text-cyan-400 tracking-tighter">LIVE SESSION CLIP GRID</h2>
                    <div className="px-3 py-1 bg-cyan-400/10 rounded-full border border-cyan-400/20 text-[9px] font-mono text-cyan-400 animate-pulse">
                      QUANTIZED: 1 BAR
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button 
                      onClick={addScene}
                      className="px-6 py-2 bg-zinc-800 rounded-full text-[8px] font-retro text-slate-400 hover:text-white transition-colors border border-white/5 active:scale-95"
                    >
                      NEW SCENE
                    </button>
                    <button 
                      onClick={() => launchScene(0)}
                      className="px-6 py-2 bg-fuchsia-500 rounded-full text-[10px] font-retro text-black shadow-[0_0_20px_rgba(217,70,239,0.4)] hover:scale-105 active:scale-95 transition-transform"
                    >
                      LAUNCH SCENE 1
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-x-auto custom-scrollbar">
                   <div className="inline-flex gap-4 pb-4 h-full">
                      {Array.from({length: 8}).map((_, trackIdx) => (
                        <div key={trackIdx} className="w-56 flex flex-col gap-3">
                           {/* Track Header */}
                           <div className="h-20 bg-zinc-900/80 rounded-2xl border border-white/10 p-4 flex flex-col justify-center group hover:bg-zinc-800 transition-colors">
                              <div className="flex justify-between items-start">
                                <p className="text-[10px] font-retro text-slate-500 uppercase">TK {trackIdx + 1}</p>
                                <Activity size={12} className="text-cyan-400/20 group-hover:text-cyan-400 transition-colors" />
                              </div>
                              <p className="text-[8px] font-mono text-cyan-400/60 mt-1 uppercase truncate font-bold">
                                {trackIdx < 2 ? "PERCUSSIVE_CORE" : trackIdx < 4 ? "HARMONIC_MELD" : "SIGNAL_PROC"}
                              </p>
                           </div>

                           {/* Slotted Clips */}
                           {sessionClips[trackIdx].map((_, sceneIdx) => {
                             const clip = sessionClips[trackIdx][sceneIdx];
                             const isActive = activeSessionClips[trackIdx] === sceneIdx;
                             
                             return (
                               <button
                                 key={sceneIdx}
                                 onClick={() => {
                                   const newActive = [...activeSessionClips];
                                   newActive[trackIdx] = sceneIdx;
                                   setActiveSessionClips(newActive);
                                 }}
                                 className={`h-28 rounded-2xl border transition-all flex flex-col p-4 relative group ${
                                   clip 
                                    ? (isActive 
                                       ? "bg-emerald-500 border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.5)] animate-pulse" 
                                       : "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20")
                                    : "bg-zinc-900/40 border-white/5 hover:border-emerald-500/20 active:bg-emerald-500/5 transition-colors"
                                 }`}
                               >
                                  <div className="flex items-center justify-between w-full h-4">
                                    <div className={`w-3 h-3 rounded-sm ${clip ? (isActive ? "bg-white" : "bg-emerald-400") : "bg-zinc-800"}`} />
                                    <div className="flex gap-px">
                                      {[1,2,3,4].map(b => (
                                        <div key={b} className={`w-1 h-3 rounded-full ${isActive ? "bg-white/40" : "bg-slate-800"}`} />
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex-1" />
                                  <div className="flex flex-col items-start gap-1">
                                    <p className={`text-[9px] font-retro uppercase tracking-tighter ${isActive ? "text-white" : clip ? "text-emerald-400" : "text-slate-700 opacity-60"}`}>
                                      {clip ? clip.name : `CLIP ${sceneIdx + 1}`}
                                    </p>
                                    {clip && <p className={`text-[7px] font-mono ${isActive ? "text-white/60" : "text-emerald-500/40"}`}>128BPM • 4 BARS</p>}
                                  </div>
                                  {isActive && (
                                    <div className="absolute right-3 bottom-4 text-white">
                                      <Play size={12} fill="currentColor" />
                                    </div>
                                  )}
                               </button>
                             );
                           })}

                           {/* Track Mixer Strip */}
                           <div className="mt-8 flex flex-col gap-4 items-center p-4 bg-black/40 rounded-3xl border border-white/5">
                              <div className="w-16 h-48 bg-zinc-950 rounded-full flex flex-col p-1 relative items-center justify-end overflow-hidden group">
                                 <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/20 via-transparent to-transparent opacity-40" />
                                 {/* Volume Meter Fader */}
                                 <motion.div 
                                   className="w-full bg-cyan-400/80 rounded-full"
                                   initial={{ height: "60%" }}
                                   animate={{ height: isPlaying ? ["60%", "65%", "58%", "70%", "62%"] : "60%" }}
                                   transition={{ repeat: Infinity, duration: 0.5 }}
                                 />
                                 <div className="absolute top-1/4 w-full h-px bg-white/20" />
                                 <div className="absolute top-1/2 w-full h-px bg-white/20" />
                                 <div className="absolute top-3/4 w-full h-px bg-white/20" />
                                 
                                 <div className="absolute bottom-1/3 w-10 h-10 bg-white/10 rounded-full border border-white/20 backdrop-blur-md cursor-ns-resize shadow-xl flex items-center justify-center">
                                    <div className="w-6 h-[2px] bg-white/60" />
                                    <input 
                                      type="range" 
                                      min="0" max="1.5" step="0.01"
                                      className="absolute inset-0 opacity-0 cursor-ns-resize"
                                      onChange={(e) => {
                                        initEngine();
                                        engine!.masterGain.gain.setTargetAtTime(parseFloat(e.target.value), engine!.ctx.currentTime, 0.05);
                                      }}
                                    />
                                 </div>
                              </div>
                              <span className="text-[8px] font-retro text-slate-500">LEVEL</span>
                           </div>
                        </div>
                      ))}
                      
                      {/* Master Output Panel */}
                      <div className="w-24 bg-zinc-900 rounded-[3rem] border border-cyan-400/20 flex flex-col items-center py-8 gap-4 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                         <div className="text-[9px] font-retro text-cyan-400 rotate-90 my-10 tracking-[0.4em] neon-cyan">MASTER</div>
                         <div className="flex-1 flex flex-col gap-3">
                            {Array.from({length: 8}).map((_, i) => (
                              <button 
                                key={i}
                                className="w-14 h-14 bg-zinc-950 rounded-2xl border border-white/5 flex items-center justify-center hover:bg-zinc-800 transition-all hover:scale-105 active:scale-95 group"
                              >
                                <Play size={18} className="text-slate-600 group-hover:text-cyan-400 transition-colors" />
                              </button>
                            ))}
                         </div>
                         <div className="w-12 h-32 bg-black rounded-full border border-white/10 p-1 flex flex-col justify-end">
                            <div className="h-3/4 w-full bg-cyan-400 rounded-full" />
                         </div>
                      </div>
                   </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "ROUTING" && (
            <motion.div
              key="routing"
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              className="max-w-screen-2xl mx-auto h-full"
            >
              <div className="grid grid-cols-12 gap-8">
                <div className="col-span-12 lg:col-span-4 bg-zinc-900/40 rounded-[2.5rem] border border-white/5 p-8 shadow-inner overflow-y-auto max-h-[70vh]">
                  <h3 className="font-retro text-[10px] text-slate-400 mb-8 uppercase tracking-widest flex items-center gap-2">
                    <Layers size={14} className="text-cyan-400" /> Available Processors
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {["DELAY", "DISTORTION", "BITCRUSHER"].map(fx => (
                      <div key={fx} className="flex items-center justify-between bg-black/60 p-5 rounded-2xl border border-white/5 cursor-grab hover:border-cyan-400/30 transition-all group">
                         <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center opacity-40 group-hover:opacity-100 transition-opacity">
                               <Settings2 size={18} className="text-cyan-400" />
                            </div>
                            <span className="text-[10px] font-retro text-slate-300 tracking-tighter">{fx}</span>
                         </div>
                         <div className="flex items-center gap-2">
                            <Zap size={12} className="text-slate-600 group-hover:text-amber-400" />
                            <Plus 
                              size={14} 
                              className="text-slate-600 group-hover:text-cyan-400 transition-colors cursor-pointer" 
                              onClick={() => addFXToChain(fx)}
                            />
                         </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-8 space-y-8">
                   <div className="glass rounded-[3rem] border border-cyan-500/10 p-10 min-h-[500px] flex flex-col">
                      <div className="flex items-center justify-between mb-10">
                         <h2 className="font-retro text-sm text-cyan-400 flex items-center gap-4">
                            <Activity className="neon-cyan" /> MODULAR SIGNAL CHAIN
                         </h2>
                         <div className="flex gap-4">
                            <button className="text-[10px] font-retro text-cyan-400/60 hover:text-cyan-400 underline transition-colors">DRY/WET</button>
                            <button 
                              onClick={clearRoutingChain}
                              className="text-[10px] font-retro text-red-400/60 hover:text-red-400 underline transition-colors"
                            >
                              CLEAR CHAIN
                            </button>
                         </div>
                      </div>

                      <div className="flex-1 flex flex-wrap gap-6 items-center justify-center content-center relative">
                         <div className="w-32 h-32 bg-emerald-500/10 rounded-2xl border-2 border-dashed border-emerald-500/20 flex flex-col items-center justify-center gap-2 group hover:border-emerald-500/40 transition-colors">
                            <Volume2 className="text-emerald-500/50 group-hover:scale-110 transition-transform" />
                            <span className="font-retro text-[8px] text-emerald-500/50">INPUT</span>
                         </div>
                         
                         {routingChain.map((fx, i) => (
                            <React.Fragment key={i}>
                              <ChevronRight className="text-slate-700 animate-pulse" />
                              <div className="w-32 h-32 bg-cyan-400/20 rounded-3xl border border-cyan-400/40 flex flex-col items-center justify-center text-cyan-400 font-retro text-[8px] tracking-[0.2em] relative group">
                                <Activity size={20} className="mb-2" />
                                <span>{fx}</span>
                                <div className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white scale-0 group-hover:scale-100 transition-transform cursor-pointer" onClick={() => {
                                  const nc = routingChain.filter((_, idx) => idx !== i);
                                  setRoutingChain(nc);
                                  engine?.updateRouting(nc);
                                }}>
                                  <Trash2 size={12} />
                                </div>
                              </div>
                            </React.Fragment>
                         ))}

                         {routingChain.length < 4 && (
                           <>
                             <ChevronRight className="text-slate-700 opacity-20" />
                             <div className="w-32 h-32 bg-white/5 rounded-3xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center text-slate-700 font-retro text-[8px] tracking-[0.2em]">
                               <span>SLOT {routingChain.length + 1}</span>
                             </div>
                           </>
                         )}

                         <ChevronRight className="text-slate-700" />
                         <div className="w-32 h-32 bg-cyan-400/10 rounded-2xl border-2 border-dashed border-cyan-400/20 flex flex-col items-center justify-center gap-2 group hover:border-cyan-400/40 transition-colors">
                            <Activity className="text-cyan-400/50 group-hover:scale-110 transition-transform" />
                            <span className="font-retro text-[8px] text-cyan-400/50">MASTER</span>
                         </div>

                         {/* Routing Cables (SVG Overlay Mockup) */}
                         <svg className="absolute inset-0 pointer-events-none w-full h-full opacity-10">
                            <path d="M 128 250 Q 256 300 384 250" stroke="#22d3ee" fill="none" strokeWidth="2" strokeDasharray="4 4" />
                         </svg>
                      </div>

                      <div className="mt-12 bg-black/40 p-6 rounded-3xl border border-white/5">
                         <div className="flex justify-between items-center mb-4">
                            <span className="text-[8px] font-retro text-slate-500 tracking-widest uppercase">Latency Compensation</span>
                            <span className="text-[10px] font-mono text-cyan-400">12.4ms</span>
                         </div>
                         <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: "0%" }}
                              animate={{ width: "30%" }}
                              className="h-full bg-cyan-400" 
                            />
                         </div>
                      </div>
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* FOOTER STATUS BAR */}
      <footer className="px-8 py-3 border-t border-white/5 bg-black/60 flex items-center justify-between text-[8px] font-mono text-slate-500 tracking-widest uppercase">
        <div className="flex gap-8">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
            <span>Engines: OPTIMIZED</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isPlaying ? "bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" : "bg-slate-700"}`} />
            <span>Clock: {isPlaying ? "BIT-PERFECT" : "STATIONARY"}</span>
          </div>
          <div className="flex items-center gap-4 bg-zinc-900/50 px-3 py-1 rounded-full border border-white/5">
            <Activity size={10} className="text-cyan-400" />
            <div className="flex gap-0.5 items-end h-3">
               {[0.3, 0.7, 0.5, 0.9, 0.4, 0.8, 0.6, 0.2].map((h, i) => (
                 <motion.div 
                   key={i}
                   animate={{ height: isPlaying ? [h*100 + "%", (1-h)*100 + "%", h*100 + "%"] : h*100 + "%" }}
                   transition={{ duration: 0.5, repeat: Infinity }}
                   className="w-1 bg-cyan-500/60 rounded-t-sm" 
                 />
               ))}
            </div>
            <span>MASTER L/R</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-fuchsia-400/60">
             <Layers size={10} />
             <span>8 VOICES ACTIVE</span>
          </div>
          <div className="flex items-center gap-2">
            <Download size={10} />
            <span>8.4 MB PROJECT SIZE</span>
          </div>
        </div>
      </footer>
      <audio ref={audioDeckARef} style={{ display: 'none' }} loop />
      <audio ref={audioDeckBRef} style={{ display: 'none' }} loop />

      {/* PROJECT ASSETS SIDEBAR/DRAWER */}
      <AnimatePresence>
        {isLibraryOpen && (
           <motion.aside
             initial={{ x: "100%" }}
             animate={{ x: 0 }}
             exit={{ x: "100%" }}
             transition={{ type: "spring", damping: 25, stiffness: 200 }}
             className="fixed top-0 right-0 bottom-0 w-80 sm:w-96 bg-zinc-950/95 border-l border-white/10 shadow-[-20px_0_40px_rgba(0,0,0,0.8)] z-[100] flex flex-col backdrop-blur-xl"
           >
             <div className="p-6 border-b border-white/10 flex items-center justify-between bg-black/40">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-cyan-400 rounded-lg flex items-center justify-center text-black shadow-[0_0_15px_rgba(34,211,238,0.5)]">
                    <Library size={18} />
                  </div>
                  <div>
                    <h2 className="text-[10px] font-retro text-white tracking-widest uppercase">Project Assets</h2>
                    <p className="text-[7px] font-mono text-cyan-400/60 uppercase">Local Repository</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsLibraryOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white"
                >
                  <ChevronRight size={20} />
                </button>
             </div>

             <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {projectAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-20 gap-4 text-center p-12">
                    <Music size={40} />
                    <p className="text-[9px] font-retro tracking-widest uppercase leading-loose italic">No assets committed.<br/>Build something in the studios and save it to your library.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {projectAssets.map(asset => (
                      <div 
                        key={asset.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/json", JSON.stringify({
                            assetId: asset.id,
                            type: asset.type
                          }));
                        }}
                        className="p-4 bg-zinc-900/60 rounded-2xl border border-white/5 hover:border-cyan-400/30 transition-all group flex items-start gap-4 cursor-grab active:cursor-grabbing hover:bg-zinc-800"
                      >
                         <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                           asset.type === 'drum_pattern' ? 'bg-amber-500/10 text-amber-500' :
                           asset.type === 'synth_preset' ? 'bg-fuchsia-500/10 text-fuchsia-500' :
                           'bg-cyan-500/10 text-cyan-500'
                         }`}>
                           {asset.type === 'drum_pattern' ? <Drum size={24} /> : 
                            asset.type === 'synth_preset' ? <Zap size={24} /> :
                            asset.type === 'warped_buffer' ? <Activity size={24} /> :
                            <Music size={24} />}
                         </div>
                         <div className="flex-1 min-w-0">
                            <h4 className="text-[10px] font-retro text-slate-200 truncate uppercase mb-1">{asset.name}</h4>
                            <div className="flex flex-wrap gap-2">
                               <span className="text-[7px] font-mono bg-black/40 px-1.5 py-0.5 rounded text-white/40 uppercase border border-white/5">{asset.type.replace('_', ' ')}</span>
                               {asset.metadata.bpm && <span className="text-[7px] font-mono text-cyan-400">{asset.metadata.bpm} BPM</span>}
                            </div>
                         </div>
                         <button 
                           onClick={() => setProjectAssets(prev => prev.filter(a => a.id !== asset.id))}
                           className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                         >
                           <Trash2 size={12} />
                         </button>
                      </div>
                    ))}
                  </div>
                )}
             </div>

             <div className="p-6 border-t border-white/10 bg-black/40">
                <button 
                  onClick={() => {
                    const data = JSON.stringify(projectAssets);
                    const blob = new Blob([data], {type: 'application/json'});
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `project-assets-${new Date().toISOString().split('T')[0]}.json`;
                    link.click();
                  }}
                  className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[9px] font-retro text-slate-300 border border-white/5 transition-all flex items-center justify-center gap-2"
                >
                  <Download size={14} /> EXPORT LIBRARY
                </button>
             </div>
           </motion.aside>
        )}
      </AnimatePresence>

      {/* FLOATING LIBRARY TOGGLE */}
      {!isLibraryOpen && (
        <button 
          onClick={() => setIsLibraryOpen(true)}
          className="fixed top-1/2 -right-0.5 transform -translate-y-1/2 bg-zinc-900 border border-white/10 border-r-0 py-6 px-1.5 rounded-l-2xl shadow-2xl hover:bg-cyan-500 hover:text-black transition-all z-[90] flex flex-col items-center gap-2 group"
        >
          <div className="rotate-90 origin-center whitespace-nowrap text-[8px] font-retro tracking-[0.3em] ml-1 opacity-40 group-hover:opacity-100">LIBRARY</div>
          <Library size={16} className="text-cyan-400 group-hover:text-black" />
        </button>
      )}

    </div>
  );
}
