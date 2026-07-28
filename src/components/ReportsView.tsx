import React, { useMemo, useState } from 'react';
import { useWorkSessions, useInvoices } from '../lib/hooks';
import { formatDuration, formatCurrency, formatCurrencyString, calculateCountedHours } from '../lib/utils';
import { format, isSameDay } from 'date-fns';
import { Download, FileText, Plus, Edit2, CheckCircle2, Banknote, CheckCheck, List, Receipt, Clock, ChevronDown, ChevronUp } from 'lucide-react';
// import { jsPDF } from 'jspdf';
// import 'jspdf-autotable';
import { WorkSession, Invoice } from '../lib/types';
import { ManualSessionModal } from './ManualSessionModal';
import { EditSessionModal } from './EditSessionModal';
import { ManualInvoiceModal } from './ManualInvoiceModal';
import { InvoiceDetailsModal } from './InvoiceDetailsModal';
import { motion, AnimatePresence } from 'motion/react';

function StatCard({ title, value, icon: Icon, colorClass, subText }: { title: string, value: React.ReactNode, icon: any, colorClass: string, subText?: React.ReactNode }) {
  return (
    <motion.div 
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}
      className="bg-cloud-surface dark:bg-obsidian-surface rounded-[24px] p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)] border border-soft-divider-light/40 dark:border-soft-divider-dark/40 flex items-center gap-4 flex-1 min-w-[200px]"
    >
      <div className={`w-12 h-12 rounded-[16px] flex items-center justify-center shrink-0 ${colorClass}`}>
        <Icon className="w-6 h-6 currentColor" />
      </div>
      <div>
        <h4 className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium uppercase tracking-wider mb-0.5">{title}</h4>
        <div className="font-rounded text-[22px] font-bold text-ink-primary-light dark:text-ink-primary-dark">{value}</div>
        {subText && <div className="mt-0.5 text-[12px] font-sans font-medium text-ink-muted-light dark:text-ink-muted-dark">{subText}</div>}
      </div>
    </motion.div>
  );
}

export function ReportsView() {
  const { sessions, loading: sessionsLoading, editSession } = useWorkSessions();
  const { invoices, loading: invoicesLoading } = useInvoices();
  
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingSession, setEditingSession] = useState<WorkSession | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [activeTab, setActiveTab] = useState<'sessions' | 'invoices'>('sessions');
  const [collapsedMonths, setCollapsedMonths] = useState<Record<string, boolean>>({});

  const currentMonthKey = useMemo(() => format(new Date(), 'MMMM yyyy'), []);

  const completedSessions = useMemo(() => sessions.filter(s => s.status === 'completed'), [sessions]);

  // Group by month
  const groupedByMonth = useMemo(() => {
    const groups: { [key: string]: WorkSession[] } = {};
    const sortedSessions = [...completedSessions].sort((a, b) => a.startTime - b.startTime);
    sortedSessions.forEach(session => {
      const monthKey = format(new Date(session.startTime), 'MMMM yyyy');
      if (!groups[monthKey]) groups[monthKey] = [];
      groups[monthKey].push(session);
    });
    return groups;
  }, [completedSessions]);

  // KPIs
  const totalRevenue = useMemo(() => completedSessions.reduce((sum, s) => sum + s.totalEarned, 0), [completedSessions]);
  
  const totalInvoiced = useMemo(() => {
    // Session portion: count sessions marked invoiced, paid, or partially paid if they are NOT linked to an existing invoice
    const standaloneInvoicedSessions = completedSessions.reduce((sum, s) => {
      const isLinkedToInvoice = s.invoiceId && invoices.some(i => i.id === s.invoiceId);
      const isManualInvoiced = (s.invoiced || s.paid || s.paymentStatus === 'paid' || s.paymentStatus === 'partial') && !isLinkedToInvoice;
      return sum + (isManualInvoiced ? s.totalEarned : 0);
    }, 0);
    
    // Invoice portion: sum of all actual invoices minus any rolled-over balances to avoid double-counting
    const invoiceTotals = invoices.reduce((sum, i) => {
      let rolledOver = 0;
      if (i.itemsSnapshot) {
        rolledOver = i.itemsSnapshot
          .filter(item => item.type === 'invoice')
          .reduce((sSum, item) => sSum + ((item.totalAmount || 0) - (item.paidAmount || 0)), 0);
      } else {
        rolledOver = (i.previousInvoiceIds || []).reduce((pSum, prevId) => {
          const prevInv = invoices.find(item => item.id === prevId);
          if (prevInv) {
            const rollingInv = invoices.find(other => 
              other.id !== prevInv.id && 
              other.itemsSnapshot?.some(item => item.id === prevInv.id && item.type === 'invoice')
            );
            const snap = rollingInv?.itemsSnapshot?.find(item => item.id === prevInv.id && item.type === 'invoice');
            const origPaid = snap && snap.paidAmount !== undefined 
              ? snap.paidAmount 
              : (prevInv.paidAmount === prevInv.totalAmount ? 0 : prevInv.paidAmount || 0);
            return pSum + (prevInv.totalAmount - origPaid);
          }
          return pSum;
        }, 0);
      }
      return sum + (i.totalAmount - rolledOver);
    }, 0);
    
    return standaloneInvoicedSessions + invoiceTotals;
  }, [completedSessions, invoices]);

  const totalUninvoiced = useMemo(() => completedSessions.reduce((sum, s) => {
    const isLinkedToInvoice = s.invoiceId && invoices.some(i => i.id === s.invoiceId);
    if (isLinkedToInvoice) return sum;
    const isSettledOrInvoiced = s.invoiced || s.paid || s.paymentStatus === 'paid' || s.paymentStatus === 'partial';
    return sum + (!isSettledOrInvoiced ? s.totalEarned : 0);
  }, 0), [completedSessions, invoices]);
  const totalHours = useMemo(() => completedSessions.reduce((sum, s) => sum + (s.countedHours !== undefined ? s.countedHours : calculateCountedHours(s.durationMs)), 0), [completedSessions]);
  
  const totalPaid = useMemo(() => {
    // Only count session payments for sessions NOT linked to an existing invoice
    let sessionPaid = completedSessions.reduce((sum, s) => {
      const isLinkedToInvoice = s.invoiceId && invoices.some(i => i.id === s.invoiceId);
      if (isLinkedToInvoice) return sum;

      if (s.paymentStatus === 'paid' || s.paid) return sum + s.totalEarned;
      if (s.paymentStatus === 'partial' && s.paidAmount) return sum + s.paidAmount;
      return sum;
    }, 0);

    // Sum of all paid portions from actual invoices, using original paid amounts before rollover-inflation
    let invoicesPaid = invoices.reduce((sum, i) => {
      const rollingInvoice = invoices.find(other => 
        other.id !== i.id && 
        (other.previousInvoiceIds?.includes(i.id!) || 
         other.itemsSnapshot?.some(item => item.id === i.id && item.type === 'invoice'))
      );
      
      let actualPaid = 0;
      if (rollingInvoice) {
        const snap = rollingInvoice.itemsSnapshot?.find(item => item.id === i.id && item.type === 'invoice');
        if (snap && snap.paidAmount !== undefined) {
          actualPaid = snap.paidAmount;
        } else {
          actualPaid = i.paidAmount === i.totalAmount ? 0 : i.paidAmount || 0;
        }
      } else {
        actualPaid = i.status === 'paid' ? i.totalAmount : (i.paidAmount || 0);
      }
      return sum + actualPaid;
    }, 0);
    
    return sessionPaid + invoicesPaid;
  }, [completedSessions, invoices]);

  const remaining = Math.max(0, totalInvoiced - totalPaid);

  const exportPDF = async (monthObjKey: string, monthSessions: WorkSession[]) => {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF();
    doc.text(`Work Clock Report - ${monthObjKey}`, 14, 20);
    
    let totalEarned = 0;
    const tableData = monthSessions.map(s => {
      totalEarned += s.totalEarned;
      const sameDay = s.endTime ? isSameDay(new Date(s.startTime), new Date(s.endTime)) : true;
      return [
        format(new Date(s.startTime), 'MM/dd/yyyy'),
        format(new Date(s.startTime), 'h:mm a (HH:mm)'),
        s.endTime ? format(new Date(s.endTime), sameDay ? 'h:mm a (HH:mm)' : 'MM/dd/yyyy, h:mm a (HH:mm)') : '-',
        formatDuration(s.durationMs),
        formatCurrencyString(s.totalEarned)
      ];
    });

    autoTable(doc, {
      startY: 30,
      head: [['Date', 'Start Time', 'End Time', 'Duration', 'Earned']],
      body: tableData,
      foot: [['', '', '', 'Total:', formatCurrencyString(totalEarned)]],
    });

    doc.save(`work_clock_report_${monthObjKey.replace(' ', '_')}.pdf`);
  };

  const exportCSV = (monthObjKey: string, monthSessions: WorkSession[]) => {
    let csvContent = "Date,Start Time,End Time,Duration,Earned\n";
    monthSessions.forEach(s => {
      const sameDay = s.endTime ? isSameDay(new Date(s.startTime), new Date(s.endTime)) : true;
      const row = [
        format(new Date(s.startTime), 'MM/dd/yyyy'),
        format(new Date(s.startTime), 'h:mm a (HH:mm)'),
        s.endTime ? format(new Date(s.endTime), sameDay ? 'h:mm a (HH:mm)' : 'MM/dd/yyyy h:mm a (HH:mm)') : '-',
        formatDuration(s.durationMs),
        s.totalEarned
      ];
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `work_clock_report_${monthObjKey.replace(' ', '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (sessionsLoading) {
    return <div className="p-4 text-ink-muted-light">Loading reports...</div>;
  }

  return (
    <div className="flex flex-col gap-8 pb-10">
      
      {/* KPIs Section */}
      <div className="flex flex-wrap gap-4">
        <StatCard title="Total Revenue" value={formatCurrency(totalRevenue)} icon={Banknote} colorClass="bg-action-indigo/10 text-action-indigo dark:bg-action-indigo/20 dark:text-[#818CF8]" />
        <StatCard 
          title="Total Invoiced" 
          value={formatCurrency(totalInvoiced)} 
          icon={FileText} 
          colorClass="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400" 
          subText={<span>Uninvoiced: <span className="font-bold">{formatCurrency(totalUninvoiced)}</span></span>}
        />
        <StatCard 
          title="Total Paid" 
          value={formatCurrency(totalPaid)} 
          icon={CheckCircle2} 
          colorClass="bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400" 
          subText={<span>Remaining: <span className="font-bold">{formatCurrency(remaining)}</span></span>}
        />
        <StatCard 
          title="Total Hours" 
          value={
            (() => {
              const totalMs = completedSessions.reduce((sum, s) => sum + s.durationMs, 0);
              const totalSeconds = Math.floor(totalMs / 1000);
              const h = Math.floor(totalSeconds / 3600);
              const m = Math.floor((totalSeconds % 3600) / 60);
              const s = totalSeconds % 60;
              return (
                <span className="flex items-baseline gap-1">
                  <span>{h}<span className="font-normal text-[16px] text-ink-muted-light dark:text-ink-muted-dark font-sans ml-0.5">h</span></span>
                  <span>{m}<span className="font-normal text-[16px] text-ink-muted-light dark:text-ink-muted-dark font-sans ml-0.5">m</span></span>
                  <span>{s}<span className="font-normal text-[16px] text-ink-muted-light dark:text-ink-muted-dark font-sans ml-0.5">s</span></span>
                </span>
              );
            })()
          } 
          icon={Clock} 
          colorClass="bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400" 
        />
      </div>

      <div className="flex items-center justify-between border-b border-soft-divider-light dark:border-soft-divider-dark pb-2">
        <div className="flex gap-6">
          <button 
            onClick={() => setActiveTab('sessions')}
            className={`font-rounded text-[17px] font-bold pb-2 border-b-2 transition-all ${activeTab === 'sessions' ? 'border-action-indigo text-action-indigo' : 'border-transparent text-ink-muted-light hover:text-ink-primary-light'}`}
          >
            Sessions
          </button>
          <button 
            onClick={() => setActiveTab('invoices')}
            className={`font-rounded text-[17px] font-bold pb-2 border-b-2 transition-all ${activeTab === 'invoices' ? 'border-action-indigo text-action-indigo' : 'border-transparent text-ink-muted-light hover:text-ink-primary-light'}`}
          >
            Invoices
          </button>
        </div>
        
        {activeTab === 'sessions' && (
          <motion.button
            whileHover={{ scale: 1.03, boxShadow: '0 8px 24px rgba(79, 70, 229, 0.15)' }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowManualModal(true)}
            className="flex items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface text-action-indigo dark:text-[#818CF8] shadow-[0_4px_12px_rgb(0,0,0,0.04)] dark:shadow-[0_4px_12px_rgb(0,0,0,0.15)] px-4 py-2 rounded-[14px] font-rounded font-semibold text-[14px] border border-soft-divider-light/30 dark:border-soft-divider-dark/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Session
          </motion.button>
        )}

        {activeTab === 'invoices' && (
          <motion.button
            whileHover={{ scale: 1.03, boxShadow: '0 8px 24px rgba(79, 70, 229, 0.15)' }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowInvoiceModal(true)}
            className="flex items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface text-action-indigo dark:text-[#818CF8] shadow-[0_4px_12px_rgb(0,0,0,0.04)] dark:shadow-[0_4px_12px_rgb(0,0,0,0.15)] px-4 py-2 rounded-[14px] font-rounded font-semibold text-[14px] border border-soft-divider-light/30 dark:border-soft-divider-dark/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Invoice
          </motion.button>
        )}
      </div>

      {activeTab === 'sessions' && (
        Object.keys(groupedByMonth).length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-ink-muted-light"
          >
            <List className="w-16 h-16 mb-4 opacity-40 text-action-indigo" />
            <p className="font-sans text-[17px]">No completed sessions yet.</p>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {(() => {
              const entries = Object.entries(groupedByMonth) as [string, WorkSession[]][];
              // Sort descending: newest month first
              entries.sort((a, b) => {
                const dateA = new Date(a[0]);
                const dateB = new Date(b[0]);
                return dateB.getTime() - dateA.getTime();
              });

              return entries.map(([month, monthSessions], idx) => {
                const monthTotal = monthSessions.reduce((acc, s) => acc + s.totalEarned, 0);
                const monthDuration = monthSessions.reduce((acc, s) => acc + s.durationMs, 0);

                const isCollapsed = collapsedMonths[month] !== undefined 
                  ? collapsedMonths[month] 
                  : month !== currentMonthKey;

                return (
                  <motion.div 
                    key={month} 
                    initial={{ opacity: 0, y: 25 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: idx * 0.1, ease: 'easeOut' }}
                    whileHover={{ y: -3, boxShadow: '0 12px 30px rgba(0,0,0,0.03)', borderColor: 'rgba(79, 70, 229, 0.2)' }}
                    className="bg-cloud-surface dark:bg-obsidian-surface rounded-[24px] p-6 shadow-[0_4px_12px_rgb(0,0,0,0.04)] dark:shadow-[0_6px_20px_rgb(0,0,0,0.15)] border border-soft-divider-light/40 dark:border-soft-divider-dark/40 transition-shadow duration-300"
                  >
                    <div 
                      onClick={() => setCollapsedMonths(prev => ({ ...prev, [month]: !isCollapsed }))}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer select-none group/header"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-rounded text-[22px] font-bold text-ink-primary-light dark:text-ink-primary-dark group-hover/header:text-action-indigo dark:group-hover/header:text-[#818CF8] transition-colors flex items-center gap-2">
                            {month}
                            <span className="text-ink-muted-light dark:text-ink-muted-dark group-hover/header:text-action-indigo dark:group-hover/header:text-[#818CF8] transition-colors">
                              {isCollapsed ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
                            </span>
                          </h3>
                        </div>
                        <p className="font-sans text-[15px] text-ink-muted-light dark:text-ink-muted-dark">
                          Total: {formatDuration(monthDuration)} • <span className="text-success-spring font-semibold">{formatCurrency(monthTotal)}</span>
                        </p>
                      </div>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <motion.button
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => exportCSV(month, monthSessions)}
                          className="flex items-center gap-2 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-4 py-2 rounded-xl text-sm font-medium hover:brightness-95 dark:hover:brightness-110 border border-soft-divider-light/30 dark:border-soft-divider-dark/30 transition-all cursor-pointer"
                        >
                          <Download className="w-4 h-4" /> CSV
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.03, boxShadow: '0 4px 12px rgba(79, 70, 229, 0.2)' }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => exportPDF(month, monthSessions)}
                          className="flex items-center gap-2 bg-action-indigo text-white px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer"
                        >
                          <Download className="w-4 h-4" /> PDF
                        </motion.button>
                      </div>
                    </div>

                    <AnimatePresence initial={false}>
                      {!isCollapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-1 pt-4 border-t border-soft-divider-light/30 dark:border-soft-divider-dark/30 mt-6">
                            {monthSessions.map(session => {
                              const sameDay = session.endTime ? isSameDay(new Date(session.startTime), new Date(session.endTime)) : true;
                              const isPartial = session.paymentStatus === 'partial';
                              const isPaid = session.paymentStatus === 'paid' || session.paid;

                              return (
                                <motion.div 
                                  key={session.id} 
                                  layout
                                  className="group flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 border-b border-soft-divider-light dark:border-soft-divider-dark last:border-0 last:pb-0 gap-4 transition-all"
                                >
                                  <div className="flex items-center gap-4 flex-1">
                                    <div className="flex flex-col min-w-[100px]">
                                      <span className="font-sans font-medium text-[16px] text-ink-primary-light dark:text-ink-primary-dark cursor-pointer group-hover:text-action-indigo dark:group-hover:text-[#818CF8] transition-colors flex items-center" onClick={() => setEditingSession(session)}>
                                        {format(new Date(session.startTime), 'MMM do')}
                                        <Edit2 className="w-3.5 h-3.5 ml-2 opacity-0 group-hover:opacity-100 transition-all text-action-indigo dark:text-[#818CF8]" />
                                      </span>
                                      <span className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium-muted">
                                        {(() => {
                                          const start = new Date(session.startTime);
                                          const end = session.endTime ? new Date(session.endTime) : null;
                                          const startStr = format(start, 'h:mm a');
                                          if (!end) return startStr;
                                          const endStr = format(end, 'h:mm a');
                                          const sameDay = isSameDay(start, end);
                                          return `${startStr} - ${endStr}${!sameDay ? ' (+1 day)' : ''}`;
                                        })()}
                                      </span>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                      <AnimatePresence>
                                        {session.invoiced && (
                                          <motion.span 
                                            key="invoiced"
                                            initial={{ scale: 0.8, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider shadow-[0_2px_8px_rgba(245,158,11,0.08)]"
                                          >
                                            <FileText className="w-3 h-3" /> Invoiced
                                          </motion.span>
                                        )}
                                        {isPartial && (
                                          <motion.span 
                                            key="partial"
                                            initial={{ scale: 0.8, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider shadow-[0_2px_8px_rgba(59,130,246,0.08)]"
                                          >
                                            <CheckCircle2 className="w-3 h-3" /> Partial ({formatCurrency(session.paidAmount || 0)})
                                          </motion.span>
                                        )}
                                        {isPaid && (
                                          <motion.span 
                                            key="paid"
                                            initial={{ scale: 0.8, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider shadow-[0_2px_8px_rgba(52,211,153,0.08)]"
                                          >
                                            <CheckCircle2 className="w-3 h-3" /> Paid
                                          </motion.span>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                                    <div className="flex flex-col items-end min-w-[85px]">
                                      <span className="font-rounded font-semibold text-[16px] text-success-spring cursor-pointer hover:underline" onClick={() => setEditingSession(session)}>
                                        {formatCurrency(session.totalEarned)}
                                      </span>
                                      <span className="font-mono text-[12px] text-ink-muted-light dark:text-ink-muted-dark uppercase tracking-tight font-medium">
                                        {formatDuration(session.durationMs)} • {session.countedHours !== undefined ? session.countedHours : calculateCountedHours(session.durationMs)} hrs
                                      </span>
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              });
            })()}
          </div>
        )
      )}

      {activeTab === 'invoices' && (
        <div className="space-y-6 mt-4">
          {invoices.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-20 text-ink-muted-light"
            >
              <Receipt className="w-16 h-16 mb-4 opacity-40 text-action-indigo" />
              <p className="font-sans text-[17px]">No invoices created yet.</p>
            </motion.div>
          ) : (
             <div className="space-y-4">
               {invoices.map((inv) => (
                 <motion.div
                   key={inv.id}
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   onClick={() => setSelectedInvoice(inv)}
                   className="bg-cloud-surface dark:bg-obsidian-surface rounded-[20px] p-5 shadow-[0_4px_12px_rgb(0,0,0,0.04)] border border-soft-divider-light/40 dark:border-soft-divider-dark/40 transition-shadow duration-300 cursor-pointer group hover:border-action-indigo/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                 >
                   <div className="flex items-center gap-4">
                     <div className="w-12 h-12 bg-action-indigo/10 dark:bg-action-indigo/20 text-action-indigo dark:text-[#818CF8] rounded-[14px] flex items-center justify-center">
                       <Receipt className="w-6 h-6" />
                     </div>
                     <div>
                       <h3 className="font-rounded font-bold text-[18px] text-ink-primary-light dark:text-ink-primary-dark group-hover:text-action-indigo transition-colors">{inv.reference}</h3>
                       <p className="font-sans text-[14px] text-ink-muted-light dark:text-ink-muted-dark">{format(new Date(inv.date), 'MMM do, yyyy')} • {inv.clientName || 'General Client'}</p>
                     </div>
                   </div>
                   
                   <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end">
                     <div className="flex items-center">
                        <span className={`px-3 py-1 rounded-full text-[12px] font-bold uppercase tracking-wide ${inv.status === 'paid' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : inv.status === 'partial' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'}`}>
                          {inv.status}
                        </span>
                     </div>
                     <div className="flex flex-col items-end">
                        <span className="font-rounded font-bold text-[18px] text-ink-primary-light dark:text-ink-primary-dark">{formatCurrency(inv.totalAmount)}</span>
                        {inv.status === 'partial' && <span className="font-sans text-[12px] text-ink-muted-light">Paid: {formatCurrency(inv.paidAmount)}</span>}
                     </div>
                   </div>
                 </motion.div>
               ))}
             </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {showManualModal && <ManualSessionModal key="manual-session-modal" onClose={() => setShowManualModal(false)} />}
        {editingSession && <EditSessionModal key="edit-session-modal" session={editingSession} onClose={() => setEditingSession(null)} />}
        {showInvoiceModal && <ManualInvoiceModal key="manual-invoice-modal" onClose={() => setShowInvoiceModal(false)} />}
        {selectedInvoice && <InvoiceDetailsModal key="invoice-details-modal" invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
      </AnimatePresence>
    </div>
  );
}
