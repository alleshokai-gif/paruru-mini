'use strict';

const uiState = {
  credentials: [],
  credential: null,
  rotation: null
};

const elements = {
  credentialList: document.getElementById('credentialList'),
  refreshButton: document.getElementById('refreshButton'),
  detailEmpty: document.getElementById('detailEmpty'),
  detailContent: document.getElementById('detailContent'),
  detailHeading: document.getElementById('detailHeading'),
  detailState: document.getElementById('detailState'),
  detailStatus: document.getElementById('detailStatus'),
  detailEnabled: document.getElementById('detailEnabled'),
  detailBackend: document.getElementById('detailBackend'),
  detailConsumers: document.getElementById('detailConsumers'),
  detailConnectivity: document.getElementById('detailConnectivity'),
  detailRotated: document.getElementById('detailRotated'),
  changeButton: document.getElementById('changeButton'),
  probeButton: document.getElementById('probeButton'),
  rotationButton: document.getElementById('rotationButton'),
  stagePanel: document.getElementById('stagePanel'),
  stageForm: document.getElementById('stageForm'),
  newCredential: document.getElementById('newCredential'),
  confirmCredential: document.getElementById('confirmCredential'),
  cancelStageButton: document.getElementById('cancelStageButton'),
  rotationPanel: document.getElementById('rotationPanel'),
  rotationHeading: document.getElementById('rotationHeading'),
  rotationState: document.getElementById('rotationState'),
  rotationMessage: document.getElementById('rotationMessage'),
  rotationActions: document.getElementById('rotationActions'),
  auditList: document.getElementById('auditList'),
  diagnosticPanel: document.getElementById('diagnosticPanel'),
  diagnosticSummary: document.getElementById('diagnosticSummary'),
  consumerDiagnostics: document.getElementById('consumerDiagnostics'),
  toast: document.getElementById('toast')
};

async function api(path, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (init.method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.headers['Idempotency-Key'] = crypto.randomUUID();
    init.body = JSON.stringify(options.body || {});
  }
  const response = await fetch(path, init);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || 'Prototype request failed.');
  }
  return payload.data;
}

function makeButton(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', action);
  return button;
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.hidden = false;
  window.setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function labelStatus(value) {
  return String(value || '').replaceAll('_', ' ');
}

async function loadCredentials() {
  try {
    const result = await api('/api/credentials');
    uiState.credentials = result.items;
    renderCredentials();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderCredentials() {
  const cards = uiState.credentials.map((credential) => {
    const card = document.createElement('article');
    card.className = 'credential-card';
    const title = document.createElement('h3');
    title.textContent = credential.display_name;
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    [
      ['Status', labelStatus(credential.status)],
      ['Connection', labelStatus(credential.connectivity)],
      ['Backend', credential.backend],
      ['Consumers', String(credential.consumer_count)],
      ['Enabled', credential.enabled ? 'enabled' : 'disabled'],
      ['Last rotated', credential.last_rotated || '—']
    ].forEach(([label, value]) => {
      const item = document.createElement('div');
      const key = document.createElement('span');
      const data = document.createElement('strong');
      key.textContent = label;
      data.textContent = value;
      item.append(key, data);
      meta.append(item);
    });
    const actions = document.createElement('div');
    actions.className = 'button-row';
    actions.append(
      makeButton('詳細', '', () => selectCredential(credential.credential_id)),
      makeButton('変更', 'secondary', () => beginRotation(credential.credential_id)),
      makeButton('疎通確認', 'secondary', () => probeCredential(credential.credential_id)),
      makeButton('rotation', 'secondary', () => beginRotation(credential.credential_id))
    );
    card.append(title, meta, actions);
    return card;
  });
  elements.credentialList.replaceChildren(...cards);
}

async function selectCredential(credentialId) {
  try {
    uiState.credential = await api(`/api/credentials/${encodeURIComponent(credentialId)}`);
    if (uiState.credential.active_rotation_id) {
      uiState.rotation = await api(`/api/rotations/${encodeURIComponent(uiState.credential.active_rotation_id)}`);
    } else {
      uiState.rotation = null;
    }
    renderDetail();
    renderRotation();
    document.getElementById('detailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderDetail() {
  const credential = uiState.credential;
  elements.detailEmpty.hidden = true;
  elements.detailContent.hidden = false;
  elements.detailHeading.textContent = credential.display_name;
  elements.detailState.textContent = credential.status;
  elements.detailState.classList.toggle('failed', credential.connectivity === 'FAILED');
  elements.detailStatus.textContent = credential.status;
  elements.detailEnabled.textContent = credential.enabled ? 'enabled' : 'disabled';
  elements.detailBackend.textContent = credential.backend;
  elements.detailConsumers.textContent = credential.consumers.map((item) => item.label).join(', ');
  elements.detailConnectivity.textContent = labelStatus(credential.connectivity);
  elements.detailRotated.textContent = credential.last_rotated || '—';
}

async function beginRotation(credentialId) {
  try {
    await selectCredential(credentialId);
    if (!uiState.rotation || ['closed', 'rolled_back'].includes(uiState.rotation.state)) {
      uiState.rotation = await api('/api/rotations', {
        method: 'POST',
        body: { credential_id: credentialId }
      });
    }
    renderRotation();
    if (uiState.rotation.permitted_actions.includes('stage')) {
      elements.stagePanel.hidden = false;
      elements.newCredential.focus();
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

async function probeCredential(credentialId) {
  try {
    const result = await api(`/api/credentials/${encodeURIComponent(credentialId)}/probe`, {
      method: 'POST',
      body: {}
    });
    renderDiagnostics(result);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function submitStage(event) {
  event.preventDefault();
  const newValue = elements.newCredential.value;
  const confirmValue = elements.confirmCredential.value;
  elements.newCredential.value = '';
  elements.confirmCredential.value = '';
  try {
    uiState.rotation = await api(`/api/credentials/${encodeURIComponent(uiState.rotation.credential_id)}/stage`, {
      method: 'POST',
      body: {
        rotation_id: uiState.rotation.rotation_id,
        new_credential: newValue,
        confirm_credential: confirmValue
      }
    });
    elements.stagePanel.hidden = true;
    showToast('Credential staged successfully. Value cannot be displayed again.');
    renderRotation();
    await loadCredentials();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function runRotationAction(action) {
  const endpoint = action.replaceAll('_', '-');
  const body = action === 'disable_old' ? { approval_id: uiState.rotation.approval_id } : {};
  try {
    const result = await api(`/api/rotations/${encodeURIComponent(uiState.rotation.rotation_id)}/${endpoint}`, {
      method: 'POST',
      body
    });
    if (result.rotation) {
      uiState.rotation = result.rotation;
      renderDiagnostics(result.diagnostics);
    } else {
      uiState.rotation = result;
    }
    renderRotation();
    await loadCredentials();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderRotation() {
  const rotation = uiState.rotation;
  if (!rotation) {
    elements.rotationPanel.hidden = true;
    return;
  }
  elements.rotationPanel.hidden = false;
  elements.rotationHeading.textContent = `${uiState.credential?.display_name || rotation.credential_id} rotation`;
  elements.rotationState.textContent = labelStatus(rotation.state);
  elements.rotationState.classList.toggle('failed', rotation.state.includes('failed'));
  elements.rotationMessage.textContent = rotation.state === 'awaiting_human_approval'
    ? 'Verification passed. Explicit Human approval is required before old-disable.'
    : `Current state: ${labelStatus(rotation.state)}`;

  const labels = {
    distribute: 'distribute',
    verify: 'verify',
    approve: 'Human approval',
    disable_old: 'disable old',
    regression_check: 'regression check',
    rollback: 'rollback'
  };
  const buttons = rotation.permitted_actions
    .filter((action) => action !== 'stage')
    .map((action) => makeButton(labels[action], action === 'rollback' ? 'secondary' : '', () => runRotationAction(action)));
  elements.rotationActions.replaceChildren(...buttons);

  const events = rotation.audit.map((event) => {
    const item = document.createElement('li');
    item.textContent = `${event.timestamp} · ${event.event} · ${event.result} · ${event.safe_code}`;
    return item;
  });
  elements.auditList.replaceChildren(...events);
}

function renderDiagnostics(result) {
  if (!result) return;
  elements.diagnosticPanel.hidden = false;
  const entries = [
    ['Configured', result.configured ? 'true' : 'false'],
    ['Connectivity', labelStatus(result.connectivity)],
    ['Elapsed', `${result.elapsed_ms} ms`]
  ].map(([label, value]) => {
    const box = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    box.append(term, description);
    return box;
  });
  elements.diagnosticSummary.replaceChildren(...entries);
  const consumers = result.consumers.map((consumer) => {
    const item = document.createElement('li');
    item.textContent = `${consumer.id}: ${consumer.status}`;
    return item;
  });
  elements.consumerDiagnostics.replaceChildren(...consumers);
}

elements.refreshButton.addEventListener('click', loadCredentials);
elements.changeButton.addEventListener('click', () => beginRotation(uiState.credential.credential_id));
elements.rotationButton.addEventListener('click', () => beginRotation(uiState.credential.credential_id));
elements.probeButton.addEventListener('click', () => probeCredential(uiState.credential.credential_id));
elements.stageForm.addEventListener('submit', submitStage);
elements.cancelStageButton.addEventListener('click', () => {
  elements.newCredential.value = '';
  elements.confirmCredential.value = '';
  elements.stagePanel.hidden = true;
});

loadCredentials();
