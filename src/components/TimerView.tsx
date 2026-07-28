import React, { useState, useEffect } from 'react';
import { useWorkSessions } from '../lib/hooks';
import { formatDuration, formatCurrency, calculateEarned, calculateCountedHours } from '../lib/utils';
import { Play, Pause, Square, Briefcase, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { WorkSession } from '../lib/types';
import { useToast } from '../contexts/ToastContext';

function SummaryModal({ session, onClose }: { session: WorkSession, onClose: () => void }) {
  const sameDay = session.endTime ? new Date(session.startTime).getDate() === new Date(session.endTime).getDate() : true;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-midnight-canvas/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-cloud-surface dark:bg-obsidian-surface w-full max-w-md rounded-[32px] shadow-[0_24px_60px_rgba(0,0,0,0.12)] p-8 relative"
      >
        <button onClick={onClose} className="absolute top-6 right-6 text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light">
          <X className="w-6 h-6" />
        </button>
        <div className="w-16 h-16 rounded-[20px] bg-success-spring/20 flex items-center justify-center mb-6">
          <Briefcase className="w-8 h-8 text-success-spring" />
        </div>
        <h3 className="font-rounded text-[28px] font-bold text-ink-primary-light dark:text-ink-primary-dark mb-6">Session Complete</h3>
        
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center border-b border-soft-divider-light dark:border-soft-divider-dark pb-4">
            <span className="font-sans text-[16px] text-ink-muted-light dark:text-ink-muted-dark">Start</span>
            <span className="font-mono text-[16px] font-medium text-ink-primary-light dark:text-ink-primary-dark">{format(new Date(session.startTime), 'h:mm a (HH:mm)')}</span>
          </div>
          <div className="flex justify-between items-center border-b border-soft-divider-light dark:border-soft-divider-dark pb-4">
            <span className="font-sans text-[16px] text-ink-muted-light dark:text-ink-muted-dark">End</span>
            <span className="font-mono text-[16px] font-medium text-ink-primary-light dark:text-ink-primary-dark">{session.endTime ? format(new Date(session.endTime), sameDay ? 'h:mm a (HH:mm)' : 'MMM d, h:mm a (HH:mm)') : '-'}</span>
          </div>
          <div className="flex justify-between items-center border-b border-soft-divider-light dark:border-soft-divider-dark pb-4">
            <span className="font-sans text-[16px] text-ink-muted-light dark:text-ink-muted-dark">Time Worked</span>
            <span className="font-mono text-[16px] font-medium text-ink-primary-light dark:text-ink-primary-dark">{formatDuration(session.durationMs)}</span>
          </div>
          <div className="flex justify-between items-center border-b border-soft-divider-light dark:border-soft-divider-dark pb-4">
            <span className="font-sans text-[16px] text-ink-muted-light dark:text-ink-muted-dark">Counted Hours</span>
            <span className="font-mono text-[16px] font-medium text-ink-primary-light dark:text-ink-primary-dark">{session.countedHours !== undefined ? session.countedHours : calculateCountedHours(session.durationMs)}</span>
          </div>
          <div className="flex justify-between items-center border-b border-soft-divider-light dark:border-soft-divider-dark pb-4">
            <span className="font-sans text-[16px] text-ink-muted-light dark:text-ink-muted-dark">Pauses</span>
            <span className="font-mono text-[16px] font-medium text-ink-primary-light dark:text-ink-primary-dark">{session.pauses}</span>
          </div>
          <div className="flex justify-between items-center pt-2">
            <span className="font-rounded text-[20px] font-semibold text-action-indigo">Total Earned</span>
            <span className="font-rounded text-[24px] font-bold text-success-spring">{formatCurrency(session.totalEarned)}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-8 bg-action-indigo text-white font-rounded font-semibold text-[17px] py-4 rounded-[16px] active:scale-[0.98] transition-transform"
        >
          Done
        </button>
      </motion.div>
    </div>
  );
}

export function TimerView() {
  const { startSession, pauseSession, resumeSession, endSession, activeSession, sessions, loading } = useWorkSessions();
  const { showToast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Local state to keep the timer ticking smoothly without writing to DB every second
  const [liveDurationOffset, setLiveDurationOffset] = useState(0);
  const [justCompletedSession, setJustCompletedSession] = useState<WorkSession | null>(null);

  useEffect(() => {
    const clockInterval = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (activeSession && activeSession.status === 'active') {
      const updateTimer = () => {
        setLiveDurationOffset(Date.now() - activeSession.currentSegmentStart);
      };
      updateTimer(); // Initial call
      interval = setInterval(updateTimer, 1000);
    } else {
      setLiveDurationOffset(0);
    }
    return () => clearInterval(interval);
  }, [activeSession]);

  const handleEndSession = async () => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    
    // We compute elapsed accurately for the UI summary since endSession computes it internally for DB
    const isPaused = activeSession.status === 'paused';
    const elapsedSinceResume = isPaused ? 0 : (Date.now() - activeSession.currentSegmentStart);
    
    await endSession();
    showToast('Session is recorded successfully');
    // Find the completed session data
    const completed = sessions.find(s => s.id === sessionId);
    if (completed) {
      const finalDuration = (completed.durationMs || 0) + elapsedSinceResume;
      setJustCompletedSession({
        ...completed,
        endTime: Date.now(),
        durationMs: finalDuration,
        totalEarned: calculateEarned(finalDuration, completed.hourlyRate)
      });
    }
  };

  // When calculating justCompletedSession, the DB may not have sent the new snapshot yet,
  // so we definitely need to compute final calculations for the UI.
  useEffect(() => {
    if (justCompletedSession && activeSession === undefined) {
      // It actually vanished from "active", now we can pull its completely final form from `sessions` if possible
    }
  }, [sessions]);

  const totalDurationMs = (activeSession?.durationMs || 0) + liveDurationOffset;

  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full gap-8">
      {/* Current Day & Time */}
      <div className="text-center z-10">
        <motion.h3 
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-rounded text-[22px] font-semibold text-action-indigo dark:text-[#818CF8] tracking-[0.35px]"
        >
          {format(currentDate, 'EEEE, MMMM d')}
        </motion.h3>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="font-mono text-ink-muted-light dark:text-ink-muted-dark text-[15px]"
        >
          {format(currentDate, 'h:mm:ss a (HH:mm:ss)')}
        </motion.p>
      </div>

      <div className="relative flex items-center justify-center">
        {/* Glowing Ambient Behind-Circle halo */}
        <AnimatePresence mode="wait">
          {!loading && activeSession?.status === 'active' && (
            <motion.div
              key="glow-active"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0.4, 0.75, 0.4], scale: [1, 1.15, 1] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              className="absolute w-72 h-72 rounded-[40%] bg-emerald-400/25 dark:bg-emerald-500/20 blur-2xl"
            />
          )}
          {!loading && activeSession?.status === 'paused' && (
            <motion.div
              key="glow-paused"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.12, 1] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
              className="absolute w-72 h-72 rounded-[40%] bg-amber-400/20 dark:bg-amber-500/15 blur-2xl"
            />
          )}
          {!loading && !activeSession && (
            <motion.div
              key="glow-ready"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0.15, 0.35, 0.15], scale: [1, 1.06, 1] }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
              className="absolute w-72 h-72 rounded-[40%] bg-indigo-500/10 dark:bg-indigo-500/15 blur-2xl"
            />
          )}
        </AnimatePresence>

        <AnimatePresence mode="popLayout">
          <motion.div
            key="timer-circle"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.02 }}
            className={`w-64 h-64 rounded-[40%] flex flex-col items-center justify-center relative shadow-[0_20px_60px_rgba(0,0,0,0.08)] transition-colors duration-500 overflow-hidden z-10
              ${loading ? 'bg-cloud-surface dark:bg-obsidian-surface text-ink-primary-light dark:text-ink-primary-dark opacity-50'
                : activeSession?.status === 'active' 
                ? 'bg-focus-mint text-focus-mint-text shadow-[0_20px_50px_rgba(52,211,153,0.25)]' 
                : activeSession?.status === 'paused' 
                  ? 'bg-buttercup text-buttercup-text shadow-[0_20px_50px_rgba(245,158,11,0.18)]'
                  : 'bg-cloud-surface dark:bg-obsidian-surface text-ink-primary-light dark:text-ink-primary-dark border border-soft-divider-light/40 dark:border-soft-divider-dark/40'}`}
          >
            {/* Elegant inner rotating circular path for active status to look extremely refined and high-tech */}
            {!loading && activeSession?.status === 'active' && (
              <motion.div 
                className="absolute inset-0 border-[3.5px] border-emerald-400/35 rounded-[40%] pointer-events-none"
                animate={{ rotate: 360 }}
                transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
              />
            )}
            {!loading && activeSession?.status === 'paused' && (
              <div className="absolute inset-0 border-[3.5px] border-dashed border-amber-400/35 rounded-[40%] pointer-events-none animate-pulse" />
            )}
            
            {loading ? (
              <span className="font-rounded text-[22px] font-semibold animate-pulse">Loading...</span>
            ) : activeSession ? (
              <>
                <span className="font-sans text-[13px] font-semibold tracking-wider uppercase opacity-85 mb-2 relative z-10">
                  {activeSession.status === 'active' ? 'Working' : 'Paused'}
                </span>
                <span className="font-mono text-[48px] font-bold tracking-tight lining-nums tabular-nums relative z-10 drop-shadow-sm">
                  {formatDuration(totalDurationMs)}
                </span>
              </>
            ) : (
              <>
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                  className="mb-4 opacity-75 text-action-indigo dark:text-[#818CF8]"
                >
                  <Briefcase className="w-12 h-12" />
                </motion.div>
                <span className="font-rounded text-[22px] font-bold tracking-tight text-ink-primary-light dark:text-ink-primary-dark">Ready to work</span>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex gap-4 items-center justify-center mt-6 z-20">
        {loading ? (
          <button
            disabled
            className="bg-cloud-surface dark:bg-obsidian-surface text-ink-muted-light dark:text-ink-muted-dark font-rounded font-bold text-[22px] px-10 py-5 rounded-[24px] flex items-center gap-3 opacity-50"
          >
            <Play className="w-6 h-6 fill-current" />
            Loading...
          </button>
        ) : !activeSession ? (
          <motion.button
            whileHover={{ 
              scale: 1.04, 
              boxShadow: '0 15px 35px rgba(79, 70, 229, 0.45)',
            }}
            whileTap={{ scale: 0.96 }}
            onClick={startSession}
            disabled={loading}
            className="bg-action-indigo text-white font-rounded font-bold text-[22px] px-10 py-5 rounded-[24px] shadow-[0_12px_24px_rgba(79,70,229,0.25)] flex items-center gap-3 transition-all relative overflow-hidden group"
          >
            {/* Smooth glowing overlays */}
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <Play className="w-6 h-6 fill-current" />
            Clock In
          </motion.button>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="flex bg-cloud-surface dark:bg-obsidian-surface rounded-[24px] p-2 shadow-[0_12px_35px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_35px_rgba(0,0,0,0.35)] gap-2 border border-soft-divider-light/40 dark:border-soft-divider-dark/40"
          >
            {activeSession.status === 'active' ? (
              <motion.button
                whileHover={{ scale: 1.03, boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)' }}
                whileTap={{ scale: 0.97 }}
                onClick={pauseSession}
                className="flex items-center gap-2 bg-buttercup text-buttercup-text font-rounded font-semibold text-[17px] px-6 py-4 rounded-[18px] transition-all"
              >
                <Pause className="w-5 h-5 fill-current" />
                Pause
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.03, boxShadow: '0 4px 12px rgba(52, 211, 153, 0.2)' }}
                whileTap={{ scale: 0.97 }}
                onClick={resumeSession}
                className="flex items-center gap-2 bg-focus-mint text-focus-mint-text font-rounded font-semibold text-[17px] px-6 py-4 rounded-[18px] transition-all"
              >
                <Play className="w-5 h-5 fill-current" />
                Continue
              </motion.button>
            )}
            
            <motion.button
              whileHover={{ scale: 1.03, boxShadow: '0 4px 12px rgba(239, 68, 68, 0.1)' }}
              whileTap={{ scale: 0.97 }}
              onClick={handleEndSession}
              className="flex items-center gap-2 bg-energy-peach text-energy-peach-text font-rounded font-semibold text-[17px] px-6 py-4 rounded-[18px] transition-all"
            >
              <Square className="w-5 h-5 fill-current" />
              Clock Out
            </motion.button>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {justCompletedSession && (
          <SummaryModal
            session={justCompletedSession}
            onClose={() => setJustCompletedSession(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
