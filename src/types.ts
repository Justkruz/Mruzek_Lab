/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface DrumType {
  id: number;
  name: string;
  symbol: string;
  freq?: number;
  decay?: number;
  noise?: number;
  type: string;
  buffer?: AudioBuffer;
}

export interface AutomationPoint {
  time: number; // In PPQ (Parts Per Quarter Note)
  value: number; // 0.0 to 1.0
}

export interface SynthPreset {
  id: number;
  name: string;
  // Oscillator A
  waveA: OscillatorType | "noise";
  detuneA: number;
  panA: number;
  // Oscillator B
  waveB: OscillatorType | "noise";
  detuneB: number;
  panB: number;
  
  // Mix & Filter
  mix: number; // Balance between A and B
  filter: number;
  resonance: number;
  
  // Envelope
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  
  // Effects
  reverb: number;
  delay: number;
  warp?: number;
}

export interface MusicClip {
  id: string;
  name: string;
  color: string;
  type: "MIDI" | "DRUM";
  active: boolean;
  data: any; // Pattern indices or MIDI notes
  automation: {
    [param: string]: AutomationPoint[];
  };
}

export interface RecordedSound {
  id: string;
  name: string;
  buffer: AudioBuffer;
  url?: string;
  emoji: string;
  timestamp: number;
  params: {
    pitch: number;
    speed: number;
    filter: number;
    reverb: number;
  };
}

export interface SongSection {
  id: string;
  type: "Drum Pattern" | "Synth Sequence";
  index: number;
  length: number;
}

export interface SongClip {
  id: string;
  type: "audio" | "warp";
  startBeat: number;
  durationBeats: number;
  trackIndex: number;
  data?: any; // sound id for audio, hex matrix for warp
}

export interface SongTrack {
  id: string;
  name: string;
  volume: number;
  clips: SongClip[];
  automation?: {
    [param: string]: AutomationPoint[];
  };
  isAutomationOpen?: boolean;
  selectedAutomationParam?: string;
}

export interface MidiMapping {
  cc: number;
  type: 'warp' | 'track' | 'dj';
  targetId?: string; // Track ID or 'warp' or 'deckA'/'deckB'
  paramKey: string; // Parameter key (e.g., 'freq', 'volume', 'cutoff', 'crossfade', 'pitch')
  label: string;
}

export interface ProjectAsset {
  id: string;
  name: string;
  type: "drum_pattern" | "synth_loop" | "audio_sample" | "warped_buffer" | "synth_preset";
  data: any; // AudioBuffer, MusicClip data, or SynthPreset
  thumbnail?: string;
  timestamp: number;
  metadata: {
    bpm?: number;
    duration?: number;
    kitName?: string;
    description?: string;
  };
}

export type TabType = "DRUM STUDIO" | "SYNTH LAB" | "SESSION GRID" | "SONG MODE" | "SOUND EXPLORER" | "ROUTING" | "WARP ENGINE" | "DJ DECKS";
