import { FieldValue } from 'firebase/firestore';

export interface UserProfile {
  hourlyRate: number;
}

export type WorkSessionStatus = 'active' | 'paused' | 'completed';

export interface WorkSession {
  id?: string;
  userId: string;
  startTime: number;
  currentSegmentStart: number;
  endTime: number | null;
  status: WorkSessionStatus;
  durationMs: number;
  pauses: number;
  hourlyRate: number;
  totalEarned: number;
  countedHours?: number;
  invoiced?: boolean;
  invoiceId?: string; // Links this session to an invoice
  paid?: boolean;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
  paidAmount?: number;
  previouslyPaidAmount?: number;
  createdAt?: any; // serverTimestamp
  updatedAt?: any; // serverTimestamp
}

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid';

export interface Invoice {
  id?: string;
  userId: string;
  reference: string;
  service?: string;
  date: number;
  dueDate?: number;
  clientName: string;
  totalAmount: number;
  totalHours: number;
  status: InvoiceStatus;
  paidAmount: number;
  sessionIds: string[];
  previousInvoiceIds?: string[];
  discountType?: 'fixed' | 'percent' | null;
  discountValue?: number;
  subtotal?: number;
  itemsSnapshot?: {
    id: string;
    type: 'session' | 'invoice';
    startTime?: number;
    endTime?: number | null;
    pauses?: number;
    hourlyRate?: number;
    countedHours?: number;
    durationMs?: number;
    totalEarned?: number;
    paymentStatus?: 'unpaid' | 'partial' | 'paid';
    paidAmount?: number;
    previouslyPaidAmount?: number;
    reference?: string;
    date?: number;
    totalAmount?: number;
  }[];
  createdAt?: any;
  updatedAt?: any;
}
