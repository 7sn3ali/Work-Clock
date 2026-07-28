import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, Trash2, AlertCircle, Check, Lock } from 'lucide-react';
import { useWorkSessions, useInvoices } from '../lib/hooks';
import { calculateEarned, calculateCountedHours } from '../lib/utils';
import { format, parse } from 'date-fns';
import { WorkSession } from '../lib/types';
import { useToast } from '../contexts/ToastContext';

export function EditSessionModal({ session, onClose }: { session: WorkSession; onClose: () => void }) {
  const { editSession, deleteSession } = useWorkSessions();
  const { invoices } = useInvoices();
  const { showToast } = useToast();
  
  const linkedInvoice = session.invoiceId ? invoices.find(i => i.id === session.invoiceId) : null;
  const isLocked = session.invoiced && linkedInvoice && linkedInvoice.status !== 'draft';
  
  const initialStart = new Date(session.startTime);
  const initialEnd = session.endTime ? new Date(session.endTime) : new Date();

  const [startDateStr, setStartDateStr] = useState(format(initialStart, 'yyyy-MM-dd'));
  const [startTimeStr, setStartTimeStr] = useState(format(initialStart, 'HH:mm'));
  const [endDateStr, setEndDateStr] = useState(format(initialEnd, 'yyyy-MM-dd'));
  const [endTimeStr, setEndTimeStr] = useState(format(initialEnd, 'HH:mm'));
  const [pauses, setPauses] = useState(session.pauses.toString());
  const [countedHours, setCountedHours] = useState(session.countedHours !== undefined ? session.countedHours.toString() : calculateCountedHours(session.durationMs).toString());
  const [isManuallyEdited, setIsManuallyEdited] = useState(false);
  const [invoiced, setInvoiced] = useState(session.invoiced || false);
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'partial' | 'paid'>(session.paymentStatus || (session.paid ? 'paid' : 'unpaid'));
  const [paidAmount, setPaidAmount] = useState(session.paidAmount?.toString() || '');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  useEffect(() => {
    if (isManuallyEdited || isLocked) return;
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
  }, [startDateStr, startTimeStr, endDateStr, endTimeStr, isManuallyEdited, isLocked]);

  const handleSave = async () => {
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
    const finalEarned = parsedCountedHours * session.hourlyRate;
    
    await editSession(session.id!, {
      startTime,
      currentSegmentStart: startTime,
      endTime,
      durationMs,
      pauses: parseInt(pauses, 10) || 0,
      countedHours: parsedCountedHours,
      totalEarned: finalEarned,
      invoiced,
      paymentStatus,
      paid: paymentStatus === 'paid',
      paidAmount: paymentStatus === 'partial' ? parseFloat(paidAmount) || 0 : (paymentStatus === 'paid' ? finalEarned : 0)
    });
    
    showToast('Changes have been saved');
    onClose();
  };

  const handleDelete = async () => {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }
    await deleteSession(session.id!);
    showToast('Session is deleted successfully');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-midnight-canvas/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-cloud-surface dark:bg-obsidian-surface w-full max-w-md rounded-[32px] shadow-[0_24px_60px_rgba(0,0,0,0.12)] p-8 relative flex flex-col max-h-[90vh]"
      >
        <button onClick={onClose} className="absolute top-6 right-6 text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light">
          <X className="w-6 h-6" />
        </button>
        <h3 className="font-rounded text-[24px] font-bold text-ink-primary-light dark:text-ink-primary-dark mb-6">Edit Session</h3>
        
        <div className="flex flex-col gap-4 overflow-y-auto pr-2 pb-2">
          {isLocked && (
            <div className="bg-amber-50 dark:bg-amber-950/25 text-amber-700 dark:text-amber-400 p-4 rounded-[16px] font-sans text-[13px] mb-2 border border-amber-200/50 dark:border-amber-900/30 flex gap-3 items-start">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <span className="font-bold">Session Locked</span>
                <span>This session is linked to Invoice #{linkedInvoice?.reference} which has been marked as {linkedInvoice?.status}. Its duration, rate, and details cannot be changed.</span>
              </div>
            </div>
          )}
          {isConfirmingDelete && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-[16px] font-sans text-[15px] mb-2 border border-red-200 dark:border-red-900/50 flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>Are you sure you want to delete this session? This action cannot be undone.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Start Date</label>
              <input 
                type="date" 
                value={startDateStr}
                onChange={(e) => setStartDateStr(e.target.value)}
                disabled={isLocked}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
              />
            </div>
            
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">End Date</label>
              <input 
                type="date" 
                value={endDateStr}
                onChange={(e) => setEndDateStr(e.target.value)}
                disabled={isLocked}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
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
                disabled={isLocked}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">End Time</label>
              <input 
                type="time" 
                value={endTimeStr}
                onChange={(e) => setEndTimeStr(e.target.value)}
                disabled={isLocked}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
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
              disabled={isLocked}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
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
              disabled={isLocked}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
            />
          </div>

          <div className="flex flex-col gap-4 mt-2 mb-2">
            <label className={`flex items-center gap-3 w-fit ${isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer group'}`}>
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all ${invoiced ? 'bg-amber-500 border-amber-500' : 'border-ink-muted-light group-hover:border-action-indigo'}`}>
                {invoiced && <Check className="w-4 h-4 text-white" />}
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={invoiced} 
                  disabled={isLocked}
                  onChange={(e) => setInvoiced(e.target.checked)} 
                />
              </div>
              <span className="font-sans text-[15px] font-medium text-ink-primary-light dark:text-ink-primary-dark">Invoiced</span>
            </label>

            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Payment Status</label>
              <div className="flex bg-cloud-surface dark:bg-obsidian-surface rounded-[14px] p-1 border border-soft-divider-light dark:border-soft-divider-dark">
                {(['unpaid', 'partial', 'paid'] as const).map(pStatus => (
                  <button
                    key={pStatus}
                    type="button"
                    disabled={isLocked}
                    onClick={() => setPaymentStatus(pStatus)}
                    className={`flex-1 font-sans text-[14px] font-medium py-2 rounded-[10px] capitalize transition-all disabled:opacity-60 ${paymentStatus === pStatus ? (pStatus === 'paid' ? 'bg-emerald-500 text-white shadow-sm' : pStatus === 'partial' ? 'bg-blue-500 text-white shadow-sm' : 'bg-ink-primary-light dark:bg-ink-primary-dark text-white dark:text-[#121318] shadow-sm') : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-[#F3F4F6]'}`}
                  >
                    {pStatus}
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence>
              {paymentStatus === 'partial' && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-col gap-1 overflow-hidden"
                >
                  <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Paid Amount (<span className="font-thmanyah">ر.س</span>)</label>
                  <input 
                    type="number" 
                    min="0"
                    step="0.01"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    disabled={isLocked}
                    placeholder="0.00"
                    className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex gap-4 mt-6 shrink-0">
          {isLocked ? (
            <button
              onClick={onClose}
              className="w-full flex justify-center items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface border border-soft-divider-light dark:border-soft-divider-dark text-ink-primary-light dark:text-ink-primary-dark font-rounded font-semibold text-[17px] py-4 rounded-[16px] hover:bg-soft-divider-light/10 active:scale-[0.98] transition-all"
            >
              Close
            </button>
          ) : isConfirmingDelete ? (
            <>
              <button
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 flex justify-center items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface border border-soft-divider-light dark:border-soft-divider-dark text-ink-primary-light dark:text-ink-primary-dark font-rounded font-semibold text-[17px] py-4 rounded-[16px] active:scale-[0.98] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-[1.5] flex justify-center items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-rounded font-semibold text-[17px] py-4 rounded-[16px] shadow-[0_8px_20px_rgba(239,68,68,0.2)] active:scale-[0.98] transition-all"
              >
                Yes, Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleDelete}
                className="flex-1 flex justify-center items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 font-rounded font-semibold text-[17px] py-4 rounded-[16px] hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-[0.98] transition-all"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                onClick={handleSave}
                className="flex-[2] flex justify-center items-center gap-2 bg-action-indigo text-white font-rounded font-semibold text-[17px] py-4 rounded-[16px] hover:opacity-90 active:scale-[0.98] transition-all"
              >
                <Save className="w-5 h-5" />
                Save
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
