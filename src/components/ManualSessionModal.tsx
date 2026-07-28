import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Save, Check } from 'lucide-react';
import { useWorkSessions, useUserProfile } from '../lib/hooks';
import { calculateEarned, calculateCountedHours } from '../lib/utils';
import { format, parse } from 'date-fns';
import { useToast } from '../contexts/ToastContext';

export function ManualSessionModal({ onClose }: { onClose: () => void }) {
  const { addManualSession } = useWorkSessions();
  const { profile } = useUserProfile();
  const { showToast } = useToast();
  
  const [startDateStr, setStartDateStr] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startTimeStr, setStartTimeStr] = useState('09:00');
  const [endDateStr, setEndDateStr] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endTimeStr, setEndTimeStr] = useState('17:00');
  const [pauses, setPauses] = useState('0');
  const [countedHours, setCountedHours] = useState('8');
  const [isManuallyEdited, setIsManuallyEdited] = useState(false);
  const [invoiced, setInvoiced] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (isManuallyEdited) return;
    try {
      const startObj = parse(`${startDateStr} ${startTimeStr}`, 'yyyy-MM-dd HH:mm', new Date());
      const endObj = parse(`${endDateStr} ${endTimeStr}`, 'yyyy-MM-dd HH:mm', new Date());
      const durationMs = endObj.getTime() - startObj.getTime();
      if (durationMs >= 0) {
        const calculated = calculateCountedHours(durationMs);
        setCountedHours(calculated.toString());
      }
    } catch (e) {
      // Ignore parse errors while typing
    }
  }, [startDateStr, startTimeStr, endDateStr, endTimeStr, isManuallyEdited]);

  const handleSave = async () => {
    if (!profile) return;
    
    // Combine date and time
    const startObj = parse(`${startDateStr} ${startTimeStr}`, 'yyyy-MM-dd HH:mm', new Date());
    const endObj = parse(`${endDateStr} ${endTimeStr}`, 'yyyy-MM-dd HH:mm', new Date());
    
    const startTime = startObj.getTime();
    const endTime = endObj.getTime();
    
    if (endTime < startTime) {
      showToast('End time cannot be before start time');
      return;
    }
    
    const durationMs = endTime - startTime;
    const parsedCountedHours = parseFloat(countedHours) || 0;
    const finalEarned = parsedCountedHours * profile.hourlyRate;
    
    await addManualSession({
      startTime,
      currentSegmentStart: startTime,
      endTime,
      status: 'completed',
      durationMs,
      pauses: parseInt(pauses, 10) || 0,
      hourlyRate: profile.hourlyRate,
      countedHours: parsedCountedHours,
      totalEarned: finalEarned,
      invoiced,
      paid
    });
    
    showToast('Session is recorded successfully');
    onClose();
  };

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
        <h3 className="font-rounded text-[24px] font-bold text-ink-primary-light dark:text-ink-primary-dark mb-6">Add Manual Session</h3>
        
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Start Date</label>
              <input 
                type="date" 
                value={startDateStr}
                onChange={(e) => setStartDateStr(e.target.value)}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
            
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">End Date</label>
              <input 
                type="date" 
                value={endDateStr}
                onChange={(e) => setEndDateStr(e.target.value)}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Start Time</label>
              <input 
                type="time" 
                value={startTimeStr}
                onChange={(e) => setStartTimeStr(e.target.value)}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">End Time</label>
              <input 
                type="time" 
                value={endTimeStr}
                onChange={(e) => setEndTimeStr(e.target.value)}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Number of pauses</label>
            <input 
              type="number" 
              min="0"
              value={pauses}
              onChange={(e) => setPauses(e.target.value)}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Counted hours</label>
            <input 
              type="number" 
              min="0"
              step="0.01"
              value={countedHours}
              onChange={(e) => {
                setCountedHours(e.target.value);
                setIsManuallyEdited(true);
              }}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
            />
          </div>

          <div className="flex gap-6 mt-2">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${invoiced ? 'bg-amber-500 border-amber-500' : 'border-ink-muted-light group-hover:border-action-indigo'}`}>
                {invoiced && <Check className="w-4 h-4 text-white" />}
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={invoiced} 
                  onChange={(e) => setInvoiced(e.target.checked)} 
                />
              </div>
              <span className="font-sans text-[15px] font-medium text-ink-primary-light dark:text-ink-primary-dark">Invoiced</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${paid ? 'bg-emerald-500 border-emerald-500' : 'border-ink-muted-light group-hover:border-action-indigo'}`}>
                {paid && <Check className="w-4 h-4 text-white" />}
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={paid} 
                  onChange={(e) => setPaid(e.target.checked)} 
                />
              </div>
              <span className="font-sans text-[15px] font-medium text-ink-primary-light dark:text-ink-primary-dark">Paid</span>
            </label>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full mt-8 flex justify-center items-center gap-2 bg-action-indigo text-white font-rounded font-semibold text-[17px] py-4 rounded-[16px] hover:opacity-90 active:scale-[0.98] transition-all"
        >
          <Save className="w-5 h-5" />
          Save Session
        </button>
      </motion.div>
    </div>
  );
}
