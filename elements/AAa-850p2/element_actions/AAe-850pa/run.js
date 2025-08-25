function(instance, properties, context) {
  const engine = instance.data && instance.data.engine;
  if (!engine) {
    instance.publishState('last_error', 'Engine não inicializada (initialize.js ainda não rodou).');
    instance.triggerEvent('errored');
    return;
  }

  let steps = [];
  try {
    steps = JSON.parse(properties.steps_json || '[]');
    if (!Array.isArray(steps)) throw new Error('steps_json não é um array');
  } catch (e) {
    instance.publishState('last_error', 'JSON inválido: ' + e.message);
    instance.triggerEvent('errored');
    return;
  }

  const interactiveDefault =
    (typeof properties.interactive_default === 'boolean')
      ? properties.interactive_default
      : false;

  const interactiveSelectors = (properties.interactive_selectors || '').trim();

  const opts = {
    defaultTimeout: Number(properties.default_timeout) || 10000,
    checkInterval: Number(properties.check_interval) || 200,
    debug: !!properties.debug,
    autoScroll: properties.auto_scroll !== false,
    interactiveDefault,
    interactiveSelectors
  };

  // start() já faz restart seguro e cleanup se necessário
  engine.start(steps, opts);
}
