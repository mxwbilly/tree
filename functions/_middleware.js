const HOME_LANGUAGE_PATHS = {
  vi: '/vi/',
  th: '/th/',
  id: '/id/'
};

export async function onRequest(context) {
  const { request } = context;
  if (!['GET', 'HEAD'].includes(request.method)) return context.next();

  const url = new URL(request.url);
  const isHomeRequest = url.pathname === '/' || url.pathname === '/index.html';
  const targetPath = HOME_LANGUAGE_PATHS[url.searchParams.get('lang')];
  if (!isHomeRequest || !targetPath) return context.next();

  url.pathname = targetPath;
  url.searchParams.delete('lang');
  return Response.redirect(url.toString(), 301);
}
