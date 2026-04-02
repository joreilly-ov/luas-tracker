# Frontend

React + Vite frontend for Luas and DART tracking.

## Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui components
- Capacitor (Android)

## Local development

From this folder:

```sh
npm install
npm run dev
```

By default, API requests use `VITE_API_URL` when set, otherwise same-origin requests.

Create `.env.local` if you need a local backend:

```sh
VITE_API_URL=http://localhost:8000
```

## Build

```sh
npm run build
npm run preview
```

## Tests

```sh
npm run test
npm run test:watch
npm run test:coverage
```

Coverage output is generated in `coverage/`.

## Android (Capacitor)

Initialize and sync Android project:

```sh
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

The Android app loads this frontend from `dist/` and uses the backend URL configured in `capacitor.config.ts`.
