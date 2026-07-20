/* calc.js
 * Pure functions that reproduce the "black text" formula columns from the
 * original Followup Tracker sheet: Due Date, Days Overdue, Ageing Bucket,
 * Priority, and the suggested Next Follow-up Date.
 * These are NEVER stored — always derived fresh from today's date, exactly
 * like the Excel TODAY() formulas did.
 */

function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toISO(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function today() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Due Date = Invoice Date + Credit Days */
function computeDueDate(invoiceDateISO, creditDays) {
  const inv = parseDate(invoiceDateISO);
  if (!inv) return null;
  const due = new Date(inv);
  due.setDate(due.getDate() + (Number(creditDays) || 0));
  return due;
}

/** Days Overdue(+)/Left(-) = TODAY() - Due Date */
function computeDaysOverdue(dueDate) {
  if (!dueDate) return null;
  const diffMs = today() - dueDate;
  return Math.round(diffMs / 86400000);
}

/** Ageing Bucket, from Days Overdue */
function computeAgeingBucket(invoiceDateISO, daysOverdue) {
  if (!invoiceDateISO) return "Set Invoice Date";
  if (daysOverdue <= 0) return "Not Due";
  if (daysOverdue <= 30) return "0-30 Days";
  if (daysOverdue <= 60) return "31-60 Days";
  if (daysOverdue <= 90) return "61-90 Days";
  return "90+ Days";
}

/** Priority, from Amount Outstanding + Days Overdue (unless Settled) */
function computePriority(status, invoiceDateISO, amountOutstanding, daysOverdue) {
  if (status === "Settled") return "-";
  if (!invoiceDateISO) return "Set Invoice Date";
  const amt = Number(amountOutstanding) || 0;
  if (amt >= 500000 && daysOverdue > 60) return "Critical";
  if (amt >= 500000 || daysOverdue > 90) return "High";
  if (amt >= 100000) return "Medium";
  return "Low";
}

/** Suggested Next Follow-up Date, from Priority. Purely a suggestion —
 *  the stored nextFollowupDate field is freely editable, same as Excel. */
function suggestNextFollowup(priority) {
  const addDays = { Critical: 1, High: 2, Medium: 5, Low: 7 }[priority] ?? 7;
  const d = today();
  d.setDate(d.getDate() + addDays);
  return d;
}

/** Runs all derived fields for one customer row. */
function deriveFields(customer) {
  const dueDate = computeDueDate(customer.invoiceDate, customer.creditDays);
  const daysOverdue = computeDaysOverdue(dueDate);
  const ageingBucket = computeAgeingBucket(customer.invoiceDate, daysOverdue);
  const priority = computePriority(
    customer.status,
    customer.invoiceDate,
    customer.amountOutstanding,
    daysOverdue
  );
  return {
    dueDate: dueDate ? toISO(dueDate) : "",
    daysOverdue: customer.invoiceDate ? daysOverdue : "",
    ageingBucket,
    priority,
  };
}

const AGEING_ORDER = ["Set Invoice Date", "Not Due", "0-30 Days", "31-60 Days", "61-90 Days", "90+ Days"];
const PRIORITY_ORDER = ["Critical", "High", "Medium", "Low", "Set Invoice Date", "-"];
