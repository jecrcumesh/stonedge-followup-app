/* export.js
 * Rebuilds the workbook in the same shape as the original
 * Stonedge_Customer_Followup_Tracker.xlsx, with the SAME live formulas —
 * Due Date, Days Overdue, Ageing Bucket, Priority and the Dashboard's
 * SUMIF/COUNTIF/LARGE formulas — not just a snapshot of values. Every
 * formula cell also carries today's computed value as its cache, so the
 * file looks right even before Excel recalculates it on open.
 */

const XLSX_EPOCH_MS = Date.UTC(1899, 11, 30);
const DATE_FMT = "dd\\-mmm\\-yyyy";
const CURRENCY_FMT = '"Rs. "#,##0';

function excelSerial(isoString) {
  if (!isoString) return null;
  const [y, m, d] = isoString.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - XLSX_EPOCH_MS) / 86400000);
}
function textCell(v) {
  return { t: "s", v: v == null ? "" : String(v) };
}
function numCell(v, z) {
  const o = { t: "n", v: Number(v) || 0 };
  if (z) o.z = z;
  return o;
}
function dateCell(isoString) {
  const serial = excelSerial(isoString);
  return serial == null ? { t: "s", v: "" } : { t: "n", v: serial, z: DATE_FMT };
}
function formulaCell(cachedValue, formula, extra) {
  const isNum = typeof cachedValue === "number";
  return { t: isNum ? "n" : "s", v: isNum ? cachedValue : String(cachedValue ?? ""), f: formula, ...extra };
}

function exportToExcel(customers, meta) {
  const enriched = customers.map((c) => ({ ...c, ...deriveFields(c) }));
  const wb = XLSX.utils.book_new();

  /* =========================== Followup Tracker =========================== */
  const trackerHeader = [
    "Sr No", "Firm", "Customer Name", "Mobile No", "Email ID",
    "Amount Outstanding", "Invoice Date", "Credit Days", "Due Date",
    "Days Overdue(+)/Left(-)", "Ageing Bucket", "Status", "Priority",
    "Next Follow-up Date", "Last Follow-up Date", "Followed Up By",
    "Last Remark / Notes",
  ];
  const tws = {};
  tws["A1"] = textCell("STONEDGE GROUP — SUNDRY DEBTORS FOLLOW-UP TRACKER");
  tws["A2"] = textCell(meta.periodLabel || "");
  trackerHeader.forEach((h, i) => {
    tws[XLSX.utils.encode_cell({ r: 3, c: i })] = textCell(h);
  });

  const startRow = 5;
  const lastRow = startRow + enriched.length - 1;

  enriched.forEach((c, i) => {
    const r = startRow + i;
    tws[`A${r}`] = numCell(c.srNo);
    tws[`B${r}`] = textCell(c.firm);
    tws[`C${r}`] = textCell(c.customerName);
    tws[`D${r}`] = textCell(c.mobileNo);
    tws[`E${r}`] = textCell(c.emailId);
    tws[`F${r}`] = numCell(c.amountOutstanding, CURRENCY_FMT);
    tws[`G${r}`] = dateCell(c.invoiceDate);
    tws[`H${r}`] = numCell(c.creditDays);

    tws[`I${r}`] = formulaCell(
      excelSerial(c.dueDate) ?? "",
      `IF(G${r}="","",G${r}+H${r})`,
      { z: DATE_FMT }
    );
    tws[`J${r}`] = formulaCell(c.daysOverdue === "" ? "" : c.daysOverdue, `IF(G${r}="","",TODAY()-I${r})`);
    tws[`K${r}`] = formulaCell(
      c.ageingBucket,
      `IF(G${r}="","Set Invoice Date",IF(J${r}<=0,"Not Due",IF(J${r}<=30,"0-30 Days",IF(J${r}<=60,"31-60 Days",IF(J${r}<=90,"61-90 Days","90+ Days")))))`
    );
    tws[`L${r}`] = textCell(c.status);
    tws[`M${r}`] = formulaCell(
      c.priority,
      `IF(L${r}="Settled","-",IF(G${r}="","Set Invoice Date",IF(AND(F${r}>=500000,J${r}>60),"Critical",IF(OR(F${r}>=500000,J${r}>90),"High",IF(F${r}>=100000,"Medium","Low")))))`
    );

    // Next Follow-up Date: still a live suggestion formula until someone
    // sets a real date — exactly like the original sheet's convention.
    if (!c.nextFollowupDate) {
      tws[`N${r}`] = formulaCell(
        "",
        `IF(L${r}="Settled","-",IF(M${r}="Critical",TODAY()+1,IF(M${r}="High",TODAY()+2,IF(M${r}="Medium",TODAY()+5,TODAY()+7))))`,
        { z: DATE_FMT }
      );
    } else {
      tws[`N${r}`] = dateCell(c.nextFollowupDate);
    }

    tws[`O${r}`] = dateCell(c.lastFollowupDate);
    tws[`P${r}`] = textCell(c.followedUpBy);
    tws[`Q${r}`] = textCell(c.remark);
  });

  tws["!ref"] = `A1:Q${lastRow}`;
  tws["!cols"] = [
    { wch: 6 }, { wch: 24 }, { wch: 28 }, { wch: 26 }, { wch: 22 },
    { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, tws, "Followup Tracker");

  /* =============================== Dashboard =============================== */
  const dws = {};
  const TF = `'Followup Tracker'`;
  const rangeF = `${TF}!$F$${startRow}:$F$${lastRow}`;
  const rangeB = `${TF}!$B$${startRow}:$B$${lastRow}`;
  const rangeC = `${TF}!$C$${startRow}:$C$${lastRow}`;
  const rangeL = `${TF}!$L$${startRow}:$L$${lastRow}`;

  const totalOutstanding = enriched.reduce((s, c) => s + (Number(c.amountOutstanding) || 0), 0);
  const byFirm = {};
  meta.firms.forEach((f) => (byFirm[f] = 0));
  enriched.forEach((c) => (byFirm[c.firm] = (byFirm[c.firm] || 0) + (Number(c.amountOutstanding) || 0)));
  const pending = enriched.filter((c) => c.status === "Pending Follow-up").length;
  const settled = enriched.filter((c) => c.status === "Settled").length;

  dws["B2"] = textCell("STONEDGE GROUP — CUSTOMER OUTSTANDING & FOLLOW-UP DASHBOARD");
  dws["B3"] = textCell("Report Date:");
  dws["C3"] = formulaCell(excelSerial(new Date().toISOString().slice(0, 10)), "TODAY()", { z: DATE_FMT });

  let r = 5;
  dws[`B${r}`] = textCell("KEY METRICS"); r++;
  dws[`B${r}`] = textCell("Total Outstanding (Both Firms)");
  dws[`E${r}`] = formulaCell(totalOutstanding, `SUM(${rangeF})`, { z: CURRENCY_FMT }); r++;
  meta.firms.forEach((f) => {
    dws[`B${r}`] = textCell(`${f} — Outstanding`);
    dws[`E${r}`] = formulaCell(byFirm[f] || 0, `SUMIF(${rangeB},"${f}",${rangeF})`, { z: CURRENCY_FMT });
    r++;
  });
  dws[`B${r}`] = textCell("Total Customers");
  dws[`E${r}`] = formulaCell(enriched.length, `COUNTA(${rangeC})`); r++;
  dws[`B${r}`] = textCell("Customers Pending Follow-up");
  dws[`E${r}`] = formulaCell(pending, `COUNTIF(${rangeL},"Pending Follow-up")`); r++;
  dws[`B${r}`] = textCell("Customers Settled");
  dws[`E${r}`] = formulaCell(settled, `COUNTIF(${rangeL},"Settled")`); r++;
  r++; // blank row

  dws[`B${r}`] = textCell("STATUS BREAKDOWN"); r++;
  dws[`B${r}`] = textCell("Status"); dws[`C${r}`] = textCell("No. of Customers"); dws[`D${r}`] = textCell("Amount Outstanding"); r++;
  meta.statuses.forEach((s) => {
    const rows = enriched.filter((c) => c.status === s);
    const amt = rows.reduce((sum, c) => sum + (Number(c.amountOutstanding) || 0), 0);
    dws[`B${r}`] = textCell(s);
    dws[`C${r}`] = formulaCell(rows.length, `COUNTIF(${rangeL},B${r})`);
    dws[`D${r}`] = formulaCell(amt, `SUMIF(${rangeL},B${r},${rangeF})`, { z: CURRENCY_FMT });
    r++;
  });
  r++; // blank row

  dws[`B${r}`] = textCell("TOP 5 HIGHEST OUTSTANDING CUSTOMERS"); r++;
  dws[`B${r}`] = textCell("Rank"); dws[`C${r}`] = textCell("Customer Name"); dws[`D${r}`] = textCell("Firm"); dws[`E${r}`] = textCell("Amount Outstanding"); r++;
  const top5 = [...enriched].sort((a, b) => (Number(b.amountOutstanding) || 0) - (Number(a.amountOutstanding) || 0)).slice(0, 5);
  top5.forEach((c, i) => {
    dws[`B${r}`] = numCell(i + 1);
    dws[`C${r}`] = textCell(c.customerName);
    dws[`D${r}`] = textCell(c.firm);
    dws[`E${r}`] = formulaCell(c.amountOutstanding || 0, `LARGE(${rangeF},${i + 1})`, { z: CURRENCY_FMT });
    r++;
  });
  r++;
  dws[`B${r}`] = textCell("Note: Enter an Invoice Date for each customer in the Followup Tracker sheet to"); r++;
  dws[`B${r}`] = textCell("automatically activate Days Overdue, Ageing Bucket and Priority calculations.");

  dws["!ref"] = `A1:H${r}`;
  dws["!cols"] = [{ wch: 3 }, { wch: 34 }, { wch: 16 }, { wch: 26 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, dws, "Dashboard");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Stonedge_Followup_Tracker_Export_${stamp}.xlsx`, { cellStyles: true });
}
