# MeChampZ KataGo Drive Gateway

A Cloudflare Worker that streams KataGo model files from Google Drive to the browser.
It adds public CORS headers, forwards HTTP Range requests, and keeps Google service-account credentials server-side.

## Routes

- `GET|HEAD /model/desktop` -> TF3 B11C768 Drive file
- `GET|HEAD /model/mobile` -> TF3 B10C128 Drive file
- `OPTIONS` -> CORS preflight

## Required Cloudflare Worker secrets

Set these with Wrangler (never commit values):

- `DRIVE_SERVICE_ACCOUNT_EMAIL`
- `DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY` (PEM private key; Wrangler secret accepts multiline text)
- `DRIVE_FILE_ID_DESKTOP`
- `DRIVE_FILE_ID_MOBILE`

The Google service account must have Viewer access to each model file. Enable Google Drive API in the Google Cloud project that owns the service account.

## Deploy

From this directory:

```sh
npm install --save-dev wrangler
npx wrangler secret put DRIVE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put DRIVE_FILE_ID_DESKTOP
npx wrangler secret put DRIVE_FILE_ID_MOBILE
npx wrangler deploy
```

After deployment, test:

```sh
curl -I https://YOUR-WORKER.workers.dev/model/desktop
curl -I -H 'Range: bytes=0-1023' https://YOUR-WORKER.workers.dev/model/desktop
```

The second request should return HTTP 206 and a valid Content-Range header if Drive supports the requested range for the uploaded file.

## Important

- Do not deploy until both model files have been uploaded and their IDs and SHA256 values have been verified.
- Google Drive is origin storage, not a CDN. Public distribution may encounter Drive quota restrictions.
- Worker response bodies are streamed; the Worker does not buffer the entire model in memory.
- The browser may cache successful downloads using the existing Cache API in `site/katago/kata-worker.js`.
