export async function onRequest(context) {
  const country = context.request.cf?.country || 'XX';
  return new Response(JSON.stringify({ country }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
