import React, { useState, useEffect } from 'react';
import { useUserProfile } from '../lib/hooks';
import { formatCurrency } from '../lib/utils';
import { Save } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { motion } from 'motion/react';

export function SettingsView() {
  const { profile, loading, updateHourlyRate } = useUserProfile();
  const [rateInput, setRateInput] = useState('');
  const { showToast } = useToast();
  
  useEffect(() => {
    if (profile) {
      setRateInput(profile.hourlyRate.toString());
    }
  }, [profile]);

  if (loading) return null;

  const handleSave = async () => {
    const rate = parseFloat(rateInput);
    if (!isNaN(rate) && rate >= 0) {
      await updateHourlyRate(rate);
      showToast('Changes have been saved');
    }
  };

  const isUnchanged = parseFloat(rateInput) === profile?.hourlyRate || rateInput === '';

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-col gap-6"
    >
      <motion.div 
        whileHover={{ y: -2, boxShadow: '0 12px 30px rgba(0,0,0,0.03)' }}
        className="bg-cloud-surface dark:bg-obsidian-surface rounded-[24px] p-6 shadow-[0_4px_12px_rgb(0,0,0,0.04)] border border-soft-divider-light/30 dark:border-soft-divider-dark/30 transition-all duration-350"
      >
        <h3 className="font-rounded text-[22px] font-bold text-ink-primary-light dark:text-ink-primary-dark mb-2">Hourly Rate</h3>
        <p className="font-sans text-[16px] text-ink-muted-light dark:text-ink-muted-dark mb-6">
          Set your default hourly rate in <span className="font-thmanyah">ر.س</span>. This will be used to calculate earnings for future sessions.
        </p>
        
        <div className="flex gap-4 items-center">
          <div className="relative flex-1 group">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-thmanyah text-[17px] text-ink-muted-light group-focus-within:text-action-indigo font-semibold transition-colors duration-300">ر.س</span>
            <input
              type="number"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              className="w-full bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark font-mono font-medium text-[17px] pl-16 pr-4 py-4 rounded-[16px] border border-soft-divider-light/50 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 transition-all duration-300"
              placeholder="75"
              min="0"
              step="1"
            />
          </div>
          <motion.button
            whileHover={!isUnchanged ? { scale: 1.03, boxShadow: '0 8px 20px rgba(79, 70, 229, 0.3)' } : {}}
            whileTap={!isUnchanged ? { scale: 0.97 } : {}}
            onClick={handleSave}
            disabled={isUnchanged}
            className="bg-action-indigo text-white font-rounded font-semibold text-[17px] px-6 py-4 rounded-[16px] shadow-[0_8px_20px_rgb(79,70,229,0.15)] hover:bg-action-indigo/95 disabled:opacity-50 disabled:shadow-none transition-all flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-5 h-5" />
            Save
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
