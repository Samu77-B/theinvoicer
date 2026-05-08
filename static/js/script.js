let previewInvoiceId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadClients();
  loadInvoices();
  addInvoiceItem();

  const vatCb = document.getElementById('invoiceVatApplies');
  if (vatCb) {
    vatCb.addEventListener('change', syncInvoiceVatUi);
  }
  const editVatCb = document.getElementById('editInvoiceVatApplies');
  if (editVatCb) {
    editVatCb.addEventListener('change', syncEditInvoiceVatUi);
  }

  const newInvModal = document.getElementById('newInvoiceModal');
  if (newInvModal) {
    newInvModal.addEventListener('shown.bs.modal', () => {
      const box = document.getElementById('invoiceItems');
      if (box && box.children.length === 0) {
        addInvoiceItem();
      }
      const vatCheck = document.getElementById('invoiceVatApplies');
      const vatRate = document.getElementById('invoiceVatRate');
      if (vatCheck) vatCheck.checked = false;
      if (vatRate) vatRate.value = '20';
      syncInvoiceVatUi();
    });
  }

  const reportsModal = document.getElementById('reportsModal');
  if (reportsModal) {
    reportsModal.addEventListener('shown.bs.modal', () => {
      loadReport('month');
    });
  }
});

function escapeHtml(text) {
  if (text == null) return '';
  const d = document.createElement('div');
  d.textContent = String(text);
  return d.innerHTML;
}

function formatUkDate(isoYmd) {
  if (!isoYmd) return '';
  const p = isoYmd.split('-');
  if (p.length !== 3) return isoYmd;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

async function apiFetch(url, options = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...options });
  if (r.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return r;
}

function syncInvoiceVatUi() {
  const cb = document.getElementById('invoiceVatApplies');
  const wrap = document.getElementById('invoiceVatRateWrap');
  if (cb && wrap) wrap.style.display = cb.checked ? 'block' : 'none';
}

function syncEditInvoiceVatUi() {
  const cb = document.getElementById('editInvoiceVatApplies');
  const wrap = document.getElementById('editInvoiceVatRateWrap');
  if (cb && wrap) wrap.style.display = cb.checked ? 'block' : 'none';
}

function setReportPeriodUI(period) {
  const w = document.getElementById('reportWeekBtn');
  const m = document.getElementById('reportMonthBtn');
  if (!w || !m) return;
  if (period === 'week') {
    w.classList.add('btn-apple-primary');
    w.classList.remove('btn-apple-secondary');
    m.classList.add('btn-apple-secondary');
    m.classList.remove('btn-apple-primary');
  } else {
    m.classList.add('btn-apple-primary');
    m.classList.remove('btn-apple-secondary');
    w.classList.add('btn-apple-secondary');
    w.classList.remove('btn-apple-primary');
  }
}

async function loadReport(period) {
  setReportPeriodUI(period);
  const el = document.getElementById('reportsContent');
  if (!el) return;
  el.innerHTML = '<p class="text-muted mb-0">Loading…</p>';
  try {
    const response = await apiFetch(`/api/reports?period=${encodeURIComponent(period)}`);
    if (!response.ok) throw new Error('Failed to load report');
    const data = await response.json();
    const rowsHtml = (data.invoices || [])
      .map(
        (inv) => `
      <tr>
        <td>${escapeHtml(inv.invoice_number)}</td>
        <td>${escapeHtml(formatUkDate(inv.date))}</td>
        <td>${escapeHtml(inv.client_name)}</td>
        <td class="text-end">£${Number(inv.total_amount).toFixed(2)}</td>
        <td>${inv.paid ? '<span class="text-success">Paid</span>' : '<span class="text-warning">Unpaid</span>'}</td>
      </tr>`
      )
      .join('');
    el.innerHTML = `
      <p class="text-muted mb-3" style="font-size: 13px;">${escapeHtml(data.range_start)} – ${escapeHtml(data.range_end)} · UTC calendar ${escapeHtml(data.period)}</p>
      <div class="reports-summary">
        <div class="reports-stat"><p class="label">Invoices</p><p class="value">${data.invoice_count}</p></div>
        <div class="reports-stat"><p class="label">Invoiced</p><p class="value">£${Number(data.total_invoiced).toFixed(2)}</p></div>
        <div class="reports-stat"><p class="label">Paid</p><p class="value">£${Number(data.paid_total).toFixed(2)}</p></div>
        <div class="reports-stat"><p class="label">Unpaid</p><p class="value">£${Number(data.unpaid_total).toFixed(2)}</p></div>
      </div>
      <div class="table-responsive rounded-3 border" style="border-color: var(--border) !important;">
        <table class="table table-dark table-striped mb-0" style="--bs-table-bg: transparent;">
          <thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th class="text-end">Total</th><th>Status</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="5" class="text-muted">No invoices in this period.</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = `<p class="text-danger mb-0">${escapeHtml(e.message || 'Failed to load report')}</p>`;
  }
}

async function loadClients() {
  try {
    const response = await apiFetch('/api/clients');
    if (!response.ok) throw new Error('Failed to load clients');
    const clients = await response.json();

    const clientSelect = document.querySelector('select[name="client_id"]');
    if (!clientSelect) return;
    clientSelect.innerHTML = '<option value="">Select a client…</option>';

    clients.forEach((client) => {
      const option = document.createElement('option');
      option.value = client.id;
      option.textContent = client.name;
      clientSelect.appendChild(option);
    });
  } catch (error) {
    showError('Failed to load clients: ' + error.message);
  }
}

async function saveClient() {
  try {
    const form = document.getElementById('clientForm');
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const address = (form.querySelector('[name="address"]')?.value || '').trim();

    if (!name || !email) {
      showError('Name and email are required');
      return;
    }

    const response = await apiFetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, address }),
    });

    if (!response.ok) throw new Error('Failed to save client');

    showSuccess('Client saved successfully');
    form.reset();
    bootstrap.Modal.getInstance(document.getElementById('newClientModal')).hide();
    loadClients();
  } catch (error) {
    showError('Failed to save client: ' + error.message);
  }
}

function addInvoiceItem() {
  const container = document.getElementById('invoiceItems');
  const newItem = document.createElement('div');
  newItem.className = 'line-item-row';
  newItem.innerHTML = `
        <div class="line-item-desc">
          <input type="text" class="form-control" name="description[]" placeholder="Description" required>
        </div>
        <div class="line-item-amt">
          <input type="number" step="0.01" class="form-control" name="amount[]" placeholder="0.00" required>
        </div>
        <div class="line-item-rm">
          <button type="button" class="btn-remove-line" aria-label="Remove line" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
  container.appendChild(newItem);
}

async function saveInvoice() {
  try {
    const form = document.getElementById('invoiceForm');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const clientId = form.querySelector('select[name="client_id"]').value;
    if (!clientId) {
      showError('Please select a client');
      return;
    }

    const descriptions = Array.from(form.querySelectorAll('input[name="description[]"]')).map((input) => input.value);
    const amounts = Array.from(form.querySelectorAll('input[name="amount[]"]')).map((input) => parseFloat(input.value));

    if (descriptions.length === 0) {
      showError('Please add at least one invoice item');
      return;
    }

    const items = descriptions.map((description, index) => ({
      description,
      amount: amounts[index],
    }));

    const vatApplies = document.getElementById('invoiceVatApplies')?.checked || false;
    const vatRateRaw = document.getElementById('invoiceVatRate')?.value;
    const vatRatePercent = vatApplies ? parseFloat(vatRateRaw) : undefined;
    if (vatApplies && (Number.isNaN(vatRatePercent) || vatRatePercent < 0 || vatRatePercent > 100)) {
      showError('Enter a valid VAT rate between 0 and 100');
      return;
    }

    const response = await apiFetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: parseInt(clientId, 10),
        items,
        vat_applies: vatApplies,
        vat_rate_percent: vatRatePercent,
      }),
    });

    if (!response.ok) throw new Error('Failed to save invoice');

    const result = await response.json();
    showSuccess(`Invoice ${result.invoice_number} created successfully for ${result.client_name}`);
    form.reset();
    document.getElementById('invoiceItems').innerHTML = '';
    addInvoiceItem();
    bootstrap.Modal.getInstance(document.getElementById('newInvoiceModal')).hide();
    loadInvoices();
  } catch (error) {
    showError('Failed to save invoice: ' + error.message);
  }
}

function renderInvoicePreviewHtml(invoice) {
  const addr = (invoice.client.address || '').trim();
  const billToLines = [escapeHtml(invoice.client.name)];
  if (addr) billToLines.push(escapeHtml(addr).replace(/\n/g, '<br>'));
  billToLines.push(`<span class="text-muted">${escapeHtml(invoice.client.email)}</span>`);

  const rows = invoice.items
    .map(
      (item) => `
                    <tr>
                        <td>${escapeHtml(item.description)}</td>
                        <td class="text-end">£${Number(item.amount).toFixed(2)}</td>
                    </tr>`
    )
    .join('');

  const subtotal =
    invoice.subtotal_net != null
      ? Number(invoice.subtotal_net)
      : invoice.items.reduce((s, item) => s + Number(item.amount), 0);
  const vatApplies = !!invoice.vat_applies;
  const amtHeading = vatApplies ? 'Amount (net)' : 'Amount';
  const vatRows = vatApplies
    ? `
                <tr>
                    <td class="text-end" style="border-left: none; border-bottom: none;">Subtotal (net)</td>
                    <td class="text-end">£${subtotal.toFixed(2)}</td>
                </tr>
                <tr>
                    <td class="text-end" style="border-left: none; border-bottom: none;">VAT (${Number(
                      invoice.vat_rate_percent ?? 20
                    ).toFixed(2)}%)</td>
                    <td class="text-end">£${Number(invoice.vat_amount || 0).toFixed(2)}</td>
                </tr>`
    : '';
  const totalLabel = vatApplies ? 'Total due' : 'Total';

  return `
        <div class="invoice-header">
            <div class="invoice-header-left">
                <img src="/static/logo.png" alt="" class="invoice-logo" width="56" height="56">
                <div class="invoice-from">
                    <h2>Paul Banning</h2>
                    <p>48 Pellipar Close<br>
                    London N13 4AG<br>
                    07730 556097</p>
                </div>
            </div>
            <div class="text-end">
                <h1>INVOICE</h1>
                <p>Invoice #: ${escapeHtml(invoice.invoice_number)}<br>
                Date: ${escapeHtml(formatUkDate(invoice.date))}</p>
            </div>
        </div>

        <div class="invoice-details">
            <h4>Bill To</h4>
            <p>${billToLines.join('<br>')}</p>
        </div>

        <table class="invoice-items">
            <thead>
                <tr>
                    <th style="width: 70%">Description</th>
                    <th style="width: 30%" class="text-end">${amtHeading}</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
                ${vatRows}
                <tr>
                    <td class="text-end" style="border-left: none; border-bottom: none;"><strong>${totalLabel}</strong></td>
                    <td class="text-end"><strong>£${Number(invoice.total_amount).toFixed(2)}</strong></td>
                </tr>
            </tbody>
        </table>

        <div class="invoice-terms">
            <h5>Terms &amp; Conditions</h5>
            <p>Payment is due on receipt of invoice</p>

            <h5>Bank details</h5>
            <p>Paul Banning<br>
            Account 72113763<br>
            Sort code 60-83-71</p>
        </div>
    `;
}

async function openInvoicePreview(invoiceId) {
  try {
    const response = await apiFetch(`/api/invoices/${invoiceId}`);
    if (!response.ok) throw new Error('Failed to load invoice');
    const invoice = await response.json();
    previewInvoiceId = invoice.id;

    const msg = document.getElementById('emailMessage');
    if (msg) msg.value = '';

    const preview = document.getElementById('invoicePreview');
    preview.className = 'invoice-preview';
    preview.innerHTML = renderInvoicePreviewHtml(invoice);

    const modal = new bootstrap.Modal(document.getElementById('invoicePreviewModal'));
    modal.show();
  } catch (error) {
    showError('Failed to open preview: ' + error.message);
  }
}

async function openEditInvoice(invoiceId) {
  try {
    const response = await apiFetch(`/api/invoices/${invoiceId}`);
    if (!response.ok) throw new Error('Failed to load invoice');
    const invoice = await response.json();

    const form = document.getElementById('editInvoiceForm');
    form.querySelector('input[name="invoice_id"]').value = invoice.id;
    form.querySelector('input[name="invoice_number"]').value = invoice.invoice_number;
    form.querySelector('input[name="client_name"]').value = invoice.client.name;

    const itemsContainer = document.getElementById('editInvoiceItems');
    itemsContainer.innerHTML = `
            <div class="row mb-2">
                <div class="col-8">
                    <label class="form-label">Description</label>
                </div>
                <div class="col-4">
                    <label class="form-label">Amount (£)</label>
                </div>
            </div>
        `;

    invoice.items.forEach((item) => addEditInvoiceItem(item));

    const ev = document.getElementById('editInvoiceVatApplies');
    const er = document.getElementById('editInvoiceVatRate');
    if (ev) ev.checked = !!invoice.vat_applies;
    if (er) {
      er.value =
        invoice.vat_applies && invoice.vat_rate_percent != null
          ? String(invoice.vat_rate_percent)
          : '20';
    }
    syncEditInvoiceVatUi();

    const modal = new bootstrap.Modal(document.getElementById('editInvoiceModal'));
    modal.show();
  } catch (error) {
    showError('Failed to edit invoice: ' + error.message);
  }
}

function addEditInvoiceItem(item = null) {
  const container = document.getElementById('editInvoiceItems');
  const newItem = document.createElement('div');
  newItem.className = 'line-item-row';
  newItem.innerHTML = `
        <div class="line-item-desc">
          <input type="text" class="form-control" name="description[]" placeholder="Description" required>
        </div>
        <div class="line-item-amt">
          <input type="number" step="0.01" class="form-control" name="amount[]" placeholder="0.00" required>
        </div>
        <div class="line-item-rm">
          <button type="button" class="btn-remove-line" aria-label="Remove line" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
  const descInput = newItem.querySelector('input[name="description[]"]');
  const amtInput = newItem.querySelector('input[name="amount[]"]');
  if (item) {
    descInput.value = item.description;
    amtInput.value = item.amount;
  }
  container.appendChild(newItem);
}

async function updateInvoice() {
  try {
    const form = document.getElementById('editInvoiceForm');
    const invoiceId = form.querySelector('input[name="invoice_id"]').value;
    const invoiceNumber = (form.querySelector('input[name="invoice_number"]').value || '').trim();
    const descriptions = Array.from(form.querySelectorAll('#editInvoiceItems input[name="description[]"]')).map((input) => input.value);
    const amounts = Array.from(form.querySelectorAll('#editInvoiceItems input[name="amount[]"]')).map((input) => parseFloat(input.value));

    const items = descriptions.map((description, index) => ({
      description,
      amount: amounts[index],
    }));

    const vatApplies = document.getElementById('editInvoiceVatApplies')?.checked || false;
    const vatRateRaw = document.getElementById('editInvoiceVatRate')?.value;
    const vatRatePercent = vatApplies ? parseFloat(vatRateRaw) : undefined;
    if (vatApplies && (Number.isNaN(vatRatePercent) || vatRatePercent < 0 || vatRatePercent > 100)) {
      showError('Enter a valid VAT rate between 0 and 100');
      return;
    }

    const response = await apiFetch(`/api/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        invoice_number: invoiceNumber,
        vat_applies: vatApplies,
        vat_rate_percent: vatRatePercent,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to update invoice');
    }

    showSuccess('Invoice updated successfully');
    bootstrap.Modal.getInstance(document.getElementById('editInvoiceModal')).hide();
    loadInvoices();
  } catch (error) {
    showError('Failed to update invoice: ' + error.message);
  }
}

async function deleteInvoice(invoiceId) {
  if (!confirm('Are you sure you want to delete this invoice?')) return;

  try {
    const response = await apiFetch(`/api/invoices/${invoiceId}`, {
      method: 'DELETE',
    });

    if (!response.ok) throw new Error('Failed to delete invoice');

    showSuccess('Invoice deleted successfully');
    loadInvoices();
  } catch (error) {
    showError('Failed to delete invoice: ' + error.message);
  }
}

async function duplicateInvoice(invoiceId) {
  try {
    const response = await apiFetch(`/api/invoices/${invoiceId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to duplicate invoice');
    }
    showSuccess(`Duplicated as ${data.invoice_number}`);
    await loadInvoices();
    if (data.id) {
      openEditInvoice(data.id);
    }
  } catch (error) {
    showError(error.message || 'Failed to duplicate invoice');
  }
}

async function loadInvoices() {
  try {
    const response = await apiFetch('/api/invoices');
    if (!response.ok) throw new Error('Failed to load invoices');
    const invoices = await response.json();

    const list = document.getElementById('invoicesList');
    list.innerHTML = '';

    if (invoices.length === 0) {
      list.innerHTML = '<div class="empty-state">No invoices yet. Create a client, then make your first invoice.</div>';
      return;
    }

    invoices.forEach((invoice) => {
      const item = document.createElement('div');
      item.className = 'invoice-card';
      item.innerHTML = `
                <div class="invoice-card-main">
                    <p class="invoice-card-title">${escapeHtml(invoice.invoice_number)} — ${escapeHtml(invoice.client.name)}</p>
                    <p class="invoice-card-meta">Date: ${escapeHtml(formatUkDate(invoice.date))}</p>
                    ${
                      invoice.vat_applies
                        ? `<p class="invoice-card-vat">VAT ${Number(invoice.vat_rate_percent ?? 20).toFixed(2)}% · Net £${Number(
                            invoice.subtotal_net ?? 0
                          ).toFixed(2)}</p>`
                        : ''
                    }
                    <p class="invoice-card-amount">£${Number(invoice.total_amount).toFixed(2)}</p>
                </div>
                <div class="invoice-card-actions">
                    <button type="button" class="btn-apple-icon" title="Preview" aria-label="Preview" onclick="openInvoicePreview(${invoice.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button type="button" class="btn-apple-icon" title="Edit" aria-label="Edit" onclick="openEditInvoice(${invoice.id})">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button type="button" class="btn-apple-icon" title="Duplicate" aria-label="Duplicate" onclick="duplicateInvoice(${invoice.id})">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button type="button" class="btn-apple-icon ${invoice.paid ? 'is-paid' : 'is-unpaid'}" title="Toggle paid" aria-label="Toggle paid"
                            onclick="togglePaidStatus(${invoice.id}, ${!invoice.paid})">
                        <i class="fas fa-${invoice.paid ? 'check' : 'clock'}"></i>
                    </button>
                    <button type="button" class="btn-apple-icon is-danger" title="Delete" aria-label="Delete" onclick="deleteInvoice(${invoice.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
      list.appendChild(item);
    });
  } catch (error) {
    showError('Failed to load invoices: ' + error.message);
  }
}

async function togglePaidStatus(invoiceId, isPaid) {
  try {
    const response = await apiFetch(`/api/invoices/${invoiceId}/paid`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid: isPaid }),
    });

    if (!response.ok) throw new Error('Failed to update payment status');

    showSuccess(`Invoice marked as ${isPaid ? 'paid' : 'unpaid'}`);
    loadInvoices();
  } catch (error) {
    showError('Failed to update payment status: ' + error.message);
  }
}

async function sendInvoiceEmail() {
  if (!previewInvoiceId) {
    showError('Open an invoice preview first');
    return;
  }
  const btn = document.getElementById('btnSendInvoice');
  if (btn) {
    btn.disabled = true;
  }
  try {
    const msgEl = document.getElementById('emailMessage');
    const message = (msgEl?.value || '').trim();
    const response = await apiFetch(`/api/invoices/${previewInvoiceId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Send failed');
    }
    showSuccess('Invoice sent to client email');
  } catch (error) {
    showError(error.message || 'Failed to send email');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function printInvoice() {
  const el = document.querySelector('#invoicePreviewModal .invoice-preview');
  if (!el) return;

  const invoiceContent = el.cloneNode(true);
  const printContainer = document.createElement('div');
  printContainer.className = 'print-container';
  printContainer.style.cssText = `
        position: fixed;
        left: 0;
        top: 0;
        width: 100%;
        max-width: 210mm;
        height: auto;
        min-height: 0;
        padding: 0;
        margin: 0;
        background-color: white;
        z-index: 9999;
        overflow: visible;
    `;

  printContainer.appendChild(invoiceContent);
  document.body.appendChild(printContainer);

  setTimeout(() => {
    window.print();
    document.body.removeChild(printContainer);
  }, 200);
}

function savePDF() {
  printInvoice();
}

function showSuccess(message) {
  const alertDiv = document.createElement('div');
  alertDiv.className = 'alert app-toast alert-success alert-dismissible fade show position-fixed top-0 end-0 m-3';
  alertDiv.style.zIndex = '11000';
  alertDiv.innerHTML = `
        ${escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
  document.body.appendChild(alertDiv);
  setTimeout(() => alertDiv.remove(), 5000);
}

function showError(message) {
  const alertDiv = document.createElement('div');
  alertDiv.className = 'alert app-toast alert-danger alert-dismissible fade show position-fixed top-0 end-0 m-3';
  alertDiv.style.zIndex = '11000';
  alertDiv.innerHTML = `
        ${escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
  document.body.appendChild(alertDiv);
  setTimeout(() => alertDiv.remove(), 8000);
}
