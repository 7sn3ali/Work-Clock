import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { motion, AnimatePresence } from 'motion/react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex bg-cloud-surface dark:bg-obsidian-surface p-1 rounded-full shadow-[0_4px_12px_rgb(0,0,0,0.04)] dark:shadow-[0_4px_12px_rgb(0,0,0,0.2)] border border-soft-divider-light/30 dark:border-soft-divider-dark/30">
      <button
        onClick={() => setTheme('light')}
        className={`relative p-2 rounded-full transition-colors z-10 ${
          theme === 'light' ? 'text-action-indigo' : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-ink-primary-dark'
        }`}
        title="Light Mode"
      >
        {theme === 'light' && (
          <motion.div
            layoutId="theme-bubble"
            className="absolute inset-0 bg-action-indigo/10 dark:bg-action-indigo/20 rounded-full"
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          />
        )}
        <Sun className="w-[18px] h-[18px] relative z-20" />
      </button>

      <button
        onClick={() => setTheme('system')}
        className={`relative p-2 rounded-full transition-colors z-10 ${
          theme === 'system' ? 'text-action-indigo dark:text-[#818CF8]' : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-ink-primary-dark'
        }`}
        title="System Theme"
      >
        {theme === 'system' && (
          <motion.div
            layoutId="theme-bubble"
            className="absolute inset-0 bg-action-indigo/10 dark:bg-action-indigo/20 rounded-full"
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          />
        )}
        <Monitor className="w-[18px] h-[18px] relative z-20" />
      </button>

      <button
        onClick={() => setTheme('dark')}
        className={`relative p-2 rounded-full transition-colors z-10 ${
          theme === 'dark' ? 'text-[#818CF8]' : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-ink-primary-dark'
        }`}
        title="Dark Mode"
      >
        {theme === 'dark' && (
          <motion.div
            layoutId="theme-bubble"
            className="absolute inset-0 bg-action-indigo/10 dark:bg-action-indigo/20 rounded-full"
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          />
        )}
        <Moon className="w-[18px] h-[18px] relative z-20" />
      </button>
    </div>
  );
}
