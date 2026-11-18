(function () {
  const $ = (id) => document.getElementById(id);

  function apply(next) {
    if (document.activeElement !== $('set-hk')) $('set-hk').value = hotkeyLabel(next.runHotkey);
    document.documentElement.dataset.theme = next.theme === 'light' ? 'light' : 'dark';
    $('set-top').checked = !!next.alwaysOnTop;
    $('set-freeze').checked = !!next.freeze;
    if (document.activeElement !== $('set-delay')) $('set-delay').value = next.delay;
    $('set-aimax').value = String(next.aiMaxSize);
    $('set-panels').value = String(next.panelCount);
    $('set-method').value = next.method;
    $('set-device').value = next.aiDevice;
    SM.applyDevice($('set-method'), next.aiDevice);
  }

  const save = (patch) => window.api.settings.set(patch).then(apply);

  $('set-device').addEventListener('change', (e) => save({ aiDevice: e.target.value }));
  bindHotkey($('set-hk'), (accelerator) => save({ runHotkey: accelerator }));
  $('btn-close').addEventListener('click', () => window.api.window.close());
  $('set-top').addEventListener('change', (e) => save({ alwaysOnTop: e.target.checked }));
  $('set-freeze').addEventListener('change', (e) => save({ freeze: e.target.checked }));
  $('set-delay').addEventListener('change', (e) => {
    const value = Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0)));
    e.target.value = value;
    save({ delay: value });
  });
  $('set-method').addEventListener('change', (e) => save({ method: e.target.value }));
  $('set-aimax').addEventListener('change', (e) => save({ aiMaxSize: Number(e.target.value) }));
  $('set-panels').addEventListener('change', (e) => save({ panelCount: Number(e.target.value) }));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.api.window.close();
  });

  window.api.settings.get().then((s) => {
    SM.fillSelect($('set-method'), s.method);
    apply(s);
  });
  window.api.onSettingsChanged(apply);
})();
