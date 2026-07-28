import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, Check } from 'lucide-react';
import { useInvoices, useWorkSessions } from '../lib/hooks';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { useToast } from '../contexts/ToastContext';
import { formatDuration, formatCurrency, calculateCountedHours } from '../lib/utils';
import type { WorkSession } from '../lib/types';

export function ManualInvoiceModal({ onClose }: { onClose: () => void }) {
  const { invoices, addInvoice, editInvoice: updateInvoice } = useInvoices();
  const { sessions, editSession } = useWorkSessions();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [reference, setReference] = useState(`INV-${format(new Date(), 'yyyyMMdd-HHmm')}`);
  const [clientName, setClientName] = useState('');
  const [service, setService] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [totalHours, setTotalHours] = useState('');
  const [status, setStatus] = useState<'draft' | 'sent' | 'partial' | 'paid'>('draft');
  const [paidAmount, setPaidAmount] = useState('');

  const [dateStr, setDateStr] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDateStr, setDueDateStr] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [discountType, setDiscountType] = useState<'fixed' | 'percent' | null>(null);
  const [discountValue, setDiscountValue] = useState<string>('');
  const [subtotal, setSubtotal] = useState<number>(0);

  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());

  const getSessionRemaining = (s: WorkSession) => {
    const total = s.totalEarned || 0;
    const payment = s.paymentStatus || (s.paid ? 'paid' : 'unpaid');
    if (payment === 'partial') {
      return Math.max(0, total - (s.paidAmount || 0));
    }
    if (payment === 'paid') {
      return 0;
    }
    return total;
  };

  const uninvoicedSessions = sessions
    .filter(s => {
      if (s.status !== 'completed') return false;
      // Uninvoiced sessions are always considered unpaid/invoiceable
      if (!s.invoiced) return true;
      // Invoiced sessions are invoiceable if their paymentStatus is unpaid or partial with unpaid remainder
      const payment = s.paymentStatus || (s.paid ? 'paid' : 'unpaid');
      return (payment === 'unpaid' || payment === 'partial') && getSessionRemaining(s) > 0;
    })
    .sort((a, b) => a.startTime - b.startTime);

  const unpaidInvoices = invoices
    .filter(inv => inv.status !== 'paid')
    .sort((a, b) => a.date - b.date);

  const uninvoicedSessionsHash = uninvoicedSessions.map(s => `${s.id}-${s.totalEarned}-${s.durationMs}-${s.paidAmount || 0}-${s.paymentStatus || ''}`).join(',');
  const unpaidInvoicesHash = unpaidInvoices.map(inv => `${inv.id}-${inv.totalAmount}-${inv.paidAmount || 0}`).join(',');

  // Recalculate totals when selected sessions and discount parameters change
  useEffect(() => {
    let newAmount = 0;
    let newDurationMs = 0;
    let newCountedHours = 0;

    selectedSessions.forEach(selectedId => {
       const session = uninvoicedSessions.find(s => s.id === selectedId);
       if (session) {
         newAmount += getSessionRemaining(session);
         newDurationMs += session.durationMs || 0;
         newCountedHours += session.countedHours !== undefined 
           ? session.countedHours 
           : calculateCountedHours(session.durationMs);
       }
    });

    selectedInvoices.forEach(invId => {
       const inv = unpaidInvoices.find(i => i.id === invId);
       if (inv) {
         const remaining = inv.totalAmount - (inv.paidAmount || 0);
         newAmount += remaining;
       }
    });

    let finalAmount = newAmount;
    const discVal = parseFloat(discountValue) || 0;
    if (discountType === 'percent') {
      finalAmount = Math.max(0, newAmount - (newAmount * discVal) / 100);
    } else if (discountType === 'fixed') {
      finalAmount = Math.max(0, newAmount - discVal);
    }

    setSubtotal(newAmount);
    setTotalAmount(finalAmount.toFixed(2));
    setTotalHours(newCountedHours.toFixed(0));
  }, [selectedSessions, selectedInvoices, discountType, discountValue, uninvoicedSessionsHash, unpaidInvoicesHash]);

  const toggleSession = (sessionId: string) => {
    const nextSet = new Set(selectedSessions);
    if (nextSet.has(sessionId)) {
      nextSet.delete(sessionId);
    } else {
      nextSet.add(sessionId);
    }
    setSelectedSessions(nextSet);
  };

  const toggleInvoice = (invoiceId: string) => {
    const nextSet = new Set(selectedInvoices);
    if (nextSet.has(invoiceId)) {
      nextSet.delete(invoiceId);
    } else {
      nextSet.add(invoiceId);
    }
    setSelectedInvoices(nextSet);
  };

  const handleSave = async () => {
    if (!user) return;
    
    // Any extra keys passed to addInvoice will be saved to Firestore, e.g., previousInvoiceIds
    const invoiceData: any = {
      reference,
      clientName,
      service,
      totalAmount: parseFloat(totalAmount) || 0,
      totalHours: parseFloat(totalHours) || 0,
      status,
      paidAmount: status === 'paid' ? (parseFloat(totalAmount) || 0) : (parseFloat(paidAmount) || 0),
      sessionIds: Array.from(selectedSessions),
      date: new Date(dateStr).getTime(),
      dueDate: new Date(dueDateStr).getTime(),
      discountType,
      discountValue: parseFloat(discountValue) || 0,
      subtotal: subtotal || parseFloat(totalAmount) || 0,
    };

    if (selectedInvoices.size > 0) {
      invoiceData.previousInvoiceIds = Array.from(selectedInvoices);
    }

    if (status !== 'draft') {
      const itemsSnapshot = [
        ...Array.from(selectedSessions).map(sId => {
          const s = sessions.find(item => item.id === sId)!;
          return {
            id: sId,
            type: 'session' as const,
            startTime: s.startTime,
            endTime: s.endTime,
            pauses: s.pauses,
            hourlyRate: s.hourlyRate,
            countedHours: s.countedHours !== undefined ? s.countedHours : calculateCountedHours(s.durationMs),
            durationMs: s.durationMs,
            totalEarned: s.totalEarned,
            paymentStatus: s.paymentStatus || (s.paid ? 'paid' : 'unpaid'),
            paidAmount: s.paidAmount || 0,
          };
        }),
        ...Array.from(selectedInvoices).map(invId => {
          const inv = unpaidInvoices.find(i => i.id === invId)!;
          return {
            id: invId,
            type: 'invoice' as const,
            reference: inv.reference,
            date: inv.date,
            totalAmount: inv.totalAmount,
            paidAmount: inv.paidAmount || 0,
          };
        })
      ].sort((a, b) => {
        const dateA = a.type === 'session' ? a.startTime : a.date;
        const dateB = b.type === 'session' ? b.startTime : b.date;
        return dateA - dateB;
      });
      invoiceData.itemsSnapshot = itemsSnapshot;
    }

    const invoiceId = await addInvoice(invoiceData);

    if (invoiceId) {
      await Promise.all([
        ...Array.from(selectedSessions).map(sId => {
          const s = sessions.find(item => item.id === sId);
          const prevPaid = s ? (s.paymentStatus === 'partial' ? (s.paidAmount || 0) : 0) : 0;
          return editSession(sId, { 
            invoiced: true, 
            invoiceId, 
            previouslyPaidAmount: prevPaid 
          });
        }),
        ...Array.from(selectedInvoices).map(invId => {
          const inv = unpaidInvoices.find(i => i.id === invId);
          if (inv) {
            return updateInvoice(invId, { status: 'paid', paidAmount: inv.totalAmount });
          }
          return Promise.resolve();
        })
      ]);
    }

    showToast('Invoice has been created');
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
        <h3 className="font-rounded text-[24px] font-bold text-ink-primary-light dark:text-ink-primary-dark mb-6">Create Invoice</h3>
        
        <div className="flex flex-col gap-4 overflow-y-auto pr-2 pb-2">
          
          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Reference</label>
            <input 
              type="text" 
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Client Name</label>
            <input 
              type="text" 
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Service Type</label>
            <input 
              type="text" 
              placeholder="e.g. Software Development, Consultation"
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark text-[14px] px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Date</label>
              <input 
                type="date" 
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
            
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Due Date</label>
              <input 
                type="date" 
                value={dueDateStr}
                onChange={(e) => setDueDateStr(e.target.value)}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
          </div>

          {uninvoicedSessions.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center justify-between">
                <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Sessions to Invoice</label>
                <div className="flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setSelectedSessions(new Set(uninvoicedSessions.map(s => s.id!)))}
                    className="font-sans text-[12px] font-medium text-action-indigo dark:text-[#818CF8] hover:underline transition-all"
                  >
                    Check All
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setSelectedSessions(new Set())}
                    className="font-sans text-[12px] font-medium text-ink-muted-light dark:text-ink-muted-dark hover:underline transition-all"
                  >
                    Uncheck All
                  </button>
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto bg-morning-paper dark:bg-midnight-canvas rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 p-2 flex flex-col gap-1">
                {uninvoicedSessions.map(session => {
                  const isPartial = session.paymentStatus === 'partial';
                  const remaining = getSessionRemaining(session);
                  return (
                    <label key={session.id} className="flex items-center gap-3 p-2 hover:bg-cloud-surface dark:hover:bg-obsidian-surface rounded-lg cursor-pointer transition-colors user-select-none font-sans">
                      <div className="relative flex items-center justify-center w-5 h-5 border border-soft-divider-light dark:border-soft-divider-dark rounded cursor-pointer overflow-hidden shrink-0">
                        <input 
                          type="checkbox"
                          checked={selectedSessions.has(session.id!)}
                          onChange={() => toggleSession(session.id!)}
                          className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="absolute inset-0 bg-transparent peer-checked:bg-action-indigo flex items-center justify-center transition-colors">
                          <Check className="w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      <div className="flex-1 flex justify-between items-center min-w-0">
                        <div className="flex flex-col min-w-0">
                          <span className="font-sans text-[14px] text-ink-primary-light dark:text-ink-primary-dark">
                            {format(new Date(session.startTime), 'MMM d, yyyy')}
                          </span>
                          {isPartial && (
                            <span className="font-sans text-[11px] text-amber-500 dark:text-amber-400 font-medium truncate">
                              Partial (Paid: {formatCurrency(session.paidAmount || 0)} of {formatCurrency(session.totalEarned)})
                            </span>
                          )}
                          {session.invoiced && !isPartial && (
                            <span className="font-sans text-[11px] text-red-500 dark:text-red-400 font-medium truncate">
                              Unpaid (Previously Invoiced)
                            </span>
                          )}
                        </div>
                        <div className="flex gap-3 items-center shrink-0 ml-2">
                          <span className="font-mono text-[13px] text-ink-muted-light dark:text-ink-muted-dark">
                            {formatDuration(session.durationMs)}
                          </span>
                          <span className="font-sans font-semibold text-[13px] text-ink-primary-light dark:text-ink-primary-dark">
                            {formatCurrency(remaining)}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {unpaidInvoices.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center justify-between">
                <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Unpaid Items</label>
                <div className="flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setSelectedInvoices(new Set(unpaidInvoices.map(s => s.id!)))}
                    className="font-sans text-[12px] font-medium text-action-indigo dark:text-[#818CF8] hover:underline transition-all"
                  >
                    Check All
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setSelectedInvoices(new Set())}
                    className="font-sans text-[12px] font-medium text-ink-muted-light dark:text-ink-muted-dark hover:underline transition-all"
                  >
                    Uncheck All
                  </button>
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto bg-morning-paper dark:bg-midnight-canvas rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 p-2 flex flex-col gap-1">
                {unpaidInvoices.map(inv => {
                  const remaining = inv.totalAmount - (inv.paidAmount || 0);
                  
                  return (
                  <label key={inv.id} className="flex items-center gap-3 p-2 hover:bg-cloud-surface dark:hover:bg-obsidian-surface rounded-lg cursor-pointer transition-colors user-select-none">
                    <div className="relative flex items-center justify-center w-5 h-5 border border-soft-divider-light dark:border-soft-divider-dark rounded cursor-pointer overflow-hidden shrink-0">
                      <input 
                        type="checkbox"
                        checked={selectedInvoices.has(inv.id!)}
                        onChange={() => toggleInvoice(inv.id!)}
                        className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="absolute inset-0 bg-transparent peer-checked:bg-action-indigo flex items-center justify-center transition-colors">
                        <Check className="w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    <div className="flex-1 flex justify-between items-center">
                      <span className="font-sans text-[14px] text-ink-primary-light dark:text-ink-primary-dark truncate max-w-[120px]">
                        {inv.reference}
                      </span>
                      <div className="flex gap-3 items-center">
                        <span className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark">
                          Unpaid
                        </span>
                        <span className="font-sans font-medium text-[13px] text-ink-primary-light dark:text-ink-primary-dark">
                          {formatCurrency(remaining)}
                        </span>
                      </div>
                    </div>
                  </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Discount Section */}
          <div className="flex flex-col gap-2 p-3 bg-morning-paper dark:bg-midnight-canvas rounded-2xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30">
            <span className="font-sans text-[13px] text-ink-primary-light dark:text-ink-primary-dark font-semibold">Discount</span>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[11px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Type</label>
                <select
                  value={discountType || ''}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : e.target.value as 'fixed' | 'percent';
                    setDiscountType(val);
                    if (!val) setDiscountValue('');
                  }}
                  className="w-full bg-cloud-surface dark:bg-obsidian-surface text-ink-primary-light dark:text-ink-primary-dark px-2.5 py-2.5 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 text-xs transition-all duration-300"
                >
                  <option value="">No Discount</option>
                  <option value="fixed">Fixed Amount (SAR)</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[11px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Value</label>
                <input
                  type="number"
                  disabled={!discountType}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="0"
                  className="w-full bg-cloud-surface dark:bg-obsidian-surface text-ink-primary-light dark:text-ink-primary-dark px-2.5 py-2.5 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 text-xs disabled:opacity-50 transition-all duration-300"
                />
              </div>
            </div>
            {discountType && subtotal > 0 && (
              <span className="text-[11px] text-indigo-650 font-medium">
                Subtotal: {formatCurrency(subtotal)} • Discounted Total: {totalAmount} SAR
              </span>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Total Amount</label>
              <input 
                type="number" 
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Total Hours</label>
              <input 
                type="number" 
                value={totalHours}
                onChange={(e) => setTotalHours(e.target.value)}
                placeholder="0"
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 mt-2 mb-2">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Status</label>
            <div className="flex flex-wrap gap-2 text-sm">
               {(['draft', 'sent', 'partial', 'paid'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`flex-1 min-w-[70px] py-1.5 rounded-lg capitalize transition-all ${status === s ? 'bg-action-indigo text-white bg-opacity-100 shadow-sm' : 'bg-cloud-surface dark:bg-obsidian-surface text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-[#F3F4F6] border border-soft-divider-light/30 dark:border-soft-divider-dark/30'}`}
                  >
                    {s}
                  </button>
               ))}
            </div>
            {status === 'partial' && (
               <div className="flex flex-col gap-1 mt-4">
                  <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">Paid Amount</label>
                  <input 
                    type="number" 
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
                  />
               </div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-6 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 flex justify-center items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface border border-soft-divider-light dark:border-soft-divider-dark text-ink-primary-light dark:text-ink-primary-dark font-rounded font-semibold text-[17px] py-4 rounded-[16px] active:scale-[0.98] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!clientName}
            className="flex-1 flex justify-center items-center gap-2 bg-action-indigo text-white font-rounded font-semibold text-[17px] py-4 rounded-[16px] shadow-[0_8px_20px_rgba(79,70,229,0.2)] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            <Save className="w-5 h-5" />
            Create
          </button>
        </div>
      </motion.div>
    </div>
  );
}
