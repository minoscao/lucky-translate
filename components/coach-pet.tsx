'use client';
/* oxlint-disable react/react-compiler -- the animation controller intentionally keeps timers and current pet state in refs */

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

type PetClip = 'idle' | 'groom' | 'paw-face' | 'blink' | 'tail' | 'pet' | 'slap' | 'talk' | 'sleep-enter' | 'sleep' | 'belly-enter' | 'belly' | 'belly-exit' | 'wake' | 'belly-wake';
const CLIP_MS: Record<PetClip, number> = {
  idle: 5042, groom: 5042, 'paw-face': 4033, blink: 5042, tail: 5042, pet: 8042, slap: 1583, talk: 5042,
  'sleep-enter': 4042, sleep: 5042, 'belly-enter': 4042, belly: 5033, 'belly-exit': 4042, wake: 8042, 'belly-wake': 6042,
};
const RANDOM_AWAKE: PetClip[] = ['groom', 'paw-face', 'blink', 'tail'];
const TOUCH_ACTIONS: PetClip[] = ['groom', 'paw-face', 'blink', 'tail', 'pet', 'slap'];

export function CoachPet({ busy, speaking, recording, activity }: { busy: boolean; speaking: boolean; recording: boolean; activity: number }) {
  const [playback, setPlayback] = useState<{ clip: PetClip; revision: number }>({ clip: 'idle', revision: 0 });
  const [label, setLabel] = useState('Ready');
  const [room, setRoom] = useState<'day' | 'night'>('day');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), lastInteraction = useRef(performance.now());
  const asleep = useRef(false), sleepStyle = useRef<'prone' | 'belly'>('prone'), wakeTouches = useRef(0), awakeChance = useRef(5), sleepChance = useRef(5), bellyChance = useRef(10), naturalWakeChance = useRef(1), sleepLoops = useRef(0), previousActivity = useRef(activity), previousForced = useRef<PetClip | undefined>(undefined);
  const forced = speaking ? 'talk' : recording ? 'tail' : busy ? 'paw-face' : undefined;
  const play = useCallback((clip: PetClip) => setPlayback(current => ({ clip, revision: current.revision + 1 })), []);
  const recordInteraction = useCallback(() => { lastInteraction.current = performance.now(); sleepChance.current = 5; wakeTouches.current = 0; }, []);
  const wake = useCallback(() => {
    if (!asleep.current) return;
    asleep.current = false; wakeTouches.current = 0; sleepLoops.current = 0; naturalWakeChance.current = 1;
    play(sleepStyle.current === 'belly' ? 'belly-wake' : 'wake');
  }, [play]);

  useEffect(() => {
    const sources: PetClip[] = ['talk', 'tail', 'sleep-enter', 'sleep', 'wake'];
    const timer = window.setTimeout(() => sources.forEach(clip => { const image = new window.Image(); image.src = `/pet/${clip}.webp`; }), 900);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const update = () => { const hour = new Date().getHours(); setRoom(hour >= 7 && hour < 19 ? 'day' : 'night'); };
    update(); const timer = window.setInterval(update, 60_000); return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activity === previousActivity.current) return;
    previousActivity.current = activity; recordInteraction();
    if (asleep.current) wake();
  }, [activity, recordInteraction, wake]);
  useEffect(() => {
    const prior = previousForced.current; previousForced.current = forced;
    if (!forced) { if (prior) play('idle'); return; }
    recordInteraction(); if (asleep.current) asleep.current = false; play(forced);
    setLabel(speaking ? 'Speaking' : recording ? 'Listening' : 'Thinking');
  }, [forced, play, recordInteraction, recording, speaking]);
  useEffect(() => {
    if (forced) return;
    const clip = playback.clip;
    setLabel(clip === 'sleep' || clip === 'belly' || clip === 'sleep-enter' || clip === 'belly-enter' || clip === 'belly-exit' ? (wakeTouches.current ? `${wakeTouches.current}/3 to wake` : 'Sleeping') : clip === 'pet' ? 'Happy' : clip === 'slap' ? 'Hey!' : 'Ready');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (clip === 'sleep-enter') { sleepStyle.current = 'prone'; play('sleep'); return; }
      if (clip === 'belly-enter') { sleepStyle.current = 'belly'; play('belly'); return; }
      if (clip === 'belly-exit') { sleepStyle.current = 'prone'; play('sleep'); return; }
      if (clip === 'wake' || clip === 'belly-wake') { play('idle'); return; }
      if (clip === 'sleep' || clip === 'belly') {
        sleepLoops.current += 1;
        if (performance.now() - lastInteraction.current >= 5 * 60_000 && Math.random() * 100 < naturalWakeChance.current) { asleep.current = false; naturalWakeChance.current = 1; play(clip === 'belly' ? 'belly-wake' : 'wake'); return; }
        naturalWakeChance.current = Math.min(100, naturalWakeChance.current + 1);
        if (sleepLoops.current % 6 === 0) {
          if (Math.random() * 100 < bellyChance.current) { bellyChance.current = 10; play(clip === 'belly' ? 'belly-exit' : 'belly-enter'); return; }
          bellyChance.current = Math.min(100, bellyChance.current + 10);
        }
        play(clip); return;
      }
      if (clip !== 'idle') { play('idle'); return; }
      if (performance.now() - lastInteraction.current >= 60_000) {
        if (Math.random() * 100 < sleepChance.current) { asleep.current = true; sleepStyle.current = 'prone'; play('sleep-enter'); return; }
        sleepChance.current = Math.min(100, sleepChance.current + 5);
      }
      if (Math.random() * 100 < awakeChance.current) { awakeChance.current = 5; play(RANDOM_AWAKE[Math.floor(Math.random() * RANDOM_AWAKE.length)]); return; }
      awakeChance.current = Math.min(100, awakeChance.current + 5); play('idle');
    }, CLIP_MS[clip]);
    return () => clearTimeout(timer.current);
  }, [forced, playback, play]);

  const touch = () => {
    if (asleep.current) {
      wakeTouches.current += 1; setLabel(`${wakeTouches.current}/3 to wake`);
      if (wakeTouches.current >= 3) { recordInteraction(); wake(); return; }
      if (sleepStyle.current === 'prone') { sleepStyle.current = 'belly'; play('belly-enter'); } else { sleepStyle.current = 'prone'; play('belly-exit'); }
      return;
    }
    recordInteraction();
    const choices = TOUCH_ACTIONS.filter(clip => clip !== playback.clip);
    play(choices[Math.floor(Math.random() * choices.length)]);
  };
  return <aside className={`coach-pet-stage ${room} ${forced || playback.clip}`} aria-label={`Lucky cat: ${label}`}>
    <button type="button" className="coach-pet-button" onClick={touch} aria-label="Tap Lucky for a random action. When sleeping, tap three times to wake her.">
      <Image key={`${playback.clip}-${playback.revision}`} src={`/pet/${playback.clip}.webp`} width={224} height={224} alt="" unoptimized priority={false} />
      {speaking && <span className="pet-voice" aria-hidden="true"><i/><i/><i/></span>}
    </button>
    <small>{label}</small>
  </aside>;
}
