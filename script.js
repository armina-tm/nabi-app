// ── Suggestion Modal ───────────────────────────────────────────────────────

function openSuggestModal() {
  document.getElementById('suggestModal').classList.add('open');
}

function closeSuggestModal(e) {
  if (e && e.target !== document.getElementById('suggestModal')) return;
  document.getElementById('suggestModal').classList.remove('open');
  document.getElementById('suggestText').value = '';
}

function sendSuggestion() {
  const text = document.getElementById('suggestText').value.trim();
  if (!text) { alert('Please enter a message before sending.'); return; }
  const subject = encodeURIComponent('nabi app - Feedback');
  const body    = encodeURIComponent(text);
  window.location.href = `mailto:a.malala@sap.com?subject=${subject}&body=${body}`;
  closeSuggestModal();
}
let selectedOp   = null;
let selectedFreq = null;
let selectedDays = new Set();

let selectedOp2        = null;
let selectedCombinator = 'and';
let condition2Active   = false;

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildDayPicker();
  wireOperatorButtons();
  wireFrequencyButtons();
  wireCombinatorButtons();
  wireOpGroup2();
});

function buildDayPicker() {
  const picker = document.getElementById('dayPicker');
  for (let d = 1; d <= 31; d++) {
    const chip = document.createElement('button');
    chip.className = 'day-chip';
    chip.textContent = d;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      selectedDays.has(d) ? selectedDays.delete(d) : selectedDays.add(d);
    });
    picker.appendChild(chip);
  }
}

function wireOperatorButtons() {
  document.getElementById('opGroup').addEventListener('click', e => {
    const btn = e.target.closest('.op-btn');
    if (!btn) return;
    document.querySelectorAll('#opGroup .op-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedOp = btn.dataset.op;
  });
}

function wireFrequencyButtons() {
  document.getElementById('freqGroup').addEventListener('click', e => {
    const btn = e.target.closest('.freq-btn');
    if (!btn) return;
    document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedFreq = btn.dataset.freq;

    document.getElementById('extraEveryX').classList.toggle('visible',    selectedFreq === 'every-x');
    document.getElementById('extraSpecificDays').classList.toggle('visible', selectedFreq === 'specific-days');
  });
}

// ── Date helpers ───────────────────────────────────────────────────────────

// Parse a yyyy-mm-dd string as a local date (avoids UTC-offset issues)
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function isWeekday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

// ── Condition logic ────────────────────────────────────────────────────────

/*
  For each condition we need to know:
    - windowStart / windowEnd  (the date range)
    - triggers(evalDate)       → true if the email fires on that date

  evalDate  = the transaction/reference date entered by the user
  runDate   = the date the job is currently running (we iterate this)
  x         = offset in days
*/

function getWindowForRunDate(op, evalDate, x, runDate) {
  switch (op) {
    case 'within-minus':
    case 'not-within-minus':
      return { start: addDays(runDate, -x), end: runDate };

    case 'within-plus':
    case 'not-within-plus':
      return { start: runDate, end: addDays(runDate, x) };
  }
}

function conditionMet(op, evalDate, x, runDate) {
  const { start, end } = getWindowForRunDate(op, evalDate, x, runDate);
  const inside = evalDate >= start && evalDate <= end;

  switch (op) {
    case 'within-minus':
    case 'within-plus':
      return inside;

    case 'not-within-minus':
    case 'not-within-plus':
      return !inside;
  }
}

// ── First trigger date ─────────────────────────────────────────────────────

/*
  We search forward from the reference date (or today, whichever makes sense)
  to find the first calendar day on which the condition is TRUE.
  We cap the search at 730 days to avoid infinite loops.
*/
function findFirstTriggerDate(op, evalDate, x) {
  const CAP = 730;
  let candidate = new Date(evalDate);
  for (let i = 0; i < CAP; i++) {
    if (combinedConditionMet(candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return null;
}

// ── Schedule generation ────────────────────────────────────────────────────

function nextScheduledDate(freq, fromDate, intervalDays, specificDays) {
  switch (freq) {
    case 'daily':
      return addDays(fromDate, 1);

    case 'daily-weekdays': {
      let d = addDays(fromDate, 1);
      while (!isWeekday(d)) d = addDays(d, 1);
      return d;
    }

    case 'every-x':
      return addDays(fromDate, intervalDays);

    case 'specific-days': {
      // find the next calendar date whose day-of-month is in the set
      let d = addDays(fromDate, 1);
      for (let i = 0; i < 366; i++) {
        if (specificDays.has(d.getDate())) return d;
        d = addDays(d, 1);
      }
      return null;
    }

    case 'once':
      return null; // only fires once
  }
}

/*
  Build an array of up to `limit` trigger dates starting from firstTrigger,
  honouring the frequency and only including dates where the condition is met.
*/
function buildSchedule(op, evalDate, x, firstTrigger, freq, intervalDays, specificDays, limit = 10) {
  if (freq === 'once') return [firstTrigger];

  let last = firstTrigger;
  if (freq === 'specific-days') {
    const dates = [];
    const CAP = 1460;
    // Find the first scheduled day on or after firstTrigger
    let candidate = new Date(firstTrigger);
    candidate.setDate(candidate.getDate() - 1); // step back one so nextScheduledDate starts from firstTrigger
    for (let i = 0; i < CAP && dates.length < limit; i++) {
      const next = nextScheduledDate('specific-days', candidate, intervalDays, specificDays);
      if (!next) break;
      candidate = next;
      if (!combinedConditionMet(next)) break;
      dates.push(next);
    }
    return dates;
  }

  const dates = [firstTrigger];
  const CAP = 1460;

  for (let i = 0; i < CAP && dates.length < limit; i++) {
    const next = nextScheduledDate(freq, last, intervalDays, specificDays);
    if (!next) break;
    last = next;
    if (!combinedConditionMet(next)) break;
    dates.push(next);
  }
  return dates;
}

// ── Explanation text ───────────────────────────────────────────────────────

function buildExplanation(op, evalDate, x, firstTrigger) {
  const evalStr  = formatDate(evalDate);
  const xMark    = formatDate(addDays(evalDate, op.includes('plus') ? x : -(-x))); // unused here, kept for clarity
  const markDate = formatDate(addDays(evalDate, op.includes('minus') ? x : -x));

  switch (op) {
    case 'within-minus':
      return `The reminder fires every run day while the transaction date (${evalStr}) is within the last ${x} days. ` +
             `It stops triggering after the ${x}-day mark (${formatDate(addDays(evalDate, x))}).`;

    case 'not-within-minus':
      return `The reminder fires every run day once the transaction date (${evalStr}) is more than ${x} days old. ` +
             `The first trigger is on ${formatDate(addDays(evalDate, x))} — the day after the ${x}-day window closes.`;

    case 'within-plus':
      return `The reminder fires every run day while the due date (${evalStr}) is within the next ${x} days. ` +
             `It starts ${x} days before the due date and fires up to and including ${evalStr}.`;

    case 'not-within-plus':
      return `The reminder fires every run day while the due date (${evalStr}) is still more than ${x} days away. ` +
             `It stops once the date enters the ${x}-day window.`;
  }
}

function wireCombinatorButtons() {
  document.getElementById('combinatorGroup').addEventListener('click', e => {
    const btn = e.target.closest('.comb-btn');
    if (!btn) return;
    document.querySelectorAll('.comb-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCombinator = btn.dataset.comb;
  });
}

function wireOpGroup2() {
  document.getElementById('opGroup2').addEventListener('click', e => {
    const btn = e.target.closest('.op-btn');
    if (!btn) return;
    document.querySelectorAll('#opGroup2 .op-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedOp2 = btn.dataset.op;
  });
}

function showCondition2() {
  condition2Active = true;
  document.getElementById('condition2Wrapper').classList.add('visible');
  document.getElementById('addCondBtn').style.display = 'none';
  // Mirror Condition 1 date into Condition 2 as a convenience default
  const d1 = document.getElementById('refDate').value;
  if (d1) document.getElementById('refDate2').value = d1;
}

function hideCondition2() {
  condition2Active = false;
  document.getElementById('condition2Wrapper').classList.remove('visible');
  document.getElementById('addCondBtn').style.display = 'block';
  // Reset Condition 2 state
  selectedOp2 = null;
  document.querySelectorAll('#opGroup2 .op-btn').forEach(b => b.classList.remove('selected'));
}

// ── Combined condition logic ───────────────────────────────────────────────

// evalDate1/2, x1/2 are set inside calculate() before any find/build call
let _evalDate1, _x1, _evalDate2, _x2;

function combinedConditionMet(runDate) {
  const c1 = conditionMet(selectedOp, _evalDate1, _x1, runDate);
  if (!condition2Active) return c1;
  const c2 = conditionMet(selectedOp2, _evalDate2, _x2, runDate);
  return selectedCombinator === 'and' ? c1 && c2 : c1 || c2;
}

// ── Main calculate() ───────────────────────────────────────────────────────

function calculate() {
  // 1. Read inputs — Condition 1
  const refDateVal = document.getElementById('refDate').value;
  const offsetVal  = parseInt(document.getElementById('offset').value, 10);

  if (!refDateVal)   { alert('Please enter a Transaction Date.'); return; }
  if (!selectedOp)   { alert('Please select an Operator for Condition 1.'); return; }
  if (!selectedFreq) { alert('Please select a Frequency.'); return; }
  if (isNaN(offsetVal) || offsetVal < 1) { alert('X days must be at least 1.'); return; }

  if (selectedFreq === 'every-x') {
    const iv = parseInt(document.getElementById('intervalDays').value, 10);
    if (isNaN(iv) || iv < 1) { alert('Interval must be at least 1 day.'); return; }
  }
  if (selectedFreq === 'specific-days' && selectedDays.size === 0) {
    alert('Please select at least one day of the month.');
    return;
  }

  // 2. Read inputs — Condition 2 (if active)
  if (condition2Active) {
    const refDate2Val = document.getElementById('refDate2').value;
    const offset2Val  = parseInt(document.getElementById('offset2').value, 10);
    if (!refDate2Val) { alert('Please enter a Transaction Date for Condition 2.'); return; }
    if (!selectedOp2) { alert('Please select an Operator for Condition 2.'); return; }
    if (isNaN(offset2Val) || offset2Val < 1) { alert('X days for Condition 2 must be at least 1.'); return; }
    _evalDate2 = parseLocalDate(refDate2Val);
    _x2        = offset2Val;
  }

  // 3. Set shared variables used by combinedConditionMet
  _evalDate1 = parseLocalDate(refDateVal);
  _x1        = offsetVal;

  const intervalDays = parseInt(document.getElementById('intervalDays').value, 10) || 2;

  // 4. Find first trigger date
  const firstTrigger = findFirstTriggerDate(selectedOp, _evalDate1, _x1);

  // 5. Build schedule
  const schedule = firstTrigger
    ? buildSchedule(selectedOp, _evalDate1, _x1, firstTrigger, selectedFreq, intervalDays, selectedDays, 5)
    : [];

  // 6. Render results
  renderResult(firstTrigger, schedule, _evalDate1, _x1, selectedFreq);
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderResult(firstTrigger, schedule, evalDate, x, freq) {
  const resultEl    = document.getElementById('result');
  const triggerEl   = document.getElementById('triggerDate');
  const summaryEl   = document.getElementById('condSummary');
  const scheduleEl  = document.getElementById('scheduleBlock');
  const listEl      = document.getElementById('scheduleList');

  resultEl.style.display = 'block';

  // Condition summary
  if (condition2Active) {
    summaryEl.textContent = selectedCombinator === 'and'
      ? 'Condition 1 AND Condition 2 both satisfied'
      : 'Condition 1 OR Condition 2 satisfied';
  } else {
    summaryEl.textContent = '';
  }

  if (!firstTrigger) {
    triggerEl.textContent    = 'No trigger found within 2 years';
    scheduleEl.style.display = 'none';
    return;
  }

  const displayTrigger = (freq === 'specific-days' && schedule.length > 0) ? schedule[0] : firstTrigger;
  triggerEl.textContent = displayTrigger ? formatDate(displayTrigger) : 'No trigger found within 2 years';

  // Schedule list
  listEl.innerHTML = '';
  if (schedule.length > 0) {
    scheduleEl.style.display = 'block';

    const today = new Date(); today.setHours(0, 0, 0, 0);

    schedule.forEach((d, idx) => {
      const li   = document.createElement('li');
      const dot  = document.createElement('span');
      dot.className = 'dot';

      const isPast   = d < today;
      const isToday  = d.getTime() === today.getTime();

      if (isToday) dot.style.background = '#ecac00';
      if (isPast)  dot.style.background = '#555';

      const label = document.createElement('span');
      label.textContent = formatDate(d);
      if (isPast)  label.style.color = '#666';
      if (isToday) label.style.color = '#ecac00';

      if (idx === 0) {
        const tag = document.createElement('span');
        tag.textContent = 'First trigger';
        tag.style.cssText = 'font-size:10px;background:#ecac00;color:#0a0a0a;border-radius:99px;padding:2px 8px;margin-left:auto;';
        li.append(dot, label, tag);
      } else {
        li.append(dot, label);
      }

      listEl.appendChild(li);
    });
  } else {
    scheduleEl.style.display = 'none';
  }
}
