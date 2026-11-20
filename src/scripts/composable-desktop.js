/* ── Genesys Composable Desktop integration ─────────────────────────
   Append as its own <script> (after services.js) — do NOT merge into
   services.js, keep it a separate concern from the EF/softphone code.

   Wraps the Genesys.ComposableDesktop.* postMessage protocol:
     GET_STATUS → STATUS_UPDATE(handshake) → REGISTRATION_REQUEST →
     REGISTRATION_RESPONSE → STATUS_UPDATE(authenticated) → SET_INTERACTION

   Docs:  https://developer.genesys.cloud/devapps/composable-desktop/
   Examples: https://github.com/MyPureCloud/crm-composable-desktop-examples
   ------------------------------------------------------------------ */

window.ComposableDesktop = (function () {

  // ── CONFIGURATION — adjust for your org ──────────────────────────
  const ENVIRONMENT = 'mypurecloud.ie'; // must match the EF/softphone region in index.html
  const BROKER_URL   = `https://apps.${ENVIRONMENT}/crm-embeddable-desktop/index.html`;
  const COMPONENT_NAME = 'GENESYS_CLOUD_COMPOSABLE_DESKTOP';
  // This is the predefined, pre-whitelisted component name for the Composable
  // Desktop beta (per MyPureCloud/crm-composable-desktop-examples). Custom
  // component names still require whitelisting by the Composable Desktop team.

  // Gadgets to mount. 'default' scope = the primary/only gadget bound to
  // the agent's focused interaction; additional gadgets must use
  // 'embedded' scope with a unique scopeId — each needs its own
  // SET_INTERACTION call, so list every scope you use here.
  const GADGETS = [
    { key: 'copilot',   path: '/copilot',   scope: 'default',  scopeId: null,       size: 'fluid' },
    { key: 'scripts',   path: '/scripter',  scope: 'embedded', scopeId: 'scope-1',  size: 'fluid' },
    { key: 'acw',       path: '/acw',       scope: 'embedded', scopeId: 'scope-2',  size: 'fluid' },
    { key: 'email',     path: '/email',     scope: 'embedded', scopeId: 'scope-3',  size: 'fluid' },
    { key: 'messaging', path: '/messaging', scope: 'embedded', scopeId: 'scope-4',  size: 'fluid' },
  ];

  function componentUrl(gadget) {
    const scopeParam = gadget.scope === 'embedded'
      ? `scope=embedded&scopeId=${encodeURIComponent(gadget.scopeId)}`
      : `scope=default`;
    return `https://apps.${ENVIRONMENT}/crm-embeddable-desktop/component.html` +
           `#${gadget.path}?size=${gadget.size}&${scopeParam}`;
  }

  // ── STATE ─────────────────────────────────────────────────────────
  let componentId   = null;
  let broker         = null;
  let registered      = false;
  let authenticated   = false;
  let pendingInteractionId = null;

  function genId() {
    return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  }

  function getOrCreateComponentId() {
    const KEY = 'cd_component_id';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = genId();
      localStorage.setItem(KEY, id);
    }
    return id;
  }

  function post(type, data) {
    if (!broker) return;
    broker.postMessage({ type: `Genesys.ComposableDesktop.${type}`, data }, '*');
  }

  function getStatus() {
    post('GET_STATUS', { componentId, contextId: 'handshake' });
  }

  function register() {
    post('REGISTRATION_REQUEST', { componentId, name: COMPONENT_NAME });
  }

  // Sends SET_INTERACTION once per configured gadget scope.
  function pushInteraction(interactionId) {
    if (!authenticated) { pendingInteractionId = interactionId; return; }
    const sentScopes = new Set();
    GADGETS.forEach(g => {
      const key = g.scope + (g.scopeId || '');
      if (sentScopes.has(key)) return; // one SET_INTERACTION per distinct scope
      sentScopes.add(key);
      const data = { componentId, scope: g.scope, interactionId };
      if (g.scopeId) data.id = g.scopeId;
      post('SET_INTERACTION', data);
    });
    console.log('[ComposableDesktop] SET_INTERACTION →', interactionId);
  }

  function handleMessage(event) {
    let message;
    try {
      message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch (e) { return; }
    const { type, data } = message || {};
    if (!type || !type.startsWith('Genesys.ComposableDesktop')) return;

    switch (type) {
      case 'Genesys.ComposableDesktop.STATUS_UPDATE':
        if (data.contextId === 'handshake' || data.contextId === 'initial') {
          register();
        } else if (data.authenticated) {
          authenticated = true;
          if (pendingInteractionId) {
            const id = pendingInteractionId;
            pendingInteractionId = null;
            pushInteraction(id);
          }
        }
        break;
      case 'Genesys.ComposableDesktop.REGISTRATION_RESPONSE':
        registered = true;
        console.log('[ComposableDesktop] registered', componentId);
        break;
      case 'Genesys.ComposableDesktop.INTERACTION_UPDATE':
        console.log('[ComposableDesktop] interaction update', data);
        break;
      default:
        break;
    }
  }

  // ── LIFECYCLE ─────────────────────────────────────────────────────
  // init(): call ONCE on page load. Only sets up the hidden broker +
  // handshake — no gadget UI yet, since gadgets now live inside the
  // interaction drawer and are attached/detached as it opens/closes.
  function init() {
    componentId = getOrCreateComponentId();

    const brokerFrame = document.createElement('iframe');
    brokerFrame.id = 'composableDesktopBroker';
    brokerFrame.style.display = 'none';
    brokerFrame.src = BROKER_URL;
    document.body.appendChild(brokerFrame);

    window.addEventListener('message', handleMessage);

    brokerFrame.addEventListener('load', () => {
      broker = brokerFrame.contentWindow;
      getStatus();
    });
  }

  // attachGadgets(containerIdsByGadget, interactionId): call when the
  // interaction drawer opens. Creates one gadget iframe per configured
  // scope into the given container ids, then pushes interactionId into
  // them (queued until the broker handshake is authenticated, if not yet).
  function attachGadgets(containerIdsByGadget, interactionId) {
    detachGadgets(); // in case a previous drawer's gadgets are still mounted
    GADGETS.forEach(g => {
      const containerId = containerIdsByGadget[g.key];
      const container = containerId && document.getElementById(containerId);
      if (!container) return;
      const iframe = document.createElement('iframe');
      iframe.id = `cd-gadget-${g.key}`;
      iframe.src = componentUrl(g);
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      container.appendChild(iframe);
    });
    if (interactionId) pushInteraction(interactionId);
  }

  // detachGadgets(): call when the drawer closes, to free the iframes
  // rather than leaving 3 more Genesys sessions running in the background.
  function detachGadgets() {
    GADGETS.forEach(g => {
      const iframe = document.getElementById(`cd-gadget-${g.key}`);
      if (iframe) iframe.remove();
    });
  }

  return {
    init,
    attachGadgets,
    detachGadgets,
    setInteraction: pushInteraction,
  };
})();
