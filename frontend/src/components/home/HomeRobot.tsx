import type { CSSProperties } from 'react';

/** Robot de la página de Inicio. Se dibuja solo con CSS; su movimiento depende de --hm-x / --hm-y
 * (ver pages/home/home.css y el handler de mouse en pages/Home.tsx).
 *
 * Cabeza y cuerpo son VOLÚMENES: varias capas con la misma silueta apiladas en profundidad
 * (translateZ) y más pequeñas hacia atrás, de modo que al girar se ve el grosor y el contorno
 * redondeado en vez de una tarjeta plana. La capa frontal lleva los detalles (visor, brillo, logo). */

const mix = (t: number) => {
  // De gris verdoso oscuro (atrás) a blanco (frente).
  const from = [150, 169, 164];
  const to = [240, 245, 243];
  return `rgb(${from.map((f, i) => Math.round(f + (to[i] - f) * t)).join(',')})`;
};

type Layer = { z: number; scale: number; color: string; front: boolean };

function buildLayers(count: number, depth: number, backScale: number): Layer[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 1 : i / (count - 1);
    return { z: -depth / 2 + t * depth, scale: backScale + (1 - backScale) * t, color: mix(t), front: i === count - 1 };
  });
}

const HEAD_LAYERS = buildLayers(10, 70, 0.86);
const BODY_LAYERS = buildLayers(8, 50, 0.88);

const layerStyle = (l: Layer): CSSProperties => ({
  transform: `translateZ(${l.z}px) scale(${l.scale})`,
  background: l.front ? undefined : l.color,
});

const HomeRobot = () => (
  <div className="hm-robotwrap">
    <div className="hm-platform" aria-hidden>
      <div className="hm-pr hm-pr1" />
      <div className="hm-pr hm-pr2" />
      <div className="hm-pr hm-pr3" />
    </div>
    <div className="hm-robot" role="img" aria-label="Asistente virtual ZContable: sus ojos y su cuerpo siguen el cursor">
      <div className="hm-holo" />
      <div className="hm-r3d">
        <div className="hm-arm hm-arm-l">
          <div className="hm-hand" />
        </div>
        <div className="hm-arm hm-arm-r">
          <div className="hm-hand" />
        </div>
        <div className="hm-thruster" />

        <div className="hm-body">
          {BODY_LAYERS.map((l) => (
            <div key={l.z} className={`hm-bl${l.front ? ' hm-bl-front' : ''}`} style={layerStyle(l)}>
              {l.front ? (
                <>
                  <div className="hm-gloss" />
                  <div className="hm-logo">
                    <span>Z</span>Contable
                  </div>
                  <div className="hm-belt" />
                </>
              ) : null}
            </div>
          ))}
        </div>

        <div className="hm-head">
          {/* Orejeras: discos girados 90° sobre el borde lateral — se ven al girar la cabeza. */}
          <div className="hm-ear" style={{ left: -22 }} />
          <div className="hm-ear" style={{ right: -22 }} />
          {HEAD_LAYERS.map((l) => (
            <div key={l.z} className={`hm-hl${l.front ? ' hm-hl-front' : ''}`} style={layerStyle(l)} />
          ))}
          <div className="hm-visor">
            <div className="hm-face">
              <div className="hm-eyes">
                <div className="hm-eye" style={{ left: 34 }} />
                <div className="hm-eye" style={{ right: 34 }} />
              </div>
              <div className="hm-mouth" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default HomeRobot;
