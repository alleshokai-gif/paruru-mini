(function (root) {
  'use strict';
  const host = document.getElementById('matchVideosRoot');
  if (!host || !root.PaluruMatchVideos) return;
  let read = null, getLink = null, thumbnail = null;
  const fail = code => { throw Object.assign(new Error(code), {code}); };
  const home = () => document.dispatchEvent(new CustomEvent('paruru:view-request', {detail:{viewName:'home'}}));
  const view = root.PaluruMatchVideos.create({
    root: host,
    read: () => guarded(() => read ? read() : fail('MATCH_VIDEOS_NOT_CONFIGURED')),
    getLink: id => guarded(() => getLink ? getLink(id) : fail('MATCH_VIDEOS_NOT_CONFIGURED')),
    readThumbnail: id => guarded(() => thumbnail ? thumbnail(id) : null),
    onBack: home, onSignIn: home,
  });
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      const code = error?.code;
      if (code === 'FORBIDDEN') view.setSession({authenticated:true,allowed:false});
      if (['UNAUTHENTICATED','AUTHENTICATION_REQUIRED'].includes(code)) view.setSession({authenticated:false,allowed:false});
      if (code === 'CONFIGURATION_ERROR') fail('MATCH_VIDEOS_NOT_CONFIGURED');
      throw error;
    }
  }
  const active = () => !document.hidden && document.getElementById('matchVideosView')?.classList.contains('is-active');
  document.addEventListener('paruru:authenticated', event => {
    const detail = event.detail || {}, context = detail.context;
    const authenticated = Boolean(context);
    const allowed = authenticated && ['admin','guardian','self_record'].includes(context.role)
      && Array.isArray(context.allowedViews) && context.allowedViews.includes('home');
    read = allowed && typeof detail.matchVideosApi === 'function' ? detail.matchVideosApi : null;
    getLink = allowed && typeof detail.matchVideoLinkApi === 'function' ? detail.matchVideoLinkApi : null;
    thumbnail = allowed && typeof detail.matchVideoThumbnailApi === 'function' ? detail.matchVideoThumbnailApi : null;
    view.setSession({authenticated, allowed});
  });
  document.addEventListener('match-videos:opened', event => {
    if (!active()) return;
    const pending = view.open();
    event.detail?.waitUntil?.(pending);
  });
  document.addEventListener('match-videos:closed', () => view.close());
  document.addEventListener('kaz-os:locked', () => {
    read = null; getLink = null; thumbnail = null;
    view.setSession({authenticated:false,allowed:false}); view.close();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) view.close();
    else if (active()) void view.open();
  });
  window.addEventListener('pagehide', () => view.close());
  window.addEventListener('pageshow', () => { if (active()) void view.open(); });
})(globalThis);
