import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import type { WorkSession, UserProfile, Invoice } from './types';
import { handleFirestoreError, OperationType } from '../firebase';
import { calculateEarned, calculateCountedHours } from './utils';
import { useAuth } from '../contexts/AuthContext';

export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const docRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      } else {
        // Create default profile
        setDoc(docRef, { hourlyRate: 75 }).catch((err) => 
          handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}`)
        );
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const updateHourlyRate = async (newRate: number) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { hourlyRate: newRate });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  return { profile, loading, updateHourlyRate };
}

export function useWorkSessions() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'sessions'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WorkSession[];
      setSessions(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions`);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const activeSession = sessions.find(s => s.status === 'active' || s.status === 'paused');

  const startSession = async () => {
    if (!user || !profile || activeSession) return;
    const now = Date.now();
    const sessionData: Omit<WorkSession, "id"> = {
      userId: user.uid,
      startTime: now,
      currentSegmentStart: now,
      endTime: null,
      status: 'active',
      durationMs: 0,
      pauses: 0,
      hourlyRate: profile.hourlyRate,
      totalEarned: 0,
      countedHours: 0,
    };
    
    try {
      await addDoc(collection(db, 'users', user.uid, 'sessions'), {
        ...sessionData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions`);
    }
  };

  const pauseSession = async () => {
    if (!user || !activeSession || activeSession.status !== 'active') return;
    try {
      const elapsedSinceResume = Date.now() - activeSession.currentSegmentStart;
      const updatedDuration = (activeSession.durationMs || 0) + elapsedSinceResume;
      const hoursCounted = calculateCountedHours(updatedDuration);
      
      await updateDoc(doc(db, 'users', user.uid, 'sessions', activeSession.id!), {
        status: 'paused',
        durationMs: updatedDuration,
        pauses: (activeSession.pauses || 0) + 1,
        countedHours: hoursCounted,
        totalEarned: hoursCounted * activeSession.hourlyRate,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/sessions/${activeSession.id}`);
    }
  };

  const resumeSession = async () => {
    if (!user || !activeSession || activeSession.status !== 'paused') return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'sessions', activeSession.id!), {
        status: 'active',
        currentSegmentStart: Date.now(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
       handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/sessions/${activeSession.id}`);
    }
  };

  const endSession = async () => {
    if (!user || !activeSession) return;
    
    const isPaused = activeSession.status === 'paused';
    const elapsedSinceResume = isPaused ? 0 : (Date.now() - activeSession.currentSegmentStart);
    const finalDuration = (activeSession.durationMs || 0) + elapsedSinceResume;
    const finalCounted = calculateCountedHours(finalDuration);
    const finalEarned = finalCounted * activeSession.hourlyRate;

    try {
      await updateDoc(doc(db, 'users', user.uid, 'sessions', activeSession.id!), {
        status: 'completed',
        endTime: Date.now(),
        durationMs: finalDuration,
        countedHours: finalCounted,
        totalEarned: finalEarned,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/sessions/${activeSession.id}`);
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'sessions', sessionId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions/${sessionId}`);
    }
  };

  const addManualSession = async (sessionData: Omit<WorkSession, "id" | "userId" | "createdAt" | "updatedAt">) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'sessions'), {
        ...sessionData,
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/sessions`);
    }
  };

  const editSession = async (sessionId: string, sessionData: Partial<WorkSession>) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'sessions', sessionId), {
        ...sessionData,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/sessions/${sessionId}`);
    }
  };

  return { sessions, loading, startSession, pauseSession, resumeSession, endSession, activeSession, deleteSession, addManualSession, editSession };
}

export function useInvoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setInvoices([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'invoices'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Invoice[];
      setInvoices(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/invoices`);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const addInvoice = async (invoiceData: Omit<Invoice, "id" | "userId" | "createdAt" | "updatedAt">) => {
    if (!user) return;
    try {
      const result = await addDoc(collection(db, 'users', user.uid, 'invoices'), {
        ...invoiceData,
        userId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return result.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/invoices`);
    }
  };

  const editInvoice = async (invoiceId: string, invoiceData: Partial<Invoice>) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'invoices', invoiceId), {
        ...invoiceData,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/invoices/${invoiceId}`);
    }
  };

  const deleteInvoice = async (invoiceId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'invoices', invoiceId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/invoices/${invoiceId}`);
    }
  };

  return { invoices, loading, addInvoice, editInvoice, deleteInvoice };
}
