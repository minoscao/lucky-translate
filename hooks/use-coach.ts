'use client';
/* oxlint-disable react/react-compiler -- controller refs deliberately expose current async state to stable recorder callbacks */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  coachDailySummaryDirect, coachPracticeDirect, coachReplyDirect, coachWeeklySummaryDirect,
  CoachDailySummary, CoachExercise, CoachLevelAssessment, CoachMemory, CoachMessage, CoachWeeklySummary, CoachUsage, EMPTY_COACH_MEMORY, coachLevelAssessmentDirect,
} from '@/lib/coach';
import { transcribeDirect } from '@/lib/direct-api';
import { VoiceRecorder } from '@/lib/voice-recorder';
import { AccountSnapshot } from '@/lib/account';
import { AccountScope } from '@/lib/account-scope';

type UsageHandler = (tokens: number, cost: number) => void;
type CoachJournal = { todayDate: string; todaySeconds: number; totalSeconds?: number; daily: CoachDailySummary[]; weekly: CoachWeeklySummary[]; assessment?: CoachLevelAssessment };
const JOURNAL_KEY = 'lucky-coach-journal';
const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const weekStart = (value: string) => {
  const date = new Date(`${value}T12:00:00`), day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day); return dateKey(date);
};
const weekEnd = (start: string) => { const date = new Date(`${start}T12:00:00`); date.setDate(date.getDate() + 6); return dateKey(date); };
const emptyJournal = (): CoachJournal => ({ todayDate: dateKey(), todaySeconds: 0, daily: [], weekly: [] });
const totalPracticeSeconds = (journal: CoachJournal) => {
  if (typeof journal.totalSeconds === 'number') return journal.totalSeconds;
  const today = dateKey(), todaySummary = journal.daily.find(item => item.date === today)?.minutes || 0;
  return Math.max(journal.todaySeconds, todaySummary * 60) + journal.daily.filter(item => item.date !== today).reduce((sum, item) => sum + item.minutes * 60, 0) + journal.weekly.reduce((sum, item) => sum + item.minutes * 60, 0);
};
const cleanMemory = (memory: CoachMemory): CoachMemory => ({
  level: String(memory.level || 'discovering').slice(0, 80), topics: (memory.topics || []).map(String).slice(-12),
  strengths: (memory.strengths || []).map(String).slice(-12), focus: (memory.focus || []).map(String).slice(-12), phrases: (memory.phrases || []).map(String).slice(-20),
});

export function useCoach(scope: AccountScope, addUsage: UsageHandler, ieltsScore?: number) {
  const localStorage = scope.storage, saveCloudRecord = scope.save;
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<CoachMessage[]>([]), [memory, setMemory] = useState<CoachMemory>(EMPTY_COACH_MEMORY);
  const [busy, setBusy] = useState(false), [recording, setRecording] = useState(false), [error, setError] = useState(''), [tip, setTip] = useState('');
  const [practice, setPractice] = useState<{ title: string; exercises: CoachExercise[] }>(), [speechRequest, setSpeechRequest] = useState<{ id: number; text: string }>();
  const [journal, setJournal] = useState<CoachJournal>(emptyJournal);
  const recorder = useRef<VoiceRecorder | undefined>(undefined), abort = useRef<AbortController | undefined>(undefined), keyRef = useRef(scope.owner), usageRef = useRef(addUsage), ieltsScoreRef = useRef(ieltsScore);
  const historyRef = useRef<CoachMessage[]>([]), memoryRef = useRef<CoachMemory>(EMPTY_COACH_MEMORY), busyRef = useRef(false), recordingRef = useRef(false), journalRef = useRef<CoachJournal>(emptyJournal());
  const cloudReady = useRef(false);
  const messageId = useRef(0), speechId = useRef(0);
  usageRef.current = addUsage;
  ieltsScoreRef.current = ieltsScore;
  const setBusyState = (value: boolean) => { busyRef.current = value; setBusy(value); };
  const setRecordingState = (value: boolean) => { recordingRef.current = value; setRecording(value); };
  const saveSession = (messages: CoachMessage[], nextMemory: CoachMemory) => { if (!cloudReady.current || !scope.active) return; const data = { history: messages.slice(-80), memory: nextMemory }; try { localStorage.setItem('lucky-coach-state', JSON.stringify(data)); } catch {} if (cloudReady.current) void saveCloudRecord('coach-state', 'coach-state', data).catch(() => {}); };
  const saveJournal = useCallback((next: CoachJournal) => { if (!scope.active) return; journalRef.current = next; setJournal(next); try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(next)); } catch {} if (cloudReady.current) void saveCloudRecord('coach-journal', 'coach-journal', next).catch(() => {}); }, []);
  const applyUsage = useCallback((usage: CoachUsage) => {
    usageRef.current(usage.tokens, usage.cost);
    if (usage.time) saveJournal({ ...journalRef.current, todayDate: dateKey(), todaySeconds: usage.time.trainingTodaySeconds, totalSeconds: usage.time.trainingTotalSeconds });
  }, [saveJournal]);
  const updateHistory = (messages: CoachMessage[]) => { historyRef.current = messages; setHistory(messages); };
  const updateMemory = (nextMemory: CoachMemory) => {
    const score = ieltsScoreRef.current;
    const normalized = cleanMemory(nextMemory);
    const next = typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 9 ? { ...normalized, level: `Self-reported IELTS ${score}` } : normalized;
    memoryRef.current = next; setMemory(next);
  };

  useEffect(() => {
    updateMemory(memoryRef.current);
    saveSession(historyRef.current, memoryRef.current);
  }, [ieltsScore]);

  useEffect(() => {
    if (!scope.owner) return;
    const hydration = new AbortController(); cloudReady.current = false;
    void scope.request<{ records: Array<{ id: string; data: unknown }>; account: AccountSnapshot }>('/api/cloud', { signal: hydration.signal }).then(payload => {
      if (hydration.signal.aborted || !scope.active) return;
      const state = payload.records.find(record => record.id === 'coach-state')?.data as { history?: CoachMessage[]; memory?: CoachMemory } | undefined;
      const remote = payload.records.find(record => record.id === 'coach-journal')?.data as CoachJournal | undefined;
      const messages = Array.isArray(state?.history) ? state.history.filter(item => (item?.role === 'learner' || item?.role === 'coach') && typeof item.text === 'string').slice(-80) : [];
      updateHistory(messages); messageId.current = Math.max(0, ...messages.map(item => Number(item.id) || 0));
      updateMemory(state?.memory ? cleanMemory(state.memory) : EMPTY_COACH_MEMORY);
      const next = remote?.todayDate && Array.isArray(remote.daily) && Array.isArray(remote.weekly) ? remote : emptyJournal();
      journalRef.current = { ...next, todayDate: dateKey(), todaySeconds: payload.account.usage.todayTrainingSeconds, totalSeconds: payload.account.usage.totalTrainingSeconds };
      setJournal(journalRef.current);
      try {
        localStorage.setItem('lucky-coach-state', JSON.stringify({ history: messages, memory: memoryRef.current }));
        localStorage.setItem(JOURNAL_KEY, JSON.stringify(journalRef.current));
      } catch {}
      cloudReady.current = true; setReady(true);
    }).catch(cause => { if (!hydration.signal.aborted && scope.active) setError(cause instanceof Error ? cause.message : '无法读取你的云端记录，请重试'); });
    return () => { hydration.abort(); cloudReady.current = false; };
  }, [scope]);

  const requestReply = useCallback(async (messages: CoachMessage[], nextMemory: CoachMemory, turnStatus: string, newSession = false) => {
    if (!cloudReady.current || !scope.active) return false;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setBusyState(true); setError(''); setTip('');
    try {
      const result = await coachReplyDirect({ key: keyRef.current, history: messages, memory: nextMemory, turnStatus, newSession, voiceMode: true, signal: controller.signal });
      if (controller.signal.aborted || !scope.active) return false;
      const reply = result.data.reply.trim(); if (!reply) throw new Error('English Coach 没有返回回复');
      const updatedMemory = cleanMemory(result.data.memory), updated = [...messages, { id: (messageId.current = Math.max(Date.now() * 1000 + Math.floor(Math.random() * 1000), messageId.current + 1)), createdAt: Date.now(), role: 'coach' as const, text: reply }];
      updateHistory(updated); updateMemory(updatedMemory); setTip(result.data.tip.trim()); saveSession(updated, updatedMemory); applyUsage(result.usage);
      setSpeechRequest({ id: ++speechId.current, text: reply }); return true;
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'English Coach 暂时无法回应'); return false; }
    finally { if (abort.current === controller) { abort.current = undefined; setBusyState(false); } }
  }, []);

  const submitLearner = useCallback(async (raw: string, fromRecorder = false) => {
    const text = raw.trim().slice(0, 2000); if (!cloudReady.current || !scope.active || !text || busyRef.current || (!fromRecorder && recordingRef.current)) return false;
    const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length || 0;
    const greeting = /^(hi|hello|hey|thanks|thank you|okay|ok|yes|no)[!. ]*$/i.test(text);
    const turnStatus = greeting ? 'brief social reply: respond naturally' : words >= 4 ? 'the learner is expressing a complete idea: follow it and invite depth' : 'short reply: follow its meaning and invite one easy detail; do not infer a lower level or force a scaffold';
    const next = [...historyRef.current, { id: (messageId.current = Math.max(Date.now() * 1000 + Math.floor(Math.random() * 1000), messageId.current + 1)), createdAt: Date.now(), role: 'learner' as const, text }]; updateHistory(next); saveSession(next, memoryRef.current);
    return requestReply(next, memoryRef.current, turnStatus);
  }, [requestReply]);

  useEffect(() => {
    const current = new VoiceRecorder({
      onSentence: audio => {
        if (busyRef.current) return;
        const controller = new AbortController(); abort.current = controller; setBusyState(true); setError('');
        void transcribeDirect(audio, keyRef.current, controller.signal).then(result => {
          if (controller.signal.aborted || !scope.active) return false;
          applyUsage(result.usage);
          if (!result.text) { setError('没有听清，请再说一次'); return false; }
          if (abort.current === controller) { abort.current = undefined; setBusyState(false); }
          return submitLearner(result.text, true);
        }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '语音识别失败'); })
          .finally(() => { if (abort.current === controller) { abort.current = undefined; setBusyState(false); } });
      }, onLevel: () => {}, onError: message => { setError(message); setRecordingState(false); },
    });
    recorder.current = current;
    return () => { abort.current?.abort(); void current.stop(false); };
  }, [submitLearner]);

  const beginSession = useCallback(async () => { abort.current?.abort(); setPractice(undefined); updateHistory([]); setTip(''); return requestReply([], memoryRef.current, 'new session', true); }, [requestReply]);
  const startRecording = useCallback(async () => {
    if (!cloudReady.current || !scope.active || busyRef.current || recordingRef.current) return false;
    setError(''); const started = await recorder.current?.start('hold', false).catch(cause => { setError(cause instanceof Error ? cause.message : '无法开启麦克风'); return false; });
    setRecordingState(Boolean(started)); return Boolean(started);
  }, []);
  const stopRecording = useCallback(async () => { if (!recordingRef.current) return; setRecordingState(false); await recorder.current?.stop(); }, []);
  const createPractice = useCallback(async () => {
    if (!cloudReady.current || !scope.active || busyRef.current) return false;
    const controller = new AbortController(); abort.current = controller; setBusyState(true); setError('');
    try { const result = await coachPracticeDirect({ key: keyRef.current, history: historyRef.current, memory: memoryRef.current, signal: controller.signal }); if (controller.signal.aborted || !scope.active) return false; setPractice(result.data); applyUsage(result.usage); return true; }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法生成练习'); return false; }
    finally { if (abort.current === controller) { abort.current = undefined; setBusyState(false); } }
  }, []);
  const summarizeToday = useCallback(async () => {
    if (!cloudReady.current || !scope.active || busyRef.current) return undefined;
    if (!historyRef.current.some(message => message.role === 'learner')) { setError('先完成一小段对话，再生成今日总结'); return undefined; }
    const controller = new AbortController(); abort.current = controller; setBusyState(true); setError('');
    try {
      const today = dateKey(), current = journalRef.current, existing = current.daily.find(item => item.date === today);
      const result = await coachDailySummaryDirect({ key: keyRef.current, history: historyRef.current, memory: memoryRef.current, existing, signal: controller.signal });
      if (controller.signal.aborted || !scope.active) return undefined;
      applyUsage(result.usage);
      const report: CoachDailySummary = { id: `day-${today}`, date: today, minutes: Math.max(1, Math.round(current.todaySeconds / 60)), ...result.data };
      let next: CoachJournal = { ...current, daily: [...current.daily.filter(item => item.date !== today), report].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14) };
      const oldStarts = [...new Set(next.daily.map(item => weekStart(item.date)).filter(start => start < weekStart(today)))].sort();
      for (const start of oldStarts) {
        const days = next.daily.filter(item => weekStart(item.date) === start); if (!days.length) continue;
        const weekly = await coachWeeklySummaryDirect({ key: keyRef.current, daily: days, signal: controller.signal }); if (controller.signal.aborted || !scope.active) return undefined; applyUsage(weekly.usage);
        const archive: CoachWeeklySummary = { id: `week-${start}`, startDate: start, endDate: weekEnd(start), minutes: days.reduce((sum, item) => sum + item.minutes, 0), ...weekly.data };
        next = { ...next, daily: next.daily.filter(item => weekStart(item.date) !== start), weekly: [...next.weekly.filter(item => item.startDate !== start), archive].sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 52) };
      }
      saveJournal({ ...next, todaySeconds: journalRef.current.todaySeconds, totalSeconds: journalRef.current.totalSeconds }); return report;
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法生成今日总结'); return undefined; }
    finally { if (abort.current === controller) { abort.current = undefined; setBusyState(false); } }
  }, [saveJournal]);
  const clearSession = useCallback(() => { abort.current?.abort(); void recorder.current?.stop(false); setRecordingState(false); updateHistory([]); setPractice(undefined); setTip(''); setError(''); saveSession([], memoryRef.current); }, []);
  const evaluateLevel = useCallback(async () => {
    if (!cloudReady.current || !scope.active || busyRef.current || totalPracticeSeconds(journalRef.current) < 7200 || journalRef.current.assessment) return undefined;
    const controller = new AbortController(); abort.current = controller; setBusyState(true); setError('');
    try {
      const result = await coachLevelAssessmentDirect({ key: keyRef.current, history: historyRef.current, memory: memoryRef.current, signal: controller.signal });
      if (controller.signal.aborted || !scope.active) return undefined;
      applyUsage(result.usage);
      const assessment: CoachLevelAssessment = { id: `assessment-${Date.now()}`, createdAt: new Date().toISOString(), score: Math.max(1, Math.min(9, Math.round(result.data.score))), grammar: result.data.grammar, vocabulary: result.data.vocabulary, fluency: result.data.fluency, conclusion: result.data.conclusion };
      saveJournal({ ...journalRef.current, assessment }); return assessment;
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '暂时无法完成水平评估'); return undefined; }
    finally { if (abort.current === controller) { abort.current = undefined; setBusyState(false); } }
  }, [saveJournal]);
  return {
    ready, cancel: () => { abort.current?.abort(); void recorder.current?.stop(false); setRecordingState(false); },
    history, memory, busy, recording, error, tip, practice, speechRequest,
    todaySeconds: journal.todayDate === dateKey() ? journal.todaySeconds : 0, totalPracticeSeconds: totalPracticeSeconds(journal), latestAssessment: journal.assessment, eligibleForAssessment: totalPracticeSeconds(journal) >= 7200,
    dailySummaries: journal.daily, weeklySummaries: journal.weekly,
    beginSession, sendText: submitLearner, startRecording, stopRecording, createPractice, summarizeToday, clearSession, evaluateLevel, setPractice, setError,
  };
}
