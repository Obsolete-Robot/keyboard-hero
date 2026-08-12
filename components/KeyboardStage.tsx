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
// The strike zone sits a full key-depth above the controller deck so timing is
// readable before a note reaches the physical key.
const HIT_Z = -0.72;
const FAR_Z = -19.5;
const TRAVEL_DISTANCE = HIT_Z - FAR_Z;
const POST_HIT_BEATS = 1.45;
const NOTE_GAP_MIN = 0.055;
const AIM_SPARK_COUNT = 16;
const AIM_RENDER_ORDER = 1200;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export type KeyboardNoteState =
  | "upcoming"
  | "active"
  | "hit"
  | "missed";
export type KeyboardFinger = 1 | 2 | 3 | 4 | 5;
export type KeyboardStageHand = "left" | "right";

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
  /** Optional authoritative sustain completion, from 0 to 1. */
  holdProgress?: number;
  /** Optional per-note color override as any Three.js-compatible CSS color. */
  color?: string;
  hand?: KeyboardStageHand;
  /** Piano fingering: 1 is thumb and 5 is pinky. */
  finger?: KeyboardFinger;
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
  powerActivation?: boolean;
}

export interface KeyboardStagePowerState {
  charge: number;
  active: boolean;
  progress: number;
  remainingBeats: number;
  durationBeats: number;
  multiplier: number;
  energy: number;
  activations: number;
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
  /** Earned combo-energy state. Power Mode remains controlled by the game engine. */
  power?: KeyboardStagePowerState;
  /** Number of upcoming beats visible on the highway. */
  travelBeats?: number;
  /** Restricts the visible suggested-fingering rows when a lesson knows its hands. */
  fingeringHands?: readonly KeyboardStageHand[];
  showHud?: boolean;
  /** Short label centered over the timing target. */
  strikeLabel?: string;
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
  laneColor: string;
  laneMaterial: THREE.MeshBasicMaterial;
  landingMaterial: THREE.MeshBasicMaterial;
}

interface NoteVisual {
  group: THREE.Group;
  body: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>;
  glow: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshBasicMaterial>;
  flare: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshBasicMaterial>;
  outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  headCap: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  tailCap: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  bodyMaterial: THREE.MeshStandardMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
  flareMaterial: THREE.MeshBasicMaterial;
  outlineMaterial: THREE.LineBasicMaterial;
  capMaterial: THREE.MeshBasicMaterial;
  fingerLabel?: THREE.Sprite;
  fingerLabelMaterial?: THREE.SpriteMaterial;
  fingerLabelTexture?: THREE.CanvasTexture;
}

type AimMarkerTone = "held" | "matched" | "miss";

interface AimMarkerVisual {
  midi: number;
  group: THREE.Group;
  whiteRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  colorRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  core: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  sparkSeeds: Float32Array;
  sparkColors: THREE.BufferAttribute;
  tone: AimMarkerTone | null;
}

interface FeedbackBurst {
  root: THREE.Group;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  echoRing?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shockwave?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  streaks?: THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >;
  fracture?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
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

const DEFAULT_POWER_STATE: KeyboardStagePowerState = {
  charge: 0,
  active: false,
  progress: 0,
  remainingBeats: 0,
  durationBeats: 8,
  multiplier: 1,
  energy: 0,
  activations: 0,
};

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

function makeRoundedNoteGeometry() {
  const radius = 0.16;
  const half = 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.quadraticCurveTo(half, -half, half, -half + radius);
  shape.lineTo(half, half - radius);
  shape.quadraticCurveTo(half, half, half - radius, half);
  shape.lineTo(-half + radius, half);
  shape.quadraticCurveTo(-half, half, -half, half - radius);
  shape.lineTo(-half, -half + radius);
  shape.quadraticCurveTo(-half, -half, -half + radius, -half);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    // Depth plus the two 0.025 bevel shoulders stays exactly one unit, so
    // scaling cannot eat the authored gap between adjacent notes.
    depth: 0.95,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    curveSegments: 5,
  });
  geometry.translate(0, 0, -0.475);
  geometry.computeVertexNormals();
  return geometry;
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
const HIT_BAR_WIDTH = KEYBOARD_WIDTH + 0.42;
const KEY_LANE_COLORS = [
  "#35e8ff",
  "#3da9ff",
  "#536cff",
  "#8255ff",
  "#b94ff5",
  "#e94bd2",
  "#ff4b9a",
  "#ff5268",
  "#ff7047",
  "#ffa23d",
  "#ffd13f",
  "#dbea48",
  "#9bea50",
  "#55e878",
  "#35dda8",
  "#31d4d2",
  "#3abbe9",
  "#438cf6",
  "#665eea",
  "#9853dd",
  "#ca4ebc",
  "#ef518e",
  "#fa6260",
  "#f58f49",
  "#e8c84c",
] as const;

function laneColor(midi: number) {
  const index = midi - FIRST_MIDI_NOTE;
  return KEY_LANE_COLORS[index] ?? "#7cecff";
}

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
  return laneColor(note.midi);
}

type GuideHand = KeyboardStageHand;

interface FingerGuideTarget {
  hand: GuideHand;
  finger: KeyboardFinger;
  state: "active" | "upcoming";
}

const FINGER_NAMES: Readonly<Record<KeyboardFinger, string>> = {
  1: "Thumb",
  2: "Index",
  3: "Middle",
  4: "Ring",
  5: "Pinky",
};

const FINGER_ABBREVIATIONS: Readonly<Record<KeyboardFinger, string>> = {
  1: "T",
  2: "I",
  3: "M",
  4: "R",
  5: "P",
};

const FINGERS_BY_HAND: Readonly<Record<GuideHand, readonly KeyboardFinger[]>> = {
  left: [5, 4, 3, 2, 1],
  right: [1, 2, 3, 4, 5],
};

function authoredFingeringForNote(
  note: KeyboardStageNote,
): { hand: GuideHand; finger: KeyboardFinger } | null {
  if (
    (note.hand !== "left" && note.hand !== "right") ||
    note.finger === undefined ||
    !Number.isInteger(note.finger) ||
    note.finger < 1 ||
    note.finger > 5
  ) {
    return null;
  }
  return { hand: note.hand, finger: note.finger };
}

function makeFingerLabelTexture(hand: GuideHand, finger: KeyboardFinger) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (!context) return texture;

  context.fillStyle = "rgba(3, 9, 22, 0.82)";
  context.strokeStyle = "rgba(255, 255, 255, 0.94)";
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(5, 5, 118, 70, 18);
  context.fill();
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "700 34px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`${hand === "left" ? "L" : "R"}${finger}`, 64, 41);
  texture.needsUpdate = true;
  return texture;
}

function feedbackColor(
  feedback: KeyboardHitFeedback,
  palette: KeyboardStagePalette,
) {
  if (feedback.kind === "miss") return palette.miss;
  return laneColor(feedback.midi);
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
  power = DEFAULT_POWER_STATE,
  travelBeats = 8,
  fingeringHands,
  showHud = true,
  strikeLabel = "PLAY HERE",
  className = "",
  style,
  ariaLabel = "Interactive 3D 25-key Keyboard Hero performance stage",
  onKeyDown,
  onKeyUp,
  onReady,
}: KeyboardStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const strikeZoneRef = useRef<HTMLDivElement>(null);
  const nextNoteStartById = useMemo(() => {
    const byMidi = new Map<number, KeyboardStageNote[]>();
    notes.forEach((note) => {
      const laneNotes = byMidi.get(note.midi) ?? [];
      laneNotes.push(note);
      byMidi.set(note.midi, laneNotes);
    });
    const result = new Map<string | number, number>();
    byMidi.forEach((laneNotes) => {
      laneNotes.sort((left, right) => left.startBeat - right.startBeat);
      let nextDistinctStart: number | undefined;
      for (let end = laneNotes.length - 1; end >= 0; ) {
        const groupStartBeat = laneNotes[end].startBeat;
        let begin = end;
        while (
          begin > 0 &&
          Math.abs(laneNotes[begin - 1].startBeat - groupStartBeat) <= 1e-6
        ) {
          begin -= 1;
        }
        if (nextDistinctStart !== undefined) {
          for (let index = begin; index <= end; index += 1) {
            result.set(laneNotes[index].id, nextDistinctStart);
          }
        }
        nextDistinctStart = groupStartBeat;
        end = begin - 1;
      }
    });
    return result;
  }, [notes]);
  const fingerGuide = useMemo(() => {
    const presentHands = new Set<GuideHand>();
    const targets = new Map<string, FingerGuideTarget>();
    const authoredNotes = notes.flatMap((note) => {
      const fingering = authoredFingeringForNote(note);
      return fingering ? [{ note, ...fingering }] : [];
    });
    authoredNotes.forEach(({ hand }) => presentHands.add(hand));
    const hands = fingeringHands
      ? ([...new Set(fingeringHands)] as GuideHand[]).filter(
          (hand): hand is GuideHand => hand === "left" || hand === "right",
        )
      : (["left", "right"] as const).filter((hand) =>
          presentHands.has(hand),
        );
    const nextStartBeat = authoredNotes.reduce<number | null>(
      (next, { note }) =>
        note.startBeat > currentBeat + 0.000_001 &&
        (next === null || note.startBeat < next)
          ? note.startBeat
          : next,
      null,
    );

    authoredNotes.forEach(({ note, hand, finger }) => {
      if (!hands.includes(hand)) return;
      const isActive =
        note.startBeat <= currentBeat &&
        note.startBeat + (note.durationBeats ?? 0.28) >= currentBeat;
      const isUpcoming =
        !isActive &&
        nextStartBeat !== null &&
        Math.abs(note.startBeat - nextStartBeat) <= 1e-6;
      if (!isActive && !isUpcoming) return;
      const key = `${hand}:${finger}`;
      const previous = targets.get(key);
      if (!previous || (isActive && previous.state !== "active")) {
        targets.set(key, {
          hand,
          finger,
          state: isActive ? "active" : "upcoming",
        });
      }
    });

    return { hands, targets: [...targets.values()] };
  }, [currentBeat, fingeringHands, notes]);
  const fingerGuideLabel = useMemo(() => {
    if (fingerGuide.hands.length === 0) return "No finger targets are available.";
    const targets = [...fingerGuide.targets]
      .sort((left, right) =>
        left.hand === right.hand
          ? left.hand === "left"
            ? right.finger - left.finger
            : left.finger - right.finger
          : left.hand === "left"
            ? -1
            : 1,
      )
      .map(
        (target) =>
          `${target.hand} hand ${target.finger} ${target.state}`,
      );
    return targets.length
      ? `Suggested fingering: ${targets.join(", ")}.`
      : `Suggested fingering ready for ${fingerGuide.hands.join(" and ")} hand.`;
  }, [fingerGuide]);
  const notesRef = useRef(notes);
  const nextNoteStartRef = useRef(nextNoteStartById);
  const currentBeatRef = useRef(currentBeat);
  const currentTimeRef = useRef(currentTime);
  const pressedRef = useRef(pressedMidiNotes);
  const palette = useMemo(() => resolvePalette(theme), [theme]);
  const paletteRef = useRef(palette);
  const intensityRef = useRef(intensity);
  const powerRef = useRef(power);
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
    nextNoteStartRef.current = nextNoteStartById;
    currentBeatRef.current = currentBeat;
    currentTimeRef.current = currentTime;
    pressedRef.current = pressedMidiNotes;
    paletteRef.current = palette;
    intensityRef.current = intensity;
    powerRef.current = power;
    travelBeatsRef.current = travelBeats;
    onKeyDownRef.current = onKeyDown;
    onKeyUpRef.current = onKeyUp;
    onReadyRef.current = onReady;
  }, [
    notes,
    nextNoteStartById,
    currentBeat,
    currentTime,
    pressedMidiNotes,
    palette,
    intensity,
    power,
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
    let cameraKick = 0;
    let flashEnergy = 0;
    let powerSurge = 0;
    let lastPowerActivation = powerRef.current.activations;
    let viewportWidth = 1;
    let viewportHeight = 1;
    let cameraTargetY = 0.1;
    let strikeProjectionDirty = true;
    let lastStrikeX = Number.NaN;
    let lastStrikeY = Number.NaN;
    let lastStrikeWidth = Number.NaN;
    let lastStrikeAngle = Number.NaN;
    const lastProjectedCameraPosition = new THREE.Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const lastProjectedCameraQuaternion = new THREE.Quaternion(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;
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
      const laneMaterial = new THREE.MeshBasicMaterial({
        color: laneColor(key.midi),
        transparent: true,
        opacity: key.isBlack ? 0.115 : index % 2 === 0 ? 0.072 : 0.052,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      laneMaterials.push(laneMaterial);
      const lane = new THREE.Mesh(
        new THREE.PlaneGeometry(
          key.width * (key.isBlack ? 0.74 : 0.9),
          TRAVEL_DISTANCE - 0.35,
        ),
        laneMaterial,
      );
      lane.rotation.x = -Math.PI / 2;
      lane.position.set(
        key.x,
        key.isBlack ? 0.024 : 0.008,
        (FAR_Z + HIT_Z) / 2,
      );
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
        emissiveIntensity: 6,
        roughness: 0.12,
        metalness: 0.15,
      }),
      "primary",
    );
    const hitLine = new THREE.Mesh(
      new THREE.BoxGeometry(HIT_BAR_WIDTH, 0.055, 0.055),
      hitMaterial,
    );
    hitLine.position.set(0, 0.17, HIT_Z);
    world.add(hitLine);
    const hitHaloMaterial = addThemedMaterial(
      new THREE.MeshBasicMaterial({
        color: paletteRef.current.primary,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      "primary",
    );
    const hitHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(KEYBOARD_WIDTH + 0.62, 0.15),
      hitHaloMaterial,
    );
    hitHalo.rotation.x = -Math.PI / 2;
    hitHalo.position.set(0, 0.105, HIT_Z);
    world.add(hitHalo);

    const hitSweepMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hitSweep = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.13),
      hitSweepMaterial,
    );
    hitSweep.rotation.x = -Math.PI / 2;
    hitSweep.position.set(-KEYBOARD_WIDTH / 2, 0.125, HIT_Z);
    world.add(hitSweep);

    const powerSurgeMaterial = new THREE.MeshBasicMaterial({
      color: paletteRef.current.success,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const powerSurgeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.54, 0.68, 64),
      powerSurgeMaterial,
    );
    powerSurgeRing.rotation.x = -Math.PI / 2;
    powerSurgeRing.position.set(0, 0.13, HIT_Z - 0.02);
    powerSurgeRing.visible = false;
    world.add(powerSurgeRing);

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

    KEY_LAYOUT.forEach((key, index) => {
      const pitchColor = laneColor(key.midi);
      const keyMaterial = new THREE.MeshStandardMaterial({
        color: key.isBlack ? 0x10131d : 0xf1f4f7,
        emissive: pitchColor,
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
        color: pitchColor,
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
        laneColor: pitchColor,
        laneMaterial: laneMaterials[index],
        landingMaterial,
      });
    });

    const aimWhiteRingGeometry = new THREE.RingGeometry(0.115, 0.205, 40);
    const aimColorRingGeometry = new THREE.RingGeometry(0.21, 0.29, 40);
    const aimCoreGeometry = new THREE.CircleGeometry(0.047, 24);
    const aimMarkers: AimMarkerVisual[] = KEY_LAYOUT.map((key, keyIndex) => {
      const group = new THREE.Group();
      group.name = `held-aim-${key.midi}`;
      group.position.set(key.x, 0.19, HIT_Z);
      group.visible = false;

      const whiteMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const whiteRing = new THREE.Mesh(aimWhiteRingGeometry, whiteMaterial);
      whiteRing.name = "held-aim-white-ring";
      whiteRing.rotation.x = -Math.PI / 2;
      whiteRing.renderOrder = AIM_RENDER_ORDER + 2;
      whiteRing.frustumCulled = false;
      group.add(whiteRing);

      const colorMaterial = new THREE.MeshBasicMaterial({
        color: laneColor(key.midi),
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const colorRing = new THREE.Mesh(aimColorRingGeometry, colorMaterial);
      colorRing.name = "held-aim-color-ring";
      colorRing.rotation.x = -Math.PI / 2;
      colorRing.position.y = -0.008;
      colorRing.renderOrder = AIM_RENDER_ORDER + 1;
      colorRing.frustumCulled = false;
      group.add(colorRing);

      const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const core = new THREE.Mesh(aimCoreGeometry, coreMaterial);
      core.name = "held-aim-core";
      core.rotation.x = -Math.PI / 2;
      core.position.y = 0.006;
      core.renderOrder = AIM_RENDER_ORDER + 3;
      core.frustumCulled = false;
      group.add(core);

      const sparkPositions = new Float32Array(AIM_SPARK_COUNT * 3);
      const sparkColorValues = new Float32Array(AIM_SPARK_COUNT * 3);
      const sparkSeeds = new Float32Array(AIM_SPARK_COUNT * 3);
      for (let index = 0; index < AIM_SPARK_COUNT; index += 1) {
        const offset = index * 3;
        sparkSeeds[offset] =
          (index / AIM_SPARK_COUNT) * Math.PI * 2 + keyIndex * 0.31;
        sparkSeeds[offset + 1] = ((index * 7 + keyIndex * 3) % 17) / 17;
        sparkSeeds[offset + 2] = 0.72 + ((index * 5 + keyIndex) % 9) / 12;
        new THREE.Color(index % 2 === 0 ? 0xffffff : laneColor(key.midi)).toArray(
          sparkColorValues,
          offset,
        );
      }
      const sparkGeometry = new THREE.BufferGeometry();
      sparkGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(sparkPositions, 3),
      );
      const sparkColors = new THREE.BufferAttribute(sparkColorValues, 3);
      sparkGeometry.setAttribute("color", sparkColors);
      const sparkMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        vertexColors: true,
        size: 0.065,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false,
      });
      const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
      sparks.name = "held-aim-sparks";
      sparks.renderOrder = AIM_RENDER_ORDER + 4;
      sparks.frustumCulled = false;
      group.add(sparks);

      world.add(group);
      return {
        midi: key.midi,
        group,
        whiteRing,
        colorRing,
        core,
        sparks,
        sparkSeeds,
        sparkColors,
        tone: null,
      };
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

    const ambientParticleCount = Math.round(
      70 + clamp(intensityRef.current, 0, 2) * 45,
    );
    const ambientPositions = new Float32Array(ambientParticleCount * 3);
    for (let index = 0; index < ambientParticleCount; index += 1) {
      ambientPositions[index * 3] = (Math.random() - 0.5) * 13;
      ambientPositions[index * 3 + 1] = 0.5 + Math.random() * 5.5;
      ambientPositions[index * 3 + 2] =
        FAR_Z + Math.random() * (5.2 - FAR_Z);
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
    ambientParticles.visible = !reduceMotion;
    world.add(ambientParticles);

    const noteGeometry = makeRoundedNoteGeometry();
    const noteOutlineGeometry = new THREE.EdgesGeometry(noteGeometry, 28);
    const noteCapGeometry = new THREE.CircleGeometry(0.5, 28);
    const noteVisuals = new Map<string | number, NoteVisual>();
    const feedbackBursts: FeedbackBurst[] = [];
    const successFlare = new Float32Array(KEY_COUNT);
    const missFlare = new Float32Array(KEY_COUNT);
    const matchedHoldStrength = new Float32Array(KEY_COUNT);
    const pointerNotes = new Map<number, number>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const strikeCenter = new THREE.Vector3();
    const strikeLeft = new THREE.Vector3();
    const strikeRight = new THREE.Vector3();

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
      const flareMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const capMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const fingering = authoredFingeringForNote(note);
      const fingerLabelTexture = fingering
        ? makeFingerLabelTexture(fingering.hand, fingering.finger)
        : undefined;
      const fingerLabelMaterial = fingerLabelTexture
        ? new THREE.SpriteMaterial({
            map: fingerLabelTexture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        : undefined;
      const group = new THREE.Group();
      const glow = new THREE.Mesh(noteGeometry, glowMaterial);
      const flare = new THREE.Mesh(noteGeometry, flareMaterial);
      const bodyMesh = new THREE.Mesh(noteGeometry, bodyMaterialForNote);
      const outline = new THREE.LineSegments(
        noteOutlineGeometry,
        outlineMaterial,
      );
      const headCap = new THREE.Mesh(noteCapGeometry, capMaterial);
      const tailCap = new THREE.Mesh(noteCapGeometry, capMaterial);
      const fingerLabel = fingerLabelMaterial
        ? new THREE.Sprite(fingerLabelMaterial)
        : undefined;
      flare.renderOrder = 17;
      glow.renderOrder = 18;
      bodyMesh.renderOrder = 20;
      outline.renderOrder = 23;
      headCap.renderOrder = 24;
      tailCap.renderOrder = 24;
      if (fingerLabel) {
        fingerLabel.renderOrder = 30;
        fingerLabel.scale.set(0.58, 0.36, 1);
      }
      group.add(flare, glow, bodyMesh, outline, headCap, tailCap);
      if (fingerLabel) group.add(fingerLabel);
      world.add(group);
      const visual: NoteVisual = {
        group,
        body: bodyMesh,
        glow,
        flare,
        outline,
        headCap,
        tailCap,
        bodyMaterial: bodyMaterialForNote,
        glowMaterial,
        flareMaterial,
        outlineMaterial,
        capMaterial,
        fingerLabel,
        fingerLabelMaterial,
        fingerLabelTexture,
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
      visual.flareMaterial.dispose();
      visual.outlineMaterial.dispose();
      visual.capMaterial.dispose();
      visual.fingerLabelMaterial?.dispose();
      visual.fingerLabelTexture?.dispose();
      noteVisuals.delete(id);
    };

    const createFeedbackBurst = (event: KeyboardHitFeedback) => {
      const key = KEY_LAYOUT.find((candidate) => candidate.midi === event.midi);
      if (!key) return;
      const miss = event.kind === "miss";
      const gradeBoost =
        event.kind === "perfect" ? 1.46 : event.kind === "great" ? 1.2 : 0.96;
      const powerBoost = powerRef.current.active
        ? 1 + clamp(powerRef.current.energy, 0, 1) * 0.38
        : 1;
      const eventIntensity = clamp(
        (event.strength ?? 1) *
          (miss ? 0.75 : gradeBoost) *
          powerBoost *
          (event.powerActivation ? 1.2 : 1),
        0.25,
        2.2,
      );
      const keyIndex = event.midi - FIRST_MIDI_NOTE;
      const color = feedbackColor(event, paletteRef.current);
      if (miss) {
        missFlare[keyIndex] = Math.max(missFlare[keyIndex], eventIntensity);
      } else {
        successFlare[keyIndex] = Math.max(
          successFlare[keyIndex],
          eventIntensity,
        );
      }
      const rootGroup = new THREE.Group();
      rootGroup.position.set(key.x, 0.46, HIT_Z);
      world.add(rootGroup);

      const ringMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: miss ? 0.62 : 0.98,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.13, miss ? 0.2 : 0.25, 32),
        ringMaterial,
      );
      ring.rotation.x = -Math.PI / 2;
      rootGroup.add(ring);

      let echoRing:
        | THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
        | undefined;
      if (!miss) {
        const echoRingMaterial = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.78,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        echoRing = new THREE.Mesh(
          new THREE.RingGeometry(0.29, 0.35, 44),
          echoRingMaterial,
        );
        echoRing.rotation.x = -Math.PI / 2;
        echoRing.position.y = 0.018;
        rootGroup.add(echoRing);
      }

      let shockwave:
        | THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
        | undefined;
      if (!miss && !reduceMotion) {
        const shockwaveMaterial = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        shockwave = new THREE.Mesh(
          new THREE.RingGeometry(0.22, 0.3, 40),
          shockwaveMaterial,
        );
        shockwave.rotation.x = -Math.PI / 2;
        shockwave.position.y = -0.04;
        rootGroup.add(shockwave);
      }

      let streaks:
        | THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
        | undefined;
      if (!miss && !reduceMotion) {
        const streakCount = Math.round(
          (event.kind === "perfect" ? 20 : 13) * eventIntensity,
        );
        const streakPositions = new Float32Array(streakCount * 6);
        const streakColors = new Float32Array(streakCount * 6);
        const streakPalette = [
          new THREE.Color(color),
          new THREE.Color(0xffffff),
          new THREE.Color(paletteRef.current.secondary),
          new THREE.Color(paletteRef.current.success),
          new THREE.Color(laneColor(event.midi + 1)),
        ];
        for (let index = 0; index < streakCount; index += 1) {
          const offset = index * 6;
          const angle = Math.random() * Math.PI * 2;
          const inner = 0.05 + Math.random() * 0.12;
          const outer = 0.42 + Math.random() * 1.18 * eventIntensity;
          streakPositions[offset] = Math.cos(angle) * inner;
          streakPositions[offset + 1] = Math.random() * 0.14;
          streakPositions[offset + 2] = Math.sin(angle) * inner;
          streakPositions[offset + 3] = Math.cos(angle) * outer;
          streakPositions[offset + 4] = 0.12 + Math.random() * 0.62;
          streakPositions[offset + 5] = Math.sin(angle) * outer;
          const streakColor = streakPalette[index % streakPalette.length];
          streakColor.toArray(streakColors, offset);
          streakColor.toArray(streakColors, offset + 3);
        }
        const streakGeometry = new THREE.BufferGeometry();
        streakGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(streakPositions, 3),
        );
        streakGeometry.setAttribute(
          "color",
          new THREE.BufferAttribute(streakColors, 3),
        );
        const streakMaterial = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
        rootGroup.add(streaks);
      }

      let fracture:
        | THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
        | undefined;
      if (miss && !reduceMotion) {
        const fracturePositions: number[] = [];
        for (let index = 0; index < 11; index += 1) {
          const angle = (index / 11) * Math.PI * 2 + Math.random() * 0.25;
          const innerRadius = 0.08 + Math.random() * 0.08;
          const outerRadius = 0.34 + Math.random() * 0.42;
          fracturePositions.push(
            Math.cos(angle) * innerRadius,
            Math.random() * 0.08,
            Math.sin(angle) * innerRadius,
            Math.cos(angle) * outerRadius,
            Math.random() * 0.16 - 0.04,
            Math.sin(angle) * outerRadius,
          );
        }
        const fractureGeometry = new THREE.BufferGeometry();
        fractureGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(fracturePositions, 3),
        );
        const fractureMaterial = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
        });
        fracture = new THREE.LineSegments(
          fractureGeometry,
          fractureMaterial,
        );
        rootGroup.add(fracture);
      }

      const particleCount = reduceMotion
        ? 0
        : Math.round(
            (miss ? 18 : event.kind === "perfect" ? 92 : 68) *
              eventIntensity,
          );
      const positions = new Float32Array(particleCount * 3);
      const velocities = new Float32Array(particleCount * 3);
      const particleColors = new Float32Array(particleCount * 3);
      const sparkPalette = miss
        ? [new THREE.Color(color), new THREE.Color(0xffb0c2)]
        : [
            new THREE.Color(color),
            new THREE.Color(0xffffff),
            new THREE.Color(paletteRef.current.secondary),
            new THREE.Color(paletteRef.current.success),
            new THREE.Color(laneColor(event.midi - 1)),
            new THREE.Color(laneColor(event.midi + 1)),
          ];
      for (let index = 0; index < particleCount; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const horizontal = miss
          ? 0.25 + Math.random() * 0.95
          : 1.2 + Math.random() * 3.4;
        positions[index * 3] = (Math.random() - 0.5) * 0.08;
        positions[index * 3 + 1] = Math.random() * 0.08;
        positions[index * 3 + 2] = (Math.random() - 0.5) * 0.08;
        velocities[index * 3] = Math.cos(angle) * horizontal;
        velocities[index * 3 + 1] = miss
          ? 0.15 + Math.random() * 0.85
          : 1.5 + Math.random() * 4.2;
        velocities[index * 3 + 2] = Math.sin(angle) * horizontal;
        sparkPalette[index % sparkPalette.length].toArray(
          particleColors,
          index * 3,
        );
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(particleColors, 3),
      );
      const material = new THREE.PointsMaterial({
        color: 0xffffff,
        vertexColors: true,
        size: miss ? 0.17 : event.kind === "perfect" ? 0.125 : 0.11,
        transparent: true,
        opacity: miss ? 0.58 : 1,
        blending: miss ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      rootGroup.add(points);

      const burstLight = new THREE.PointLight(
        color,
        miss ? 4 : 25 * eventIntensity,
        miss ? 3.5 : 6.5,
        2,
      );
      burstLight.position.y = 0.5;
      rootGroup.add(burstLight);

      feedbackBursts.push({
        root: rootGroup,
        points,
        velocities,
        ring,
        echoRing,
        shockwave,
        streaks,
        fracture,
        light: burstLight,
        age: 0,
        duration: reduceMotion ? 0.38 : miss ? 0.56 : 1.16,
        miss,
      });
      if (!reduceMotion) {
        cameraShake = Math.max(
          cameraShake,
          (miss ? 0.035 : event.kind === "perfect" ? 0.145 : 0.11) *
            eventIntensity,
        );
        if (!miss) cameraKick = Math.max(cameraKick, eventIntensity * 0.18);
      }
      flashEnergy = Math.max(flashEnergy, miss ? 0.22 : eventIntensity * 1.3);
      if (event.powerActivation && !reduceMotion) powerSurge = 1;
    };

    const setAimMarkerTone = (
      marker: AimMarkerVisual,
      tone: AimMarkerTone,
    ) => {
      if (marker.tone === tone) return;
      marker.tone = tone;
      const lane = new THREE.Color(laneColor(marker.midi));
      const accent = new THREE.Color(
        tone === "miss"
          ? paletteRef.current.miss
          : tone === "matched"
            ? paletteRef.current.success
            : laneColor(marker.midi),
      );
      marker.colorRing.material.color.copy(
        tone === "matched" ? lane : accent,
      );
      const colors = marker.sparkColors.array as Float32Array;
      for (let index = 0; index < AIM_SPARK_COUNT; index += 1) {
        const color =
          index % 3 === 0
            ? new THREE.Color(0xffffff)
            : index % 3 === 1
              ? accent
              : lane;
        color.toArray(colors, index * 3);
      }
      marker.sparkColors.needsUpdate = true;
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
        key.material.emissive.set(key.laneColor);
        key.landingMaterial.color.set(key.laneColor);
        key.laneMaterial.color.set(key.laneColor);
      });
      aimMarkers.forEach((marker) => {
        marker.tone = null;
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
      viewportWidth = width;
      viewportHeight = height;
      strikeProjectionDirty = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 620 ? 43 : width < 900 ? 39 : 36;
      camera.position.z = width < 620 ? 13.8 : width < 900 ? 12.8 : 12.1;
      camera.position.y = width < 620 ? 9.5 : 8.9;
      cameraTargetY = width >= 620 && width < 900 ? 0.7 : 0.1;
      camera.lookAt(0, cameraTargetY, -2.1);
      camera.updateProjectionMatrix();
    };

    const handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      ambientParticles.visible = !reduceMotion;
      if (!reduceMotion) return;

      cameraShake = 0;
      cameraKick = 0;
      powerSurge = 0;
      powerSurgeRing.visible = false;
      powerSurgeMaterial.opacity = 0;
      hitSweep.position.x = 0;
      hitSweepMaterial.opacity = 0.1;
      feedbackBursts.forEach((burst) => {
        burst.points.visible = false;
        if (burst.shockwave) burst.shockwave.visible = false;
        if (burst.streaks) burst.streaks.visible = false;
        if (burst.fracture) burst.fracture.visible = false;
      });
      aimMarkers.forEach((marker) => {
        marker.group.scale.setScalar(1);
        const positions = marker.sparks.geometry.attributes.position
          .array as Float32Array;
        for (let spark = 0; spark < AIM_SPARK_COUNT; spark += 1) {
          const offset = spark * 3;
          const angle = marker.sparkSeeds[offset];
          const progress = marker.sparkSeeds[offset + 1];
          const radius = 0.12 + progress * 0.18;
          positions[offset] = Math.cos(angle) * radius;
          positions[offset + 1] = 0.025 + progress * 0.14;
          positions[offset + 2] = Math.sin(angle) * radius * 0.72;
        }
        marker.sparks.geometry.attributes.position.needsUpdate = true;
      });

      const baseCameraZ =
        viewportWidth < 620 ? 13.8 : viewportWidth < 900 ? 12.8 : 12.1;
      camera.position.set(0, viewportWidth < 620 ? 9.5 : 8.9, baseCameraZ);
      camera.lookAt(0, cameraTargetY, -2.1);
      strikeProjectionDirty = true;
    };

    const updateStrikeZoneProjection = () => {
      const strikeZone = strikeZoneRef.current;
      if (!strikeZone) return;
      const cameraPositionChanged =
        camera.position.distanceToSquared(lastProjectedCameraPosition) > 1e-5;
      const cameraRotationChanged =
        1 - Math.abs(camera.quaternion.dot(lastProjectedCameraQuaternion)) >
        1e-7;
      if (
        !strikeProjectionDirty &&
        !cameraPositionChanged &&
        !cameraRotationChanged
      ) {
        return;
      }
      const halfWidth = HIT_BAR_WIDTH / 2;

      world.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      strikeCenter.set(0, 0.16, HIT_Z);
      strikeLeft.set(-halfWidth, 0.16, HIT_Z);
      strikeRight.set(halfWidth, 0.16, HIT_Z);
      world.localToWorld(strikeCenter).project(camera);
      world.localToWorld(strikeLeft).project(camera);
      world.localToWorld(strikeRight).project(camera);

      const centerX = (strikeCenter.x * 0.5 + 0.5) * viewportWidth;
      const centerY = (-strikeCenter.y * 0.5 + 0.5) * viewportHeight;
      const leftX = (strikeLeft.x * 0.5 + 0.5) * viewportWidth;
      const leftY = (-strikeLeft.y * 0.5 + 0.5) * viewportHeight;
      const rightX = (strikeRight.x * 0.5 + 0.5) * viewportWidth;
      const rightY = (-strikeRight.y * 0.5 + 0.5) * viewportHeight;
      const projectedWidth = Math.hypot(rightX - leftX, rightY - leftY);
      const angle = Math.atan2(rightY - leftY, rightX - leftX);
      const hasCachedTransform =
        Number.isFinite(lastStrikeX) &&
        Number.isFinite(lastStrikeY) &&
        Number.isFinite(lastStrikeAngle);

      if (
        !hasCachedTransform ||
        Math.abs(centerX - lastStrikeX) > 0.2 ||
        Math.abs(centerY - lastStrikeY) > 0.2 ||
        Math.abs(angle - lastStrikeAngle) > 0.0005
      ) {
        strikeZone.style.transform =
          `translate3d(${centerX}px, ${centerY}px, 0) ` +
          `translate(-50%, -50%) rotate(${angle}rad)`;
        lastStrikeX = centerX;
        lastStrikeY = centerY;
        lastStrikeAngle = angle;
      }
      if (
        !Number.isFinite(lastStrikeWidth) ||
        Math.abs(projectedWidth - lastStrikeWidth) > 0.2
      ) {
        strikeZone.style.width = `${projectedWidth}px`;
        lastStrikeWidth = projectedWidth;
      }
      lastProjectedCameraPosition.copy(camera.position);
      lastProjectedCameraQuaternion.copy(camera.quaternion);
      strikeProjectionDirty = false;
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
    motionQuery.addEventListener("change", handleMotionPreferenceChange);

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
      const powerState = powerRef.current;
      const powerEnergy = powerState.active
        ? clamp(powerState.energy, 0, 1)
        : 0;
      const powerPulse = powerState.active
        ? reduceMotion
          ? 0.72
          : 0.76 + Math.sin(now * 0.0032) * 0.16
        : 0;

      if (powerState.activations !== lastPowerActivation) {
        const activated = powerState.activations > lastPowerActivation;
        lastPowerActivation = powerState.activations;
        if (activated) {
          flashEnergy = Math.max(flashEnergy, 2.4);
          if (!reduceMotion) {
            powerSurge = 1;
            cameraShake = Math.max(cameraShake, 0.22);
            cameraKick = Math.max(cameraKick, 0.72);
          } else {
            powerSurge = 0;
          }
          for (let index = 0; index < successFlare.length; index += 1) {
            successFlare[index] = Math.max(successFlare[index], 0.34);
          }
        }
      }

      applyTheme();

      while (pendingFeedbackRef.current.length) {
        const event = pendingFeedbackRef.current.shift();
        if (event) createFeedbackBurst(event);
      }

      matchedHoldStrength.fill(0);

      beatLines.forEach((line, index) => {
        const deltaBeat = (1 - beatFraction) % 1 + index;
        line.position.z = HIT_Z - (deltaBeat / visibleBeats) * TRAVEL_DISTANCE;
        line.visible = line.position.z >= FAR_Z;
        line.scale.y = index % 4 === 0 ? 2.2 : 1;
      });

      const liveIds = new Set<string | number>();
      const sustainedMidi = new Set<number>();
      notesRef.current.forEach((note) => {
        if (
          note.midi < FIRST_MIDI_NOTE ||
          note.midi >= FIRST_MIDI_NOTE + KEY_COUNT
        ) {
          return;
        }
        liveIds.add(note.id);
        const durationBeats = Math.max(0.08, note.durationBeats ?? 0.28);
        const tailBeat = note.startBeat + durationBeats;
        const visible =
          note.startBeat <= beat + visibleBeats + 0.65 &&
          tailBeat >= beat - POST_HIT_BEATS;
        let visual = noteVisuals.get(note.id);
        if (!visible) {
          if (visual) visual.group.visible = false;
          return;
        }
        visual ??= createNoteVisual(note);
        visual.group.visible = true;
        const key = KEY_LAYOUT[note.midi - FIRST_MIDI_NOTE];
        const noteWidth = key.width * (key.isBlack ? 0.8 : 0.82);
        const nextStartBeat = nextNoteStartRef.current.get(note.id);
        const separatedDuration =
          nextStartBeat !== undefined
            ? Math.min(
                durationBeats,
                Math.max(0.045, nextStartBeat - note.startBeat),
              )
            : durationBeats;
        const unseparatedLength = Math.max(
          0.14,
          (separatedDuration / visibleBeats) * TRAVEL_DISTANCE,
        );
        const separationGap = Math.min(
          unseparatedLength * 0.28,
          clamp(
            (TRAVEL_DISTANCE / visibleBeats) * 0.04,
            NOTE_GAP_MIN,
            0.15,
          ),
        );
        const length = Math.max(0.08, unseparatedLength - separationGap);
        const headZ =
          HIT_Z - ((note.startBeat - beat) / visibleBeats) * TRAVEL_DISTANCE;
        const velocity = clamp(note.velocity ?? 0.82, 0.1, 1);
        const color = noteColor(note, paletteRef.current);
        const keyIndex = note.midi - FIRST_MIDI_NOTE;
        const successEnergy = successFlare[keyIndex];
        const pressedNow =
          hasMidi(pressedRef.current, note.midi) ||
          pressedByPointer.has(note.midi);
        const sustaining =
          durationBeats >= 0.45 &&
          beat >= note.startBeat - 0.08 &&
          beat <= tailBeat + 0.08 &&
          (pressedNow || note.state === "active");
        if (sustaining) sustainedMidi.add(note.midi);
        const missed = note.state === "missed";
        const matchedHold =
          pressedNow && !missed && note.state === "active";
        const holdStrength = matchedHold
          ? reduceMotion
            ? 0.82
            : clamp(
                0.68 + clamp(note.holdProgress ?? 0.5, 0, 1) * 0.32,
                0.68,
                1,
              )
          : 0;
        matchedHoldStrength[keyIndex] = Math.max(
          matchedHoldStrength[keyIndex],
          holdStrength,
        );
        const hitBoost = matchedHold
          ? 1.72
          : note.state === "active"
            ? 1.55
            : 1;
        const renderedColor = missed ? paletteRef.current.miss : color;
        const motionFlare = reduceMotion ? 0 : successEnergy;
        const powerNoteBoost = missed
          ? 0
          : powerEnergy * (0.74 + powerPulse * 0.26);

        visual.group.position.set(
          key.x,
          key.isBlack ? 0.7 : 0.48,
          headZ - length / 2,
        );
        const bodyHeight =
          (0.12 + velocity * 0.11) *
          hitBoost *
          (1 +
            motionFlare * 0.3 +
            (sustaining ? 0.12 : 0) +
            powerNoteBoost * 0.08 +
            holdStrength * 0.1);
        const haloLength = length + Math.min(0.07, separationGap * 0.46);
        visual.body.scale.set(noteWidth, bodyHeight, length);
        visual.glow.scale.set(
          noteWidth *
            (1.42 +
              motionFlare * 0.7 +
              powerNoteBoost * 0.32 +
              holdStrength * 0.28),
          0.34 +
            motionFlare * 0.16 +
            powerNoteBoost * 0.08 +
            holdStrength * 0.08,
          haloLength,
        );
        visual.flare.scale.set(
          noteWidth *
            (1.64 +
              motionFlare * 0.88 +
              (sustaining ? 0.46 : 0) +
              powerNoteBoost * 0.48 +
              holdStrength * 0.5),
          0.42 +
            motionFlare * 0.18 +
            powerNoteBoost * 0.12 +
            holdStrength * 0.12,
          haloLength + Math.min(0.025, separationGap * 0.16),
        );
        visual.outline.scale.set(
          noteWidth * 1.025,
          bodyHeight * 1.035,
          length * 1.003,
        );
        visual.headCap.position.set(0, 0, length / 2 + 0.007);
        visual.tailCap.position.set(0, 0, -length / 2 - 0.007);
        visual.headCap.scale.set(noteWidth * 0.98, bodyHeight * 1.02, 1);
        visual.tailCap.scale.copy(visual.headCap.scale);
        const showFingerLabel =
          !missed &&
          note.state !== "hit" &&
          note.startBeat <= beat + 2 &&
          tailBeat >= beat - 0.08;
        if (visual.fingerLabel && visual.fingerLabelMaterial) {
          visual.fingerLabel.visible = showFingerLabel;
          visual.fingerLabel.position.set(
            0,
            0.38 + bodyHeight * 0.72,
            length / 2 + 0.14,
          );
          visual.fingerLabelMaterial.opacity =
            note.state === "active" ? 1 : 0.86;
        }
        visual.bodyMaterial.color.set(renderedColor);
        visual.bodyMaterial.emissive.set(renderedColor);
        visual.bodyMaterial.emissiveIntensity =
          (missed ? 0.8 : 2.25 + velocity * 1.1) * hitBoost +
          successEnergy * 9 +
          (sustaining ? 3.2 : 0) +
          powerNoteBoost * 4.2 +
          holdStrength * 7.2;
        visual.bodyMaterial.opacity = missed ? 0.46 : 0.96;
        visual.glowMaterial.color.set(renderedColor);
        visual.glowMaterial.opacity = clamp(
          (missed ? 0.06 : 0.14 + activeIntensity * 0.05) * hitBoost +
            successEnergy * 0.48 +
            (sustaining ? 0.24 : 0) +
            powerNoteBoost * 0.12 +
            holdStrength * 0.3,
          0.04,
          0.92,
        );
        visual.flareMaterial.color.set(renderedColor);
        visual.flareMaterial.opacity = clamp(
          (sustaining ? 0.2 : 0) +
            successEnergy * 0.34 +
            powerNoteBoost * 0.1 +
            holdStrength * 0.28,
          0,
          0.66,
        );
        visual.outlineMaterial.color.set(
          missed ? paletteRef.current.miss : 0xffffff,
        );
        visual.outlineMaterial.opacity = clamp(
          (missed ? 0.3 : 0.52) +
            successEnergy * 0.16 +
            holdStrength * 0.34,
          0.22,
          0.96,
        );
        visual.capMaterial.color.set(renderedColor);
        visual.capMaterial.opacity = clamp(
          (missed ? 0.4 : 0.7) + successEnergy * 0.12 + holdStrength * 0.2,
          0.32,
          0.96,
        );
      });

      noteVisuals.forEach((_, id) => {
        if (!liveIds.has(id)) removeNoteVisual(id);
      });

      keyVisuals.forEach((key, index) => {
        const active =
          hasMidi(pressedRef.current, key.midi) || pressedByPointer.has(key.midi);
        const hitEnergy = successFlare[index];
        const missedEnergy = missFlare[index];
        const holdMatch = matchedHoldStrength[index];
        const sustaining = sustainedMidi.has(key.midi);
        const targetY = key.baseY - (active ? 0.055 : 0);
        key.mesh.position.y += (targetY - key.mesh.position.y) * 0.32;
        key.mesh.scale.y +=
          (1 +
            (reduceMotion ? 0 : hitEnergy * 0.18) +
            (sustaining ? 0.055 : 0) -
            key.mesh.scale.y) *
          0.28;
        key.material.emissive.set(
          missedEnergy > 0.08 ? paletteRef.current.miss : key.laneColor,
        );
        key.material.emissiveIntensity +=
          ((active ? 3.1 + activeIntensity : key.isBlack ? 0.08 : 0.025) +
            hitEnergy * 10 +
            missedEnergy * 2.8 +
            (sustaining ? 3.4 : 0) +
            holdMatch * 8.4 +
            powerEnergy * (1.15 + powerPulse * 0.9) -
            key.material.emissiveIntensity) *
          0.3;
        key.landingMaterial.color.set(
          missedEnergy > 0.08 ? paletteRef.current.miss : key.laneColor,
        );
        key.landingMaterial.opacity +=
          (Math.max(
            active ? 0.72 : 0,
            hitEnergy * 0.96,
            missedEnergy * 0.62,
            sustaining ? 0.48 : 0,
            holdMatch * 0.98,
            powerEnergy * (0.07 + powerPulse * 0.05),
          ) -
            key.landingMaterial.opacity) *
          0.3;
        key.laneMaterial.color.set(
          missedEnergy > 0.08 ? paletteRef.current.miss : key.laneColor,
        );
        const baseLaneOpacity = key.isBlack
          ? 0.115
          : index % 2 === 0
            ? 0.072
            : 0.052;
        key.laneMaterial.opacity +=
          (baseLaneOpacity +
            hitEnergy * 0.42 +
            missedEnergy * 0.25 +
            (sustaining ? 0.12 : 0) +
            holdMatch * 0.34 +
            powerEnergy * (0.045 + powerPulse * 0.035) -
            key.laneMaterial.opacity) *
          0.28;
        if (!reduceMotion && (active || hitEnergy > 0.08 || sustaining)) {
          key.landingMaterial.opacity *=
            0.86 + Math.sin(now * 0.012 + index) * 0.14;
        }

        const marker = aimMarkers[index];
        marker.group.visible = active;
        if (active) {
          const tone: AimMarkerTone =
            missedEnergy > 0.08
              ? "miss"
              : holdMatch > 0
                ? "matched"
                : "held";
          setAimMarkerTone(marker, tone);
          const matchedEnergy = tone === "matched" ? holdMatch : 0;
          const motionPulse = reduceMotion
            ? 0
            : Math.sin(now * 0.009 + index * 0.73) * 0.055;
          marker.group.scale.setScalar(
            1 + motionPulse + matchedEnergy * (reduceMotion ? 0.1 : 0.18),
          );
          marker.whiteRing.material.opacity =
            tone === "matched" ? 1 : tone === "miss" ? 0.94 : 0.98;
          marker.colorRing.material.opacity =
            tone === "matched" ? 0.98 : tone === "miss" ? 0.82 : 0.62;
          marker.core.material.opacity = tone === "matched" ? 1 : 0.9;
          marker.core.scale.setScalar(1 + matchedEnergy * 0.42);
          marker.sparks.material.opacity =
            tone === "matched" ? 1 : tone === "miss" ? 0.86 : 0.74;
          marker.sparks.material.size =
            0.06 + matchedEnergy * 0.035 + (tone === "miss" ? 0.008 : 0);

          const positions = marker.sparks.geometry.attributes.position
            .array as Float32Array;
          for (let spark = 0; spark < AIM_SPARK_COUNT; spark += 1) {
            const offset = spark * 3;
            const seedAngle = marker.sparkSeeds[offset];
            const seedPhase = marker.sparkSeeds[offset + 1];
            const speed = marker.sparkSeeds[offset + 2];
            const progress = reduceMotion
              ? seedPhase
              : (seedPhase + now * 0.00072 * speed) % 1;
            const spin = reduceMotion
              ? 0
              : now * 0.00078 * (spark % 2 === 0 ? 1 : -1);
            const radius =
              0.12 + progress * (0.18 + matchedEnergy * 0.15);
            positions[offset] = Math.cos(seedAngle + spin) * radius;
            positions[offset + 1] =
              0.025 + progress * (0.14 + matchedEnergy * 0.18);
            positions[offset + 2] =
              Math.sin(seedAngle + spin) * radius * 0.72;
          }
          marker.sparks.geometry.attributes.position.needsUpdate = true;
        }
        successFlare[index] *= Math.pow(0.028, deltaSeconds);
        missFlare[index] *= Math.pow(0.006, deltaSeconds);
      });

      for (let index = feedbackBursts.length - 1; index >= 0; index -= 1) {
        const burst = feedbackBursts[index];
        burst.age += deltaSeconds;
        const progress = burst.age / burst.duration;
        burst.points.visible = !reduceMotion;
        if (burst.shockwave) burst.shockwave.visible = !reduceMotion;
        if (burst.streaks) burst.streaks.visible = !reduceMotion;
        if (burst.fracture) burst.fracture.visible = !reduceMotion;
        const positions = burst.points.geometry.attributes.position
          .array as Float32Array;
        if (!reduceMotion) {
          for (
            let particle = 0;
            particle < positions.length / 3;
            particle += 1
          ) {
            const offset = particle * 3;
            burst.velocities[offset + 1] -=
              (burst.miss ? 0.75 : 5.2) * deltaSeconds;
            positions[offset] += burst.velocities[offset] * deltaSeconds;
            positions[offset + 1] +=
              burst.velocities[offset + 1] * deltaSeconds;
            positions[offset + 2] +=
              burst.velocities[offset + 2] * deltaSeconds;
          }
          burst.points.geometry.attributes.position.needsUpdate = true;
        }
        burst.points.material.opacity = Math.max(
          0,
          (burst.miss ? 0.58 : 1) * (1 - progress * progress),
        );
        burst.ring.material.opacity = Math.max(
          0,
          (burst.miss ? 0.58 : 0.96) * (1 - progress),
        );
        burst.ring.scale.setScalar(
          reduceMotion ? 1 : 1 + progress * (burst.miss ? 1.7 : 4.6),
        );
        if (burst.echoRing) {
          burst.echoRing.scale.setScalar(
            reduceMotion ? 1.3 : 1.2 + progress * 6.2,
          );
          burst.echoRing.material.opacity = Math.max(
            0,
            0.78 * (1 - progress * 1.16),
          );
        }
        if (burst.shockwave && !reduceMotion) {
          burst.shockwave.scale.setScalar(1 + progress * 7.2);
          burst.shockwave.material.opacity = Math.max(
            0,
            0.72 * (1 - progress) * (1 - progress),
          );
        }
        if (burst.fracture && !reduceMotion) {
          burst.fracture.scale.setScalar(1 + progress * 0.38);
          burst.fracture.material.opacity = Math.max(
            0,
            0.95 * (1 - progress * 1.35),
          );
        }
        if (burst.streaks && !reduceMotion) {
          burst.streaks.scale.setScalar(1 + progress * 0.42);
          burst.streaks.material.opacity = Math.max(
            0,
            0.92 * (1 - progress) * (1 - progress),
          );
        }
        burst.light.intensity *= Math.pow(0.002, deltaSeconds);

        if (progress >= 1) {
          world.remove(burst.root);
          disposeObject(burst.root);
          burst.light.dispose();
          feedbackBursts.splice(index, 1);
        }
      }

      if (!reduceMotion) {
        const ambientPositionAttribute = ambientGeometry.attributes.position;
        const ambientArray = ambientPositionAttribute.array as Float32Array;
        for (let index = 0; index < ambientParticleCount; index += 1) {
          const zIndex = index * 3 + 2;
          ambientArray[zIndex] +=
            deltaSeconds *
            (0.28 + activeIntensity * 0.32 + powerEnergy * 0.58);
          if (ambientArray[zIndex] > 5.2) ambientArray[zIndex] = FAR_Z;
        }
        ambientPositionAttribute.needsUpdate = true;
      }
      ambientParticleMaterial.opacity = clamp(
        0.24 + activeIntensity * 0.25 + powerEnergy * 0.16,
        0,
        0.92,
      );

      padMaterials.forEach((material, index) => {
        material.emissiveIntensity =
          0.35 +
          activeIntensity * 0.25 +
          (reduceMotion
            ? 0.18
            : Math.max(0, Math.sin(now * 0.0026 + index * 0.7)) * 0.42) +
          powerEnergy * (0.34 + powerPulse * 0.18);
      });

      const beatPulse = Math.pow(1 - beatFraction, 5);
      beatLineMaterial.opacity =
        0.2 + powerEnergy * (0.1 + powerPulse * 0.08);
      hitMaterial.color.set(
        powerState.active
          ? paletteRef.current.success
          : paletteRef.current.primary,
      );
      hitMaterial.emissive.copy(hitMaterial.color);
      hitMaterial.emissiveIntensity =
        3.8 +
        beatPulse * (1.8 + activeIntensity * 0.55) +
        powerEnergy * (2.1 + powerPulse * 1.35);
      hitHaloMaterial.opacity =
        0.13 +
        beatPulse * 0.11 +
        Math.min(0.12, flashEnergy * 0.05) +
        powerEnergy * 0.08;
      hitHalo.scale.y = 1 + beatPulse * 0.16 + powerEnergy * 0.08;
      hitLine.scale.z = 1 + beatPulse * 0.18;
      if (reduceMotion) {
        hitSweep.position.x = 0;
        hitSweepMaterial.opacity = 0.1;
      } else {
        const sweepProgress = (now * 0.00034) % 1;
        hitSweep.position.x =
          -KEYBOARD_WIDTH / 2 - 0.4 +
          sweepProgress * (KEYBOARD_WIDTH + 0.8);
        hitSweepMaterial.opacity =
          0.12 + Math.sin(sweepProgress * Math.PI) * 0.2;
      }
      if (reduceMotion) {
        powerSurgeRing.visible = powerState.active;
        powerSurgeRing.scale.setScalar(7.5);
        powerSurgeMaterial.opacity = powerState.active ? 0.1 : 0;
      } else if (powerSurge > 0.008) {
        const surgeProgress = 1 - powerSurge;
        powerSurgeRing.visible = true;
        powerSurgeRing.scale.setScalar(1 + surgeProgress * 10.5);
        powerSurgeMaterial.opacity = 0.88 * powerSurge * powerSurge;
        powerSurge *= Math.pow(0.045, deltaSeconds);
      } else {
        powerSurgeRing.visible = false;
        powerSurgeMaterial.opacity = 0;
      }
      powerSurgeMaterial.color.set(paletteRef.current.success);

      primaryLight.intensity =
        9 +
        activeIntensity * 4 +
        flashEnergy * 11 +
        powerEnergy * (5.5 + powerPulse * 2.5);
      secondaryLight.intensity =
        8 + activeIntensity * 3 + powerEnergy * (3.2 + powerPulse * 1.8);
      renderer.toneMappingExposure =
        1.16 + powerEnergy * 0.1 + Math.min(0.08, flashEnergy * 0.018);
      flashEnergy *= Math.pow(0.015, deltaSeconds);

      if (!reduceMotion) {
        const baseCameraZ =
          viewportWidth < 620 ? 13.8 : viewportWidth < 900 ? 12.8 : 12.1;
        camera.position.x = Math.sin(now * 0.00042) * 0.08 * activeIntensity;
        camera.position.y =
          (viewportWidth < 620 ? 9.5 : 8.9) +
          Math.sin(now * 0.00031) * 0.035 * activeIntensity;
        camera.position.z =
          baseCameraZ -
          cameraKick * 0.26 -
          powerEnergy * (0.025 + powerPulse * 0.025);
        if (cameraShake > 0.001) {
          camera.position.x += (Math.random() - 0.5) * cameraShake;
          camera.position.y += (Math.random() - 0.5) * cameraShake;
          cameraShake *= Math.pow(0.02, deltaSeconds);
        }
        cameraKick *= Math.pow(0.035, deltaSeconds);
        camera.lookAt(0, cameraTargetY, -2.1);
      }

      updateStrikeZoneProjection();

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
      motionQuery.removeEventListener("change", handleMotionPreferenceChange);
      pointerNotes.forEach((midi) => onKeyUpRef.current?.(midi));
      disposeObject(scene);
      noteGeometry.dispose();
      noteOutlineGeometry.dispose();
      noteCapGeometry.dispose();
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
    "--kh-power-energy": clamp(power.energy, 0, 1),
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
      className={`kh-stage${power.active ? " kh-stage--power" : ""} ${className}`.trim()}
      style={rootStyle}
      aria-busy={!ready && !webglError}
      data-power-mode={power.active ? "active" : "charging"}
    >
      <canvas
        ref={canvasRef}
        className="kh-stage__canvas"
        tabIndex={0}
        aria-label={ariaLabel}
      />

      <div className="kh-stage__atmosphere" aria-hidden="true" />
      <div className="kh-stage__power-wash" aria-hidden="true" />
      <div className="kh-stage__scanlines" aria-hidden="true" />

      {!webglError && (
        <div
          ref={strikeZoneRef}
          className="kh-stage__strike-zone"
          data-ready={ready ? "true" : "false"}
          aria-hidden="true"
        >
          <div className="kh-stage__strike-sweep" />
          <div className="kh-stage__strike-label">
            <i />
            <span>{strikeLabel}</span>
            <i />
          </div>
        </div>
      )}

      {!webglError && fingerGuide.hands.length > 0 && (
        <div
          className="kh-stage__finger-guide"
          role="group"
          aria-label="Suggested piano finger guide"
        >
          <span className="kh-stage__finger-guide-title" aria-hidden="true">
            SUGGESTED FINGERING
          </span>
          <span className="kh-stage__finger-guide-legend" aria-hidden="true">
            T thumb · I index · M middle · R ring · P pinky
          </span>
          <span className="kh-stage__finger-guide-summary">{fingerGuideLabel}</span>
          <div className="kh-stage__finger-guide-hands">
            {fingerGuide.hands.map((hand) => (
              <div
                className="kh-stage__finger-hand"
                data-hand={hand}
                key={hand}
                role="group"
                aria-label={`${hand === "left" ? "Left" : "Right"} hand`}
              >
                <span className="kh-stage__finger-hand-label" aria-hidden="true">
                  {hand === "left" ? "L" : "R"}
                </span>
                <div className="kh-stage__finger-row">
                  {FINGERS_BY_HAND[hand].map((finger) => {
                    const target = fingerGuide.targets.find(
                      (candidate) =>
                        candidate.hand === hand && candidate.finger === finger,
                    );
                    return (
                      <span
                        className={`kh-stage__finger${
                          target ? ` is-${target.state}` : ""
                        }`}
                        key={finger}
                        role="img"
                        aria-label={`${hand === "left" ? "Left" : "Right"} hand, finger ${finger}, ${FINGER_NAMES[finger]}${target ? `, ${target.state}` : ", ready"}`}
                      >
                        <b>{finger}</b>
                        <small>{FINGER_ABBREVIATIONS[finger]}</small>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
