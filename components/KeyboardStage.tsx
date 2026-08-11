"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import "./KeyboardStage.css";

const FIRST_MIDI_NOTE = 48;
const KEY_COUNT = 25;
const WHITE_KEY_WIDTH = 0.7;
const HIT_Z = 1.82;
const FAR_Z = -14.7;
const TRAVEL_DISTANCE = HIT_Z - FAR_Z;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export type KeyboardNoteState =
  | "upcoming"
  | "active"
  | "hit"
  | "missed";

export interface KeyboardStageNote {
  /** Stable identifier used to preserve a note visual while the song moves. */
  id: string | number;
  /** MIDI note number. The rendered controller covers MIDI 48–72 (C3–C5). */
  midi: number;
  /** Song-relative beat at which the note should cross the timing line. */
  startBeat: number;
  /** Sustained length in beats. Defaults to a short quarter-beat block. */
  durationBeats?: number;
  /** Optional MIDI velocity, 0–1. It influences brightness and height. */
  velocity?: number;
  state?: KeyboardNoteState;
  /** Optional per-note color override as any Three.js-compatible CSS color. */
  color?: string;
  hand?: "left" | "right";
}

export type KeyboardHitGrade = "perfect" | "great" | "good" | "miss";

export interface KeyboardHitFeedback {
  /** Supplying an id guarantees that an event is emitted exactly once. */
  id?: string | number;
  midi: number;
  kind: KeyboardHitGrade;
  beat?: number;
  time?: number;
  strength?: number;
}

export type KeyboardStageThemeName = "electric" | "aurora" | "sunset";

export interface KeyboardStagePalette {
  background: string;
  panel: string;
  lane: string;
  primary: string;
  secondary: string;
  success: string;
  miss: string;
  whiteKeyGlow: string;
}

export type KeyboardStageTheme =
  | KeyboardStageThemeName
  | Partial<KeyboardStagePalette>;

export interface KeyboardStageProps {
  notes: readonly KeyboardStageNote[];
  currentBeat: number;
  currentTime?: number;
  pressedMidiNotes?: ReadonlySet<number> | readonly number[];
  /** The latest event or a short event history. Old ids are de-duplicated. */
  feedback?: KeyboardHitFeedback | readonly KeyboardHitFeedback[] | null;
  theme?: KeyboardStageTheme;
  /** 0 removes ambient motion; 1 is the authored look; values up to 2 add juice. */
  intensity?: number;
  /** Number of upcoming beats visible on the highway. */
  travelBeats?: number;
  showHud?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  onKeyDown?: (midi: number, velocity: number) => void;
  onKeyUp?: (midi: number) => void;
  onReady?: () => void;
}

interface KeyLayout {
  midi: number;
  isBlack: boolean;
  x: number;
  width: number;
}

interface KeyVisual extends KeyLayout {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  material: THREE.MeshStandardMaterial;
  baseY: number;
  landingMaterial: THREE.MeshBasicMaterial;
}

interface NoteVisual {
  group: THREE.Group;
  body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  glow: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  bodyMaterial: THREE.MeshStandardMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
}

interface FeedbackBurst {
  root: THREE.Group;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  ringMaterial: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  age: number;
  duration: number;
  miss: boolean;
}

interface ThemeMaterial {
  material: THREE.Material & { color: THREE.Color };
  role: keyof KeyboardStagePalette;
}

type StageStyle = CSSProperties & Record<`--kh-${string}`, string | number>;

const THEME_PRESETS: Record<KeyboardStageThemeName, KeyboardStagePalette> = {
  electric: {
    background: "#050817",
    panel: "#10172a",
    lane: "#293a66",
    primary: "#21dcff",
    secondary: "#bd3cff",
    success: "#6dffb3",
    miss: "#ff406c",
    whiteKeyGlow: "#a9eeff",
  },
  aurora: {
    background: "#03120f",
    panel: "#0b2422",
    lane: "#1f554d",
    primary: "#63ffd3",
    secondary: "#88a8ff",
    success: "#d7ff6d",
    miss: "#ff5c78",
    whiteKeyGlow: "#baffee",
  },
  sunset: {
    background: "#160715",
    panel: "#281326",
    lane: "#66304f",
    primary: "#ffb83e",
    secondary: "#ff4fd8",
    success: "#9dff7a",
    miss: "#ff3f55",
    whiteKeyGlow: "#ffe4ad",
  },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolvePalette(theme: KeyboardStageTheme): KeyboardStagePalette {
  if (typeof theme === "string") return THEME_PRESETS[theme];
  return { ...THEME_PRESETS.electric, ...theme };
}

function isBlackKey(midi: number) {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

function makeKeyLayout(): KeyLayout[] {
  const midiNotes = Array.from(
    { length: KEY_COUNT },
    (_, index) => FIRST_MIDI_NOTE + index,
  );
  const whiteNotes = midiNotes.filter((midi) => !isBlackKey(midi));
  const whiteX = new Map<number, number>();

  whiteNotes.forEach((midi, index) => {
    whiteX.set(
      midi,
      (index - (whiteNotes.length - 1) / 2) * WHITE_KEY_WIDTH,
    );
  });

  return midiNotes.map((midi) => {
    const black = isBlackKey(midi);
    if (!black) {
      return {
        midi,
        isBlack: false,
        x: whiteX.get(midi) ?? 0,
        width: WHITE_KEY_WIDTH - 0.035,
      };
    }

    let previous = midi - 1;
    let next = midi + 1;
    while (isBlackKey(previous)) previous -= 1;
    while (isBlackKey(next)) next += 1;
    const previousX = whiteX.get(previous);
    const nextX = whiteX.get(next);
    const x =
      previousX !== undefined && nextX !== undefined
        ? (previousX + nextX) / 2
        : previousX !== undefined
          ? previousX + WHITE_KEY_WIDTH / 2
          : (nextX ?? 0) - WHITE_KEY_WIDTH / 2;

    return { midi, isBlack: true, x, width: 0.41 };
  });
}

const KEY_LAYOUT = makeKeyLayout();
const WHITE_KEY_COUNT = KEY_LAYOUT.filter((key) => !key.isBlack).length;
const KEYBOARD_WIDTH = WHITE_KEY_COUNT * WHITE_KEY_WIDTH;

function hasMidi(
  pressed: ReadonlySet<number> | readonly number[],
  midi: number,
) {
  if (Array.isArray(pressed)) return pressed.includes(midi);
  return (pressed as ReadonlySet<number>).has(midi);
}

function noteColor(note: KeyboardStageNote, palette: KeyboardStagePalette) {
  if (note.color) return note.color;
  if (note.state === "missed") return palette.miss;
  if (note.state === "hit") return palette.success;
  if (note.hand === "left") return palette.secondary;
  if (note.hand === "right") return palette.primary;
  return isBlackKey(note.midi) ? palette.secondary : palette.primary;
}

function feedbackColor(
  feedback: KeyboardHitFeedback,
  palette: KeyboardStagePalette,
) {
  if (feedback.kind === "miss") return palette.miss;
  if (feedback.kind === "perfect") return palette.success;
  if (feedback.kind === "great") return palette.primary;
  return palette.secondary;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    materials.forEach((material) => {
      const materialRecord = material as THREE.Material &
        Record<string, unknown>;
      Object.values(materialRecord).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

function makeTextTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 224;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { canvas, context, texture };
}

export default function KeyboardStage({
  notes,
  currentBeat,
  currentTime = 0,
  pressedMidiNotes = [],
  feedback = null,
  theme = "electric",
  intensity = 1,
  travelBeats = 8,
  showHud = true,
  className = "",
  style,
  ariaLabel = "Interactive 3D 25-key Keyboard Hero performance stage",
  onKeyDown,
  onKeyUp,
  onReady,
}: KeyboardStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef(notes);
  const currentBeatRef = useRef(currentBeat);
  const currentTimeRef = useRef(currentTime);
  const pressedRef = useRef(pressedMidiNotes);
  const palette = useMemo(() => resolvePalette(theme), [theme]);
  const paletteRef = useRef(palette);
  const intensityRef = useRef(intensity);
  const travelBeatsRef = useRef(travelBeats);
  const onKeyDownRef = useRef(onKeyDown);
  const onKeyUpRef = useRef(onKeyUp);
  const onReadyRef = useRef(onReady);
  const pendingFeedbackRef = useRef<KeyboardHitFeedback[]>([]);
  const seenFeedbackRef = useRef(new Set<string>());
  const [webglError, setWebglError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    notesRef.current = notes;
    currentBeatRef.current = currentBeat;
    currentTimeRef.current = currentTime;
    pressedRef.current = pressedMidiNotes;
    paletteRef.current = palette;
    intensityRef.current = intensity;
    travelBeatsRef.current = travelBeats;
    onKeyDownRef.current = onKeyDown;
    onKeyUpRef.current = onKeyUp;
    onReadyRef.current = onReady;
  }, [
    notes,
    currentBeat,
    currentTime,
    pressedMidiNotes,
    palette,
    intensity,
    travelBeats,
    onKeyDown,
    onKeyUp,
    onReady,
  ]);

  useEffect(() => {
    if (!feedback) return;
    const events = Array.isArray(feedback) ? feedback : [feedback];

    events.forEach((event, index) => {
      const key = String(
        event.id ??
          `${event.midi}:${event.kind}:${event.beat ?? event.time ?? index}`,
      );
      if (seenFeedbackRef.current.has(key)) return;
      seenFeedbackRef.current.add(key);
      pendingFeedbackRef.current.push(event);
    });

    if (seenFeedbackRef.current.size > 256) {
      const newest = Array.from(seenFeedbackRef.current).slice(-128);
      seenFeedbackRef.current = new Set(newest);
    }
  }, [feedback]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    let renderer: THREE.WebGLRenderer;
    try {
      if (typeof window === "undefined" || !window.WebGLRenderingContext) {
        throw new Error("WebGL is not available in this browser.");
      }
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "WebGL could not be started.";
      const failureTimer = window.setTimeout(() => setWebglError(reason), 0);
      return () => window.clearTimeout(failureTimer);
    }

    let disposed = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | undefined;
    let lastFrame = performance.now();
    let lastDisplayUpdate = -Infinity;
    let appliedTheme = "";
    let cameraShake = 0;
    let flashEnergy = 0;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.position.set(0, 8.9, 12.1);
    camera.lookAt(0, 0.1, -2.1);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.setClearAlpha(0);

    scene.background = new THREE.Color(paletteRef.current.background);
    scene.fog = new THREE.FogExp2(paletteRef.current.background, 0.042);

    const world = new THREE.Group();
    world.rotation.x = -0.018;
    scene.add(world);

    const themedMaterials: ThemeMaterial[] = [];
    const addThemedMaterial = <T extends THREE.Material & { color: THREE.Color }>(
      material: T,
      role: keyof KeyboardStagePalette,
    ) => {
      themedMaterials.push({ material, role });
      return material;
    };

    const ambientLight = new THREE.HemisphereLight(0xbcecff, 0x12051f, 1.3);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(-3.5, 8, 6);
    scene.add(keyLight);
    const primaryLight = new THREE.PointLight(
      paletteRef.current.primary,
      15,
      16,
      2,
    );
    primaryLight.position.set(-4.5, 2.3, -0.5);
    scene.add(primaryLight);
    const secondaryLight = new THREE.PointLight(
      paletteRef.current.secondary,
      13,
      15,
      2,
    );
    secondaryLight.position.set(4.5, 2.1, -2.5);
    scene.add(secondaryLight);

    const floorMaterial = addThemedMaterial(
      new THREE.MeshStandardMaterial({
        color: paletteRef.current.background,
        roughness: 0.6,
        metalness: 0.48,
        transparent: true,
        opacity: 0.94,
      }),
      "background",
    );
    const highwayFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(KEYBOARD_WIDTH + 0.55, TRAVEL_DISTANCE + 0.7),
      floorMaterial,
    );
    highwayFloor.rotation.x = -Math.PI / 2;
    highwayFloor.position.set(0, -0.035, (FAR_Z + HIT_Z) / 2);
    world.add(highwayFloor);

    const laneMaterials: THREE.MeshBasicMaterial[] = [];
    KEY_LAYOUT.forEach((key, index) => {
      const laneMaterial = addThemedMaterial(
        new THREE.MeshBasicMaterial({
          color: paletteRef.current.lane,
          transparent: true,
          opacity: key.isBlack ? 0.16 : index % 2 === 0 ? 0.085 : 0.045,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
        "lane",
      );
      laneMaterials.push(laneMaterial);
      const lane = new THREE.Mesh(
        new THREE.PlaneGeometry(key.width * (key.isBlack ? 0.74 : 0.9), 16.1),
        laneMaterial,
      );
      lane.rotation.x = -Math.PI / 2;
      lane.position.set(key.x, key.isBlack ? 0.024 : 0.008, -6.2);
      world.add(lane);
    });

    const dividerMaterial = addThemedMaterial(
      new THREE.LineBasicMaterial({
        color: paletteRef.current.lane,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
      }),
      "lane",
    );
    const dividerPositions: number[] = [];
    KEY_LAYOUT.filter((key) => !key.isBlack).forEach((key) => {
      dividerPositions.push(
        key.x - WHITE_KEY_WIDTH / 2,
        0.035,
        HIT_Z,
        key.x - WHITE_KEY_WIDTH / 2,
        0.035,
        FAR_Z,
      );
    });
    dividerPositions.push(
      KEYBOARD_WIDTH / 2,
      0.035,
      HIT_Z,
      KEYBOARD_WIDTH / 2,
      0.035,
      FAR_Z,
    );
    const dividerGeometry = new THREE.BufferGeometry();
    dividerGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(dividerPositions, 3),
    );
    world.add(new THREE.LineSegments(dividerGeometry, dividerMaterial));

    const beatLineMaterial = addThemedMaterial(
      new THREE.MeshBasicMaterial({
        color: paletteRef.current.primary,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      "primary",
    );
    const beatLines = Array.from({ length: 12 }, () => {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(KEYBOARD_WIDTH + 0.3, 0.024),
        beatLineMaterial,
      );
      line.rotation.x = -Math.PI / 2;
      line.position.y = 0.045;
      world.add(line);
      return line;
    });

    const hitMaterial = addThemedMaterial(
      new THREE.MeshStandardMaterial({
        color: paletteRef.current.primary,
        emissive: paletteRef.current.primary,
        emissiveIntensity: 4,
        roughness: 0.2,
        metalness: 0.25,
      }),
      "primary",
    );
    const hitLine = new THREE.Mesh(
      new THREE.BoxGeometry(KEYBOARD_WIDTH + 0.45, 0.09, 0.1),
      hitMaterial,
    );
    hitLine.position.set(0, 0.15, HIT_Z);
    world.add(hitLine);
    const hitHaloMaterial = addThemedMaterial(
      new THREE.MeshBasicMaterial({
        color: paletteRef.current.primary,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      "primary",
    );
    const hitHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(KEYBOARD_WIDTH + 0.8, 0.42),
      hitHaloMaterial,
    );
    hitHalo.rotation.x = -Math.PI / 2;
    hitHalo.position.set(0, 0.075, HIT_Z);
    world.add(hitHalo);

    const bodyMaterial = addThemedMaterial(
      new THREE.MeshStandardMaterial({
        color: paletteRef.current.panel,
        roughness: 0.3,
        metalness: 0.72,
      }),
      "panel",
    );
    const edgeMaterial = addThemedMaterial(
      new THREE.MeshStandardMaterial({
        color: paletteRef.current.secondary,
        emissive: paletteRef.current.secondary,
        emissiveIntensity: 0.55,
        roughness: 0.25,
        metalness: 0.75,
      }),
      "secondary",
    );
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(KEYBOARD_WIDTH + 0.9, 0.55, 5.02),
      bodyMaterial,
    );
    body.position.set(0, 0.05, 3.54);
    world.add(body);
    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.42, 5.16),
        edgeMaterial,
      );
      rail.position.set(
        side * (KEYBOARD_WIDTH / 2 + 0.38),
        0.35,
        3.5,
      );
      world.add(rail);
    });

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(KEYBOARD_WIDTH + 0.55, 0.36, 1.88),
      bodyMaterial,
    );
    deck.position.set(0, 0.35, 1.03);
    world.add(deck);

    const whiteGeometry = new THREE.BoxGeometry(
      WHITE_KEY_WIDTH - 0.035,
      0.24,
      2.72,
    );
    const blackGeometry = new THREE.BoxGeometry(0.41, 0.39, 1.64);
    const landingGeometry = new THREE.RingGeometry(0.12, 0.23, 24);
    const keyVisuals: KeyVisual[] = [];
    const keyMeshes: THREE.Mesh[] = [];

    KEY_LAYOUT.forEach((key) => {
      const keyMaterial = new THREE.MeshStandardMaterial({
        color: key.isBlack ? 0x10131d : 0xf1f4f7,
        emissive: key.isBlack ? paletteRef.current.secondary : 0x9edfff,
        emissiveIntensity: key.isBlack ? 0.08 : 0.025,
        roughness: key.isBlack ? 0.22 : 0.3,
        metalness: key.isBlack ? 0.45 : 0.08,
      });
      const keyMesh = new THREE.Mesh(
        key.isBlack ? blackGeometry : whiteGeometry,
        keyMaterial,
      );
      const baseY = key.isBlack ? 0.79 : 0.62;
      keyMesh.position.set(key.x, baseY, key.isBlack ? 2.71 : 3.55);
      keyMesh.userData.midi = key.midi;
      keyMesh.userData.isKeyboardKey = true;
      keyMesh.renderOrder = key.isBlack ? 3 : 2;
      world.add(keyMesh);
      keyMeshes.push(keyMesh);

      const landingMaterial = new THREE.MeshBasicMaterial({
        color: key.isBlack
          ? paletteRef.current.secondary
          : paletteRef.current.primary,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const landing = new THREE.Mesh(landingGeometry, landingMaterial);
      landing.rotation.x = -Math.PI / 2;
      landing.position.set(key.x, 0.19, HIT_Z - 0.03);
      landing.scale.x = key.isBlack ? 0.72 : 1;
      world.add(landing);

      if (key.midi % 12 === 0 && !key.isBlack) {
        const cMarker = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.012, 0.045),
          edgeMaterial,
        );
        cMarker.position.set(key.x, baseY + 0.13, 4.78);
        world.add(cMarker);
      }

      keyVisuals.push({
        ...key,
        mesh: keyMesh,
        material: keyMaterial,
        baseY,
        landingMaterial,
      });
    });

    const padMaterials: THREE.MeshStandardMaterial[] = [];
    for (let index = 0; index < 8; index += 1) {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const padColor = index % 2
        ? paletteRef.current.secondary
        : paletteRef.current.primary;
      const padMaterial = new THREE.MeshStandardMaterial({
        color: padColor,
        emissive: padColor,
        emissiveIntensity: 0.55,
        roughness: 0.42,
        metalness: 0.25,
      });
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.13, 0.47),
        padMaterial,
      );
      pad.position.set(-4.52 + column * 0.64, 0.61, 0.68 + row * 0.58);
      pad.rotation.y = row ? -0.018 : 0.018;
      world.add(pad);
      padMaterials.push(padMaterial);
    }

    const knobMaterial = new THREE.MeshStandardMaterial({
      color: 0x171a24,
      roughness: 0.27,
      metalness: 0.78,
    });
    const knobIndicatorMaterial = addThemedMaterial(
      new THREE.MeshBasicMaterial({ color: paletteRef.current.primary }),
      "primary",
    );
    for (let index = 0; index < 8; index += 1) {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = 2.64 + column * 0.62;
      const z = 0.69 + row * 0.58;
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.21, 0.18, 20),
        knobMaterial,
      );
      knob.position.set(x, 0.66, z);
      world.add(knob);
      const indicator = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.016, 0.16),
        knobIndicatorMaterial,
      );
      indicator.position.set(x, 0.765, z - 0.035);
      indicator.rotation.y = -0.5 + index * 0.14;
      world.add(indicator);
    }

    const touchStripMaterial = addThemedMaterial(
      new THREE.MeshStandardMaterial({
        color: paletteRef.current.secondary,
        emissive: paletteRef.current.secondary,
        emissiveIntensity: 1.3,
        roughness: 0.32,
        metalness: 0.35,
      }),
      "secondary",
    );
    [-1, 1].forEach((side) => {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.06, 1.04),
        touchStripMaterial,
      );
      strip.position.set(side < 0 ? -1.53 : 1.53, 0.57, 1.02);
      world.add(strip);
    });

    const { context: displayContext, texture: displayTexture } =
      makeTextTexture();
    const displayMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: displayTexture,
      toneMapped: false,
    });
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(1.78, 0.76),
      displayMaterial,
    );
    display.rotation.x = -Math.PI / 2;
    display.position.set(0, 0.58, 0.91);
    world.add(display);

    const buttonMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b4252,
      roughness: 0.35,
      metalness: 0.5,
    });
    [-0.63, 0, 0.63].forEach((x) => {
      const button = new THREE.Mesh(
        new THREE.BoxGeometry(0.31, 0.08, 0.23),
        buttonMaterial,
      );
      button.position.set(x, 0.6, 1.51);
      world.add(button);
    });

    const ambientParticleCount = reduceMotion
      ? 20
      : Math.round(70 + clamp(intensityRef.current, 0, 2) * 45);
    const ambientPositions = new Float32Array(ambientParticleCount * 3);
    for (let index = 0; index < ambientParticleCount; index += 1) {
      ambientPositions[index * 3] = (Math.random() - 0.5) * 13;
      ambientPositions[index * 3 + 1] = 0.5 + Math.random() * 5.5;
      ambientPositions[index * 3 + 2] = FAR_Z + Math.random() * 19;
    }
    const ambientGeometry = new THREE.BufferGeometry();
    ambientGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(ambientPositions, 3),
    );
    const ambientParticleMaterial = addThemedMaterial(
      new THREE.PointsMaterial({
        color: paletteRef.current.primary,
        size: 0.055,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
      "primary",
    );
    const ambientParticles = new THREE.Points(
      ambientGeometry,
      ambientParticleMaterial,
    );
    world.add(ambientParticles);

    const noteGeometry = new THREE.BoxGeometry(1, 1, 1);
    const noteVisuals = new Map<string | number, NoteVisual>();
    const feedbackBursts: FeedbackBurst[] = [];
    const pointerNotes = new Map<number, number>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const createNoteVisual = (note: KeyboardStageNote) => {
      const color = noteColor(note, paletteRef.current);
      const bodyMaterialForNote = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 2.4,
        roughness: 0.25,
        metalness: 0.28,
        transparent: true,
        opacity: 0.94,
      });
      const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const group = new THREE.Group();
      const glow = new THREE.Mesh(noteGeometry, glowMaterial);
      const bodyMesh = new THREE.Mesh(noteGeometry, bodyMaterialForNote);
      group.add(glow, bodyMesh);
      world.add(group);
      const visual: NoteVisual = {
        group,
        body: bodyMesh,
        glow,
        bodyMaterial: bodyMaterialForNote,
        glowMaterial,
      };
      noteVisuals.set(note.id, visual);
      return visual;
    };

    const removeNoteVisual = (id: string | number) => {
      const visual = noteVisuals.get(id);
      if (!visual) return;
      world.remove(visual.group);
      visual.bodyMaterial.dispose();
      visual.glowMaterial.dispose();
      noteVisuals.delete(id);
    };

    const createFeedbackBurst = (event: KeyboardHitFeedback) => {
      const key = KEY_LAYOUT.find((candidate) => candidate.midi === event.midi);
      if (!key) return;
      const eventIntensity = clamp(event.strength ?? 1, 0.25, 1.8);
      const miss = event.kind === "miss";
      const color = feedbackColor(event, paletteRef.current);
      const rootGroup = new THREE.Group();
      rootGroup.position.set(key.x, 0.46, HIT_Z);
      world.add(rootGroup);

      const ringMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.24, 28),
        ringMaterial,
      );
      ring.rotation.x = -Math.PI / 2;
      rootGroup.add(ring);

      const particleCount = reduceMotion
        ? 6
        : Math.round((miss ? 12 : 24) * eventIntensity);
      const positions = new Float32Array(particleCount * 3);
      const velocities = new Float32Array(particleCount * 3);
      for (let index = 0; index < particleCount; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const horizontal = 0.8 + Math.random() * 1.8;
        velocities[index * 3] = Math.cos(angle) * horizontal;
        velocities[index * 3 + 1] = 1.1 + Math.random() * 2.7;
        velocities[index * 3 + 2] = Math.sin(angle) * horizontal;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color,
        size: miss ? 0.09 : 0.13,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      rootGroup.add(points);

      const burstLight = new THREE.PointLight(
        color,
        miss ? 6 : 13 * eventIntensity,
        5,
        2,
      );
      burstLight.position.y = 0.5;
      rootGroup.add(burstLight);

      feedbackBursts.push({
        root: rootGroup,
        points,
        velocities,
        ringMaterial,
        light: burstLight,
        age: 0,
        duration: miss ? 0.65 : 0.9,
        miss,
      });
      cameraShake = Math.max(
        cameraShake,
        (miss ? 0.04 : 0.085) * eventIntensity,
      );
      flashEnergy = Math.max(flashEnergy, miss ? 0.35 : eventIntensity);
    };

    const drawDisplay = () => {
      if (!displayContext) return;
      const activeCount = KEY_LAYOUT.reduce(
        (total, key) => total + (hasMidi(pressedRef.current, key.midi) ? 1 : 0),
        0,
      );
      const activePalette = paletteRef.current;
      const gradient = displayContext.createLinearGradient(0, 0, 512, 224);
      gradient.addColorStop(0, "#03151d");
      gradient.addColorStop(1, "#0e0622");
      displayContext.fillStyle = gradient;
      displayContext.fillRect(0, 0, 512, 224);
      displayContext.strokeStyle = activePalette.primary;
      displayContext.lineWidth = 7;
      displayContext.strokeRect(8, 8, 496, 208);
      displayContext.fillStyle = activePalette.primary;
      displayContext.font = "700 31px ui-monospace, SFMono-Regular, monospace";
      displayContext.fillText("PERFORM // 25", 31, 53);
      displayContext.font = "800 61px ui-monospace, SFMono-Regular, monospace";
      displayContext.fillText(
        `B ${Math.max(0, currentBeatRef.current).toFixed(1).padStart(5, "0")}`,
        30,
        126,
      );
      displayContext.fillStyle = activeCount
        ? activePalette.success
        : "rgba(190, 220, 235, .72)";
      displayContext.font = "700 27px ui-monospace, SFMono-Regular, monospace";
      displayContext.fillText(
        activeCount ? `${activeCount} NOTE${activeCount > 1 ? "S" : ""} LIVE` : "MIDI READY",
        31,
        180,
      );
      displayTexture.needsUpdate = true;
    };

    const applyTheme = () => {
      const activePalette = paletteRef.current;
      const signature = JSON.stringify(activePalette);
      if (signature === appliedTheme) return;
      appliedTheme = signature;
      scene.background = new THREE.Color(activePalette.background);
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.set(activePalette.background);
      }
      primaryLight.color.set(activePalette.primary);
      secondaryLight.color.set(activePalette.secondary);
      themedMaterials.forEach(({ material, role }) => {
        material.color.set(activePalette[role]);
        if ("emissive" in material) {
          const emissiveMaterial = material as THREE.MeshStandardMaterial;
          if (emissiveMaterial.emissive) {
            emissiveMaterial.emissive.set(activePalette[role]);
          }
        }
        material.needsUpdate = true;
      });
      keyVisuals.forEach((key) => {
        key.material.emissive.set(
          key.isBlack ? activePalette.secondary : activePalette.whiteKeyGlow,
        );
        key.landingMaterial.color.set(
          key.isBlack ? activePalette.secondary : activePalette.primary,
        );
      });
      padMaterials.forEach((material, index) => {
        const color = index % 2
          ? activePalette.secondary
          : activePalette.primary;
        material.color.set(color);
        material.emissive.set(color);
      });
      lastDisplayUpdate = -Infinity;
    };

    const resize = () => {
      if (disposed) return;
      const width = Math.max(1, root.clientWidth);
      const height = Math.max(1, root.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 620 ? 43 : width < 900 ? 39 : 36;
      camera.position.z = width < 620 ? 13.8 : width < 900 ? 12.8 : 12.1;
      camera.position.y = width < 620 ? 9.5 : 8.9;
      camera.updateProjectionMatrix();
    };

    const hitTest = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersection = raycaster.intersectObjects(keyMeshes, false)[0];
      return intersection?.object.userData.midi as number | undefined;
    };

    const startPointerNote = (event: PointerEvent, midi: number) => {
      const previous = pointerNotes.get(event.pointerId);
      if (previous === midi) return;
      if (previous !== undefined) onKeyUpRef.current?.(previous);
      pointerNotes.set(event.pointerId, midi);
      const bounds = canvas.getBoundingClientRect();
      const vertical = (event.clientY - bounds.top) / bounds.height;
      onKeyDownRef.current?.(midi, clamp(1.04 - vertical * 0.28, 0.55, 1));
    };

    const releasePointerNote = (event: PointerEvent) => {
      const midi = pointerNotes.get(event.pointerId);
      if (midi === undefined) return;
      pointerNotes.delete(event.pointerId);
      onKeyUpRef.current?.(midi);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const midi = hitTest(event);
      if (midi === undefined) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      startPointerNote(event, midi);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerNotes.has(event.pointerId)) return;
      const midi = hitTest(event);
      if (midi !== undefined) startPointerNote(event, midi);
    };
    const handlePointerUp = (event: PointerEvent) => {
      releasePointerNote(event);
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    const handleContextLoss = (event: Event) => {
      event.preventDefault();
      setReady(false);
      setWebglError(
        "The 3D stage lost its graphics connection. Reload to restart it.",
      );
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("contextmenu", preventContextMenu);
    canvas.addEventListener("webglcontextlost", handleContextLoss);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(root);
    } else {
      window.addEventListener("resize", resize);
    }
    resize();
    drawDisplay();

    const animate = (now: number) => {
      if (disposed) return;
      const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;
      const activeIntensity = clamp(intensityRef.current, 0, 2);
      const beat = currentBeatRef.current;
      const beatFraction = ((beat % 1) + 1) % 1;
      const visibleBeats = Math.max(1, travelBeatsRef.current);
      const pressedByPointer = new Set(pointerNotes.values());

      applyTheme();

      beatLines.forEach((line, index) => {
        const deltaBeat = (1 - beatFraction) % 1 + index;
        line.position.z = HIT_Z - (deltaBeat / visibleBeats) * TRAVEL_DISTANCE;
        line.visible = line.position.z >= FAR_Z;
        line.scale.y = index % 4 === 0 ? 2.2 : 1;
      });

      const liveIds = new Set<string | number>();
      notesRef.current.forEach((note) => {
        if (note.midi < FIRST_MIDI_NOTE || note.midi >= FIRST_MIDI_NOTE + KEY_COUNT) {
          return;
        }
        liveIds.add(note.id);
        const durationBeats = Math.max(0.08, note.durationBeats ?? 0.28);
        const tailBeat = note.startBeat + durationBeats;
        const visible =
          note.startBeat <= beat + visibleBeats + 0.2 && tailBeat >= beat - 0.8;
        let visual = noteVisuals.get(note.id);
        if (!visible) {
          if (visual) visual.group.visible = false;
          return;
        }
        visual ??= createNoteVisual(note);
        visual.group.visible = true;
        const key = KEY_LAYOUT[note.midi - FIRST_MIDI_NOTE];
        const noteWidth = key.width * (key.isBlack ? 0.8 : 0.82);
        const length = Math.max(
          0.27,
          (durationBeats / visibleBeats) * TRAVEL_DISTANCE,
        );
        const headZ =
          HIT_Z - ((note.startBeat - beat) / visibleBeats) * TRAVEL_DISTANCE;
        const velocity = clamp(note.velocity ?? 0.82, 0.1, 1);
        const color = noteColor(note, paletteRef.current);
        const nearbyPress =
          (hasMidi(pressedRef.current, note.midi) ||
            pressedByPointer.has(note.midi)) &&
          Math.abs(note.startBeat - beat) < 0.35;
        const hitBoost = note.state === "hit" || nearbyPress ? 1.65 : 1;
        const missed = note.state === "missed";

        visual.group.position.set(
          key.x,
          key.isBlack ? 0.7 : 0.48,
          headZ - length / 2,
        );
        visual.body.scale.set(
          noteWidth,
          (0.12 + velocity * 0.11) * hitBoost,
          length,
        );
        visual.glow.scale.set(noteWidth * 1.45, 0.36, length + 0.22);
        visual.bodyMaterial.color.set(color);
        visual.bodyMaterial.emissive.set(color);
        visual.bodyMaterial.emissiveIntensity =
          (missed ? 0.8 : 2.25 + velocity * 1.1) * hitBoost;
        visual.bodyMaterial.opacity = missed ? 0.5 : 0.94;
        visual.glowMaterial.color.set(color);
        visual.glowMaterial.opacity =
          (missed ? 0.07 : 0.14 + activeIntensity * 0.05) * hitBoost;
      });

      noteVisuals.forEach((_, id) => {
        if (!liveIds.has(id)) removeNoteVisual(id);
      });

      keyVisuals.forEach((key, index) => {
        const active =
          hasMidi(pressedRef.current, key.midi) || pressedByPointer.has(key.midi);
        const targetY = key.baseY - (active ? 0.055 : 0);
        key.mesh.position.y += (targetY - key.mesh.position.y) * 0.32;
        key.material.emissiveIntensity +=
          ((active ? 2.8 + activeIntensity : key.isBlack ? 0.08 : 0.025) -
            key.material.emissiveIntensity) *
          0.24;
        key.landingMaterial.opacity +=
          ((active ? 0.8 : 0) - key.landingMaterial.opacity) * 0.24;
        if (active) {
          key.landingMaterial.opacity *=
            0.86 + Math.sin(now * 0.012 + index) * 0.14;
        }
      });

      while (pendingFeedbackRef.current.length) {
        const event = pendingFeedbackRef.current.shift();
        if (event) createFeedbackBurst(event);
      }

      for (let index = feedbackBursts.length - 1; index >= 0; index -= 1) {
        const burst = feedbackBursts[index];
        burst.age += deltaSeconds;
        const progress = burst.age / burst.duration;
        const positions = burst.points.geometry.attributes.position
          .array as Float32Array;
        for (let particle = 0; particle < positions.length / 3; particle += 1) {
          const offset = particle * 3;
          burst.velocities[offset + 1] -= 4.6 * deltaSeconds;
          positions[offset] += burst.velocities[offset] * deltaSeconds;
          positions[offset + 1] += burst.velocities[offset + 1] * deltaSeconds;
          positions[offset + 2] += burst.velocities[offset + 2] * deltaSeconds;
        }
        burst.points.geometry.attributes.position.needsUpdate = true;
        burst.points.material.opacity = Math.max(0, 1 - progress * progress);
        burst.ringMaterial.opacity = Math.max(0, 0.9 * (1 - progress));
        const ringScale = 1 + progress * (burst.miss ? 2 : 4.2);
        burst.root.children[0].scale.setScalar(ringScale);
        burst.light.intensity *= 0.87;

        if (progress >= 1) {
          world.remove(burst.root);
          burst.points.geometry.dispose();
          burst.points.material.dispose();
          const ring = burst.root.children[0] as THREE.Mesh;
          ring.geometry.dispose();
          burst.ringMaterial.dispose();
          burst.light.dispose();
          feedbackBursts.splice(index, 1);
        }
      }

      const ambientPositionAttribute = ambientGeometry.attributes.position;
      const ambientArray = ambientPositionAttribute.array as Float32Array;
      for (let index = 0; index < ambientParticleCount; index += 1) {
        const zIndex = index * 3 + 2;
        ambientArray[zIndex] += deltaSeconds * (0.28 + activeIntensity * 0.32);
        if (ambientArray[zIndex] > 5.2) ambientArray[zIndex] = FAR_Z;
      }
      ambientPositionAttribute.needsUpdate = true;
      ambientParticleMaterial.opacity = 0.24 + activeIntensity * 0.25;

      padMaterials.forEach((material, index) => {
        material.emissiveIntensity =
          0.35 +
          activeIntensity * 0.25 +
          Math.max(0, Math.sin(now * 0.0026 + index * 0.7)) * 0.42;
      });

      const beatPulse = Math.pow(1 - beatFraction, 5);
      hitMaterial.emissiveIntensity = 2.5 + beatPulse * (2.2 + activeIntensity);
      hitHaloMaterial.opacity =
        0.16 + beatPulse * 0.2 + Math.min(0.32, flashEnergy * 0.18);
      hitHalo.scale.y = 1 + beatPulse * 0.65;
      primaryLight.intensity = 9 + activeIntensity * 4 + flashEnergy * 11;
      secondaryLight.intensity = 8 + activeIntensity * 3;
      flashEnergy *= Math.pow(0.015, deltaSeconds);

      if (!reduceMotion) {
        camera.position.x = Math.sin(now * 0.00042) * 0.08 * activeIntensity;
        camera.position.y =
          (root.clientWidth < 620 ? 9.5 : 8.9) +
          Math.sin(now * 0.00031) * 0.035 * activeIntensity;
        if (cameraShake > 0.001) {
          camera.position.x += (Math.random() - 0.5) * cameraShake;
          camera.position.y += (Math.random() - 0.5) * cameraShake;
          cameraShake *= Math.pow(0.02, deltaSeconds);
        }
        camera.lookAt(0, 0.1, -2.1);
      }

      if (now - lastDisplayUpdate > 180) {
        drawDisplay();
        lastDisplayUpdate = now;
      }

      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const statusTimer = window.setTimeout(() => {
      if (disposed) return;
      setWebglError(null);
      setReady(true);
      onReadyRef.current?.();
    }, 0);
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.clearTimeout(statusTimer);
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("contextmenu", preventContextMenu);
      canvas.removeEventListener("webglcontextlost", handleContextLoss);
      pointerNotes.forEach((midi) => onKeyUpRef.current?.(midi));
      disposeObject(scene);
      noteGeometry.dispose();
      whiteGeometry.dispose();
      blackGeometry.dispose();
      landingGeometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  const rootStyle: StageStyle = {
    "--kh-primary": palette.primary,
    "--kh-secondary": palette.secondary,
    "--kh-success": palette.success,
    "--kh-miss": palette.miss,
    "--kh-background": palette.background,
    ...style,
  };
  const activeNotes = notes.reduce(
    (total, note) =>
      total +
      (note.startBeat <= currentBeat &&
      note.startBeat + (note.durationBeats ?? 0.28) >= currentBeat
        ? 1
        : 0),
    0,
  );

  return (
    <div
      ref={rootRef}
      className={`kh-stage ${className}`.trim()}
      style={rootStyle}
      aria-busy={!ready && !webglError}
    >
      <canvas
        ref={canvasRef}
        className="kh-stage__canvas"
        tabIndex={0}
        aria-label={ariaLabel}
      />

      <div className="kh-stage__atmosphere" aria-hidden="true" />
      <div className="kh-stage__scanlines" aria-hidden="true" />

      {showHud && !webglError && (
        <div className="kh-stage__hud" aria-hidden="true">
          <div className="kh-stage__identity">
            <span className="kh-stage__live-dot" />
            <span>PERFORMANCE STAGE</span>
            <span className="kh-stage__divider">/</span>
            <strong>25 KEY</strong>
          </div>
          <div className="kh-stage__metrics">
            <span>
              BEAT <strong>{Math.max(0, currentBeat).toFixed(1)}</strong>
            </span>
            <span>
              TIME <strong>{Math.max(0, currentTime).toFixed(1)}s</strong>
            </span>
            <span className={activeNotes ? "is-active" : ""}>
              {activeNotes ? `${activeNotes} LIVE` : "C3 — C5"}
            </span>
          </div>
          <div className="kh-stage__hint">
            <span className="kh-stage__hint-line" />
            Notes meet the light bar on the beat
          </div>
        </div>
      )}

      {!ready && !webglError && (
        <div className="kh-stage__loading" role="status">
          <span />
          Lighting the stage…
        </div>
      )}

      {webglError && (
        <div className="kh-stage__fallback" role="status">
          <div className="kh-stage__fallback-keys" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
          <p className="kh-stage__fallback-kicker">2D PRACTICE MODE</p>
          <h3>The 3D stage needs WebGL</h3>
          <p>
            Your song controls can keep working, but this browser cannot draw
            the performance highway. Enable hardware acceleration or try a
            current browser, then reload.
          </p>
          <small>{webglError}</small>
        </div>
      )}
    </div>
  );
}
