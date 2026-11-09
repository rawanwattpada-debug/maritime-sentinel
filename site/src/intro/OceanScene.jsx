import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Cinematic hero: a living ocean (Gerstner waves) with a container ship and smaller
// vessels riding the swell, radar rings, and a camera that moves toward the bow as the
// visitor scrolls. Everything is generated in code: no images, videos or 3D files.

// ---------------------------------------------------------------- waves (shared JS + GLSL)
// [direction x, direction z, steepness, wavelength]
const WAVES = [
  [1.0, 0.25, 0.12, 110],
  [0.6, 0.9, 0.1, 64],
  [-0.4, 1.0, 0.08, 34],
  [0.9, -0.6, 0.07, 19],
  [0.2, -1.0, 0.05, 11],
];
const G = 9.8;

function waveAt(x, z, t) {
  // returns height at (x, z) using the same Gerstner sum as the shader
  let y = 0;
  for (const [dx, dz, s, L] of WAVES) {
    const len = Math.hypot(dx, dz);
    const k = (2 * Math.PI) / L;
    const c = Math.sqrt(G / k);
    const a = s / k;
    const f = k * ((dx / len) * x + (dz / len) * z - c * t);
    y += a * Math.sin(f);
  }
  return y;
}

const WAVE_GLSL = WAVES.map(
  ([dx, dz, s, L]) => `wave(vec2(${dx.toFixed(3)}, ${dz.toFixed(3)}), ${s.toFixed(3)}, ${L.toFixed(1)}, p, t, tan, bin)`,
).join(';\n    p2 += ');

const oceanVert = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  vec3 wave(vec2 dir, float steep, float L, vec3 p, float t, inout vec3 tan, inout vec3 bin) {
    float k = 6.2831853 / L;
    float c = sqrt(9.8 / k);
    vec2 d = normalize(dir);
    float f = k * (dot(d, p.xz) - c * t);
    float a = steep / k;
    tan += vec3(-d.x * d.x * steep * sin(f), d.x * steep * cos(f), -d.x * d.y * steep * sin(f));
    bin += vec3(-d.x * d.y * steep * sin(f), d.y * steep * cos(f), -d.y * d.y * steep * sin(f));
    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
  }

  void main() {
    vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 p = base;
    p.x += uFlow;                      // the sea flows past the ship = the ship moves forward
    float t = uTime;
    vec3 tan = vec3(1.0, 0.0, 0.0);
    vec3 bin = vec3(0.0, 0.0, 1.0);
    vec3 p2 = vec3(0.0);
    p2 += ${WAVE_GLSL};
    vec3 world = base + p2;
    vHeight = p2.y;
    vNormal = normalize(cross(bin, tan));
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const oceanFrag = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uFog;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform vec3 uCam;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    vec3 n = normalize(vNormal);
    // fine ripples
    vec2 q = vWorld.xz * 0.35 + vec2(uTime * 0.6, uTime * 0.25);
    n = normalize(n + vec3(noise(q) - 0.5, 0.0, noise(q + 17.0) - 0.5) * 0.35);

    vec3 V = normalize(uCam - vWorld);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    vec3 water = mix(uDeep, uShallow, smoothstep(-2.0, 3.0, vHeight));
    vec3 col = mix(water, uSky, fres * 0.42);

    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(n, H), 0.0), 220.0);
    col += uSun * spec * 2.2;

    // foam on the crests
    float foam = smoothstep(1.6, 2.4, vHeight + noise(vWorld.xz * 0.12 + uTime * 0.2) * 0.9);
    col = mix(col, vec3(0.78, 0.9, 0.95), foam * 0.35);

    float dist = length(uCam - vWorld);
    float fog = 1.0 - exp(-pow(dist * 0.0023, 1.6));
    gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
    float sun = pow(max(dot(normalize(vDir), uSunDir), 0.0), 18.0);
    col += uGlow * sun * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- vessels

function hullGeometry(length, width, height, bowStart = 0.62) {
  // side profile extruded across the beam, then the bow narrowed to a point
  const s = new THREE.Shape();
  s.moveTo(-length / 2, 0);
  s.lineTo(length / 2 - length * 0.06, 0);
  s.quadraticCurveTo(length / 2 + length * 0.02, height * 0.5, length / 2 + length * 0.04, height);
  s.lineTo(-length / 2, height);
  s.lineTo(-length / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -width / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const f = (x / (length / 2) - bowStart) / (1.04 - bowStart);
    if (f > 0) {
      const taper = Math.max(0.04, 1 - Math.pow(Math.min(f, 1), 1.6));
      pos.setZ(i, pos.getZ(i) * taper);
    }
    // a little flare toward the deck
    const yN = pos.getY(i) / height;
    pos.setZ(i, pos.getZ(i) * (0.82 + 0.18 * yN));
  }
  g.computeVertexNormals();
  return g;
}

function containerShip() {
  const ship = new THREE.Group();
  const L = 150;
  const W = 24;
  const H = 14;
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2b4c74, roughness: 0.5, metalness: 0.3 });
  const hull = new THREE.Mesh(hullGeometry(L, W, H), hullMat);
  hull.position.y = -4;
  ship.add(hull);

  // red antifouling band at the waterline
  const band = new THREE.Mesh(
    hullGeometry(L * 0.995, W * 1.01, 4.2),
    new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.8 }),
  );
  band.position.y = -4.6;
  ship.add(band);

  // containers
  const palette = [0x0e7490, 0x2a6f8f, 0xc2410c, 0x475569, 0x0f766e, 0xb45309, 0x3b5b8c, 0x94a3b8];
  const box = new THREE.BoxGeometry(11.6, 2.5, 2.35);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.25 });
  const rows = 7;
  const cols = 8;
  const tiers = 5;
  const count = rows * cols * tiers;
  const inst = new THREE.InstancedMesh(box, mat, count);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let n = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let col = 0; col < cols; col += 1) {
      const h = tiers - ((r * 3 + col * 5) % 3 === 0 ? 1 : 0) - (r === rows - 1 ? 2 : 0);
      for (let t = 0; t < tiers; t += 1) {
        if (t >= h) { m.makeScale(0, 0, 0); } else {
          m.makeTranslation(-40 + r * 12.3, H - 4 + 1.3 + t * 2.55, -8.4 + col * 2.4);
        }
        inst.setMatrixAt(n, m);
        inst.setColorAt(n, c.setHex(palette[(r * 7 + col * 3 + t * 5) % palette.length]));
        n += 1;
      }
    }
  }
  ship.add(inst);

  // bridge tower at the stern
  const white = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(12, 16, 22), white);
  tower.position.set(-60, H - 4 + 8, 0);
  ship.add(tower);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 30), white);
  wing.position.set(-56, H - 4 + 15, 0);
  ship.add(wing);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.4, 28),
    new THREE.MeshBasicMaterial({ color: 0x67e8f9 }),
  );
  glass.position.set(-53.4, H - 4 + 15.3, 0);
  ship.add(glass);
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.2, 9, 16),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 }),
  );
  funnel.position.set(-66, H - 4 + 20, 0);
  ship.add(funnel);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 8), white);
  mast.position.set(-60, H - 4 + 21, 0);
  ship.add(mast);

  // navigation lights
  const light = (color, x, y, z) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 12), new THREE.MeshBasicMaterial({ color }));
    l.position.set(x, y, z);
    ship.add(l);
  };
  light(0xef4444, -56, H - 4 + 15, -15.5);
  light(0x22c55e, -56, H - 4 + 15, 15.5);
  light(0xffffff, -60, H - 4 + 26, 0);
  light(0xffffff, 70, H - 4 + 3, 0);
  return ship;
}

function smallBoat(color = 0x334155, length = 14) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    hullGeometry(length, length * 0.32, length * 0.28, 0.4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }),
  );
  hull.position.y = -length * 0.12;
  g.add(hull);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(length * 0.3, length * 0.2, length * 0.24),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 }),
  );
  cabin.position.set(-length * 0.08, length * 0.22, 0);
  g.add(cabin);
  return g;
}

function radarRing(color, radius) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.97, radius, 96), mat);
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

// ---------------------------------------------------------------- camera path (scroll 0 -> 1)

const CAM = [
  { pos: [-170, 10, 135], look: [5, 30, 0] }, // slide 1: wide, low, the whole ship under the title
  { pos: [-25, 8, 88], look: [60, 14, 0] }, // between: alongside the containers
  { pos: [95, 5, 60], look: [85, 7, 0] }, // slide 2: at the bow, side
  { pos: [215, 4.5, 26], look: [90, 8, 0] }, // end: ahead of the bow, looking back
];
const camCurve = new THREE.CatmullRomCurve3(CAM.map((c) => new THREE.Vector3(...c.pos)));
const lookCurve = new THREE.CatmullRomCurve3(CAM.map((c) => new THREE.Vector3(...c.look)));

// progressRef.current: 0..1 scroll position through slides 1-2; activeRef.current: render or pause
export default function OceanScene({ progressRef, activeRef }) {
  const host = useRef(null);

  useEffect(() => {
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const FOG = new THREE.Color(0x1a4766);
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.5, 4000);

    const sunDir = new THREE.Vector3(-0.55, 0.22, -0.8).normalize();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(2500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        uniforms: {
          uTop: { value: new THREE.Color(0x0b1830) },
          uHorizon: { value: new THREE.Color(0x2a6a86) },
          uGlow: { value: new THREE.Color(0xffc879) },
          uSunDir: { value: sunDir },
        },
      }),
    );
    scene.add(sky);

    const oceanMat = new THREE.ShaderMaterial({
      vertexShader: oceanVert,
      fragmentShader: oceanFrag,
      uniforms: {
        uTime: { value: 0 },
        uFlow: { value: 0 },
        uDeep: { value: new THREE.Color(0x06263f) },
        uShallow: { value: new THREE.Color(0x13788f) },
        uSky: { value: new THREE.Color(0x3f8199) },
        uFog: { value: FOG },
        uSun: { value: new THREE.Color(0xffd9a0) },
        uSunDir: { value: sunDir },
        uCam: { value: new THREE.Vector3() },
      },
    });
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 360, 360), oceanMat);
    ocean.rotation.x = -Math.PI / 2;
    scene.add(ocean);

    scene.add(new THREE.HemisphereLight(0x9bd7e6, 0x0b1a2c, 1.1));
    const key = new THREE.DirectionalLight(0xffe2b8, 1.6);
    key.position.copy(sunDir).multiplyScalar(400);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5eead4, 0.6);
    rim.position.set(200, 80, 300);
    scene.add(rim);

    const ship = containerShip();
    scene.add(ship);

    const boats = [
      { obj: smallBoat(0x475569, 16), x: -40, z: 95, drift: 0.6 },
      { obj: smallBoat(0x0f766e, 12), x: 130, z: -70, drift: 0.3 },
      { obj: smallBoat(0x7c2d12, 10), x: 250, z: 60, drift: 0.9 },
    ];
    boats.forEach((b) => scene.add(b.obj));

    // radar rings: cyan around the ship, amber around small craft
    const shipRings = [radarRing(0x22d3ee, 110), radarRing(0x22d3ee, 110), radarRing(0x67e8f9, 160)];
    shipRings.forEach((r) => scene.add(r));
    const boatRings = boats.map(() => radarRing(0xf5b547, 16));
    boatRings.forEach((r) => scene.add(r));

    // wake: a soft foam strip behind the stern
    const wake = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 34, 1, 1),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uSpeed: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uSpeed; varying vec2 vUv;
          float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
          float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
          void main(){
            float along = vUv.x;           // 1 = at the stern
            float across = abs(vUv.y - 0.5) * 2.0;
            float spread = mix(0.25, 1.0, 1.0 - along);
            float edge = smoothstep(spread, spread * 0.4, across);
            float streak = n(vec2(vUv.x * 30.0 + uTime * 3.0 * uSpeed, vUv.y * 12.0));
            float a = edge * pow(along, 1.3) * (0.35 + 0.65 * streak) * 0.75;
            gl_FragColor = vec4(vec3(0.85, 0.95, 1.0), a);
          }`,
      }),
    );
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(-205, 0.6, 0);
    scene.add(wake);

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    let flow = 0;
    let raf;
    const camPos = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    const tmp = new THREE.Vector3();

    const bob = (obj, x, z, t, size, amp = 1) => {
      const y = waveAt(x + flow, z, t);
      const fwd = waveAt(x + flow + size, z, t);
      const back = waveAt(x + flow - size, z, t);
      const port = waveAt(x + flow, z - size * 0.3, t);
      const stbd = waveAt(x + flow, z + size * 0.3, t);
      obj.position.set(x, y * amp, z);
      obj.rotation.z = Math.atan2(fwd - back, size * 2) * amp;
      obj.rotation.x = -Math.atan2(stbd - port, size * 0.6) * amp * 0.8;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!activeRef.current) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const p = THREE.MathUtils.clamp(progressRef.current, 0, 1);

      // the ship speeds up as we move toward the bow
      const speed = 6 + p * 12;
      flow += speed * dt;
      oceanMat.uniforms.uTime.value = t;
      oceanMat.uniforms.uFlow.value = flow;
      wake.material.uniforms.uTime.value = t;
      wake.material.uniforms.uSpeed.value = speed / 8;

      // a big ship moves slowly on the swell; small boats move more
      bob(ship, 0, 0, t, 70, 0.45);
      boats.forEach((b, i) => {
        b.x -= speed * dt * b.drift;
        if (b.x < -300) b.x += 650;
        bob(b.obj, b.x, b.z, t, 7, 1);
        b.obj.rotation.y = Math.PI;
        boatRings[i].position.set(b.x, 0.8, b.z);
        const s = 1 + ((t * 0.6 + i * 0.3) % 1) * 1.6;
        boatRings[i].scale.setScalar(s);
        boatRings[i].material.opacity = 0.8 * (1 - ((t * 0.6 + i * 0.3) % 1));
      });
      shipRings.forEach((r, i) => {
        if (i === 2) {
          r.position.set(0, 0.8, 0);
          r.material.opacity = 0.18 + Math.sin(t * 1.5) * 0.06;
          return;
        }
        const ph = (t * 0.25 + i * 0.5) % 1;
        r.position.set(0, 0.8, 0);
        r.scale.setScalar(0.3 + ph * 1.2);
        r.material.opacity = 0.75 * (1 - ph);
      });

      // camera: scroll position along the path + a gentle sway like being on a boat
      camPos.copy(camCurve.getPoint(p));
      camLook.copy(lookCurve.getPoint(p));
      camPos.y += Math.sin(t * 0.7) * 0.6 + waveAt(camPos.x + flow, camPos.z, t) * 0.25;
      camera.position.copy(camPos);
      tmp.copy(camLook);
      tmp.y += Math.sin(t * 0.5) * 0.3;
      camera.lookAt(tmp);
      oceanMat.uniforms.uCam.value.copy(camera.position);
      sky.position.copy(camera.position);

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) [].concat(o.material).forEach((m) => m.dispose());
      });
      el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={host} className="absolute inset-0" />;
}
