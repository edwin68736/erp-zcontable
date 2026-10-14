import { useEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import HomeRail from '../components/home/HomeRail';
import HomeRobot from '../components/home/HomeRobot';
import { getHomeModules } from '../navigation/homeModules';
import { getHomeSections } from '../navigation/homeShortcuts';
import { auth } from '../services/auth';
import './home/home.css';

/**
 * Fondo de la escena: frontend/public/home/fondo-inicio.jpg (ver LEEME.txt ahí). Si el archivo no
 * existe se ve el degradado de respaldo.
 */
const BG_IMAGE = `url(${import.meta.env.BASE_URL}home/fondo-inicio.jpeg)`;
const BG_STYLE: CSSProperties = {
  backgroundImage: [
    BG_IMAGE,
    'radial-gradient(ellipse 60% 55% at 92% 18%, rgba(200,225,240,.8), transparent 70%)',
    'radial-gradient(circle at 6% 36%, rgba(34,150,100,.6), transparent 20%)',
    'radial-gradient(ellipse 70% 30% at 45% 100%, rgba(222,228,226,.9), transparent 70%)',
    'linear-gradient(180deg, #3b4a47 0%, #2b3a37 50%, #8c9a97 100%)',
  ].join(', '),
};

/** Posiciones de los accesos alrededor del robot (los de arriba/abajo se anclan al centro, donde está el robot; los de los lados, a los bordes) y cuánto se desplazan con el mouse. */
const SLOTS: { left?: string; right?: string; top: number; d: number }[] = [
  { left: 'calc(50% - 352px)', top: 25, d: 10 },
  { left: 'calc(50% + 170px)', top: 23, d: 12 },
  { left: '2%', top: 42, d: 18 },
  { right: '0%', top: 42, d: 18 },
  { left: '0%', top: 60, d: 16 },
  { right: '3%', top: 64, d: 14 },
  { left: 'calc(50% - 300px)', top: 74, d: 12 },
  { left: 'calc(50% - 91px)', top: 82, d: 10 },
];

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

const Home = () => {
  const user = auth.getUser();
  const displayName = user?.name?.trim() || user?.username?.trim() || 'Usuario';
  const firstName = displayName.split(/\s+/)[0].toUpperCase();
  const modules = useMemo(() => getHomeModules(), []);
  const sections = useMemo(() => getHomeSections(), []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);
  const target = useRef({ x: 0, y: 0 });

  const flush = () => {
    raf.current = 0;
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--hm-x', String(target.current.x));
    el.style.setProperty('--hm-y', String(target.current.y));
  };
  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  // El cuerpo y la cabeza giran con el movimiento horizontal del mouse; el vertical solo mueve los ojos.
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const robot = e.currentTarget.querySelector('.hm-robot');
    if (!robot) return;
    const r = robot.getBoundingClientRect();
    target.current = {
      x: Math.round(clamp((e.clientX - (r.left + r.width / 2)) / 520) * 1000) / 1000,
      y: Math.round(clamp((e.clientY - (r.top + r.height * 0.22)) / 380) * 1000) / 1000,
    };
    schedule();
  };
  const onLeave = () => {
    target.current = { x: 0, y: 0 };
    schedule();
  };

  return (
    <div className="-mx-2 md:-mx-6 -mt-4 -mb-6">
      <div ref={rootRef} className="hm-root" style={BG_STYLE} onMouseMove={onMove} onMouseLeave={onLeave}>
        <div className="hm-content">
          <div className="hm-stagewrap">
          <section className="hm-stage" aria-label="Accesos rápidos por módulo">
            <div className="hm-bubble">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#7ef0c0" aria-hidden style={{ flex: '0 0 26px', marginTop: 2 }}>
                <path d="M12 2l2.2 6.3L21 10l-5.3 3.7L17 21l-5-4-5 4 1.3-7.3L3 10l6.8-1.7z" />
              </svg>
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, lineHeight: 1.15 }}>¡Hola {firstName}!</h1>
                <p style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 500, color: '#d9f6e8' }}>¿Qué vamos a hacer hoy?</p>
              </div>
            </div>

            <HomeRobot />

            {modules.map((m, i) => {
              const slot = SLOTS[i % SLOTS.length];
              return (
                <div
                  key={m.key}
                  className="hm-node"
                  style={{ left: slot.left, right: slot.right, top: `${slot.top}%`, ['--hm-d' as string]: slot.d }}
                >
                  <img className="hm-art" src={m.icon} alt="" aria-hidden draggable={false} />
                  <Link className="hm-card" to={m.to}>
                    <span className="hm-ico">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d={m.glyph} />
                      </svg>
                    </span>
                    <span>
                      <span style={{ display: 'block', fontSize: 15, fontWeight: 700 }}>{m.title}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: '#cfeadd' }}>{m.subtitle}</span>
                    </span>
                  </Link>
                </div>
              );
            })}
          </section>
          </div>

          <HomeRail />
        </div>

        {sections.length === 0 ? (
          <div className="hm-white" style={{ position: 'relative', zIndex: 2, margin: '0 16px 16px', padding: '20px 24px', fontSize: 14, color: '#78350f', background: '#fffbeb' }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Sin módulos asignados</p>
            <p style={{ margin: '4px 0 0' }}>
              Su usuario no tiene permisos de navegación configurados. Contacte al administrador del estudio para asignarle un rol.
            </p>
          </div>
        ) : (
          <details className="hm-white" style={{ position: 'relative', zIndex: 2, margin: '0 16px 16px', padding: '14px 20px' }}>
            <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>Todos mis accesos</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 14 }}>
              {sections.map((section) => (
                <section key={section.id} aria-labelledby={`home-${section.id}`}>
                  <h2 id={`home-${section.id}`} style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#0b6b3f' }}>
                    <i className={section.icon} aria-hidden style={{ marginRight: 8 }} />
                    {section.label}
                  </h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {section.items.map((item) => (
                      <Link
                        key={`${section.id}-${item.to}`}
                        to={item.to}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, color: '#1e293b' }}
                      >
                        <i className={item.icon} aria-hidden style={{ color: '#0b6b3f' }} />
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
};

export default Home;
