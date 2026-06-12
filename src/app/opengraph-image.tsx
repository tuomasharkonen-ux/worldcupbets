import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const alt = 'World Cup Bets — WC 2026, the friends’ betting league';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Brand tokens mirrored from globals.css @theme (satori can't read CSS vars).
const BACKGROUND = '#0a1e12';
const FOREGROUND = '#eef6f0';
const MUTED = '#b7d2bf';
const PRIMARY = '#f0a830';
const PRIMARY_PRESS = '#b87d18';
const PRIMARY_BRIGHT = '#ffd166';
const ON_PRIMARY = '#0a1e12';

// Hosts first (US / Canada / Mexico), then a spread of WC nations.
const FLAG_CODES = ['us', 'ca', 'mx', 'br', 'ar', 'fr', 'gb-eng', 'es', 'de', 'pt', 'nl', 'jp'];

async function flagSrc(code: string): Promise<string> {
  const svg = await readFile(
    join(process.cwd(), 'node_modules/flag-icons/flags/4x3', `${code}.svg`),
    'base64',
  );
  return `data:image/svg+xml;base64,${svg}`;
}

export default async function Image() {
  const [carterOne, jakarta, flags] = await Promise.all([
    readFile(join(process.cwd(), 'assets/fonts/CarterOne-Regular.ttf')),
    readFile(join(process.cwd(), 'assets/fonts/PlusJakartaSans-SemiBold.ttf')),
    Promise.all(FLAG_CODES.map(flagSrc)),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 36,
          backgroundColor: BACKGROUND,
          // The app-backdrop blobs: floodlit gold up top, emerald turf glow below.
          backgroundImage: [
            'radial-gradient(circle at 12% -10%, rgba(240, 168, 48, 0.22), transparent 55%)',
            'radial-gradient(circle at 95% 0%, rgba(74, 222, 128, 0.16), transparent 50%)',
            'radial-gradient(circle at 55% 115%, rgba(34, 197, 94, 0.22), transparent 55%)',
          ].join(', '),
        }}
      >
        {/* Faint pitch centre circle behind the lockup */}
        <div
          style={{
            position: 'absolute',
            top: -190,
            left: 350,
            width: 500,
            height: 500,
            borderRadius: 250,
            border: '3px solid rgba(255, 255, 255, 0.05)',
          }}
        />

        {/* Trophy chip — gold rounded square with the 3D press lip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 108,
            height: 108,
            borderRadius: 32,
            backgroundColor: PRIMARY,
            boxShadow: `0 9px 0 0 ${PRIMARY_PRESS}, 0 24px 60px -12px rgba(0, 0, 0, 0.6)`,
          }}
        >
          {/* lucide Trophy */}
          <svg
            width="58"
            height="58"
            viewBox="0 0 24 24"
            fill="none"
            stroke={ON_PRIMARY}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978" />
            <path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978" />
            <path d="M18 9h1.5a1 1 0 0 0 0-5H18" />
            <path d="M4 22h16" />
            <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
            <path d="M6 9H4.5a1 1 0 0 1 0-5H6" />
          </svg>
        </div>

        <div
          style={{
            display: 'flex',
            fontFamily: 'Carter One',
            fontSize: 110,
            color: FOREGROUND,
            textShadow: `0 0 48px ${PRIMARY_BRIGHT}80`,
          }}
        >
          World Cup Bets
        </div>

        <div
          style={{
            display: 'flex',
            fontFamily: 'Plus Jakarta Sans',
            fontSize: 32,
            color: MUTED,
          }}
        >
          WC 2026 — the friends’ betting league
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 22 }}>
          {flags.map((src, i) => (
            <img
              key={FLAG_CODES[i]}
              alt=""
              src={src}
              width={62}
              height={46}
              style={{
                borderRadius: 8,
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.18)',
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Carter One', data: carterOne, style: 'normal', weight: 400 },
        { name: 'Plus Jakarta Sans', data: jakarta, style: 'normal', weight: 600 },
      ],
    },
  );
}
