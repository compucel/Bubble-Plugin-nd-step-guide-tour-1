function(instance, context) {
  // ========= Helpers locais ao initialize =========
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

  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
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

  const classesToSelector = (classes = []) => classes.length ? '.' + classes.filter(Boolean).join('.') : null;

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

  const resolveElementWithFallback = (step) => {
    if (step.selector) {
      const el = document.querySelector(step.selector);
      if (el && isVisible(el)) return el;
    }
    const fb = step.fallback || {};
    const byClasses = classesToSelector(fb.classes || []);
    if (byClasses) {
      const el = document.querySelector(byClasses);
      if (el && isVisible(el)) return el;
    }
    const byText = queryByTextWithinClasses(fb.classes || [], fb.text || '');
    if (byText && isVisible(byText)) return byText;
    if (fb.domPath) {
      const el = document.querySelector(fb.domPath);
      if (el && isVisible(el)) return el;
    }
    return null;
  };

  const executeAction = (step, el) => {
    const act = step.action;
    if (!act || !el) return Promise.resolve();
    el.classList.add('ndtour-highlight');
    return new Promise((res) => {
      switch (act) {
        case 'click':
          el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          setTimeout(() => { el.click(); res(); }, 400);
          break;
        case 'focus':
          el.focus?.(); res(); break;
        case 'select':
          if (el.tagName === 'SELECT') {
            if (el.selectedIndex < 1 && el.options.length > 1) el.selectedIndex = 1;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          res();
          break;
        default: res();
      }
      setTimeout(() => el.classList.remove('ndtour-highlight'), 900);
    });
  };

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
          await executeAction(ctx.currentStepConfig, ctx.currentElement);
        }
        introInstance.exit();
        setTimeout(() => {
          if (ctx.isRunning) ctx.executeStep(ctx.currentStepIndex + 1);
        }, 800);
      });
    }, 50);
  };

  const attachStyles = () => {
    if (document.getElementById('ndtour-style')) return;
    const style = document.createElement('style');
    style.id = 'ndtour-style';
    style.textContent = `.ndtour-highlight{outline:3px solid #f59e0b !important;transition:outline .2s ease;}`;
    document.head.appendChild(style);
  };

  const buildEngine = (instance) => {
    attachStyles();
    const engine = {
      isRunning: false,
      steps: [],
      currentStepIndex: 0,
      currentStepConfig: null,
      currentElement: null,
      abortController: null,
      intro: null,
      options: { defaultTimeout: 10000, checkInterval: 200, debug: false, autoScroll: true },
      debugLog(...a){ if (engine.options.debug) console.log('[Tour]', ...a); },
      setStates(){
        instance.publishState('is_running', engine.isRunning);
        instance.publishState('current_step', engine.currentStepIndex + 1);
      },
      async start(steps, opts = {}){
        if (engine.isRunning) return;
        engine.options = { ...engine.options, ...opts };
        engine.steps = steps || [];
        engine.currentStepIndex = 0;
        engine.isRunning = true;
        engine.abortController = new AbortController();
        engine.setStates();
        engine.debugLog('Start', engine.steps.length, 'steps');
        try { await engine.executeStep(0); } catch (err) { engine.fail(err); }
      },
      stop(reason = 'Parado'){
        engine.debugLog('Stop:', reason);
        engine.isRunning = false;
        engine.currentStepConfig = null;
        engine.currentElement = null;
        engine.abortController?.abort();
        engine.abortController = null;
        engine.intro?.exit();
        engine.intro = null;
        instance.publishState('last_error', reason || '');
        engine.setStates();
      },
      complete(){
        engine.debugLog('Completed');
        engine.isRunning = false;
        engine.currentStepConfig = null;
        engine.currentElement = null;
        engine.intro?.exit();
        engine.intro = null;
        engine.setStates();
        try { instance.triggerEvent && instance.triggerEvent('completed'); } catch(_){}
      },
      async executeStep(i){
        if (!engine.isRunning) return;
        if (i >= engine.steps.length) return engine.complete();

        engine.currentStepIndex = i;
        engine.currentStepConfig = engine.steps[i];
        engine.currentElement = null;
        engine.setStates();

        const step = engine.currentStepConfig;
        engine.debugLog(`Preparing step ${i+1}:`, step.title || step.selector);

        let el = resolveElementWithFallback(step);
        if (!el && step.selector) {
          try {
            el = await waitForElement(step.selector, engine.options.defaultTimeout, engine.options.checkInterval, engine.abortController?.signal);
          } catch (_) {
            el = resolveElementWithFallback(step);
          }
        }
        if (!el) throw new Error(`Elemento não encontrado na etapa ${i + 1}`);

        engine.currentElement = el;
        if (engine.options.autoScroll) {
          try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_){}
          await new Promise(r => setTimeout(r, 200));
        }

        if (!window.introJs) throw new Error('Intro.js não carregado');
        if (engine.intro) engine.intro.exit();

        engine.intro = window.introJs().setOptions({
          steps: [{ element: el, intro: step.content || '', position: step.placement || 'bottom' }],
          showStepNumbers: true, showBullets: false, showProgress: true,
          exitOnOverlayClick: false, exitOnEsc: false,
          nextLabel: i === engine.steps.length - 1 ? 'Concluir' : 'Próximo',
          prevLabel: 'Voltar', doneLabel: 'Concluir'
        });

        engine.intro.start();
        interceptNext(engine.intro, () => engine);
        engine.debugLog(`Step ${i+1} shown; waiting Next`);
      },
      fail(err){
        console.error(err);
        instance.publishState('last_error', String(err && err.message || err));
        engine.stop('Erro: ' + (err?.message || err));
        try { instance.triggerEvent && instance.triggerEvent('errored'); } catch(_){}
      }
    };
    return engine;
  };

  // ========= bootstrap do elemento =========
  instance.data = instance.data || {};
  loadIntro()
    .then(() => { instance.data.engine = buildEngine(instance); })
    .catch(e => {
      console.error('Falha ao carregar Intro.js', e);
      instance.publishState('last_error', 'Falha ao carregar Intro.js');
      try { instance.triggerEvent && instance.triggerEvent('errored'); } catch(_){}
    });
}
