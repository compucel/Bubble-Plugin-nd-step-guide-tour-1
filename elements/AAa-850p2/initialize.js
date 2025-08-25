function(instance, context) {
  // ========= Carrega Intro =========
  const loadIntro = () => new Promise((resolve, reject) => {
    if (window.introJs) return resolve();
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/intro.js/minified/introjs.min.css';
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/intro.js/minified/intro.min.js';
    js.onload = () => resolve();
    js.onerror = reject;
    document.head.appendChild(css);
    document.head.appendChild(js);
  });

  // ========= Utils =========
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  const waitForElement = (selector, timeout, checkInterval, abortSignal) => {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (abortSignal?.aborted) return reject(new Error('Tour cancelado'));
        const el = document.querySelector(selector);
        if (el && isVisible(el)) return resolve(el);
        if (Date.now() - start > timeout) return reject(new Error(`Timeout aguardando "${selector}"`));
        setTimeout(tick, checkInterval);
      };
      tick();
    });
  };

  const classesToSelector = (classes = []) =>
    classes.length ? '.' + classes.filter(Boolean).join('.') : null;

  const queryByTextWithinClasses = (classes = [], text = '') => {
    if (!classes.length || !text) return null;
    const sel = classesToSelector(classes);
    if (!sel) return null;
    const nodes = document.querySelectorAll(sel);
    for (const n of nodes) {
      const t = (n.textContent || '').trim();
      if (t === text || t.includes(text)) return n;
    }
    return null;
  };

  // ========= Heurísticas Bubble (relaxa classes dinâmicas) =========
  const isDynBubbleClass = (c) =>
    /^a\d+x\d+$/i.test(c) || (/^[a-z]{5,7}$/i.test(c) && !['bubble','element','dropdown','chevron','clickable','center'].includes(c));

  const STABLE = new Set(['bubble-element','Input','MultiLineInput','Dropdown','Text','clickable-element','dropdown-chevron']);

  const relaxClassList = (arr=[]) => arr.filter(c => STABLE.has(c) || !isDynBubbleClass(c));

  const relaxSelector = (sel) => {
    try {
      if (!sel || sel[0] !== '.') return null;
      const parts = sel.split('.').filter(Boolean);
      const kept = relaxClassList(parts);
      return kept.length ? '.' + kept.join('.') : null;
    } catch { return null; }
  };

  const visibleNodes = (nodes) => {
    const out = [];
    for (const n of nodes) {
      if (!(n instanceof Element)) continue;
      if (isVisible(n)) out.push(n);
    }
    return out;
  };

  const pickByViewportProximity = (nodes) => {
    if (!nodes.length) return null;
    const cx = window.innerWidth/2, cy = window.innerHeight/2;
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      const nx = r.left + r.width/2, ny = r.top + r.height/2;
      const d = Math.hypot(nx-cx, ny-cy);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  };

  const getTopMostLayer = () => {
    let candidates = [];
    const tryAdd = (q) => { try { candidates = candidates.concat([...document.querySelectorAll(q)]); } catch {} };
    tryAdd('[role="dialog"]'); tryAdd('[aria-modal="true"]');
    tryAdd('.modal,.Modal,.popup,.Popup');
    tryAdd('.bubble-element');
    if (!candidates.length) return document;
    let best=null, bestZ=-1;
    for (const el of candidates) {
      const z = parseInt(getComputedStyle(el).zIndex || '0', 10);
      if (!Number.isNaN(z) && z > bestZ) { bestZ = z; best = el; }
    }
    return best || document;
  };

  const getContainerFor = (el) => {
    // sobe até um contêiner “lógico” (dialog/popup/bubble-element com z-index alto)
    let cur = el;
    let best = null, bestZ = -1;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      const z = parseInt(cs.zIndex || '0', 10);
      if (z > bestZ) { bestZ = z; best = cur; }
      if (cur.matches?.('[role="dialog"],[aria-modal="true"],.modal,.Modal,.popup,.Popup,.bubble-element')) {
        // continua subindo só pra ver se há zIndex maior; ao final pegamos o maior
      }
      cur = cur.parentElement;
    }
    return best || document;
  };

  // ========= Interação / edição =========
  const isEditableElement = (el) => {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const tp = (el.getAttribute('type') || 'text').toLowerCase();
      const editables = ['text','search','email','url','tel','number','password','date','datetime-local','time','month','week','color'];
      return editables.includes(tp);
    }
    const cls = el.classList;
    if (cls.contains('Input') || cls.contains('MultiLineInput') || cls.contains('Dropdown')) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['textbox','combobox','spinbutton'].includes(role)) return true;
    return false;
  };

  const findFocusableInside = (root) => {
    if (!root) return null;
    if (isEditableElement(root)) return root;
    return root.querySelector('input, textarea, select, [contenteditable="true"]');
  };

  const findFocusableNear = (root, maxDistance = 500) => {
    if (!root) return null;
    const base = root.getBoundingClientRect();
    const cx = base.left + base.width/2;
    const cy = base.top + base.height/2;
    const cands = visibleNodes(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'));
    let best=null, bestD=Infinity;
    for (const el of cands) {
      const r = el.getBoundingClientRect();
      const nx = r.left + r.width/2;
      const ny = r.top + r.height/2;
      const d = Math.hypot(nx-cx, ny-cy);
      if (d < bestD) { bestD = d; best = el; }
    }
    return (best && bestD <= maxDistance) ? best : null;
  };

  // ========= Resolver elemento com escopo =========
  const selectAllInScope = (scope, selector) => {
    try { return scope.querySelectorAll(selector); } catch { return []; }
  };

  const resolveElementWithFallback = (step, scope) => {
    const root = scope || document;

    // 1) seletor direto
    if (step.selector) {
      let el = root.querySelector(step.selector);
      if (!el && root !== document) el = document.querySelector(step.selector);
      if (el && isVisible(el)) return el;
    }

    // 2) seletor relaxado
    if (step.selector && step.selector.startsWith('.')) {
      const relaxed = relaxSelector(step.selector);
      if (relaxed) {
        let nodes = visibleNodes(selectAllInScope(root, relaxed));
        if (!nodes.length && root !== document) {
          nodes = visibleNodes(document.querySelectorAll(relaxed));
        }
        if (nodes.length === 1) return nodes[0];
        if (nodes.length > 1) {
          const best = pickByViewportProximity(nodes);
          if (best) return best;
        }
      }
    }

    // 3) fallback.classes relaxado
    const fb = step.fallback || {};
    const fromClasses = (fb.classes || []).filter(Boolean);
    if (fromClasses.length) {
      const relaxedClasses = relaxClassList(fromClasses);
      if (relaxedClasses.length) {
        const sel = '.' + relaxedClasses.join('.');
        let nodes = visibleNodes(selectAllInScope(root, sel));
        if (!nodes.length && root !== document) {
          nodes = visibleNodes(document.querySelectorAll(sel));
        }
        if (nodes.length === 1) return nodes[0];
        if (nodes.length > 1) {
          const best = pickByViewportProximity(nodes);
          if (best) return best;
        }
      }
    }

    // 4) por texto
    if ((fb.classes || []).length && fb.text) {
      const rc = relaxClassList(fb.classes || []);
      if (rc.length) {
        const sel = '.' + rc.join('.');
        let nodes = selectAllInScope(root, sel);
        if (!nodes.length && root !== document) {
          nodes = document.querySelectorAll(sel);
        }
        for (const n of nodes) {
          const t = (n.textContent || '').trim();
          if ((t === fb.text || t.includes(fb.text)) && isVisible(n)) return n;
        }
      }
    }

    // 5) domPath
    if (fb.domPath) {
      let el = root.querySelector(fb.domPath);
      if (!el && root !== document) el = document.querySelector(fb.domPath);
      if (el && isVisible(el)) return el;
    }

    // 6) heurística final: editáveis do top-layer (dentro do scope)
    const top = scope || getTopMostLayer();
    const editables = visibleNodes(selectAllInScope(top, 'input, textarea, select, [contenteditable="true"]'));
    if (editables.length) {
      const best = pickByViewportProximity(editables);
      if (best) return best;
    }
    return null;
  };

  // ========= Ação do passo =========
  const executeAction = (step, el, engine) => {
    const act = step.action;
    if (!act || !el) return Promise.resolve();
    el.classList.add('ndtour-highlight');

    // Atualiza contexto após cliques (ex.: abre modal)
    const updateContextSoon = () => {
      setTimeout(() => {
        engine.contextScope = getContainerFor(el) || getTopMostLayer();
      }, 300);
    };

    return new Promise((res) => {
      switch (act) {
        case 'click':
          el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            el.click();
            updateContextSoon();
            res();
          }, 400);
          break;
        case 'focus':
          el.focus?.();
          updateContextSoon();
          res();
          break;
        case 'select':
          if (el.tagName === 'SELECT') {
            if (el.selectedIndex < 1 && el.options.length > 1) el.selectedIndex = 1;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          updateContextSoon();
          res();
          break;
        default:
          updateContextSoon();
          res();
      }
      setTimeout(() => el.classList.remove('ndtour-highlight'), 900);
    });
  };

  // ========= Intercepta "Próximo" =========
  const interceptNext = (introInstance, getCtx) => {
    setTimeout(() => {
      const next = document.querySelector('.introjs-nextbutton, .introjs-donebutton');
      if (!next) return;
      const cloned = next.cloneNode(true);
      next.parentNode.replaceChild(cloned, next);
      cloned.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const ctx = getCtx();
        if (ctx.currentStepConfig && ctx.currentElement) {
          await executeAction(ctx.currentStepConfig, ctx.currentElement, ctx);
        }
        introInstance.exit();
        setTimeout(() => {
          if (ctx.isRunning) ctx.executeStep(ctx.currentStepIndex + 1);
        }, 1200); // dá tempo de abrir popups
      });
    }, 50);
  };

  // ========= CSS do modo interativo =========
  const enableInteractiveCSS = () => {
    if (document.getElementById('ndtour-interactive-style')) return;
    const style = document.createElement('style');
    style.id = 'ndtour-interactive-style';
    style.textContent = `
      body.ndtour-interactive .introjs-overlay,
      body.ndtour-interactive .introjs-helperLayer,
      body.ndtour-interactive .introjs-tooltipReferenceLayer { pointer-events: none !important; }
      body.ndtour-interactive .introjs-tooltip,
      body.ndtour-interactive .introjs-skipbutton,
      body.ndtour-interactive .introjs-nextbutton,
      body.ndtour-interactive .introjs-prevbutton,
      body.ndtour-interactive .introjs-closebutton { pointer-events: auto !important; }
      body.ndtour-interactive .introjs-disableInteraction { pointer-events: none !important; background: transparent !important; opacity: 0 !important; }
      .ndtour-raise { position: relative !important; z-index: 2147483647 !important; }
      .ndtour-highlight{ outline:3px solid #f59e0b !important; transition:outline .2s ease; }
    `;
    document.head.appendChild(style);
  };

  const attachStyles = () => {
    if (!document.getElementById('ndtour-style')) {
      const style = document.createElement('style');
      style.id = 'ndtour-style';
      style.textContent = `.ndtour-highlight{outline:3px solid #f59e0b !important;transition:outline .2s ease;}`;
      document.head.appendChild(style);
    }
    enableInteractiveCSS();
  };

  const setInteractiveMode = (el, on) => {
    document.body.classList.toggle('ndtour-interactive', !!on);
    if (el) el.classList.toggle('ndtour-raise', !!on);
  };

  // ========= Helpers de options =========
  const parseSelectorList = (txt) => (txt ? String(txt).split(',').map(s=>s.trim()).filter(Boolean) : []);
  const matchesAnySelector = (el, selectors) => {
    if (!el || !selectors || !selectors.length) return false;
    try { return selectors.some(sel => { try { return el.matches(sel); } catch { return false; } }); }
    catch { return false; }
  };

  // ========= Cleanup global =========
  const cleanupIntroDom = () => {
    try {
      document.querySelectorAll('.introjs-overlay, .introjs-helperLayer, .introjs-tooltipReferenceLayer, .introjs-tooltip, .introjs-disableInteraction, .introjs-fixedTooltip')
        .forEach(n => n.remove());
    } catch(_) {}
    document.body.classList.remove('introjs-fixedTooltip', 'ndtour-interactive');
  };

  // ========= Engine =========
  const buildEngine = (instance) => {
    attachStyles();
    const engine = {
      isRunning: false,
      steps: [],
      currentStepIndex: 0,
      currentStepConfig: null,
      currentElement: null,
      contextScope: null,          // NOVO: escopo preferencial (modal/top-layer) entre passos
      abortController: null,
      intro: null,
      _disableObs: null,
      options: {
        defaultTimeout: 10000,
        checkInterval: 200,
        debug: false,
        autoScroll: true,
        interactiveDefault: false,
        interactiveSelectors: [
          '.bubble-element.Input',
          '.bubble-element.MultiLineInput',
          '.bubble-element.Dropdown',
          'input','textarea','select','[contenteditable="true"]'
        ]
      },
      debugLog(...a){ if (engine.options.debug) console.log('[Tour]', ...a); },
      setStates(){
        instance.publishState('is_running', engine.isRunning);
        instance.publishState('current_step', engine.currentStepIndex + 1);
      },
      resetFlags(){
        setInteractiveMode(engine.currentElement, false);
        try { engine._disableObs && engine._disableObs.disconnect(); } catch(_) {}
        engine._disableObs = null;
        engine.contextScope = null;
      },
      async start(steps, opts = {}){
        // RESTART seguro
        if (engine.isRunning) {
          engine.stop('Reinício solicitado');
          await new Promise(r => setTimeout(r, 50));
        }
        cleanupIntroDom();

        engine.options = { ...engine.options, ...opts };
        if (typeof engine.options.interactiveSelectors === 'string') {
          engine.options.interactiveSelectors = parseSelectorList(engine.options.interactiveSelectors);
        }

        engine.steps = steps || [];
        engine.currentStepIndex = 0;
        engine.currentStepConfig = null;
        engine.currentElement = null;
        engine.contextScope = null;

        engine.isRunning = true;
        engine.abortController = new AbortController();
        engine.setStates();
        engine.debugLog('Start', engine.steps.length, 'steps');

        try { await engine.executeStep(0); } catch (err) { engine.fail(err); }
      },
      stop(reason = 'Parado'){
        engine.debugLog('Stop:', reason);
        engine.resetFlags();

        engine.isRunning = false;
        engine.currentStepConfig = null;
        engine.currentElement = null;

        engine.abortController?.abort();
        engine.abortController = null;

        try { engine.intro && engine.intro.exit(); } catch(_) {}
        engine.intro = null;

        cleanupIntroDom();

        instance.publishState('last_error', reason || '');
        engine.setStates();
      },
      complete(){
        engine.debugLog('Completed');
        engine.resetFlags();

        engine.isRunning = false;
        engine.currentStepConfig = null;
        engine.currentElement = null;

        try { engine.intro && engine.intro.exit(); } catch(_) {}
        engine.intro = null;

        cleanupIntroDom();

        engine.setStates();
        try { instance.triggerEvent && instance.triggerEvent('completed'); } catch(_){}
      },
      async executeStep(i){
        if (!engine.isRunning) return;
        if (i >= engine.steps.length) return engine.complete();

        // limpa marcas do passo anterior
        setInteractiveMode(engine.currentElement, false);

        engine.currentStepIndex = i;
        engine.currentStepConfig = engine.steps[i];
        engine.currentElement = null;
        engine.setStates();

        const step = engine.currentStepConfig;
        engine.debugLog(`Preparing step ${i+1}:`, step.title || step.selector);

        // 1) Resolver alvo (prioriza escopo de contexto)
        let el = resolveElementWithFallback(step, engine.contextScope || undefined);
        if (!el && step.selector) {
          try {
            el = await waitForElement(step.selector, engine.options.defaultTimeout, engine.options.checkInterval, engine.abortController?.signal);
          } catch (_) {
            el = resolveElementWithFallback(step, engine.contextScope || undefined);
          }
        }
        if (!el) throw new Error(`Elemento não encontrado na etapa ${i + 1}`);
        engine.currentElement = el;

        // 2) Auto-scroll
        if (engine.options.autoScroll) {
          try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_){}
          await new Promise(r => setTimeout(r, 200));
        }

        // 3) Intro
        if (!window.introJs) throw new Error('Intro.js não carregado');
        if (engine.intro) engine.intro.exit();

        const isLast = i === engine.steps.length - 1;

        // 4) Campo real (descendente ou vizinho)
        const inner = findFocusableInside(el) || findFocusableNear(el, 500);
        const targetForIntro = inner || el;

        // 5) Interatividade (sem JSON)
        const selectorIsWrapperHint =
          typeof step.selector === 'string' &&
          /\.bubble-element/.test(step.selector) &&
          (step.selector.includes('.Input') || step.selector.includes('.MultiLineInput') || step.selector.includes('.Dropdown'));

        const isInteractive =
          !!engine.options.interactiveDefault ||
          isEditableElement(targetForIntro) ||
          matchesAnySelector(targetForIntro, engine.options.interactiveSelectors) ||
          selectorIsWrapperHint ||
          step.action === 'focus';

        // 6) Liga modo interativo + foco
        setInteractiveMode(targetForIntro, isInteractive);
        if (isInteractive) {
          try { targetForIntro.click && targetForIntro.click(); } catch(_){}
          try { targetForIntro.focus && targetForIntro.focus(); } catch(_){}
        }

        // 7) Cria Intro
        engine.intro = window.introJs().setOptions({
          steps: [{ element: targetForIntro, intro: step.content || '', position: step.placement || 'bottom' }],
          showStepNumbers: true,
          showBullets: false,
          showProgress: true,
          exitOnOverlayClick: false,
          exitOnEsc: false,
          disableInteraction: !isInteractive,
          nextLabel: 'Próximo',
          prevLabel: 'Voltar',
          doneLabel: isLast ? 'Concluir' : 'Próximo'
        });

        // Eventos para garantir cleanup mesmo se o usuário fechar
        try {
          engine.intro.oncomplete(() => engine.complete());
          engine.intro.onexit(() => engine.stop('Saída do usuário/Intro'));
          engine.intro.onafterchange(() => {
            // se o Intro recriar layers, neutraliza de novo
            setTimeout(nukeLayers, 0);
          });
        } catch(_) { /* compat old intro */ }

        engine.intro.start();
        interceptNext(engine.intro, () => engine);

        // 8) Neutraliza overlays/tampa após iniciar (e em recriações)
        function nukeLayers(){
          document.querySelectorAll('.introjs-overlay, .introjs-helperLayer, .introjs-tooltipReferenceLayer, .introjs-disableInteraction')
            .forEach(n => {
              if (isInteractive && (n.classList.contains('introjs-overlay') || n.classList.contains('introjs-helperLayer') || n.classList.contains('introjs-tooltipReferenceLayer'))) {
                n.style.pointerEvents = 'none';
              }
              if (n.classList.contains('introjs-disableInteraction')) {
                n.style.pointerEvents = 'none';
                n.style.background = 'transparent';
                n.style.opacity = '0';
              }
            });
        }
        setTimeout(nukeLayers, 0);

        try { engine._disableObs && engine._disableObs.disconnect(); } catch(_) {}
        engine._disableObs = new MutationObserver(nukeLayers);
        engine._disableObs.observe(document.body, { childList: true, subtree: true });

        engine.debugLog(`Step ${i+1} shown; waiting Next`);
      },
      fail(err){
        console.error(err);
        instance.publishState('last_error', String((err && err.message) || err));
        engine.stop('Erro: ' + (err?.message || err));
        try { instance.triggerEvent && instance.triggerEvent('errored'); } catch(_){}
      }
    };
    return engine;
  };

  // ========= bootstrap =========
  instance.data = instance.data || {};
  loadIntro()
    .then(() => { instance.data.engine = buildEngine(instance); })
    .catch(e => {
      console.error('Falha ao carregar Intro.js', e);
      instance.publishState('last_error', 'Falha ao carregar Intro.js');
      try { instance.triggerEvent && instance.triggerEvent('errored'); } catch(_){}
    });
}
