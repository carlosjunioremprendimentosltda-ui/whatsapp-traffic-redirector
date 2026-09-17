document.addEventListener('DOMContentLoaded', () => {
  // Estado local
  let currentLinks = [];
  let currentSettings = {};
  let qrCodeInstance = null;

  // Elementos do DOM
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('pageTitle');
  const pageSubtitle = document.getElementById('pageSubtitle');

  // Modais
  const linkModal = document.getElementById('linkModal');
  const qrModal = document.getElementById('qrModal');
  const authModal = document.getElementById('authModal');
  const authForm = document.getElementById('authForm');
  const authPinInput = document.getElementById('authPinInput');
  const linkForm = document.getElementById('linkForm');
  const modalLinkTitle = document.getElementById('modalLinkTitle');
  const closeLinkModalBtn = document.getElementById('closeLinkModalBtn');
  const cancelLinkModalBtn = document.getElementById('cancelLinkModalBtn');
  const closeQrModalBtn = document.getElementById('closeQrModalBtn');

  // Gerenciamento de Autenticação / Token
  let adminToken = localStorage.getItem('adminToken') || '';

  async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (adminToken) {
      options.headers['x-admin-token'] = adminToken;
    }
    const res = await fetch(url, options);
    if (res.status === 401) {
      if (authModal) authModal.style.display = 'flex';
    }
    return res;
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = (authPinInput?.value || '').trim();
      if (!pin) return;
      try {
        const res = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.success && data.token) {
          adminToken = data.token;
          localStorage.setItem('adminToken', adminToken);
          authModal.style.display = 'none';
          if (authPinInput) authPinInput.value = '';
          showToast('Autenticado com sucesso!', 'success');
          loadAllData();
          loadLeads();
        } else {
          showToast(data.message || 'PIN incorreto.', 'error');
        }
      } catch (err) {
        showToast('Erro ao autenticar.', 'error');
      }
    });
  }

  // Inputs do Modal Link
  const linkIdInput = document.getElementById('linkIdInput');
  const linkNameInput = document.getElementById('linkNameInput');
  const linkUrlInput = document.getElementById('linkUrlInput');
  const linkPhoneInput = document.getElementById('linkPhoneInput');
  const linkMessageInput = document.getElementById('linkMessageInput');
  const linkLimitInput = document.getElementById('linkLimitInput');
  const linkWeightInput = document.getElementById('linkWeightInput');
  const linkActiveInput = document.getElementById('linkActiveInput');
  const groupDirectUrl = document.getElementById('groupDirectUrl');
  const groupPhoneGenerator = document.getElementById('groupPhoneGenerator');
  const linkTypeRadios = document.querySelectorAll('input[name="linkInputType"]');

  // Alternar entre Link Direto e Gerador por Telefone no Modal
  linkTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'url') {
        groupDirectUrl.style.display = 'block';
        groupPhoneGenerator.style.display = 'none';
        linkUrlInput.setAttribute('required', 'true');
        linkPhoneInput.removeAttribute('required');
      } else {
        groupDirectUrl.style.display = 'none';
        groupPhoneGenerator.style.display = 'block';
        linkUrlInput.removeAttribute('required');
        linkPhoneInput.setAttribute('required', 'true');
      }
    });
  });

  // Inputs de Configurações
  const settingsDelayRange = document.getElementById('settingsDelayRange');
  const delayDisplay = document.getElementById('delayDisplay');
  const settingsTitleInput = document.getElementById('settingsTitleInput');
  const settingsSubtitleInput = document.getElementById('settingsSubtitleInput');
  const settingsButtonTextInput = document.getElementById('settingsButtonTextInput');
  const metaPixelInput = document.getElementById('metaPixelInput');
  const googleAnalyticsInput = document.getElementById('googleAnalyticsInput');
  const customScriptsInput = document.getElementById('customScriptsInput');
  const adminPinInput = document.getElementById('adminPinInput');
  const requireAuthToggle = document.getElementById('requireAuthToggle');
  const fallbackUrlInput = document.getElementById('fallbackUrlInput');

  // Botões principais
  const openAddLinkModalBtn = document.getElementById('openAddLinkModalBtn');
  const refreshStatsBtn = document.getElementById('refreshStatsBtn');
  const copyPublicLinkBtn = document.getElementById('copyPublicLinkBtn');
  const saveStrategyBtn = document.getElementById('saveStrategyBtn');
  const saveAllSettingsBtn = document.getElementById('saveAllSettingsBtn');
  const resetStatsBtn = document.getElementById('resetStatsBtn');
  const importBackupBtn = document.getElementById('importBackupBtn');
  const importFileInput = document.getElementById('importFileInput');

  // 1. Navegação de Abas
  const tabInfo = {
    dashboard: { title: 'Visão Geral do Tráfego', subtitle: 'Acompanhe a distribuição e o desempenho dos seus atendentes' },
    links: { title: 'Gerenciar Links de WhatsApp', subtitle: 'Ative ou desative atendentes para direcionar o tráfego instantaneamente' },
    strategy: { title: 'Estratégia de Distribuição', subtitle: 'Configure como os leads são distribuídos entre seus números' },
    analytics: { title: 'Origens UTM & Histórico', subtitle: 'Acompanhe o desempenho de suas campanhas de tráfego pago' },
    leads: { title: 'Leads & Webhook Kommo CRM', subtitle: 'Atribuição exata de mensagens de WhatsApp com caracteres invisíveis' },
    settings: { title: 'Configurações & Pixels', subtitle: 'Personalize a tela de espera e instale códigos de rastreamento' }
  };

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = item.getAttribute('data-tab');

      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(t => t.classList.remove('active'));

      item.classList.add('active');
      const activeSection = document.getElementById(`tab-${targetTab}`);
      if (activeSection) activeSection.classList.add('active');

      if (tabInfo[targetTab]) {
        pageTitle.textContent = tabInfo[targetTab].title;
        pageSubtitle.textContent = tabInfo[targetTab].subtitle;
      }
    });
  });

  // 2. Formatação de Telefone
  function formatPhone(phone) {
    if (!phone) return '-';
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 11) {
      return `(${clean.slice(0,2)}) ${clean.slice(2,7)}-${clean.slice(7)}`;
    }
    if (clean.length === 13 && clean.startsWith('55')) {
      return `+55 (${clean.slice(2,4)}) ${clean.slice(4,9)}-${clean.slice(9)}`;
    }
    return phone;
  }

  // 3. Carregar Dados Iniciais
  async function loadAllData() {
    try {
      await Promise.all([loadStats(), loadSettings()]);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
      showToast('Erro ao carregar informações do servidor.', 'error');
    }
  }

  // Carregar Estatísticas e Links
  async function loadStats() {
    const res = await apiFetch('/api/admin/stats');
    const data = await res.json();

    if (!data.success) return;

    currentLinks = data.links || [];

    // Atualizar Cards da Visão Geral
    document.getElementById('statTotalClicks').textContent = data.totalRedirects.toLocaleString('pt-BR');
    document.getElementById('statTodayClicks').textContent = data.todayRedirects.toLocaleString('pt-BR');
    document.getElementById('statActiveLinks').textContent = `${data.activeLinks} Ativos`;
    document.getElementById('statInactiveCount').textContent = `${data.inactiveLinks} desativados`;

    // Principal Origem UTM
    const sources = Object.entries(data.utmSources || {});
    if (sources.length > 0) {
      sources.sort((a, b) => b[1] - a[1]);
      document.getElementById('statTopSource').textContent = sources[0][0];
      const campaigns = Object.entries(data.utmCampaigns || {});
      if (campaigns.length > 0) {
        campaigns.sort((a, b) => b[1] - a[1]);
        document.getElementById('statTopCampaign').textContent = `Campanha: ${campaigns[0][0]} (${campaigns[0][1]} cliques)`;
      } else {
        document.getElementById('statTopCampaign').textContent = `${sources[0][1]} cliques`;
      }
    } else {
      document.getElementById('statTopSource').textContent = 'Direto';
      document.getElementById('statTopCampaign').textContent = 'Nenhum clique registrado';
    }

    // Renderizar Distribuição de Tráfego
    renderTrafficDistribution(currentLinks, data.totalRedirects);

    // Renderizar Tabela de Links
    renderLinksTable(currentLinks);

    // Renderizar Listas de UTM
    renderUtmLists(data.utmSources, data.utmCampaigns);

    // Renderizar Tabela de Logs
    renderLogsTable(data.recentLogs || []);
  }

  // Carregar Configurações
  async function loadSettings() {
    const res = await apiFetch('/api/admin/settings');
    const data = await res.json();

    if (!data.success) return;
    currentSettings = data.settings || {};

    // Preencher formulários
    settingsTitleInput.value = currentSettings.title || 'Por favor, aguarde alguns segundos.';
    settingsSubtitleInput.value = currentSettings.subtitle || 'Estamos direcionando você para o WhatsApp.';
    settingsButtonTextInput.value = currentSettings.buttonText || 'Clique aqui se não for redirecionado';
    
    const delay = currentSettings.redirectDelay || 2000;
    settingsDelayRange.value = delay;
    delayDisplay.textContent = (delay / 1000).toFixed(1) + ' segundos';

    metaPixelInput.value = currentSettings.metaPixelId || '';
    googleAnalyticsInput.value = currentSettings.googleAnalyticsId || '';
    customScriptsInput.value = currentSettings.customHeadScripts || '';
    adminPinInput.value = currentSettings.adminPin || 'admin123';
    requireAuthToggle.checked = Boolean(currentSettings.requireAuth);
    fallbackUrlInput.value = currentSettings.fallbackUrl || '';

    // Estratégia de Rotação
    const stratRadios = document.querySelectorAll('input[name="rotationStrategy"]');
    stratRadios.forEach(r => {
      r.checked = (r.value === (currentSettings.rotationStrategy || 'round-robin'));
    });
  }

  // 4. Renderizar Barras de Distribuição
  function renderTrafficDistribution(links, totalRedirects) {
    const container = document.getElementById('trafficDistributionList');
    if (!links || links.length === 0) {
      container.innerHTML = '<p class="text-muted">Nenhum atendente/link cadastrado.</p>';
      return;
    }

    let html = '';
    links.forEach(link => {
      const clicks = link.totalClicks || 0;
      const percentage = totalRedirects > 0 ? Math.round((clicks / totalRedirects) * 100) : 0;
      const statusBadge = link.active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-gray">Desativado</span>';
      const labelDesc = link.phone ? formatPhone(link.phone) : (link.url ? link.url.slice(0, 30) + '...' : '');

      html += `
        <div class="dist-item">
          <div class="dist-header">
            <div>
              <strong>${escapeHtml(link.name)}</strong> 
              ${labelDesc ? `<span class="text-muted">(${escapeHtml(labelDesc)})</span>` : ''}
              ${statusBadge}
            </div>
            <div>
              <span>${clicks.toLocaleString('pt-BR')} cliques</span>
              <strong class="ml-2">(${percentage}%)</strong>
            </div>
          </div>
          <div class="dist-bar-wrapper">
            <div class="dist-bar-fill" style="width: ${percentage}%;"></div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  // 5. Renderizar Tabela de Links com Botão Liga/Desliga
  function renderLinksTable(links) {
    const tbody = document.getElementById('linksTableBody');
    if (!links || links.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhum link ou WhatsApp cadastrado. Clique em "+ Adicionar Novo WhatsApp" acima.</td></tr>';
      return;
    }

    let html = '';
    links.forEach(link => {
      const formattedPhone = formatPhone(link.phone);
      const limitText = link.dailyLimit > 0 ? `${link.dailyLimit} / dia` : '<span class="text-muted">Ilimitado</span>';
      
      // Renderizar o destino
      let destinationHtml = '';
      if (link.url && (link.url.startsWith('http://') || link.url.startsWith('https://'))) {
        destinationHtml = `
          <div>
            <a href="${escapeHtml(link.url)}" target="_blank" class="table-link-preview" title="${escapeHtml(link.url)}">
              🔗 ${escapeHtml(link.url)}
            </a>
            ${link.phone ? `<small class="text-muted font-mono">${escapeHtml(formattedPhone)}</small>` : ''}
          </div>
        `;
      } else if (link.phone) {
        destinationHtml = `<code>📱 ${escapeHtml(formattedPhone)}</code>`;
      } else {
        destinationHtml = `<span class="text-muted">-</span>`;
      }

      html += `
        <tr data-id="${link.id}">
          <td>
            <label class="toggle-switch">
              <input type="checkbox" class="toggle-link-status" data-id="${link.id}" ${link.active ? 'checked' : ''}>
              <span class="toggle-slider-round"></span>
            </label>
          </td>
          <td>
            <strong>${escapeHtml(link.name)}</strong>
            ${link.weight && link.weight > 1 ? `<span class="badge badge-gray" title="Peso de Distribuição">Peso ${link.weight}</span>` : ''}
          </td>
          <td>${destinationHtml}</td>
          <td>
            <strong>${(link.todayClicks || 0).toLocaleString('pt-BR')} hoje</strong> 
            <span class="text-muted">/ ${(link.totalClicks || 0).toLocaleString('pt-BR')} total</span>
          </td>
          <td>${limitText}</td>
          <td>
            <div class="flex-actions" style="display: flex; gap: 6px;">
              <button class="btn btn-sm btn-outline btn-test-link" data-url="${escapeHtml(link.url)}" title="Testar Destino">⚡ Testar</button>
              <button class="btn btn-sm btn-outline btn-qr-link" data-id="${link.id}" data-phone="${escapeHtml(link.name)}" data-url="${escapeHtml(link.url)}" title="Ver QR Code">📱 QR</button>
              <button class="btn btn-sm btn-secondary btn-edit-link" data-id="${link.id}" title="Editar">✏️</button>
              <button class="btn btn-sm btn-danger btn-delete-link" data-id="${link.id}" title="Excluir">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    // Vincular eventos da tabela
    attachTableEvents();
  }

  // Eventos nos botões da tabela
  function attachTableEvents() {
    // 1. Toggle Ativar / Desativar
    document.querySelectorAll('.toggle-link-status').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const linkId = e.target.getAttribute('data-id');
        try {
          const res = await apiFetch(`/api/admin/links/${linkId}/toggle`, { method: 'PATCH' });
          const data = await res.json();
          if (data.success) {
            showToast(data.message, 'success');
            loadStats();
          } else {
            showToast('Erro ao alternar status do link.', 'error');
            e.target.checked = !e.target.checked;
          }
        } catch (err) {
          console.error(err);
          showToast('Erro de conexão ao alternar status.', 'error');
          e.target.checked = !e.target.checked;
        }
      });
    });

    // 2. Testar Link
    document.querySelectorAll('.btn-test-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        if (url) window.open(url, '_blank');
      });
    });

    // 3. QR Code
    document.querySelectorAll('.btn-qr-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        const phone = btn.getAttribute('data-phone');
        showQrCode(url, phone);
      });
    });

    // 4. Editar Link
    document.querySelectorAll('.btn-edit-link').forEach(btn => {
      btn.addEventListener('click', () => {
        const linkId = btn.getAttribute('data-id');
        const link = currentLinks.find(l => l.id === linkId);
        if (link) openEditLinkModal(link);
      });
    });

    // 5. Excluir Link
    document.querySelectorAll('.btn-delete-link').forEach(btn => {
      btn.addEventListener('click', async () => {
        const linkId = btn.getAttribute('data-id');
        const link = currentLinks.find(l => l.id === linkId);
        if (confirm(`Tem certeza que deseja excluir "${link ? link.name : ''}"?`)) {
          try {
            const res = await apiFetch(`/api/admin/links/${linkId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              showToast(data.message, 'success');
              loadStats();
            }
          } catch (err) {
            console.error(err);
            showToast('Erro ao excluir link.', 'error');
          }
        }
      });
    });
  }

  // 6. QR Code Modal
  function showQrCode(url, phone) {
    const qrContainer = document.getElementById('qrcodeContainer');
    qrContainer.innerHTML = '';
    document.getElementById('qrModalPhone').textContent = phone || '';
    document.getElementById('qrTestLink').href = url;

    qrCodeInstance = new QRCode(qrContainer, {
      text: url,
      width: 180,
      height: 180,
      colorDark: '#005c4b',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    qrModal.style.display = 'flex';
  }

  closeQrModalBtn.addEventListener('click', () => {
    qrModal.style.display = 'none';
  });

  // 7. Modal de Adicionar / Editar Link
  openAddLinkModalBtn.addEventListener('click', () => {
    modalLinkTitle.textContent = 'Adicionar Novo Destino / Link';
    linkIdInput.value = '';
    linkNameInput.value = '';
    linkUrlInput.value = '';
    linkPhoneInput.value = '';
    linkMessageInput.value = '';
    linkLimitInput.value = 0;
    linkWeightInput.value = 1;
    linkActiveInput.checked = true;

    // Selecionar Link Direto por padrão
    const radioUrl = document.querySelector('input[name="linkInputType"][value="url"]');
    if (radioUrl) radioUrl.checked = true;
    groupDirectUrl.style.display = 'block';
    groupPhoneGenerator.style.display = 'none';
    linkUrlInput.setAttribute('required', 'true');
    linkPhoneInput.removeAttribute('required');

    linkModal.style.display = 'flex';
    linkNameInput.focus();
  });

  function openEditLinkModal(link) {
    modalLinkTitle.textContent = 'Editar Destino / Link';
    linkIdInput.value = link.id;
    linkNameInput.value = link.name;
    linkLimitInput.value = link.dailyLimit || 0;
    linkWeightInput.value = link.weight || 1;
    linkActiveInput.checked = Boolean(link.active);

    const isDirectUrl = link.url && (link.url.startsWith('http://') || link.url.startsWith('https://')) && !link.phone;

    if (isDirectUrl) {
      const radioUrl = document.querySelector('input[name="linkInputType"][value="url"]');
      if (radioUrl) radioUrl.checked = true;
      groupDirectUrl.style.display = 'block';
      groupPhoneGenerator.style.display = 'none';
      linkUrlInput.value = link.url || '';
      linkUrlInput.setAttribute('required', 'true');
      linkPhoneInput.removeAttribute('required');
    } else {
      const radioPhone = document.querySelector('input[name="linkInputType"][value="phone"]');
      if (radioPhone) radioPhone.checked = true;
      groupDirectUrl.style.display = 'none';
      groupPhoneGenerator.style.display = 'block';
      linkUrlInput.value = link.url || '';
      linkPhoneInput.value = link.phone || '';
      linkMessageInput.value = link.message || '';
      linkUrlInput.removeAttribute('required');
      linkPhoneInput.setAttribute('required', 'true');
    }

    linkModal.style.display = 'flex';
  }

  closeLinkModalBtn.addEventListener('click', () => { linkModal.style.display = 'none'; });
  cancelLinkModalBtn.addEventListener('click', () => { linkModal.style.display = 'none'; });

  // Salvar Link (POST / PUT)
  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const linkId = linkIdInput.value;
    const selectedType = document.querySelector('input[name="linkInputType"]:checked').value;

    const payload = {
      name: linkNameInput.value.trim(),
      dailyLimit: Number(linkLimitInput.value) || 0,
      weight: Number(linkWeightInput.value) || 1,
      active: linkActiveInput.checked
    };

    if (selectedType === 'url') {
      payload.url = linkUrlInput.value.trim();
      if (!payload.url) {
        showToast('Por favor, informe a URL ou Link de destino.', 'error');
        return;
      }
    } else {
      payload.phone = linkPhoneInput.value.trim();
      payload.message = linkMessageInput.value.trim();
      if (!payload.phone) {
        showToast('Por favor, informe o número de WhatsApp.', 'error');
        return;
      }
    }

    try {
      let res, data;
      if (linkId) {
        res = await apiFetch(`/api/admin/links/${linkId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await apiFetch('/api/admin/links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        linkModal.style.display = 'none';
        loadStats();
      } else {
        showToast(data.message || 'Erro ao salvar link.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Erro de conexão ao salvar link.', 'error');
    }
  });

  // 8. Renderizar Listas de UTM
  function renderUtmLists(sources = {}, campaigns = {}) {
    const srcContainer = document.getElementById('utmSourcesList');
    const cmpContainer = document.getElementById('utmCampaignsList');

    // Sources
    const srcEntries = Object.entries(sources);
    if (srcEntries.length === 0) {
      srcContainer.innerHTML = '<p class="text-muted">Nenhum parâmetro de origem registrado ainda.</p>';
    } else {
      srcEntries.sort((a, b) => b[1] - a[1]);
      srcContainer.innerHTML = srcEntries.map(([src, count]) => `
        <div class="utm-item">
          <span><strong>${escapeHtml(src)}</strong></span>
          <span class="badge badge-green">${count} cliques</span>
        </div>
      `).join('');
    }

    // Campaigns
    const cmpEntries = Object.entries(campaigns);
    if (cmpEntries.length === 0) {
      cmpContainer.innerHTML = '<p class="text-muted">Nenhuma campanha registrada ainda.</p>';
    } else {
      cmpEntries.sort((a, b) => b[1] - a[1]);
      cmpContainer.innerHTML = cmpEntries.map(([cmp, count]) => `
        <div class="utm-item">
          <span><strong>${escapeHtml(cmp)}</strong></span>
          <span class="badge badge-green">${count} cliques</span>
        </div>
      `).join('');
    }
  }

  // 9. Renderizar Histórico de Logs
  function renderLogsTable(logs) {
    const tbody = document.getElementById('logsTableBody');
    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum acesso registrado ainda.</td></tr>';
      return;
    }

    let html = '';
    logs.forEach(log => {
      const date = new Date(log.timestamp);
      const formattedDate = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR');
      const src = log.utms && log.utms.source ? escapeHtml(log.utms.source) : '<span class="text-muted">Direto</span>';
      const cmp = log.utms && log.utms.campaign ? escapeHtml(log.utms.campaign) : '<span class="text-muted">-</span>';

      html += `
        <tr>
          <td><small>${formattedDate}</small></td>
          <td><strong>${escapeHtml(log.linkName || 'Atendente')}</strong></td>
          <td>${src}</td>
          <td>${cmp}</td>
          <td><small class="text-muted">${escapeHtml(log.ip || '-')}</small></td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  // 10. Salvar Estratégia de Rotação
  saveStrategyBtn.addEventListener('click', async () => {
    const selectedStrat = document.querySelector('input[name="rotationStrategy"]:checked').value;
    const fallbackUrl = fallbackUrlInput.value.trim();

    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotationStrategy: selectedStrat, fallbackUrl })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Estratégia de rotação salva com sucesso!', 'success');
      }
    } catch (err) {
      showToast('Erro ao salvar estratégia.', 'error');
    }
  });

  // 11. Salvar Configurações Gerais & Pixels
  settingsDelayRange.addEventListener('input', (e) => {
    delayDisplay.textContent = (e.target.value / 1000).toFixed(1) + ' segundos';
  });

  saveAllSettingsBtn.addEventListener('click', async () => {
    const payload = {
      title: settingsTitleInput.value.trim(),
      subtitle: settingsSubtitleInput.value.trim(),
      buttonText: settingsButtonTextInput.value.trim(),
      redirectDelay: Number(settingsDelayRange.value) || 2000,
      metaPixelId: metaPixelInput.value.trim(),
      googleAnalyticsId: googleAnalyticsInput.value.trim(),
      customHeadScripts: customScriptsInput.value.trim(),
      adminPin: adminPinInput.value.trim(),
      requireAuth: requireAuthToggle.checked
    };

    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Todas as configurações e Pixels foram salvos!', 'success');
      }
    } catch (err) {
      showToast('Erro ao salvar configurações.', 'error');
    }
  });

  // 12. Zerar Métricas
  resetStatsBtn.addEventListener('click', async () => {
    if (confirm('Atenção: Isso irá zerar todos os contadores de cliques e logs de acessos. Deseja continuar?')) {
      try {
        const res = await apiFetch('/api/admin/reset-stats', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast(data.message, 'success');
          loadStats();
        }
      } catch (err) {
        showToast('Erro ao zerar métricas.', 'error');
      }
    }
  });

  // 13. Restaurar Backup
  importBackupBtn.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target.result);
        const res = await apiFetch('/api/admin/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json)
        });
        const data = await res.json();
        if (data.success) {
          showToast('Backup restaurado com sucesso!', 'success');
          loadAllData();
        }
      } catch (err) {
        showToast('Arquivo de backup inválido.', 'error');
      }
    };
    reader.readAsText(file);
  });

  // 14. Copiar Link de Tráfego Público
  copyPublicLinkBtn.addEventListener('click', () => {
    const publicUrl = window.location.origin + '/';
    navigator.clipboard.writeText(publicUrl).then(() => {
      showToast(`Link copiado: ${publicUrl}`, 'success');
    }).catch(() => {
      prompt('Copie seu link de tráfego:', publicUrl);
    });
  });

  // Atualizar Estatísticas Manualmente
  refreshStatsBtn.addEventListener('click', () => {
    loadStats();
    showToast('Métricas atualizadas!', 'success');
  });

  // 15. Helper Toast Notifications
  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '✅' : '❌';
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================
  // 16. Leads & Kommo CRM (Zero-Width Tracking)
  // ==========================================
  const kommoWebhookUrlInput = document.getElementById('kommoWebhookUrlInput');
  const copyWebhookUrlBtn = document.getElementById('copyWebhookUrlBtn');
  const simulateKommoWebhookBtn = document.getElementById('simulateKommoWebhookBtn');
  const refreshLeadsBtn = document.getElementById('refreshLeadsBtn');
  const leadsTableBody = document.getElementById('leadsTableBody');
  const totalLeadsCount = document.getElementById('totalLeadsCount');
  const totalSessionsCount = document.getElementById('totalSessionsCount');
  const conversionRateDisplay = document.getElementById('conversionRateDisplay');

  if (kommoWebhookUrlInput) {
    kommoWebhookUrlInput.value = `${window.location.origin}/api/webhook/kommo`;
  }

  if (copyWebhookUrlBtn) {
    copyWebhookUrlBtn.addEventListener('click', () => {
      const url = kommoWebhookUrlInput.value;
      navigator.clipboard.writeText(url).then(() => {
        showToast('URL do Webhook copiada com sucesso!', 'success');
      }).catch(() => {
        prompt('Copie a URL do Webhook:', url);
      });
    });
  }

  if (simulateKommoWebhookBtn) {
    simulateKommoWebhookBtn.addEventListener('click', async () => {
      simulateKommoWebhookBtn.disabled = true;
      simulateKommoWebhookBtn.textContent = '⏳ Simulando...';
      try {
        const res = await apiFetch('/api/admin/leads/test-simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: '5511999998888',
            message: 'Olá! Vim pelo anúncio e gostaria de saber o valor.'
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Webhook simulado com sucesso! Lead vinculado.', 'success');
          await loadLeads();
        } else {
          showToast(data.message || 'Erro ao simular webhook.', 'error');
        }
      } catch (err) {
        showToast('Erro de conexão ao simular webhook.', 'error');
      } finally {
        simulateKommoWebhookBtn.disabled = false;
        simulateKommoWebhookBtn.textContent = '🧪 Simular Webhook de Teste';
      }
    });
  }

  if (refreshLeadsBtn) {
    refreshLeadsBtn.addEventListener('click', () => {
      loadLeads();
      showToast('Lista de leads atualizada!', 'success');
    });
  }

  async function loadLeads() {
    if (!leadsTableBody) return;
    try {
      const [leadsRes, statsRes] = await Promise.all([
        apiFetch('/api/admin/leads'),
        apiFetch('/api/admin/stats')
      ]);
      const leadsData = await leadsRes.json();
      const statsData = await statsRes.json();

      const leads = leadsData.leads || [];
      const totalClicks = statsData.totalRedirects || 0;
      const totalLeads = leads.length;

      if (totalLeadsCount) totalLeadsCount.textContent = totalLeads.toLocaleString('pt-BR');
      if (totalSessionsCount) totalSessionsCount.textContent = (statsData.totalSessions || 0).toLocaleString('pt-BR');

      if (conversionRateDisplay) {
        const rate = totalClicks > 0 ? ((totalLeads / totalClicks) * 100).toFixed(1) : '0.0';
        conversionRateDisplay.textContent = `${rate}%`;
      }

      if (!leads.length) {
        leadsTableBody.innerHTML = `
          <tr>
            <td colspan="8" class="text-center py-4 text-muted">
              Nenhum lead confirmado ainda.<br>
              <small>Assim que o visitante enviar a mensagem no WhatsApp, o webhook do Kommo registrará o lead aqui automaticamente.</small>
            </td>
          </tr>
        `;
        return;
      }

      leadsTableBody.innerHTML = leads.map(l => {
        const dateStr = l.leadTime ? new Date(l.leadTime).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
        const delayBadge = l.matchDelaySeconds !== null
          ? `<span class="badge" style="background: rgba(37, 211, 102, 0.15); color: #25d366;">⏱️ ${l.matchDelaySeconds}s</span>`
          : `<span class="text-muted">-</span>`;
        const phoneFormatted = formatPhone(l.phone);
        const deviceText = l.device?.isIOS ? '📱 iOS' : l.device?.isAndroid ? '🤖 Android' : '💻 Desktop';

        return `
          <tr>
            <td class="font-mono" style="font-size: 0.85rem;">${dateStr}</td>
            <td>
              <strong>${escapeHtml(l.name || 'Lead WhatsApp')}</strong><br>
              <a href="https://wa.me/${encodeURIComponent((l.phone || '').replace(/\\D/g, ''))}" target="_blank" class="table-link font-mono">
                📱 ${phoneFormatted}
              </a>
            </td>
            <td>
              <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8;">${escapeHtml(l.utms?.source || 'Direto')}</span>
              ${l.utms?.medium ? `<br><small class="text-muted">${escapeHtml(l.utms.medium)}</small>` : ''}
            </td>
            <td>
              <span title="${escapeHtml(l.utms?.campaign || '-')}">${escapeHtml(l.utms?.campaign || '-')}</span>
              ${l.utms?.content ? `<br><small class="text-muted">${escapeHtml(l.utms.content)}</small>` : ''}
            </td>
            <td>
              <small class="font-mono">${escapeHtml(l.ip || '-')}</small><br>
              <small class="text-muted">${deviceText}</small>
            </td>
            <td>${delayBadge}</td>
            <td><code class="font-mono" style="font-size: 0.78rem;" title="${escapeHtml(l.eventId)}">${escapeHtml(l.eventId)}</code></td>
            <td>
              <button class="btn btn-icon text-danger delete-lead-btn" data-id="${l.id}" title="Excluir Lead" style="cursor: pointer; background: transparent; border: none;">
                🗑️
              </button>
            </td>
          </tr>
        `;
      }).join('');

      document.querySelectorAll('.delete-lead-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const leadId = e.currentTarget.getAttribute('data-id');
          if (!confirm('Deseja realmente excluir este lead?')) return;
          try {
            const res = await apiFetch(`/api/admin/leads/${leadId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
              showToast('Lead removido!', 'success');
              loadLeads();
            }
          } catch (_) {
            showToast('Erro ao remover lead.', 'error');
          }
        });
      });

    } catch (err) {
      console.error('Erro ao carregar leads:', err);
    }
  }

  // Carrega leads e logs quando a aba for clicada
  document.querySelector('[data-tab="leads"]')?.addEventListener('click', () => {
    loadLeads();
    loadWebhookLogs();
  });

  const webhookLogsTableBody  = document.getElementById('webhookLogsTableBody');
  const refreshWebhookLogsBtn = document.getElementById('refreshWebhookLogsBtn');
  const clearWebhookLogsBtn   = document.getElementById('clearWebhookLogsBtn');

  if (refreshWebhookLogsBtn) {
    refreshWebhookLogsBtn.addEventListener('click', () => {
      loadWebhookLogs();
      showToast('Logs de webhooks atualizados!', 'success');
    });
  }

  if (clearWebhookLogsBtn) {
    clearWebhookLogsBtn.addEventListener('click', async () => {
      if (!confirm('Deseja realmente limpar todos os logs de webhooks?')) return;
      try {
        const res = await apiFetch('/api/admin/webhook-logs', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          showToast('Logs limpos com sucesso.', 'success');
          loadWebhookLogs();
        }
      } catch (_) {
        showToast('Erro ao limpar logs.', 'error');
      }
    });
  }

  async function loadWebhookLogs() {
    if (!webhookLogsTableBody) return;
    try {
      const res = await apiFetch('/api/admin/webhook-logs');
      const data = await res.json();
      if (!data.success) return;

      const logs = data.logs || [];
      if (!logs.length) {
        webhookLogsTableBody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-4 text-muted">
              Nenhum disparo de webhook registrado ainda.<br>
              <small>Assim que o Kommo fizer um POST na URL do webhook, a requisição aparecerá aqui imediatamente com o diagnóstico.</small>
            </td>
          </tr>
        `;
        return;
      }

      webhookLogsTableBody.innerHTML = logs.map(l => {
        const dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '-';
        const matchBadge = l.matched
          ? `<span class="badge" style="background: rgba(37, 211, 102, 0.15); color: #25d366; font-weight: 600;">✅ Vínculo Confirmado (Código Encontrado)</span>`
          : `<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #eab308; font-weight: 600;" title="${escapeHtml(l.statusText || '')}">⚠️ Texto Puro (Sem Código Invisível)</span>`;

        const campaignBadge = l.matched && l.campaign !== '-'
          ? `<strong style="color: #6366f1;">${escapeHtml(l.campaign)}</strong><br><small class="text-muted">${escapeHtml(l.source)}</small>`
          : `<span class="text-muted">-</span>`;

        return `
          <tr>
            <td class="font-mono" style="font-size: 0.82rem; white-space: nowrap;">${dateStr}</td>
            <td>
              <strong>${escapeHtml(l.sender || 'Desconhecido')}</strong>
              ${l.phone ? `<br><small class="font-mono text-muted">${escapeHtml(l.phone)}</small>` : ''}
            </td>
            <td style="max-width: 260px; word-break: break-word;">
              <code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-size: 0.85rem;">${escapeHtml(l.receivedText || '')}</code>
            </td>
            <td>
              ${matchBadge}<br>
              <small class="text-muted" style="font-size: 0.75rem;">${escapeHtml(l.statusText || '')}</small>
            </td>
            <td>${campaignBadge}</td>
            <td><small class="font-mono text-muted">${escapeHtml(l.ip || '-')}</small></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Erro ao carregar logs de webhook:', err);
    }
  }

  // Auto-refresh a cada 6 segundos se estiver na aba leads
  setInterval(() => {
    const leadsTab = document.getElementById('tab-leads');
    if (leadsTab && leadsTab.classList.contains('active')) {
      loadLeads();
      loadWebhookLogs();
    }
  }, 6000);

  // Inicializar
  async function init() {
    await loadAllData();
    await loadLeads();
    await loadWebhookLogs();
  }

  init();
});
