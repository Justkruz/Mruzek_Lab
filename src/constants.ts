/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { DrumType, SynthPreset } from "./types";

export const DRUM_LIBRARY: DrumType[] = [
  { id: 0, name: "KICK DEEP", symbol: "🥁", freq: 110, decay: 0.6, type: "kick" },
  { id: 1, name: "KICK PUNCH", symbol: "🥁", freq: 180, decay: 0.35, type: "kick" },
  { id: 2, name: "KICK BOOM", symbol: "💥", freq: 85, decay: 0.85, type: "kick" },
  { id: 3, name: "SNARE CRISP", symbol: "🥁", noise: 0.7, type: "snare" },
  { id: 4, name: "SNARE FAT", symbol: "🥁", noise: 0.9, type: "snare" },
  { id: 5, name: "CLAP", symbol: "👏", type: "clap" },
  { id: 6, name: "HI-HAT CLOSED", symbol: "🥤", type: "closedHat" },
  { id: 7, name: "HI-HAT OPEN", symbol: "🍹", type: "openHat" },
  { id: 8, name: "TOM LOW", symbol: "🥁", freq: 75, type: "tom" },
  { id: 9, name: "TOM MID", symbol: "🥁", freq: 130, type: "tom" },
  { id: 10, name: "TOM HIGH", symbol: "🥁", freq: 220, type: "tom" },
  { id: 11, name: "RIMSHOT", symbol: "🔥", type: "rim" },
  { id: 12, name: "COWBELL", symbol: "🔔", type: "cowbell" },
  { id: 13, name: "CRASH", symbol: "🔌", type: "crash" },
  { id: 14, name: "SHAKER", symbol: "🧂", type: "shaker" },
  { id: 15, name: "TAMBOURINE", symbol: "🪘", type: "tamb" },
  { id: 16, name: "CONGA LOW", symbol: "🪵", freq: 95, type: "conga" },
  { id: 17, name: "CONGA HIGH", symbol: "🪵", freq: 190, type: "conga" },
  { id: 18, name: "WOODBLOCK", symbol: "🔨", type: "wood" },
];

export const SYNTH_PRESETS: SynthPreset[] = [
  { 
    id: 0, name: "DUAL SAW LEAD", 
    waveA: "sawtooth", detuneA: 0, panA: -0.2,
    waveB: "sawtooth", detuneB: 12, panB: 0.2,
    mix: 0.5, filter: 1800, resonance: 4,
    attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.4,
    reverb: 0.2, delay: 0.1
  },
  { 
    id: 1, name: "GHOST PAD", 
    waveA: "sine", detuneA: 0, panA: -0.5,
    waveB: "noise", detuneB: 0, panB: 0.5,
    mix: 0.3, filter: 600, resonance: 2,
    attack: 1.2, decay: 2.0, sustain: 0.9, release: 3.0,
    reverb: 0.6, delay: 0.3
  },
  { 
    id: 2, name: "ACID DUAL", 
    waveA: "square", detuneA: 0, panA: 0,
    waveB: "sawtooth", detuneB: 7, panB: 0,
    mix: 0.6, filter: 1200, resonance: 15,
    attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.3,
    reverb: 0.1, delay: 0.1
  },
  { 
    id: 3, name: "TRIANGLE BASS", 
    waveA: "triangle", detuneA: 0, panA: -0.1,
    waveB: "sine", detuneB: -13, panB: 0.1,
    mix: 0.7, filter: 500, resonance: 1,
    attack: 0.02, decay: 0.4, sustain: 0.8, release: 0.6,
    reverb: 0, delay: 0
  }
];
