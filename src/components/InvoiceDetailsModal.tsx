import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Save,
  Trash2,
  Receipt,
  AlertCircle,
  Download,
  Printer,
  Eye,
  Lock,
} from "lucide-react";
import { useInvoices, useWorkSessions } from "../lib/hooks";
import { Invoice, WorkSession } from "../lib/types";
import { format } from "date-fns";
import { useToast } from "../contexts/ToastContext";
import {
  formatDuration,
  formatCurrency,
  formatCurrencyString,
  calculateCountedHours,
} from "../lib/utils";
// @ts-ignore
import html2pdf from "html2pdf.js";

function stripUnsupportedColors(css: string): string {
  if (!css) return css;

  // 1. Replace oklch(...) color function with a safe fallback (handling nested parentheses gracefully up to 3 levels)
  const oklchRegex = /oklch\((?:[^()]+|\((?:[^()]+|\([^()]*\))*\))*\)/gi;
  let cleaned = css.replace(oklchRegex, "rgb(100, 116, 139)");

  // 2. Replace oklab(...) color function with a safe fallback
  const oklabRegex = /oklab\((?:[^()]+|\((?:[^()]+|\([^()]*\))*\))*\)/gi;
  cleaned = cleaned.replace(oklabRegex, "rgb(100, 116, 139)");

  // 3. Replace color-mix(...) function which can hold oklch/oklab and isn't supported by html2canvas
  const colorMixRegex = /color-mix\((?:[^()]+|\((?:[^()]+|\([^()]*\))*\))*\)/gi;
  cleaned = cleaned.replace(colorMixRegex, "rgb(156, 163, 175)");

  // 4. Replace any gradient interpolation modifier like "in oklab" or "in oklch"
  const inOklRegex = /\s+in\s+okl(ab|ch)\b/gi;
  cleaned = cleaned.replace(inOklRegex, "");

  return cleaned;
}

function f(val: number | string): string {
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function InvoiceDetailsModal({
  invoice,
  onClose,
}: {
  invoice: Invoice;
  onClose: () => void;
}) {
  const { invoices, editInvoice, deleteInvoice } = useInvoices();
  const { sessions, editSession } = useWorkSessions();
  const { showToast } = useToast();

  const [dateStr, setDateStr] = useState(
    format(new Date(invoice.date), "yyyy-MM-dd"),
  );
  const [dueDateStr, setDueDateStr] = useState(
    format(new Date(invoice.dueDate || invoice.date), "yyyy-MM-dd"),
  );
  const [totalAmount, setTotalAmount] = useState(
    invoice.totalAmount.toString(),
  );
  const [service, setService] = useState(invoice.service || "");
  const [status, setStatus] = useState<"draft" | "sent" | "partial" | "paid">(
    invoice.status,
  );
  const [paidAmount, setPaidAmount] = useState(invoice.paidAmount.toString());
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [docType, setDocType] = useState<"invoice" | "receipt">("invoice");

  const [discountType, setDiscountType] = useState<"fixed" | "percent" | null>(
    invoice.discountType || null,
  );
  const [discountValue, setDiscountValue] = useState<string>(
    invoice.discountValue?.toString() || "",
  );
  const [subtotal, setSubtotal] = useState<number>(
    invoice.subtotal || invoice.totalAmount,
  );

  const isEditable = invoice.status === "draft";

  // Filter sessions and rolled previous invoices included in this invoice
  const matchingSessions = sessions.filter(
    (s) => s.invoiceId === invoice.id || invoice.sessionIds?.includes(s.id!),
  );
  const matchingInvoices = invoices.filter((i) =>
    invoice.previousInvoiceIds?.includes(i.id!),
  );

  // Rendered sessions inside this invoice modal (frozen if itemsSnapshot exists)
  const renderedSessions = React.useMemo(() => {
    let result = [];
    if (invoice.itemsSnapshot && invoice.itemsSnapshot.length > 0) {
      result = invoice.itemsSnapshot
        .filter((item) => item.type === "session")
        .map((item) => ({
          id: item.id,
          startTime: item.startTime || 0,
          endTime: item.endTime || null,
          pauses: item.pauses || 0,
          hourlyRate: item.hourlyRate || 0,
          countedHours: item.countedHours !== undefined ? item.countedHours : 0,
          durationMs: item.durationMs || 0,
          totalEarned: item.totalEarned || 0,
          paymentStatus: item.paymentStatus || "unpaid",
          paidAmount: item.paidAmount || 0,
          previouslyPaidAmount: item.previouslyPaidAmount || 0,
        }));
    } else {
      result = [...matchingSessions];
    }
    return result.sort((a, b) => a.startTime - b.startTime);
  }, [invoice.itemsSnapshot, matchingSessions]);

  const getPrevPaid = (s: any) => {
    if (s.previouslyPaidAmount !== undefined && s.previouslyPaidAmount !== null && s.previouslyPaidAmount > 0) {
      return s.previouslyPaidAmount;
    }
    const rawSession = sessions.find((rs) => rs.id === s.id);
    if (rawSession) {
      if (rawSession.previouslyPaidAmount !== undefined && rawSession.previouslyPaidAmount !== null && rawSession.previouslyPaidAmount > 0) {
        return rawSession.previouslyPaidAmount;
      }
      if (invoice.status === "draft" || invoice.status === "sent") {
        return rawSession.paidAmount || 0;
      }
      const totalPaidOnSessionDb = rawSession.paidAmount || 0;
      const paidOnThisInvoice = s.paidAmount || 0;
      return Math.max(0, totalPaidOnSessionDb - paidOnThisInvoice);
    }
    if (invoice.status === "draft" || invoice.status === "sent") {
      return s.paidAmount || 0;
    }
    return 0;
  };

  // Track the payment details for each session in this invoice
  // Key: session ID, Value: { paymentStatus: 'unpaid' | 'partial' | 'paid', paidAmount: number }
  const [sessionPayments, setSessionPayments] = useState<
    Record<
      string,
      { paymentStatus: "unpaid" | "partial" | "paid"; paidAmount: number }
    >
  >({});

  const hasInitializedPaymentsRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (
      hasInitializedPaymentsRef.current === invoice.id &&
      Object.keys(sessionPayments).length > 0
    )
      return;
    if (renderedSessions.length === 0) return;

    const initial: Record<
      string,
      { paymentStatus: "unpaid" | "partial" | "paid"; paidAmount: number }
    > = {};

    if (invoice.itemsSnapshot && invoice.itemsSnapshot.length > 0) {
      invoice.itemsSnapshot.forEach((item) => {
        if (item.type === "session") {
          initial[item.id] = {
            paymentStatus: (item.paymentStatus as "unpaid" | "partial" | "paid") || "unpaid",
            paidAmount: item.paidAmount || 0,
          };
        }
      });
    } else {
      renderedSessions.forEach((s) => {
        const prevPaid = getPrevPaid(s);
        const totalPaidOnSession = s.paidAmount || 0;
        const paidInInvoice = Math.max(0, totalPaidOnSession - prevPaid);

        let invoicePaymentStatus: "unpaid" | "partial" | "paid" = "unpaid";
        const actualStatus = s.paymentStatus || (s.paid ? "paid" : "unpaid");
        if (actualStatus === "paid") {
          invoicePaymentStatus = "paid";
        } else if (actualStatus === "partial" || paidInInvoice > 0) {
          invoicePaymentStatus = "partial";
        }

        initial[s.id!] = {
          paymentStatus: invoicePaymentStatus,
          paidAmount: parseFloat(paidInInvoice.toFixed(2)),
        };
      });
    }

    setSessionPayments(initial);
    hasInitializedPaymentsRef.current = invoice.id!;
  }, [renderedSessions, invoice.id, invoice.itemsSnapshot]);

  const hasSessionPaymentsChanged = renderedSessions.some((s) => {
    const current = sessionPayments[s.id!];
    if (!current) return false;

    let originalInvoicePaymentStatus: "unpaid" | "partial" | "paid" = "unpaid";
    let originalPaidInInvoice = 0;

    if (invoice.itemsSnapshot && invoice.itemsSnapshot.length > 0) {
      const snapItem = invoice.itemsSnapshot.find(
        (item) => item.type === "session" && item.id === s.id,
      );
      if (snapItem) {
        originalInvoicePaymentStatus =
          (snapItem.paymentStatus as "unpaid" | "partial" | "paid") || "unpaid";
        originalPaidInInvoice = snapItem.paidAmount || 0;
      }
    } else {
      const prevPaid = getPrevPaid(s);
      const totalPaidOnSession = s.paidAmount || 0;
      originalPaidInInvoice = Math.max(0, totalPaidOnSession - prevPaid);

      const actualStatus = s.paymentStatus || (s.paid ? "paid" : "unpaid");
      if (actualStatus === "paid") {
        originalInvoicePaymentStatus = "paid";
      } else if (actualStatus === "partial" || originalPaidInInvoice > 0) {
        originalInvoicePaymentStatus = "partial";
      }
    }

    return (
      current.paymentStatus !== originalInvoicePaymentStatus ||
      Math.abs(current.paidAmount - originalPaidInInvoice) > 0.005
    );
  });

  const handleSessionPaymentStatusChange = (
    sessionId: string,
    newPaymentStatus: "unpaid" | "partial" | "paid",
  ) => {
    setSessionPayments((prev) => {
      const existing = prev[sessionId];
      const session = renderedSessions.find((s) => s.id === sessionId);
      if (!session) return prev;

      const prevPaid = getPrevPaid(session);
      const maxInvoicePayable = Math.max(0, session.totalEarned - prevPaid);

      let amount = 0;
      if (newPaymentStatus === "paid") {
        amount = maxInvoicePayable;
      } else if (newPaymentStatus === "partial") {
        amount =
          existing?.paymentStatus === "partial"
            ? existing.paidAmount
            : Math.max(0, parseFloat((maxInvoicePayable / 2).toFixed(2)));
      }

      return {
        ...prev,
        [sessionId]: {
          paymentStatus: newPaymentStatus,
          paidAmount: amount,
        },
      };
    });
  };

  const handleSessionPaidAmountChange = (
    sessionId: string,
    amountStr: string,
  ) => {
    const val = parseFloat(amountStr) || 0;
    const session = renderedSessions.find((s) => s.id === sessionId);
    if (!session) return;

    const prevPaid = getPrevPaid(session);
    const maxInvoicePayable = Math.max(0, session.totalEarned - prevPaid);
    const clampedVal = Math.max(0, Math.min(maxInvoicePayable, val));

    setSessionPayments((prev) => ({
      ...prev,
      [sessionId]: {
        ...prev[sessionId],
        paidAmount: clampedVal,
      },
    }));
  };

  const saveSessionStatusChanges = async (
    newInvoiceStatus: "draft" | "sent" | "partial" | "paid",
  ) => {
    if (newInvoiceStatus === "paid") {
      for (const s of matchingSessions) {
        await editSession(s.id!, {
          paymentStatus: "paid",
          paid: true,
          paidAmount: s.totalEarned,
        });
      }
    } else if (newInvoiceStatus === "partial") {
      for (const s of matchingSessions) {
        const current = sessionPayments[s.id!];
        if (current) {
          const prevPaid = getPrevPaid(s);
          const newPaidAmount = prevPaid + current.paidAmount;
          const isFullyPaid = newPaidAmount >= s.totalEarned;

          await editSession(s.id!, {
            paymentStatus: isFullyPaid
              ? "paid"
              : newPaidAmount > 0
                ? "partial"
                : "unpaid",
            paid: isFullyPaid,
            paidAmount: parseFloat(newPaidAmount.toFixed(2)),
          });
        }
      }
    } else if (newInvoiceStatus === "sent") {
      for (const s of matchingSessions) {
        const prevPaid = getPrevPaid(s);
        await editSession(s.id!, {
          paymentStatus: prevPaid > 0 ? "partial" : "unpaid",
          paid: false,
          paidAmount: prevPaid,
        });
      }
    }
  };

  const handleUpdateStatus = async () => {
    try {
      await saveSessionStatusChanges(status);
      
      const updatePayload: any = { status };

      const snapshotToSave =
        status !== "draft"
          ? (invoice.itemsSnapshot && invoice.itemsSnapshot.length > 0
            ? invoice.itemsSnapshot.map((item) => {
                if (item.type === "session") {
                  const pm = sessionPayments[item.id] || { paymentStatus: "unpaid", paidAmount: 0 };
                  const prevPaid = getPrevPaid({
                    id: item.id,
                    previouslyPaidAmount: item.previouslyPaidAmount,
                    paidAmount: item.paidAmount
                  });
                  return {
                    ...item,
                    paymentStatus: pm.paymentStatus,
                    paidAmount: pm.paidAmount,
                    previouslyPaidAmount: prevPaid,
                  };
                }
                return item;
              })
            : [
                ...matchingSessions.map((s) => ({
                  id: s.id!,
                  type: "session" as const,
                  startTime: s.startTime,
                  endTime: s.endTime,
                  pauses: s.pauses,
                  hourlyRate: s.hourlyRate,
                  countedHours:
                    s.countedHours !== undefined
                      ? s.countedHours
                      : calculateCountedHours(s.durationMs),
                  durationMs: s.durationMs,
                  totalEarned: s.totalEarned,
                  paymentStatus: sessionPayments[s.id!]?.paymentStatus || (s.paid ? "paid" : "unpaid"),
                  paidAmount: sessionPayments[s.id!]?.paidAmount || 0,
                  previouslyPaidAmount: getPrevPaid(s),
                })),
                ...matchingInvoices.map((inv) => ({
                  id: inv.id!,
                  type: "invoice" as const,
                  reference: inv.reference,
                  date: inv.date,
                  totalAmount: inv.totalAmount,
                  paidAmount: inv.paidAmount || 0,
                })),
              ].sort((a, b) => {
                const dateA = a.type === "session" ? a.startTime : a.date;
                const dateB = b.type === "session" ? b.startTime : b.date;
                return dateA - dateB;
              })
            )
          : undefined;

      if (invoice.status === "draft") {
        updatePayload.paidAmount =
          status === "paid"
            ? parseFloat(totalAmount) || 0
            : parseFloat(paidAmount) || 0;
        updatePayload.subtotal = subtotal || parseFloat(totalAmount) || 0;
        updatePayload.discountType = discountType;
        updatePayload.discountValue = parseFloat(discountValue) || 0;
        updatePayload.totalAmount = parseFloat(totalAmount) || 0;
      } else {
        if (status === "paid") {
          updatePayload.paidAmount = parseFloat(totalAmount) || invoice.totalAmount || 0;
        } else if (status === "sent") {
          updatePayload.paidAmount = 0;
        } else if (status === "partial") {
          updatePayload.paidAmount = parseFloat(paidAmount) || 0;
        }
      }

      if (snapshotToSave) {
        updatePayload.itemsSnapshot = snapshotToSave;
      }
      
      await editInvoice(invoice.id!, updatePayload);
      showToast("Invoice status updated successfully");
      onClose();
    } catch (err) {
      console.error(err);
      showToast("Failed to update status");
    }
  };

  // Sync overall invoice paidAmount to the sum of included session paidAmounts on changes
  React.useEffect(() => {
    if (status === "partial") {
      const sum = Object.values(sessionPayments).reduce(
        (acc, curr) => acc + curr.paidAmount,
        0,
      );
      setPaidAmount(sum.toFixed(2));
    } else if (status === "paid") {
      setPaidAmount(totalAmount);
    } else {
      setPaidAmount("0");
    }
  }, [sessionPayments, status, totalAmount]);

  // Combine and sort by date oldest first. Use itemsSnapshot if it exists to keep invoice locked (immutable snapshot)
  const breakdownItems = React.useMemo(() => {
    if (invoice.itemsSnapshot && invoice.itemsSnapshot.length > 0) {
      return invoice.itemsSnapshot.map((item) => {
        if (item.type === "session") {
          const pm = sessionPayments[item.id];
          const paymentStatusOnThisInvoice = pm ? pm.paymentStatus : (item.paymentStatus || "unpaid");
          const paidAmountOnThisInvoice = pm ? pm.paidAmount : (item.paidAmount || 0);
          const prevPaid = getPrevPaid({
            id: item.id,
            previouslyPaidAmount: item.previouslyPaidAmount,
            paidAmount: item.paidAmount
          });

          return {
            id: item.id,
            type: "session" as const,
            date: item.startTime || 0,
            data: {
              id: item.id,
              startTime: item.startTime || 0,
              endTime: item.endTime || null,
              pauses: item.pauses || 0,
              hourlyRate: item.hourlyRate || 0,
              countedHours:
                item.countedHours !== undefined ? item.countedHours : 0,
              durationMs: item.durationMs || 0,
              totalEarned: item.totalEarned || 0,
              paymentStatus: paymentStatusOnThisInvoice,
              paidAmount: paidAmountOnThisInvoice,
              previouslyPaidAmount: prevPaid,
            },
          };
        } else {
          return {
            id: item.id,
            type: "invoice" as const,
            date: item.date || 0,
            data: {
              id: item.id,
              reference: item.reference || "",
              date: item.date || 0,
              totalAmount: item.totalAmount || 0,
              paidAmount: item.paidAmount || 0,
            },
          };
        }
      }).sort((a, b) => a.date - b.date);
    }

    return [
      ...matchingSessions.map((s) => {
        const pm = sessionPayments[s.id!];
        const paymentStatusOnThisInvoice = pm ? pm.paymentStatus : (s.paymentStatus || (s.paid ? "paid" : "unpaid"));
        const paidAmountOnThisInvoice = pm ? pm.paidAmount : (s.paidAmount || 0);
        const prevPaid = getPrevPaid(s);

        return {
          id: s.id!,
          type: "session" as const,
          date: s.startTime,
          data: {
            id: s.id!,
            startTime: s.startTime,
            endTime: s.endTime,
            pauses: s.pauses,
            hourlyRate: s.hourlyRate,
            countedHours: s.countedHours,
            durationMs: s.durationMs,
            totalEarned: s.totalEarned,
            paymentStatus: paymentStatusOnThisInvoice,
            paidAmount: paidAmountOnThisInvoice,
            previouslyPaidAmount: prevPaid,
          },
        };
      }),
      ...matchingInvoices.map((i) => ({
        id: i.id!,
        type: "invoice" as const,
        date: i.date,
        data: i,
      })),
    ].sort((a, b) => a.date - b.date);
  }, [invoice.id, invoice.itemsSnapshot, matchingSessions, matchingInvoices, sessionPayments, sessions]);

  const breakdownItemsHash = breakdownItems
    .map((item) => {
      if (item.type === "session") {
        const s = item.data;
        return `${item.id}-${s.totalEarned}-${s.paidAmount || 0}-${s.paymentStatus || ""}`;
      } else {
        const inv = item.data;
        return `${item.id}-${inv.totalAmount}-${inv.paidAmount || 0}`;
      }
    })
    .join(",");

  // Recalculate total amount when editing discount parameters in draft mode
  React.useEffect(() => {
    if (!isEditable) return;

    // Calculate raw subtotal from breakdown items (sessions and rollup invoices)
    let rawSubtotal = 0;
    breakdownItems.forEach((item) => {
      if (item.type === "session") {
        const s = item.data;
        const prevPaid = s.previouslyPaidAmount || 0;
        rawSubtotal += Math.max(0, s.totalEarned - prevPaid);
      } else {
        const inv = item.data;
        rawSubtotal += Math.max(0, inv.totalAmount - (inv.paidAmount || 0));
      }
    });

    let finalAmount = rawSubtotal;
    const discVal = parseFloat(discountValue) || 0;
    if (discountType === "percent") {
      finalAmount = Math.max(0, rawSubtotal - (rawSubtotal * discVal) / 100);
    } else if (discountType === "fixed") {
      finalAmount = Math.max(0, rawSubtotal - discVal);
    }

    setSubtotal(rawSubtotal);
    setTotalAmount(finalAmount.toFixed(2));
  }, [discountType, discountValue, isEditable, breakdownItemsHash]);

  const handleSave = async () => {
    try {
      await saveSessionStatusChanges(status);

      const snapshotToSave =
        status !== "draft" && !invoice.itemsSnapshot
          ? [
              ...matchingSessions.map((s) => ({
                id: s.id!,
                type: "session" as const,
                startTime: s.startTime,
                endTime: s.endTime,
                pauses: s.pauses,
                hourlyRate: s.hourlyRate,
                countedHours:
                  s.countedHours !== undefined
                    ? s.countedHours
                    : calculateCountedHours(s.durationMs),
                durationMs: s.durationMs,
                totalEarned: s.totalEarned,
                paymentStatus: sessionPayments[s.id!]?.paymentStatus || (s.paid ? "paid" : "unpaid"),
                paidAmount: sessionPayments[s.id!]?.paidAmount || 0,
                previouslyPaidAmount: getPrevPaid(s),
              })),
              ...matchingInvoices.map((inv) => ({
                id: inv.id!,
                type: "invoice" as const,
                reference: inv.reference,
                date: inv.date,
                totalAmount: inv.totalAmount,
                paidAmount: inv.paidAmount || 0,
              })),
            ].sort((a, b) => {
              const dateA = a.type === "session" ? a.startTime : a.date;
              const dateB = b.type === "session" ? b.startTime : b.date;
              return dateA - dateB;
            })
          : undefined;

      await editInvoice(invoice.id!, {
        date: new Date(dateStr).getTime(),
        dueDate: new Date(dueDateStr).getTime(),
        totalAmount: parseFloat(totalAmount) || 0,
        service,
        status,
        paidAmount:
          status === "paid"
            ? parseFloat(totalAmount) || 0
            : parseFloat(paidAmount) || 0,
        discountType,
        discountValue: parseFloat(discountValue) || 0,
        subtotal: subtotal || parseFloat(totalAmount) || 0,
        ...(snapshotToSave ? { itemsSnapshot: snapshotToSave } : {}),
      });

      showToast("Invoice updated successfully");
      onClose();
    } catch (err) {
      console.error(err);
      showToast("Failed to save invoice");
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const element = document.getElementById("invoice-print-element");
      if (!element) {
        showToast("Error: Printable frame was not found");
        return;
      }

      showToast("Preparing PDF generation...");

      // Gather CSS rules from the document styleSheets
      let cssText = "";
      const sheetsList = Array.from(document.styleSheets);
      for (const sheet of sheetsList) {
        try {
          // If it is a style tag, extract content
          const node = sheet.ownerNode as HTMLElement | null;
          if (node && node.tagName === "STYLE") {
            cssText += (node.textContent || "") + "\n";
          } else if (sheet.href) {
            try {
              const res = await fetch(sheet.href);
              if (res.ok) {
                cssText += (await res.text()) + "\n";
              }
            } catch (e) {
              // Ignore fetch errors due to CORS/network
            }
          }

          // Fetch rule by rule as well to capture any dynamically injected rules
          try {
            if (sheet.cssRules) {
              for (const rule of Array.from(sheet.cssRules)) {
                cssText += rule.cssText + "\n";
              }
            }
          } catch (rulesErr) {
            // CORS restriction can trigger this, which is fine as we fallback to standard text content
          }
        } catch (err) {
          console.warn("Error extracting CSS for PDF:", err);
        }
      }

      const filename = `${invoice.reference}-${(invoice.clientName || "Invoice").replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`;
      const htmlContent = element.outerHTML;

      // Call the server-side generate-pdf API
      const response = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          html: htmlContent,
          css: cssText,
          filename,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned error: ${response.statusText}`);
      }

      // Download the PDF file blob
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      showToast("Invoice PDF downloaded");
    } catch (error) {
      console.error("Failed to export PDF:", error);
      showToast("Failed to download PDF");
    }
  };

  const handleDelete = async () => {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }
    try {
      // Revert session payments back to their original states and unlock them
      await Promise.all(
        matchingSessions.map((s) => {
          const prevPaid = getPrevPaid(s);
          const isFullyPaid = prevPaid >= s.totalEarned;
          return editSession(s.id!, {
            invoiced: false,
            invoiceId: null,
            previouslyPaidAmount: null,
            paidAmount: prevPaid,
            paid: isFullyPaid,
            paymentStatus: isFullyPaid
              ? "paid"
              : prevPaid > 0
                ? "partial"
                : "unpaid",
          });
        }),
      );
    } catch (err) {
      console.error(
        "Failed to restore session payments during invoice delete:",
        err,
      );
    }
    await deleteInvoice(invoice.id!);
    showToast("Invoice deleted");
    onClose();
  };

  const handlePrint = () => {
    const element = document.getElementById("invoice-print-element");
    if (!element) return;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      let styleImports = "";
      Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach(
        (link: any) => {
          styleImports += `<link rel="stylesheet" href="${link.href}">`;
        },
      );
      Array.from(document.querySelectorAll("style")).forEach((style: any) => {
        styleImports += `<style>${style.textContent}</style>`;
      });

      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Print Invoice ${invoice.reference}</title>
            ${styleImports}
            <style>
              @media print {
                @page {
                  size: A4 portrait;
                  margin: 0;
                }
                body {
                  margin: 0;
                  padding: 0;
                  background-color: #ffffff !important;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .print-root {
                  width: 210mm;
                  min-height: 297mm;
                  box-sizing: border-box;
                  margin: 0 auto;
                }
                tr {
                  page-break-inside: avoid !important;
                }
                .print-avoid-break {
                  page-break-inside: avoid !important;
                }
              }
            </style>
          </head>
          <body>
            <div class="print-root">
              ${element.outerHTML}
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.focus();
                  window.print();
                  setTimeout(function() {
                    window.parent.document.body.removeChild(window.frameElement);
                  }, 500);
                }, 500);
              };
            </script>
          </body>
        </html>
      `);
      doc.close();
    }
  };

  const computedPaid =
    status === "paid"
      ? parseFloat(totalAmount) || 0
      : status === "draft" || status === "sent"
        ? 0
        : parseFloat(paidAmount) || 0;
  const balanceRemaining = Math.max(
    0,
    (parseFloat(totalAmount) || 0) - computedPaid,
  );

  const discValue = parseFloat(discountValue) || 0;
  const computedDiscount = discountType
    ? discountType === "percent"
      ? (subtotal * discValue) / 100
      : discValue
    : 0;

  // Static/immutable values for printable invoices (non-draft / locked status)
  const isInvoiceDraft = invoice.status === "draft";

  const totalHours = React.useMemo(() => {
    let sum = 0;
    breakdownItems.forEach((item) => {
      if (item.type === "session") {
        const s = item.data;
        const hours = s.countedHours !== undefined ? s.countedHours : calculateCountedHours(s.durationMs);
        sum += hours;
      }
    });
    return sum;
  }, [breakdownItems]);

  const displaySubtotal = isInvoiceDraft
    ? subtotal
    : (invoice.subtotal || invoice.totalAmount);

  const displayDiscount = isInvoiceDraft
    ? computedDiscount
    : (invoice.discountType
        ? invoice.discountType === "percent"
          ? ((invoice.subtotal || invoice.totalAmount) * (invoice.discountValue || 0)) / 100
          : (invoice.discountValue || 0)
        : 0);

  const displayTotalAmount = isInvoiceDraft
    ? (parseFloat(totalAmount) || 0)
    : invoice.totalAmount;

  const displayPaidAmount = isInvoiceDraft
    ? computedPaid
    : (status === "paid"
        ? invoice.totalAmount
        : status === "sent"
          ? 0
          : invoice.paidAmount || 0);

  const displayBalanceDue = Math.max(
    0,
    displayTotalAmount - displayPaidAmount
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-midnight-canvas/40 backdrop-blur-sm">
      {/* Hidden Premium A4 Printable HTML Invoice */}
      <div
        id="invoice-print-container"
        style={{
          position: "absolute",
          left: "-9999px",
          top: "-9999px",
          width: "210mm",
        }}
      >
        <div
          id="invoice-print-element"
          className="w-[210mm] min-h-[297mm] bg-white text-slate-850 font-sans flex flex-col justify-between border-t-[6px] border-[#121318]"
          style={{
            boxSizing: "border-box",
            padding: "10mm 12mm",
            backgroundColor: "#ffffff",
            color: "#1e293b",
            fontFamily: "Thmanyah, system-ui, -apple-system, sans-serif",
          }}
        >
          {/* Top Header */}
          <div className="flex justify-between items-start border-b border-[#121318]/10 pb-2.5">
            <div className="flex flex-col justify-center min-h-[44px]">
              <span className="font-sans text-[22px] font-extrabold tracking-tight text-[#121318] leading-none">
                Hassan Alhussain
              </span>
            </div>
            <div className="text-right flex flex-col items-end">
              <h1 className="font-thmanyah text-[30px] font-normal tracking-wide text-slate-900 uppercase leading-none mb-0.5">
                {docType === "invoice" ? "INVOICE" : "PAYMENT RECEIPT"}
              </h1>
              <div>
                <span className="font-sans text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-[5px] border border-indigo-100/50">
                  {docType === "invoice" ? "NO." : "RECEIPT NO. REC-"} {invoice.reference}
                </span>
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-4 mt-3 mb-2.5 pb-2 border-b border-slate-100/80">
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block">
                {docType === "invoice" ? "BILLED TO" : "RECEIVED FROM"}
              </span>
              <div>
                <span className="text-[15px] font-bold text-[#121318] block font-thmanyah">
                  {invoice.clientName || "Valued Customer"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-2">
              <div>
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                  {docType === "invoice" ? "DATE OF ISSUE" : "DATE OF RECEIPT"}
                </span>
                <span className="text-[11px] font-semibold text-slate-750 block">
                  {format(new Date(invoice.date), "MMMM d, yyyy")}
                </span>
              </div>
              {docType === "invoice" && invoice.dueDate && (
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                    DUE DATE
                  </span>
                  <span className="text-[11px] font-semibold text-slate-750 block">
                    {format(new Date(invoice.dueDate), "MMMM d, yyyy")}
                  </span>
                </div>
              )}
              {docType === "receipt" && (
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                    PAYMENT STATUS
                  </span>
                  <span className={`text-[11px] font-bold uppercase block ${status === "paid" ? "text-emerald-600 font-sans" : "text-blue-600 font-sans"}`}>
                    {status === "paid" ? "Fully Paid" : "Partially Paid"}
                  </span>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                  SERVICE TYPE
                </span>
                <span className="text-[11px] font-semibold text-indigo-600 block">
                  {service || "Professional Creative Services"}
                </span>
              </div>
            </div>
          </div>

          {/* Table / Breakdown Grid */}
          <div className="flex-1 mt-1.5">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#121318]/10 bg-[#faf9f6]/95 rounded-lg">
                  <th className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] w-6">
                    #
                  </th>
                  <th className="py-1.5 px-2 text-[9px] font-bold uppercase tracking-wider text-[#6b7280]">
                    DESCRIPTION
                  </th>
                  <th className="py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] text-center w-16 whitespace-nowrap">
                    QTY / HOURS
                  </th>
                  <th className="py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] text-right w-20 whitespace-nowrap">
                    UNIT RATE
                  </th>
                  <th className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] text-right w-24 whitespace-nowrap">
                    AMOUNT
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdownItems.map((item, index) => {
                  const isEven = index % 2 === 1;
                  const bgClass = isEven ? "bg-[#faf9f6]/40" : "bg-transparent";
                  if (item.type === "session") {
                    const s = item.data;
                    const dateLabel = format(
                      new Date(s.startTime),
                      "MMM d, yyyy",
                    );
                    const tStart = format(new Date(s.startTime), "hh:mm a");
                    const tEnd = s.endTime
                      ? format(new Date(s.endTime), "hh:mm a")
                      : "Ongoing";
                    const hrs = (
                      s.countedHours !== undefined
                        ? s.countedHours
                        : calculateCountedHours(s.durationMs)
                    ).toFixed(0);

                    const prevPaid = s.previouslyPaidAmount || 0;
                    const sessionAmount = Math.max(0, s.totalEarned - prevPaid);
                    const totalPaid = prevPaid + (s.paidAmount || 0);
                    const isFullyPaid = (s.totalEarned - totalPaid) <= 0.005;
                    const hasAnyPayment = totalPaid > 0;

                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-slate-100/80 text-[12px] ${bgClass} transition-colors hover:bg-[#faf9f6]/60`}
                      >
                        <td className="py-1.5 px-3 text-slate-400 text-center font-medium">
                          {index + 1}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="font-bold text-[#1a1a1a] block font-thmanyah text-[14px]">
                            Work Session ({dateLabel})
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5 block font-mono">
                            Time: {tStart} to {tEnd}
                          </span>

                          {docType === "receipt" && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {isFullyPaid ? (
                                <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider">
                                  <span className="w-1 h-1 rounded-full bg-emerald-500" />
                                  Fully Paid
                                </span>
                              ) : hasAnyPayment ? (
                                <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider font-sans" dir="ltr">
                                  <span className="w-1 h-1 rounded-full bg-blue-500" />
                                  Partially Paid (Paid: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(totalPaid)}</span></span> / <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(s.totalEarned)}</span></span>)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-500 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider">
                                  <span className="w-1 h-1 rounded-full bg-slate-400" />
                                  Unpaid
                                </span>
                              )}
                            </div>
                          )}
                          {prevPaid > 0 && (
                            <span className="text-[10px] text-amber-600 font-medium mt-1 block leading-normal italic" style={{ color: '#d97706' }}>
                              Outstanding balance from a previous invoice.
                              <span className="text-[9px] text-slate-400 block mt-0.5 font-sans font-normal" dir="ltr">
                                (Original: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(s.totalEarned)}</span></span> | Prior Payments: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(prevPaid)}</span></span> | Billable Portion: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(sessionAmount)}</span></span>)
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-center font-medium text-slate-650 font-sans">
                          {hrs} hrs
                        </td>
                        <td className="py-1.5 text-right" dir="ltr">
                          <span className="inline-flex items-baseline gap-1 justify-end w-full">
                            <span className="font-thmanyah text-[16px] text-slate-400">
                              ر.س
                            </span>
                            <span className="font-sans text-[12px] font-bold text-slate-900">
                              {f(s.hourlyRate)}
                            </span>
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-right" dir="ltr">
                          <span className="inline-flex items-baseline gap-1 justify-end w-full">
                            <span className="font-thmanyah text-[16px] text-slate-400">
                              ر.س
                            </span>
                            <span className="font-sans text-[12px] font-bold text-slate-900">
                              {f(sessionAmount || 0)}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  } else {
                    const inv = item.data;
                    const remaining = inv.totalAmount - (inv.paidAmount || 0);
                    const isPartial = (inv.paidAmount || 0) > 0;
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-indigo-100/30 text-[12px] bg-indigo-50/25 hover:bg-indigo-50/35 transition-colors"
                      >
                        <td className="py-1.5 px-3 text-slate-400 text-center font-medium">
                          {index + 1}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="font-bold text-indigo-900 block font-thmanyah text-[14px]">
                            Outstanding balance from previous invoice (
                            {inv.reference})
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5 block font-sans">
                            {isPartial ? (
                              <>
                                Original Amount:{" "}
                                <span
                                  dir="ltr"
                                  className="inline-flex items-baseline gap-0.5"
                                >
                                  <span className="font-thmanyah">ر.س</span>
                                  <span>{f(inv.totalAmount)}</span>
                                </span>{" "}
                                • Paid Already:{" "}
                                <span
                                  dir="ltr"
                                  className="inline-flex items-baseline gap-0.5"
                                >
                                  <span className="font-thmanyah">ر.س</span>
                                  <span>{f(inv.paidAmount)}</span>
                                </span>
                              </>
                            ) : (
                              `Issued: ${format(new Date(inv.date), "MMM d, yyyy")}`
                            )}
                          </span>
                        </td>
                        <td className="py-1.5 text-center text-slate-450">-</td>
                        <td className="py-1.5 text-center text-slate-450">-</td>
                        <td className="py-1.5 px-3 text-right" dir="ltr">
                          <span className="inline-flex items-baseline gap-1 justify-end w-full">
                            <span className="font-thmanyah text-[16px] text-indigo-400">
                              ر.س
                            </span>
                            <span className="font-sans text-[12px] font-bold text-indigo-900">
                              {f(remaining)}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  }
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Section containing Summary box and nice footer notes */}
          <div className="grid grid-cols-12 gap-6 pt-3 mt-4 border-t border-slate-100 print-avoid-break">
            <div className="col-span-12 md:col-span-6 flex flex-col justify-end">
              <p className="text-[12px] font-bold text-slate-800 font-thmanyah mb-0.5">
                Thank you for your business!
              </p>
              <p className="text-[10px] text-slate-400 leading-relaxed font-sans max-w-sm">
                If you have any questions or inquiries regarding this invoice,
                please do not hesitate to email 7sn.3ali@gmail.com.
              </p>
            </div>
            <div className="col-span-12 md:col-span-6 flex-1">
              <div className="bg-[#faf9f6]/95 rounded-xl p-3 border border-[#121318]/5 flex flex-col gap-1.5">
                {docType === "invoice" ? (
                  <>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-[#6b7280] font-sans font-semibold">
                        Total Hours
                      </span>
                      <span className="font-sans text-[12px] font-bold text-slate-700">
                        {totalHours} hrs
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-[#6b7280] font-sans font-semibold">
                        Gross Total
                      </span>
                      <span
                        className="inline-flex items-baseline gap-1 font-bold text-slate-700"
                        dir="ltr"
                      >
                        <span className="font-thmanyah text-[14px] text-slate-400">
                          ر.س
                        </span>
                        <span className="font-sans text-[12px]">{f(displaySubtotal)}</span>
                      </span>
                    </div>
                    {displayDiscount > 0 && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-[#6b7280] font-sans font-semibold">
                          Discount
                          {discountType
                            ? ` (${discountType === "percent" ? `${discountValue}%` : "Fixed"})`
                            : ""}
                        </span>
                        <span
                          className="inline-flex items-baseline gap-1 font-bold text-emerald-600"
                          dir="ltr"
                        >
                          <span className="font-sans text-[12px] mr-0.5">-</span>
                          <span className="font-thmanyah text-[14px] text-emerald-500">
                            ر.س
                          </span>
                          <span className="font-sans text-[12px]">
                            {f(displayDiscount)}
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="h-px bg-slate-200/40 my-0.5"></div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-[13px] font-black text-[#4F46E5] uppercase tracking-wider font-sans">
                        Balance Due
                      </span>
                      <span
                        className="inline-flex items-baseline gap-1.5 text-[18px] font-black text-[#4F46E5]"
                        dir="ltr"
                      >
                        <span className="font-thmanyah text-[20px] text-indigo-500 font-bold">
                          ر.س
                        </span>
                        <span className="font-sans text-[16px] font-black">
                          {f(displayTotalAmount)}
                        </span>
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-[#6b7280] font-sans font-semibold">
                        Total Hours
                      </span>
                      <span className="font-sans text-[12px] font-bold text-slate-700">
                        {totalHours} hrs
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-[#6b7280] font-sans font-semibold">
                        Gross Total
                      </span>
                      <span
                        className="inline-flex items-baseline gap-1 font-bold text-slate-700"
                        dir="ltr"
                      >
                        <span className="font-thmanyah text-[14px] text-slate-400">
                          ر.س
                        </span>
                        <span className="font-sans text-[12px]">{f(displaySubtotal)}</span>
                      </span>
                    </div>
                    {displayDiscount > 0 && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-[#6b7280] font-sans font-semibold">
                          Discount
                          {discountType
                            ? ` (${discountType === "percent" ? `${discountValue}%` : "Fixed"})`
                            : ""}
                        </span>
                        <span
                          className="inline-flex items-baseline gap-1 font-bold text-emerald-600"
                          dir="ltr"
                        >
                          <span className="font-sans text-[12px] mr-0.5">-</span>
                          <span className="font-thmanyah text-[14px] text-emerald-500">
                            ر.س
                          </span>
                          <span className="font-sans text-[12px]">
                            {f(displayDiscount)}
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-[11px] border-t border-slate-100 pt-1.5 mt-0.5">
                      <span className="text-[#6b7280] font-sans font-semibold">
                        Total Invoice Value
                      </span>
                      <span
                        className="inline-flex items-baseline gap-1 font-bold text-slate-700"
                        dir="ltr"
                      >
                        <span className="font-thmanyah text-[14px] text-slate-400">
                          ر.س
                        </span>
                        <span className="font-sans text-[12px]">{f(displayTotalAmount)}</span>
                      </span>
                    </div>
                    <div className="h-px bg-slate-200/40 my-0.5"></div>
                    <div className="flex justify-between items-center py-1 bg-emerald-50/50 rounded-lg p-2 border border-emerald-100/30">
                      <span className="text-[13px] font-black text-emerald-600 uppercase tracking-wider font-sans">
                        Amount Received
                      </span>
                      <span
                        className="inline-flex items-baseline gap-1.5 text-[18px] font-black text-emerald-600"
                        dir="ltr"
                      >
                        <span className="font-thmanyah text-[20px] text-emerald-500 font-bold">
                          ر.س
                        </span>
                        <span className="font-sans text-[16px] font-black">
                          {f(displayPaidAmount)}
                        </span>
                      </span>
                    </div>
                    {displayBalanceDue > 0 && (
                      <div className="flex justify-between items-center text-[11px] mt-1">
                        <span className="text-slate-550 font-sans font-semibold">
                          Remaining Outstanding Balance
                        </span>
                        <span
                          className="inline-flex items-baseline gap-1 font-bold text-[#4F46E5]"
                          dir="ltr"
                        >
                          <span className="font-thmanyah text-[14px] text-indigo-400">
                            ر.س
                          </span>
                          <span className="font-sans text-[12px] font-bold">{f(displayBalanceDue)}</span>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-cloud-surface dark:bg-obsidian-surface w-full max-w-md rounded-[32px] shadow-[0_24px_60px_rgba(0,0,0,0.12)] p-8 relative flex flex-col max-h-[90vh]"
      >
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-action-indigo/10 dark:bg-action-indigo/20 text-action-indigo dark:text-[#818CF8] rounded-[12px] flex items-center justify-center">
            <Receipt className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-rounded text-[20px] font-bold text-ink-primary-light dark:text-ink-primary-dark">
                {invoice.reference}
              </h3>
              {invoice.status !== "draft" && (
                <span className="flex items-center gap-1 text-[10px] bg-red-50 dark:bg-red-950/30 text-amber-600 dark:text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/10 dark:border-amber-400/10">
                  <Lock className="w-3 h-3" />
                  Locked
                </span>
              )}
            </div>
            <p className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark">
              {invoice.clientName || "No Client Name"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto pr-2 pb-2">
          {invoice.status !== "draft" && (
            <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-400 p-3.5 rounded-[16px] font-sans text-[12px] mb-1 border border-amber-200/50 dark:border-amber-900/30 flex gap-2.5 items-start">
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="flex flex-col gap-0.5 leading-normal">
                <span className="font-bold text-amber-700 dark:text-amber-400">
                  Locked Invoice
                </span>
                <span>
                  The details (service type, discount, connected work sessions)
                  are permanent. You can update payment status or delete the
                  invoice.
                </span>
              </div>
            </div>
          )}
          {isConfirmingDelete && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-[16px] font-sans text-[14px] mb-2 border border-red-200 dark:border-red-900/50 flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>
                Are you sure you want to delete this invoice? This cannot be
                undone.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
                Date
              </label>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                disabled={!isEditable}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
                Due Date
              </label>
              <input
                type="date"
                value={dueDateStr}
                onChange={(e) => setDueDateStr(e.target.value)}
                disabled={!isEditable}
                className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
              Service Type
            </label>
            <input
              type="text"
              placeholder="e.g. Software Development, Consultation"
              value={service}
              onChange={(e) => setService(e.target.value)}
              disabled={!isEditable}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark text-[14px] px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
            />
          </div>

          {/* Discount Section */}
          <div className="flex flex-col gap-2 p-3 bg-morning-paper dark:bg-midnight-canvas rounded-2xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 mt-1">
            <span className="font-sans text-[13px] text-ink-primary-light dark:text-ink-primary-dark font-semibold">
              Discount
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[11px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
                  Type
                </label>
                <select
                  disabled={!isEditable}
                  value={discountType || ""}
                  onChange={(e) => {
                    const val =
                      e.target.value === ""
                        ? null
                        : (e.target.value as "fixed" | "percent");
                    setDiscountType(val);
                    if (!val) setDiscountValue("");
                  }}
                  className="w-full bg-cloud-surface dark:bg-obsidian-surface text-ink-primary-light dark:text-ink-primary-dark px-2.5 py-2.5 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 text-xs transition-all duration-300 disabled:opacity-60"
                >
                  <option value="">No Discount</option>
                  <option value="fixed">Fixed Amount (SAR)</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[11px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
                  Value
                </label>
                <input
                  type="number"
                  disabled={!isEditable || !discountType}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="0"
                  className="w-full bg-cloud-surface dark:bg-obsidian-surface text-ink-primary-light dark:text-ink-primary-dark px-2.5 py-2 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 text-xs disabled:opacity-50 transition-all duration-300"
                />
              </div>
            </div>
            {discountType && subtotal > 0 && (
              <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                Subtotal: {formatCurrency(subtotal)} • Discounted Total:{" "}
                {totalAmount} SAR
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
              Total Amount
            </label>
            <input
              type="number"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              disabled={!isEditable}
              className="w-full min-w-0 bg-morning-paper dark:bg-midnight-canvas text-ink-primary-light dark:text-ink-primary-dark px-3 py-3 rounded-xl border border-soft-divider-light/30 dark:border-soft-divider-dark/30 focus:border-action-indigo focus:outline-none focus:ring-4 focus:ring-action-indigo/15 disabled:opacity-60 transition-all duration-300"
            />
          </div>

          <div className="flex flex-col gap-1 mt-2 mb-2">
            <label className="font-sans text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
              Status
            </label>
            <div className="flex flex-wrap gap-2 text-sm">
              {invoice.status !== "draft"
                ? // For sent/partial/paid invoices, allow changing status between non-draft states
                  (["sent", "partial", "paid"] as const).map((s) => {
                    const isSelected = status === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={false}
                        onClick={() => setStatus(s)}
                        className={`flex-1 min-w-[70px] py-1.5 rounded-[10px] font-medium capitalize transition-all cursor-pointer ${status === s ? (s === "paid" ? "bg-emerald-500 text-white shadow-sm" : s === "partial" ? "bg-blue-500 text-white shadow-sm" : "bg-action-indigo text-white shadow-sm") : "bg-cloud-surface dark:bg-obsidian-surface text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-[#F3F4F6] border border-soft-divider-light/30 dark:border-soft-divider-dark/30"}`}
                      >
                        {s === "paid"
                          ? "Fully Paid"
                          : s === "partial"
                            ? "Partially Paid"
                            : s}
                      </button>
                    );
                  })
                : // For draft invoices, allow switching between all statuses
                  (["draft", "sent", "partial", "paid"] as const).map((s) => {
                    const isSelected = status === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={!isEditable}
                        onClick={() => setStatus(s)}
                        className={`flex-1 min-w-[70px] py-1.5 rounded-[10px] font-medium capitalize transition-all ${status === s ? (s === "paid" ? "bg-emerald-500 text-white shadow-sm" : s === "partial" ? "bg-blue-500 text-white shadow-sm" : "bg-action-indigo text-white shadow-sm") : "bg-cloud-surface dark:bg-obsidian-surface text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light dark:hover:text-[#F3F4F6] border border-soft-divider-light/30 dark:border-soft-divider-dark/30"}`}
                      >
                        {s === "paid"
                          ? "Fully Paid"
                          : s === "partial"
                            ? "Partially Paid"
                            : s}
                      </button>
                    );
                  })}
            </div>

            <AnimatePresence>
              {status === "partial" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-col gap-3 mt-4 overflow-hidden border border-[#121318]/5 dark:border-[#e8e6e0]/5 rounded-2xl p-4 bg-morning-paper dark:bg-midnight-canvas shadow-inner"
                >
                  <div className="flex justify-between items-center mb-1">
                    <label className="font-sans text-[13px] text-ink-primary-light dark:text-ink-primary-dark font-extrabold uppercase tracking-wider">
                      Itemized Session Payments
                    </label>
                    <span className="text-[11px] font-bold text-action-indigo dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/20 px-2.5 py-0.5 rounded-lg border border-indigo-100/30 dark:border-indigo-900/10">
                      Sum Paid: {formatCurrency(parseFloat(paidAmount) || 0)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
                    {renderedSessions.length === 0 ? (
                      <div className="text-center py-4 text-xs text-ink-muted-light dark:text-ink-muted-dark font-sans">
                        No sessions connected to this invoice yet.
                      </div>
                    ) : (
                      renderedSessions.map((session) => {
                        const prevPaid = getPrevPaid(session);
                        const maxInvoicePayable = Math.max(
                          0,
                          session.totalEarned - prevPaid,
                        );
                        const pm = sessionPayments[session.id!] || {
                          paymentStatus: "unpaid",
                          paidAmount: 0,
                        };
                        return (
                          <div
                            key={session.id}
                            className="bg-cloud-surface/30 dark:bg-obsidian-surface/30 p-3.5 rounded-2xl border border-soft-divider-light/10 dark:border-soft-divider-dark/10 flex flex-col gap-3"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col">
                                <span className="text-[13px] font-bold text-ink-primary-light dark:text-ink-primary-dark font-sans">
                                  Session (
                                  {format(
                                    new Date(session.startTime),
                                    "MMM d, yyyy",
                                  )}
                                  )
                                </span>
                                <span className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark font-medium leading-normal mt-0.5 font-sans">
                                  Rate: {formatCurrency(session.hourlyRate)}/hr
                                  • {formatDuration(session.durationMs)}
                                </span>
                              </div>
                              <div className="flex flex-col items-end shrink-0">
                                <span className="text-[13px] font-extrabold text-ink-primary-light dark:text-ink-primary-dark font-sans">
                                  {formatCurrency(session.totalEarned)}
                                </span>
                                <span className="text-[9px] font-bold text-ink-muted-light dark:text-ink-muted-dark uppercase tracking-wider font-sans">
                                  Value
                                </span>
                              </div>
                            </div>

                            {prevPaid > 0 && (
                              <div className="bg-amber-500/[0.04] dark:bg-amber-400/[0.04] border border-amber-500/10 dark:border-amber-400/10 p-2 rounded-xl flex flex-col gap-1.5">
                                <div className="w-full h-2 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden flex">
                                  <div
                                    style={{
                                      width: `${(prevPaid / session.totalEarned) * 100}%`,
                                    }}
                                    className="h-full bg-amber-500 dark:bg-amber-400"
                                    title={`Previously Paid: ${formatCurrency(prevPaid)}`}
                                  />
                                  {pm.paidAmount > 0 && (
                                    <div
                                      style={{
                                        width: `${(pm.paidAmount / session.totalEarned) * 100}%`,
                                      }}
                                      className="h-full bg-blue-500 dark:bg-blue-400"
                                      title={`Paying Now: ${formatCurrency(pm.paidAmount)}`}
                                    />
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-muted-light dark:text-ink-muted-dark font-sans font-semibold">
                                  <span className="flex items-center gap-1 shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                                    Prior: {formatCurrency(prevPaid)}
                                  </span>
                                  <span className="flex items-center gap-1 shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
                                    New Paid: {formatCurrency(pm.paidAmount)}
                                  </span>
                                  <span className="font-extrabold text-[#ca8a04] dark:text-amber-400 shrink-0">
                                    Rest:{" "}
                                    {formatCurrency(
                                      Math.max(
                                        0,
                                        maxInvoicePayable - pm.paidAmount,
                                      ),
                                    )}
                                  </span>
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-3 bg-cloud-surface dark:bg-obsidian-surface p-1 rounded-xl border border-soft-divider-light/10 dark:border-soft-divider-dark/10">
                              {(["unpaid", "partial", "paid"] as const).map(
                                (pState) => {
                                  const isSelected =
                                    pm.paymentStatus === pState;
                                  let btnClass =
                                    "text-ink-muted-light dark:text-ink-muted-dark hover:text-ink-primary-light";
                                  if (isSelected) {
                                    if (pState === "paid")
                                      btnClass =
                                        "bg-emerald-500 text-white font-bold shadow-sm";
                                    else if (pState === "partial")
                                      btnClass =
                                        "bg-blue-500 text-white font-bold shadow-sm";
                                    else
                                      btnClass =
                                        "bg-slate-500 text-white font-bold shadow-sm";
                                  }
                                  return (
                                    <button
                                      key={pState}
                                      type="button"
                                      disabled={status !== "partial"}
                                      onClick={() =>
                                        handleSessionPaymentStatusChange(
                                          session.id!,
                                          pState,
                                        )
                                      }
                                      className={`py-1 text-[11px] rounded-[8px] transition-all capitalize font-sans font-semibold cursor-pointer disabled:cursor-not-allowed ${btnClass}`}
                                    >
                                      {pState === "paid"
                                        ? "Full"
                                        : pState === "partial"
                                          ? "Partial"
                                          : "Unpaid"}
                                    </button>
                                  );
                                },
                              )}
                            </div>

                            {pm.paymentStatus === "partial" && (
                              <div className="flex flex-col gap-2 mt-1 bg-morning-paper dark:bg-midnight-canvas border border-soft-divider-light/10 dark:border-soft-divider-dark/10 p-2.5 rounded-xl">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex-1 flex items-center bg-cloud-surface dark:bg-obsidian-surface border border-soft-divider-light/10 dark:border-soft-divider-dark/10 rounded-lg px-2 py-1">
                                    <span className="text-[10px] font-bold text-ink-muted-light mr-1 font-sans">
                                      SAR
                                    </span>
                                    <input
                                      type="number"
                                      step="any"
                                      disabled={status !== "partial"}
                                      value={pm.paidAmount || ""}
                                      onChange={(e) =>
                                        handleSessionPaidAmountChange(
                                          session.id!,
                                          e.target.value,
                                        )
                                      }
                                      placeholder="0.00"
                                      className="w-full text-left outline-none bg-transparent font-sans text-xs font-bold text-ink-primary-light dark:text-ink-primary-dark"
                                    />
                                  </div>

                                  <div className="flex gap-1 shrink-0">
                                    {[0.25, 0.5, 0.75].map((ratio) => {
                                      const amt = parseFloat(
                                        (maxInvoicePayable * ratio).toFixed(2),
                                      );
                                      return (
                                        <button
                                          key={ratio}
                                          type="button"
                                          disabled={status !== "partial"}
                                          onClick={() =>
                                            handleSessionPaidAmountChange(
                                              session.id!,
                                              amt.toString(),
                                            )
                                          }
                                          className="px-1.5 py-1 text-[9px] bg-[#121318]/5 dark:bg-[#e8e6e0]/5 hover:bg-[#121318]/10 text-ink-primary-light dark:text-ink-primary-dark rounded font-bold font-sans disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                        >
                                          {ratio * 100}%
                                        </button>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      disabled={status !== "partial"}
                                      onClick={() =>
                                        handleSessionPaidAmountChange(
                                          session.id!,
                                          maxInvoicePayable.toString(),
                                        )
                                      }
                                      className="px-1.5 py-1 text-[9px] bg-action-indigo/10 text-action-indigo dark:text-indigo-400 rounded font-bold hover:bg-action-indigo/15 font-sans disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                    >
                                      Max
                                    </button>
                                  </div>
                                </div>

                                <div className="flex items-center gap-3">
                                  <input
                                    type="range"
                                    min="0"
                                    max={maxInvoicePayable}
                                    step="0.01"
                                    disabled={status !== "partial"}
                                    value={pm.paidAmount || 0}
                                    onChange={(e) =>
                                      handleSessionPaidAmountChange(
                                        session.id!,
                                        e.target.value,
                                      )
                                    }
                                    className="w-full accent-blue-500 h-1 bg-black/5 dark:bg-white/10 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                  />
                                  <span className="text-[9px] font-extrabold text-ink-muted-light dark:text-ink-muted-dark tracking-tight shrink-0 font-sans">
                                    Limit: {maxInvoicePayable.toFixed(1)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Included Items Breakdown */}
          <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-soft-divider-light/20 dark:border-soft-divider-dark/20 font-sans">
            <div className="flex justify-between items-center">
              <label className="text-[13px] text-ink-muted-light dark:text-ink-muted-dark font-medium">
                Included Items Breakdown
              </label>
              <span className="font-mono text-[11px] text-ink-muted-light dark:text-ink-muted-dark bg-morning-paper dark:bg-midnight-canvas px-2 py-0.5 rounded-md">
                {renderedSessions.length + matchingInvoices.length}{" "}
                {renderedSessions.length + matchingInvoices.length === 1
                  ? "item"
                  : "items"}
              </span>
            </div>
            <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
              {breakdownItems.length === 0 ? (
                <div className="text-center py-4 text-xs text-ink-muted-light dark:text-ink-muted-dark">
                  No individual items found for this invoice.
                </div>
              ) : (
                <>
                  {breakdownItems.map((item) => {
                    if (item.type === "session") {
                      const session = item.data;
                      const prevPaid = session.previouslyPaidAmount || 0;
                      const billable = Math.max(0, session.totalEarned - prevPaid);
                      const paidOnThis = session.paidAmount || 0;
                      return (
                        <div
                          key={item.id}
                          className="flex justify-between items-center p-2.5 bg-morning-paper dark:bg-midnight-canvas rounded-xl border border-soft-divider-light/10 dark:border-soft-divider-dark/10"
                        >
                          <div className="flex flex-col min-w-0 font-sans">
                            <span className="text-[13px] font-medium text-ink-primary-light dark:text-ink-primary-dark">
                              Session (
                              {format(
                                new Date(session.startTime),
                                "MMM d, yyyy",
                              )}
                              )
                            </span>
                            <span className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark leading-normal animate-fade-in">
                              Rate: {formatCurrency(session.hourlyRate)}/hr •{" "}
                              {formatDuration(session.durationMs)}
                              {prevPaid > 0 && (
                                <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                                  Prior Payments: {formatCurrency(prevPaid)} (Billable: {formatCurrency(billable)})
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-[13px] font-semibold text-ink-primary-light dark:text-ink-primary-dark">
                              {formatCurrency(billable)}
                            </span>
                            {paidOnThis > 0 && (
                              <div className="text-[10px] text-emerald-500 font-medium">
                                Paid On Invoice: {formatCurrency(paidOnThis)}
                              </div>
                            )}
                            {(billable - paidOnThis) > 0.001 && paidOnThis > 0 && (
                              <div className="text-[9px] text-slate-400 font-medium">
                                Bal Due: {formatCurrency(billable - paidOnThis)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    } else {
                      const inv = item.data;
                      const remaining = inv.totalAmount - (inv.paidAmount || 0);
                      const isPartial = (inv.paidAmount || 0) > 0;
                      return (
                        <div
                          key={item.id}
                          className="flex justify-between items-center p-2.5 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-100/30 dark:border-blue-900/10"
                        >
                          <div className="flex flex-col min-w-0 font-sans">
                            <span className="text-[13px] font-medium text-action-indigo dark:text-[#818CF8]">
                              Outstanding balance from previous invoice (
                              {inv.reference})
                            </span>
                            <span className="text-[11px] text-ink-muted-light dark:text-ink-muted-dark">
                              {isPartial
                                ? `Original: ${formatCurrency(inv.totalAmount)} • Paid: ${formatCurrency(inv.paidAmount || 0)}`
                                : `Issued: ${format(new Date(inv.date), "MMM d, yyyy")}`}
                            </span>
                          </div>
                          <div className="text-right shrink-0 font-sans">
                            <span className="text-[13px] font-semibold text-action-indigo dark:text-[#818CF8]">
                              {formatCurrency(remaining)}
                            </span>
                          </div>
                        </div>
                      );
                    }
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6 shrink-0 font-sans">
          {isConfirmingDelete ? (
            <>
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 flex justify-center items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface border border-soft-divider-light dark:border-soft-divider-dark text-ink-primary-light dark:text-ink-primary-dark font-rounded font-semibold text-[15px] py-3.5 rounded-[16px] active:scale-[0.98] transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-[1.5] flex justify-center items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-rounded font-semibold text-[15px] py-3.5 rounded-[16px] shadow-[0_8px_20px_rgba(239,68,68,0.15)] active:scale-[0.98] transition-all"
              >
                Yes, Delete
              </button>
            </>
          ) : (
            <>
              {isEditable ? (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    title="Delete Draft"
                    className="w-12 h-12 shrink-0 flex justify-center items-center bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 font-rounded font-semibold rounded-[16px] hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-[0.98] transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPreview(true)}
                    className="flex-1 flex justify-center items-center gap-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-[#34D399] border border-emerald-100/30 dark:border-emerald-900/20 font-rounded font-bold text-[14px] py-3.5 rounded-[16px] transition-all hover:bg-emerald-100 dark:hover:bg-emerald-950/30 font-semibold"
                  >
                    <Eye className="w-4 h-4" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex-[1.5] flex justify-center items-center gap-2 bg-action-indigo text-white font-rounded font-semibold text-[14px] py-3.5 rounded-[16px] shadow-[0_8px_20px_rgba(79,70,229,0.15)] hover:opacity-90 active:scale-[0.98] transition-all font-semibold"
                  >
                    <Save className="w-4 h-4" />
                    Update
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    title="Delete Invoice"
                    className="w-12 h-12 shrink-0 flex justify-center items-center bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 font-rounded font-semibold rounded-[16px] hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-[0.98] transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  {status !== invoice.status || hasSessionPaymentsChanged ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setStatus(invoice.status);
                          const initial: Record<
                            string,
                            {
                              paymentStatus: "unpaid" | "partial" | "paid";
                              paidAmount: number;
                            }
                          > = {};
                          matchingSessions.forEach((s) => {
                            const prevPaid = getPrevPaid(s);
                            const totalPaidOnSession = s.paidAmount || 0;
                            const paidInInvoice = Math.max(
                              0,
                              totalPaidOnSession - prevPaid,
                            );

                            let invoicePaymentStatus:
                              | "unpaid"
                              | "partial"
                              | "paid" = "unpaid";
                            const actualStatus =
                              s.paymentStatus || (s.paid ? "paid" : "unpaid");
                            if (actualStatus === "paid") {
                              invoicePaymentStatus = "paid";
                            } else if (paidInInvoice > 0) {
                              invoicePaymentStatus = "partial";
                            }

                            initial[s.id!] = {
                              paymentStatus: invoicePaymentStatus,
                              paidAmount: parseFloat(paidInInvoice.toFixed(2)),
                            };
                          });
                          setSessionPayments(initial);
                        }}
                        className="flex-1 flex justify-center items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface border border-soft-divider-light dark:border-soft-divider-dark text-ink-primary-light dark:text-ink-primary-dark font-rounded font-semibold text-[14px] py-3.5 rounded-[16px] active:scale-[0.98] transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleUpdateStatus}
                        className="flex-[1.5] flex justify-center items-center gap-2 bg-action-indigo text-white font-rounded font-semibold text-[14px] py-3.5 rounded-[16px] transition-all hover:opacity-90 shadow-[0_8px_20px_rgba(79,70,229,0.15)] font-semibold"
                      >
                        <Save className="w-4 h-4" />
                        Save Status
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 flex justify-center items-center gap-2 bg-cloud-surface dark:bg-obsidian-surface border border-soft-divider-light dark:border-soft-divider-dark text-ink-primary-light dark:text-ink-primary-dark font-rounded font-semibold text-[14px] py-3.5 rounded-[16px] active:scale-[0.98] transition-all"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPreview(true)}
                        className="flex-[1.5] flex justify-center items-center gap-2 bg-action-indigo text-white font-rounded font-semibold text-[14px] py-3.5 rounded-[16px] transition-all hover:opacity-90 shadow-[0_8px_20px_rgba(79,70,229,0.15)]"
                      >
                        <Eye className="w-4 h-4" />
                        View Invoice
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-[#0c1020]/95 backdrop-blur-md flex flex-col justify-start overflow-y-auto"
          >
            {/* Dark glassmorphic floating or top bar */}
            <div className="sticky top-0 z-10 w-full bg-[#111827]/90 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg">
              <div className="flex items-center gap-3 bg-slate-900/40 p-1 px-3 rounded-lg border border-slate-800">
                <Receipt className="w-5 h-5 text-indigo-400 animate-pulse" />
                <span className="font-sans font-bold text-slate-100">
                  {docType === "invoice" ? "Invoice Preview:" : "Receipt Preview:"} {invoice.reference}
                </span>
                <span className="text-[11px] bg-indigo-500/10 text-indigo-300 px-2.5 py-0.5 rounded-full font-mono font-medium border border-indigo-500/20">
                  A4 Document
                </span>
              </div>

              {/* Segmented Control Toggle between Invoice and Receipt */}
              {displayPaidAmount > 0 && (
                <div className="flex bg-slate-950 border border-slate-800 p-1 rounded-xl">
                  <button
                    onClick={() => setDocType("invoice")}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${docType === "invoice" ? "bg-indigo-600 text-white shadow-md font-bold" : "text-slate-400 hover:text-white"}`}
                  >
                    <span>Invoice View</span>
                  </button>
                  <button
                    onClick={() => setDocType("receipt")}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${docType === "receipt" ? "bg-emerald-600 text-white shadow-md font-bold" : "text-slate-400 hover:text-white"}`}
                  >
                    <span>Payment Receipt</span>
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-850 hover:bg-slate-700 text-slate-100 rounded-xl font-rounded font-semibold text-[13px] active:scale-95 transition-all border border-slate-700 cursor-pointer shadow-sm"
                >
                  <Printer className="w-4 h-4 text-slate-450" />
                  Print
                </button>
                <button
                  onClick={handleDownloadPDF}
                  className="flex items-center gap-2 px-4 py-2 bg-[#10b981] hover:bg-[#059669] text-white rounded-xl font-rounded font-semibold text-[13px] active:scale-95 transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)] cursor-pointer"
                >
                  <Download className="w-4 h-4 text-emerald-100" />
                  Download PDF
                </button>
                <div className="w-px h-6 bg-slate-800"></div>
                <button
                  onClick={() => setShowPreview(false)}
                  className="group flex items-center justify-center w-11 h-11 bg-slate-800 hover:bg-red-500/10 text-[#f3f4f6] hover:text-red-400 rounded-xl active:scale-95 transition-all border border-slate-700 hover:border-red-500/30 cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
                  title="Close Preview (Exit)"
                >
                  <X className="w-5 h-5 transition-transform group-hover:rotate-90 duration-300" />
                </button>
              </div>
            </div>

            {/* Scrollable Document Container */}
            <div className="w-full flex-1 flex flex-col items-center justify-start p-4 md:p-12 overflow-x-auto min-h-0 select-text">
              <div className="w-full flex justify-center">
                <div
                  id="invoice-preview-print-element"
                  className="min-w-[210mm] w-[210mm] min-h-[297mm] bg-white text-slate-850 shadow-[0_24px_80px_rgba(0,0,0,0.6)] rounded-2xl p-[10mm_12mm] flex flex-col justify-between border-t-[6px] border-[#121318] mb-12 transform origin-top transition-all"
                  style={{
                    backgroundColor: "#ffffff",
                    color: "#1e293b",
                    fontFamily: "Thmanyah, system-ui, -apple-system, sans-serif",
                    boxSizing: "border-box",
                  }}
                >
                  {/* Top Header */}
                  <div className="flex justify-between items-start border-b border-[#121318]/10 pb-2.5">
                    <div className="flex flex-col justify-center min-h-[44px]">
                      <span className="font-sans text-[22px] font-extrabold tracking-tight text-[#121318] leading-none">
                        Hassan Alhussain
                      </span>
                    </div>
                    <div className="text-right flex flex-col items-end">
                      <h1 className="font-thmanyah text-[30px] font-normal tracking-wide text-slate-900 uppercase leading-none mb-0.5">
                        {docType === "invoice" ? "INVOICE" : "PAYMENT RECEIPT"}
                      </h1>
                      <div>
                        <span className="font-sans text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-[5px] border border-indigo-100/50">
                          {docType === "invoice" ? "NO." : "RECEIPT NO. REC-"} {invoice.reference}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-4 mt-3 mb-2.5 pb-2 border-b border-slate-100/80">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block">
                        {docType === "invoice" ? "BILLED TO" : "RECEIVED FROM"}
                      </span>
                      <div>
                        <span className="text-[15px] font-bold text-[#121318] block font-thmanyah">
                          {invoice.clientName || "Valued Customer"}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-y-1.5 gap-x-2">
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                          {docType === "invoice" ? "DATE OF ISSUE" : "DATE OF RECEIPT"}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-750 block">
                          {format(new Date(invoice.date), "MMMM d, yyyy")}
                        </span>
                      </div>
                      {docType === "invoice" && invoice.dueDate && (
                        <div>
                          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                            DUE DATE
                          </span>
                          <span className="text-[11px] font-semibold text-slate-750 block">
                            {format(new Date(invoice.dueDate), "MMMM d, yyyy")}
                          </span>
                        </div>
                      )}
                      {docType === "receipt" && (
                        <div>
                          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                            PAYMENT STATUS
                          </span>
                          <span className={`text-[11px] font-bold uppercase block ${status === "paid" ? "text-emerald-600 font-sans" : "text-blue-600 font-sans"}`}>
                            {status === "paid" ? "Fully Paid" : "Partially Paid"}
                          </span>
                        </div>
                      )}
                      <div className="col-span-2">
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#9ca3af] block mb-0.5">
                          SERVICE TYPE
                        </span>
                        <span className="text-[11px] font-semibold text-indigo-600 block">
                          {service || "Professional Creative Services"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Table / Breakdown Grid */}
                  <div className="flex-1 mt-1.5">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#121318]/10 bg-[#faf9f6]/95 rounded-lg">
                          <th className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] w-6">
                            #
                          </th>
                          <th className="py-1.5 px-2 text-[9px] font-bold uppercase tracking-wider text-[#6b7280]">
                            DESCRIPTION
                          </th>
                          <th className="py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] text-center w-16 whitespace-nowrap">
                            QTY / HOURS
                          </th>
                          <th className="py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] text-right w-20 whitespace-nowrap">
                            UNIT RATE
                          </th>
                          <th className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wider text-[#6b7280] text-right w-24 whitespace-nowrap">
                            AMOUNT
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownItems.map((item, index) => {
                          const isEven = index % 2 === 1;
                          const bgClass = isEven
                            ? "bg-[#faf9f6]/40"
                            : "bg-transparent";
                          if (item.type === "session") {
                            const s = item.data;
                            const dateLabel = format(
                              new Date(s.startTime),
                              "MMM d, yyyy",
                            );
                            const tStart = format(
                              new Date(s.startTime),
                              "hh:mm a",
                            );
                            const tEnd = s.endTime
                              ? format(new Date(s.endTime), "hh:mm a")
                              : "Ongoing";
                            const hrs = (
                              s.countedHours !== undefined
                                ? s.countedHours
                                : calculateCountedHours(s.durationMs)
                            ).toFixed(0);

                            const prevPaid = s.previouslyPaidAmount || 0;
                            const sessionAmount = Math.max(0, s.totalEarned - prevPaid);
                            const totalPaid = prevPaid + (s.paidAmount || 0);
                            const isFullyPaid = (s.totalEarned - totalPaid) <= 0.005;
                            const hasAnyPayment = totalPaid > 0;

                            return (
                              <tr
                                key={item.id}
                                className={`border-b border-slate-100/80 text-[12px] ${bgClass} transition-colors hover:bg-[#faf9f6]/60`}
                              >
                                <td className="py-1.5 px-3 text-slate-400 text-center font-medium">
                                  {index + 1}
                                </td>
                                <td className="py-1.5 px-2">
                                  <span className="font-bold text-[#1a1a1a] block font-thmanyah text-[14px]">
                                    Work Session ({dateLabel})
                                  </span>
                                  <span className="text-[10px] text-slate-400 mt-0.5 block font-mono">
                                    Time: {tStart} to {tEnd}
                                  </span>

                                  {docType === "receipt" && (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                      {isFullyPaid ? (
                                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider">
                                          <span className="w-1 h-1 rounded-full bg-emerald-500" />
                                          Fully Paid
                                        </span>
                                      ) : hasAnyPayment ? (
                                        <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider font-sans" dir="ltr">
                                          <span className="w-1 h-1 rounded-full bg-blue-500" />
                                          Partially Paid (Paid: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(totalPaid)}</span></span> / <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(s.totalEarned)}</span></span>)
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-500 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider">
                                          <span className="w-1 h-1 rounded-full bg-slate-400" />
                                          Unpaid
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {prevPaid > 0 && (
                                    <span className="text-[10px] text-amber-600 font-medium mt-1 block leading-normal italic" style={{ color: '#d97706' }}>
                                      Outstanding balance from a previous invoice.
                                      <span className="text-[9px] text-slate-400 block mt-0.5 font-sans font-normal" dir="ltr">
                                        (Original: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(s.totalEarned)}</span></span> | Prior Payments: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(prevPaid)}</span></span> | Billable Portion: <span className="inline-flex items-baseline gap-0.5" dir="ltr"><span className="font-thmanyah text-[11px] font-normal">ر.س</span><span>{f(sessionAmount)}</span></span>)
                                      </span>
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 text-center font-medium text-[#4b5563] font-sans">
                                  {hrs} hrs
                                </td>
                                <td className="py-1.5 text-right" dir="ltr">
                                  <span className="inline-flex items-baseline gap-1 justify-end w-full">
                                    <span className="font-thmanyah text-[16px] text-slate-400">
                                      ر.س
                                    </span>
                                    <span className="font-sans text-[12px] font-bold text-slate-900">
                                      {f(s.hourlyRate)}
                                    </span>
                                  </span>
                                </td>
                                <td
                                  className="py-1.5 px-3 text-right"
                                  dir="ltr"
                                >
                                  <span className="inline-flex items-baseline gap-1 justify-end w-full">
                                    <span className="font-thmanyah text-[16px] text-slate-400">
                                      ر.س
                                    </span>
                                    <span className="font-sans text-[12px] font-bold text-slate-900">
                                      {f(sessionAmount || 0)}
                                    </span>
                                  </span>
                                </td>
                              </tr>
                            );
                          } else {
                            const inv = item.data;
                            const remaining =
                              inv.totalAmount - (inv.paidAmount || 0);
                            const isPartial = (inv.paidAmount || 0) > 0;
                            return (
                              <tr
                                key={item.id}
                                className="border-b border-indigo-100/30 text-[12px] bg-indigo-50/25 hover:bg-indigo-50/35 transition-colors"
                              >
                                <td className="py-1.5 px-3 text-slate-400 text-center font-medium">
                                  {index + 1}
                                </td>
                                <td className="py-1.5 px-2">
                                  <span className="font-bold text-indigo-900 block font-thmanyah text-[14px]">
                                    Outstanding balance from previous invoice (
                                    {inv.reference})
                                  </span>
                                  <span className="text-[10px] text-slate-400 mt-0.5 block font-sans">
                                    {isPartial ? (
                                      <>
                                        Original Amount:{" "}
                                        <span
                                          dir="ltr"
                                          className="inline-flex items-baseline gap-0.5"
                                        >
                                          <span className="font-thmanyah">
                                            ر.س
                                          </span>
                                          <span>{f(inv.totalAmount)}</span>
                                        </span>{" "}
                                        • Paid Already:{" "}
                                        <span
                                          dir="ltr"
                                          className="inline-flex items-baseline gap-0.5"
                                        >
                                          <span className="font-thmanyah">
                                            ر.س
                                          </span>
                                          <span>{f(inv.paidAmount)}</span>
                                        </span>
                                      </>
                                    ) : (
                                      `Issued: ${format(new Date(inv.date), "MMM d, yyyy")}`
                                    )}
                                  </span>
                                </td>
                                <td className="py-1.5 text-center text-slate-450">
                                  -
                                </td>
                                <td className="py-1.5 text-center text-slate-450">
                                  -
                                </td>
                                <td
                                  className="py-1.5 px-3 text-right"
                                  dir="ltr"
                                >
                                  <span className="inline-flex items-baseline gap-1 justify-end w-full">
                                    <span className="font-thmanyah text-[16px] text-indigo-400">
                                      ر.س
                                    </span>
                                    <span className="font-sans text-[12px] font-bold text-indigo-900">
                                      {f(remaining)}
                                    </span>
                                  </span>
                                </td>
                              </tr>
                            );
                          }
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Bottom Section containing Summary box and nice footer notes */}
                  <div className="grid grid-cols-12 gap-6 pt-3 mt-4 border-t border-slate-100 print-avoid-break">
                    <div className="col-span-12 md:col-span-6 flex flex-col justify-end">
                      <p className="text-[12px] font-bold text-slate-800 font-thmanyah mb-0.5">
                        Thank you for your business!
                      </p>
                      <p className="text-[10px] text-[#6b7280]/85 leading-relaxed font-sans max-w-sm">
                        If you have any questions or inquiries regarding this
                        invoice, please do not hesitate to email
                        7sn.3ali@gmail.com.
                      </p>
                    </div>
                    <div className="col-span-12 md:col-span-6">
                      <div className="bg-[#faf9f6]/95 rounded-xl p-3 border border-[#121318]/5 flex flex-col gap-1.5">
                        {docType === "invoice" ? (
                          <>
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-[#6b7280] font-sans font-semibold">
                                Total Hours
                              </span>
                              <span className="font-sans text-[12px] font-bold text-slate-700">
                                {totalHours} hrs
                              </span>
                            </div>
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-[#6b7280] font-sans font-semibold">
                                Gross Total
                              </span>
                              <span
                                className="inline-flex items-baseline gap-1 font-bold text-slate-700"
                                dir="ltr"
                              >
                                <span className="font-thmanyah text-[14px] text-slate-400">
                                  ر.س
                                </span>
                                <span className="font-sans text-[12px]">
                                  {f(displaySubtotal)}
                                </span>
                              </span>
                            </div>
                            {displayDiscount > 0 && (
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-[#6b7280] font-sans font-semibold">
                                  Discount
                                  {discountType
                                    ? ` (${discountType === "percent" ? `${discountValue}%` : "Fixed"})`
                                    : ""}
                                </span>
                                <span
                                  className="inline-flex items-baseline gap-1 font-bold text-emerald-600"
                                  dir="ltr"
                                >
                                  <span className="font-sans text-[12px] mr-0.5">
                                    -
                                  </span>
                                  <span className="font-thmanyah text-[14px] text-emerald-500">
                                    ر.س
                                  </span>
                                  <span className="font-sans text-[12px]">
                                    {f(displayDiscount)}
                                  </span>
                                </span>
                              </div>
                            )}
                            <div className="h-px bg-slate-200/40 my-0.5"></div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-[13px] font-black text-[#4F46E5] uppercase tracking-wider font-sans">
                                Balance Due
                              </span>
                              <span
                                className="inline-flex items-baseline gap-1.5 text-[18px] font-black text-[#4F46E5]"
                                dir="ltr"
                              >
                                <span className="font-thmanyah text-[20px] text-indigo-500 font-bold">
                                  ر.س
                                </span>
                                <span className="font-sans text-[16px] font-black">
                                  {f(displayTotalAmount)}
                                </span>
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-[#6b7280] font-sans font-semibold">
                                Total Hours
                              </span>
                              <span className="font-sans text-[12px] font-bold text-slate-700">
                                {totalHours} hrs
                              </span>
                            </div>
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-[#6b7280] font-sans font-semibold">
                                Gross Total
                              </span>
                              <span
                                className="inline-flex items-baseline gap-1 font-bold text-slate-700"
                                dir="ltr"
                              >
                                <span className="font-thmanyah text-[14px] text-slate-400">
                                  ر.س
                                </span>
                                <span className="font-sans text-[12px]">
                                  {f(displaySubtotal)}
                                </span>
                              </span>
                            </div>
                            {displayDiscount > 0 && (
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="text-[#6b7280] font-sans font-semibold">
                                  Discount
                                  {discountType
                                    ? ` (${discountType === "percent" ? `${discountValue}%` : "Fixed"})`
                                    : ""}
                                </span>
                                <span
                                  className="inline-flex items-baseline gap-1 font-bold text-emerald-600"
                                  dir="ltr"
                                >
                                  <span className="font-sans text-[12px] mr-0.5">
                                    -
                                  </span>
                                  <span className="font-thmanyah text-[14px] text-emerald-500">
                                    ر.س
                                  </span>
                                  <span className="font-sans text-[12px]">
                                    {f(displayDiscount)}
                                  </span>
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between items-center text-[11px] border-t border-slate-100 pt-1.5 mt-0.5">
                              <span className="text-[#6b7280] font-sans font-semibold">
                                Total Invoice Value
                              </span>
                              <span
                                className="inline-flex items-baseline gap-1 font-bold text-slate-700"
                                dir="ltr"
                              >
                                <span className="font-thmanyah text-[14px] text-slate-400">
                                  ر.س
                                </span>
                                <span className="font-sans text-[12px]">{f(displayTotalAmount)}</span>
                              </span>
                            </div>
                            <div className="h-px bg-slate-200/40 my-0.5"></div>
                            <div className="flex justify-between items-center py-1 bg-emerald-50/50 rounded-lg p-2 border border-emerald-100/30">
                              <span className="text-[13px] font-black text-emerald-600 uppercase tracking-wider font-sans">
                                Amount Received
                              </span>
                              <span
                                className="inline-flex items-baseline gap-1.5 text-[18px] font-black text-emerald-600"
                                dir="ltr"
                              >
                                <span className="font-thmanyah text-[20px] text-emerald-500 font-bold">
                                  ر.س
                                </span>
                                <span className="font-sans text-[16px] font-black">
                                  {f(displayPaidAmount)}
                                </span>
                              </span>
                            </div>
                            {displayBalanceDue > 0 && (
                              <div className="flex justify-between items-center text-[11px] mt-1">
                                <span className="text-slate-550 font-sans font-semibold">
                                  Remaining Outstanding Balance
                                </span>
                                <span
                                  className="inline-flex items-baseline gap-1 font-bold text-[#4F46E5]"
                                  dir="ltr"
                                >
                                  <span className="font-thmanyah text-[14px] text-indigo-400">
                                    ر.س
                                  </span>
                                  <span className="font-sans text-[12px] font-bold">
                                    {f(displayBalanceDue)}
                                  </span>
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
