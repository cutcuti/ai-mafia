import { ImageResponse } from 'next/og';
import { seatColor } from './theme';
import type { OgGame, OgMoment } from './og';

const SIZE = { width: 1200, height: 630 };
const C = { ink: '#12112a', panel: '#2b2860', fg: '#fff3d6', muted: '#bdb5e3', mafia: '#ff5a5a', town: '#5fb8ff', pink: '#ff6fa8', amber: '#ffd04f' };
const AWARD: Record<string, string> = { best_liar: '🤥 Best Liar', sharpest_read: '🔍 Sharpest Read', biggest_fumble: '🤦 Biggest Fumble', mvp: '🏆 MVP' };
const cache = { 'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800' };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: C.ink, color: C.fg, padding: 56, fontSize: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: C.pink, fontSize: 30, fontWeight: 800 }}>🔪 AI MAFIA</div>
      {children}
      <div style={{ display: 'flex', marginTop: 'auto', color: C.muted, fontSize: 24 }}>AIs play Mafia. Read their private thoughts while they lie to each other.</div>
    </div>
  );
}

export function renderGameCard(d: OgGame) {
  const banner = d.outcome === 'mafia' ? { t: '🔪 Mafia wins', c: C.mafia } : d.outcome === 'town' ? { t: '🏘️ Town wins', c: C.town } : d.outcome === 'draw' ? { t: '🤝 Draw', c: C.amber } : { t: '🔴 Live now', c: C.pink };
  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 76, fontWeight: 800, color: banner.c }}>{banner.t}</div>
        <div style={{ display: 'flex', marginTop: 8, fontSize: 34, color: C.muted }}>{d.title}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 30 }}>
          {d.players.map((p) => (
            <div
              key={p.seatId}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderRadius: 18, background: C.panel, border: `2px solid ${p.mafia ? C.mafia : '#2a2640'}` }}
            >
              <div style={{ width: 18, height: 18, borderRadius: 9, background: seatColor(p.seatId) }} />
              <div style={{ display: 'flex', fontWeight: 700 }}>{p.name}</div>
              {p.mafia && <div style={{ display: 'flex', color: C.mafia, fontSize: 24 }}>mafia</div>}
            </div>
          ))}
        </div>
        {d.award && (
          <div style={{ display: 'flex', marginTop: 28, fontSize: 30 }}>
            <span style={{ color: C.amber, marginRight: 12 }}>{AWARD[d.award.kind]}</span>
            <span style={{ fontWeight: 700 }}>{`${d.award.seatName}: ${d.award.title}`}</span>
          </div>
        )}
      </Frame>
    ),
    { ...SIZE, headers: cache },
  );
}

export function renderMomentCard(d: OgMoment) {
  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 36 }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, background: seatColor(d.seatId) }} />
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, color: seatColor(d.seatId) }}>{d.speaker}</div>
          <div style={{ display: 'flex', fontSize: 28, color: C.muted }}>{[d.model, d.context].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 24, padding: '28px 34px', borderRadius: 32, background: C.panel, fontSize: d.text.length > 160 ? 32 : 42, lineHeight: 1.3 }}>
          {`“${d.text}”`}
        </div>
        {d.award && (
          <div style={{ display: 'flex', marginTop: 24, fontSize: 30 }}>
            <span style={{ color: C.amber, marginRight: 12 }}>{AWARD[d.award.kind]}</span>
            <span style={{ fontWeight: 700 }}>{d.award.title}</span>
          </div>
        )}
      </Frame>
    ),
    { ...SIZE, headers: cache },
  );
}

export function renderSiteCard() {
  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 60, fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
          <span>Six AIs play Mafia.</span>
          <span style={{ color: C.mafia }}>Two of them are lying.</span>
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 36, color: C.muted }}>Watch them do it — and find out which model lies best.</div>
      </Frame>
    ),
    { ...SIZE, headers: cache },
  );
}
