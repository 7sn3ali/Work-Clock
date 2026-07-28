import React, { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { LogIn, Clock, FileText, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { TimerView } from './components/TimerView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { ThemeToggle } from './components/ThemeToggle';
import { motion, AnimatePresence } from 'motion/react';

function AuthScreen() {
  const { login } = useAuth();
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-morning-paper dark:bg-midnight-canvas p-6 relative overflow-hidden">
      {/* Top action bar */}
      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle />
      </div>

      {/* Dynamic Ambient Background Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-gradient-to-tr from-blue-500/20 to-indigo-500/20 rounded-full blur-3xl animate-pulse duration-[8000ms]" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-full blur-3xl animate-pulse duration-[6000ms] delay-1000" />
      
      <motion.div 
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        className="bg-cloud-surface/80 dark:bg-obsidian-surface/80 backdrop-blur-md p-10 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)] max-w-sm w-full text-center relative z-10 border border-white/20 dark:border-white/5"
      >
        <div className="w-20 h-20 bg-focus-mint rounded-[1.25rem] mx-auto flex items-center justify-center mb-6 relative group">
          <div className="absolute inset-0 bg-focus-mint rounded-[1.25rem] blur-xl opacity-50 group-hover:opacity-100 transition-opacity duration-500" />
          <Clock className="w-10 h-10 text-focus-mint-text relative z-10 animate-spin-slow" />
        </div>
        <h1 className="font-rounded text-3xl font-bold text-ink-primary-light dark:text-ink-primary-dark mb-2">Work Clock</h1>
        <p className="text-ink-muted-light dark:text-ink-muted-dark font-sans text-[17px] mb-8">Track your hours peacefully.</p>
        
        <motion.button
          whileHover={{ scale: 1.02, boxShadow: '0 0 20px rgba(79, 70, 229, 0.4)' }}
          whileTap={{ scale: 0.98 }}
          onClick={login}
          className="w-full flex items-center justify-center gap-3 bg-action-indigo text-white font-rounded font-semibold text-[17px] py-4 rounded-[1.25rem] transition-all relative overflow-hidden"
        >
          <LogIn className="w-5 h-5" />
          Sign in with Google
        </motion.button>
      </motion.div>
    </div>
  );
}

function MainApp() {
  const [activeTab, setActiveTab] = useState<'timer' | 'reports' | 'settings'>('timer');
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen relative pb-28 pt-10 px-5 sm:px-10 max-w-2xl mx-auto flex flex-col">
      {/* Background soft glowing orbs */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-indigo-500/5 dark:bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

      <header className="flex items-center justify-between mb-8">
        <h2 className="font-rounded text-[28px] font-bold text-ink-primary-light dark:text-ink-primary-dark tracking-[0.36px]">
          {activeTab === 'timer' && 'Time Tracker'}
          {activeTab === 'reports' && 'Reports'}
          {activeTab === 'settings' && 'Settings'}
        </h2>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={logout} 
            className="p-3 bg-cloud-surface dark:bg-obsidian-surface rounded-full shadow-[0_4px_12px_rgb(0,0,0,0.04)] dark:shadow-[0_4px_12px_rgb(0,0,0,0.2)] text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-ink-primary-dark transition-colors border border-soft-divider-light/30 dark:border-soft-divider-dark/30" 
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </motion.button>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="flex-1 flex flex-col"
          >
            {activeTab === 'timer' && <TimerView />}
            {activeTab === 'reports' && <ReportsView />}
            {activeTab === 'settings' && <SettingsView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Tab Bar */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-cloud-surface/85 dark:bg-obsidian-surface/85 backdrop-blur-lg px-2 py-2 rounded-[28px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] flex items-center justify-between gap-1 border border-white/25 dark:border-white/5 max-w-[340px] w-full z-40">
        <button
          onClick={() => setActiveTab('timer')}
          className={`relative flex flex-col items-center gap-1 py-3 px-4 rounded-[22px] flex-1 transition-colors duration-300 z-10 ${
            activeTab === 'timer' ? 'text-action-indigo dark:text-white' : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-ink-primary-dark'
          }`}
        >
          {activeTab === 'timer' && (
            <motion.div 
              layoutId="activeTabPill"
              className="absolute inset-0 bg-action-indigo/10 dark:bg-action-indigo/20 rounded-[22px] border border-action-indigo/20 dark:border-action-indigo/30 shadow-[0_0_15px_rgba(79,70,229,0.15)] dark:shadow-[0_0_20px_rgba(79,70,229,0.3)]"
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
            />
          )}
          <Clock className={`w-5 h-5 relative z-20 ${activeTab === 'timer' ? 'stroke-[2.5px]' : ''}`} />
          <span className="font-sans text-[11px] font-semibold tracking-[0.06px] relative z-20">Timer</span>
        </button>
        
        <button
          onClick={() => setActiveTab('reports')}
          className={`relative flex flex-col items-center gap-1 py-3 px-4 rounded-[22px] flex-1 transition-colors duration-300 z-10 ${
            activeTab === 'reports' ? 'text-action-indigo dark:text-white' : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-ink-primary-dark'
          }`}
        >
          {activeTab === 'reports' && (
            <motion.div 
              layoutId="activeTabPill"
              className="absolute inset-0 bg-action-indigo/10 dark:bg-action-indigo/20 rounded-[22px] border border-action-indigo/20 dark:border-action-indigo/30 shadow-[0_0_15px_rgba(79,70,229,0.15)] dark:shadow-[0_0_20px_rgba(79,70,229,0.3)]"
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
            />
          )}
          <FileText className={`w-5 h-5 relative z-20 ${activeTab === 'reports' ? 'stroke-[2.5px]' : ''}`} />
          <span className="font-sans text-[11px] font-semibold tracking-[0.06px] relative z-20">Reports</span>
        </button>
        
        <button
          onClick={() => setActiveTab('settings')}
          className={`relative flex flex-col items-center gap-1 py-3 px-4 rounded-[22px] flex-1 transition-colors duration-300 z-10 ${
            activeTab === 'settings' ? 'text-action-indigo dark:text-white' : 'text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-ink-primary-dark'
          }`}
        >
          {activeTab === 'settings' && (
            <motion.div 
              layoutId="activeTabPill"
              className="absolute inset-0 bg-action-indigo/10 dark:bg-action-indigo/20 rounded-[22px] border border-action-indigo/20 dark:border-action-indigo/30 shadow-[0_0_15px_rgba(79,70,229,0.15)] dark:shadow-[0_0_20px_rgba(79,70,229,0.3)]"
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
            />
          )}
          <SettingsIcon className={`w-5 h-5 relative z-20 ${activeTab === 'settings' ? 'stroke-[2.5px]' : ''}`} />
          <span className="font-sans text-[11px] font-semibold tracking-[0.06px] relative z-20">Settings</span>
        </button>
      </nav>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-morning-paper dark:bg-midnight-canvas"></div>;
  }

  return user ? <MainApp /> : <AuthScreen />;
}
