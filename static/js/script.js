let previewInvoiceId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadClients();
  loadInvoices();
  addInvoiceItem();

  const newInvModal = document.getElementById('newInvoiceModal');
  if (newInvModal) {
    newInvModal.addEventListener('shown.bs.modal', () => {
      const box = document.getElementById('invoiceItems');
      if (box && box.children.length === 0) {
        addInvoiceItem();
      }
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

async function loadClients() {
  try {
    const response = await fetch('/api/clients');
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

    const response = await fetch('/api/clients', {
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

    const response = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: parseInt(clientId, 10), items }),
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

  return `
        <div class="invoice-header">
            <div>
                <img src="/static/images/logo.svg" alt="" class="invoice-logo" width="60" height="60">
                <h2>Paul Banning</h2>
                <p>48 Pellipar Close<br>
                London N13 4AG<br>
                07730 556097</p>
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
                    <th style="width: 30%" class="text-end">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
                <tr>
                    <td class="text-end" style="border-left: none; border-bottom: none;"><strong>Total</strong></td>
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
    const response = await fetch(`/api/invoices/${invoiceId}`);
    if (!response.ok) throw new Error('Failed to load invoice');
    const invoice = await response.json();
    previewInvoiceId = invoice.id;

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
    const response = await fetch(`/api/invoices/${invoiceId}`);
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

    const response = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, invoice_number: invoiceNumber }),
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
    const response = await fetch(`/api/invoices/${invoiceId}`, {
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
    const response = await fetch(`/api/invoices/${invoiceId}/duplicate`, {
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
    const response = await fetch('/api/invoices');
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
    const response = await fetch(`/api/invoices/${invoiceId}/paid`, {
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
    const response = await fetch(`/api/invoices/${previewInvoiceId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        width: 210mm;
        height: 297mm;
        padding: 20mm;
        margin: 0;
        background-color: white;
        z-index: 9999;
        overflow: hidden;
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
