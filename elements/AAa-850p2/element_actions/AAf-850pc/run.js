function(instance, properties, context) {
  const engine = instance.data && instance.data.engine;
  if (!engine) return;
  engine.stop('Parado pelo usuário/fluxo');
}
