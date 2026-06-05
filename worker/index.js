/**
 * SplitGit — Cloudflare Worker
 *
 * Does exactly one thing: exchange a GitHub OAuth `code` for an access token.
 * The app never sees the client secret — this worker holds it as an env var.
 *
 * Deploy with:
 *   wrangler secret put GITHUB_CLIENT_SECRET
 *   wrangler deploy
 *
 * Set these in wrangler.toml (or Cloudflare dashboard):
 *   GITHUB_CLIENT_ID     — your OAuth app client ID
 *   ALLOWED_ORIGIN       — your app's origin, e.g. https://splitgit.yourdomain.com
 */

export default {
  async fetch(request, env) {
    // CORS pre-flight
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), env)
    }

    if (request.method !== 'POST') {
      return cors(new Response('Method not allowed', { status: 405 }), env)
    }

    let code
    try {
      const body = await request.json()
      code = body.code
    } catch {
      return cors(new Response('Invalid JSON body', { status: 400 }), env)
    }

    if (!code) {
      return cors(new Response('Missing code', { status: 400 }), env)
    }

    // Exchange code → token with GitHub
    const githubRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code
      })
    })

    const data = await githubRes.json()

    if (data.error) {
      return cors(
        new Response(JSON.stringify({ error: data.error_description ?? data.error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }),
        env
      )
    }

    return cors(
      new Response(JSON.stringify({ access_token: data.access_token }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }),
      env
    )
  }
}

function cors(response, env) {
  const origin = env.ALLOWED_ORIGIN ?? '*'
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}
