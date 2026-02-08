import { useCallback, useRef, useState, useEffect } from 'react';

const STORAGE_KEY = 'tetris-sound-enabled';

export const useTetrisSounds = () => {
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const musicOscillatorRef = useRef<OscillatorNode | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const musicIntervalRef = useRef<number | null>(null);

  const getContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback((frequency: number, duration: number, type: OscillatorType = 'square', volume = 0.1) => {
    if (!soundEnabled) return;
    
    const ctx = getContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  }, [soundEnabled, getContext]);

  const playMove = useCallback(() => {
    playTone(200, 0.05, 'square', 0.05);
  }, [playTone]);

  const playRotate = useCallback(() => {
    playTone(400, 0.1, 'square', 0.08);
  }, [playTone]);

  const playDrop = useCallback(() => {
    playTone(150, 0.15, 'square', 0.1);
  }, [playTone]);

  const playLineClear = useCallback((linesCount: number) => {
    if (!soundEnabled) return;
    
    const ctx = getContext();
    const frequencies = linesCount === 4 
      ? [523, 659, 784, 1047] // C5, E5, G5, C6 for Tetris
      : [392, 523, 659]; // G4, C5, E5 for regular clear
    
    frequencies.forEach((freq, i) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      }, i * 80);
    });
  }, [soundEnabled, getContext]);

  const playGameOver = useCallback(() => {
    if (!soundEnabled) return;
    
    const ctx = getContext();
    const notes = [392, 370, 349, 330, 311, 294]; // Descending notes
    
    notes.forEach((freq, i) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      }, i * 150);
    });
  }, [soundEnabled, getContext]);

  // Background music - simple retro melody loop
  const startMusic = useCallback(() => {
    if (!soundEnabled) return;
    
    const ctx = getContext();
    const melody = [
      { note: 659, dur: 200 }, // E5
      { note: 494, dur: 200 }, // B4
      { note: 523, dur: 200 }, // C5
      { note: 587, dur: 200 }, // D5
      { note: 523, dur: 200 }, // C5
      { note: 494, dur: 200 }, // B4
      { note: 440, dur: 200 }, // A4
      { note: 440, dur: 200 }, // A4
      { note: 523, dur: 200 }, // C5
      { note: 659, dur: 200 }, // E5
      { note: 587, dur: 200 }, // D5
      { note: 523, dur: 200 }, // C5
      { note: 494, dur: 400 }, // B4
      { note: 523, dur: 200 }, // C5
      { note: 587, dur: 200 }, // D5
      { note: 659, dur: 200 }, // E5
      { note: 523, dur: 200 }, // C5
      { note: 440, dur: 200 }, // A4
      { note: 440, dur: 400 }, // A4
    ];
    
    let noteIndex = 0;
    
    const playNote = () => {
      if (!soundEnabled) return;
      
      const { note, dur } = melody[noteIndex];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(note, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur / 1000);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur / 1000);
      
      noteIndex = (noteIndex + 1) % melody.length;
      
      musicIntervalRef.current = window.setTimeout(playNote, dur);
    };
    
    playNote();
  }, [soundEnabled, getContext]);

  const stopMusic = useCallback(() => {
    if (musicIntervalRef.current) {
      clearTimeout(musicIntervalRef.current);
      musicIntervalRef.current = null;
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY, String(newValue));
      return newValue;
    });
  }, []);

  // Stop music when sound is disabled
  useEffect(() => {
    if (!soundEnabled) {
      stopMusic();
    }
  }, [soundEnabled, stopMusic]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMusic();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stopMusic]);

  return {
    soundEnabled,
    toggleSound,
    playMove,
    playRotate,
    playDrop,
    playLineClear,
    playGameOver,
    startMusic,
    stopMusic,
  };
};
