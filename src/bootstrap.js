// A failed module import must not leave students with an empty page.
try {
  await import('./app.js?v=2a46e88dd0ce');
} catch (error) {
  console.error('FFCS startup failed:', error);
  document.querySelector('#intro-splash')?.remove();
  const app = document.querySelector('#app');
  if (app) {
    app.innerHTML = `<main class="app"><section class="panel" role="alert" style="margin:48px auto;max-width:520px"><h1>Let’s reload FFCS Easy</h1><p>Some app files could not load. Your saved course lists are still on this device.</p><button type="button" id="startup-retry" class="primary">Reload app</button></section></main>`;
    document.querySelector('#startup-retry').onclick = () => location.reload();
  }
}
