// The WebGL globe (docs/UI_SPEC.md §3). The only place three.js is used; pages load this file
// with React.lazy so that no other page pays for it.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection, MultiLineString } from 'geojson'
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearMipmapLinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import {
  STATIC_PULSE,
  angleDiff,
  clampPitch,
  latLonToVector,
  orientationFor,
  pulseState,
  starPositions,
} from './globeMath'
import { buildGlobeCanvas, readGlobeColours, rgbToHex, type GlobeColours } from './globeTexture'
import { defineStrings, useStrings } from '../../i18n'
import './globe.css'

export const STRINGS = defineStrings(
  {
    warm: 'warm = rising',
    cool: 'cool = falling',
    flagged: 'yellow = flagged for a sudden shift',
  },
  {
    warm: 'màu ấm = đang tăng',
    cool: 'màu lạnh = đang giảm',
    flagged: 'màu vàng = bị đánh dấu có bước nhảy đột ngột',
  },
)

export interface GlobePulse {
  id: string
  lat: number
  lon: number
  label: string
}

export interface EarthGlobeProps {
  /** Contract grid, 180 x 360, row 0 = north. */
  trendClass: Int8Array
  /** Same grid; >= 1 = flagged. */
  qualityFlag?: Int8Array | null
  /** Natural Earth land, from maps/basemap loadNaturalEarth(). */
  land: FeatureCollection
  /** Country borders mesh and country polygons from the same basemap (G2). */
  borders?: MultiLineString | null
  countries?: FeatureCollection | null
  pulses?: GlobePulse[]
  onPulseSelect?: (id: string) => void
  /** Default 105 (Southeast Asia faces the viewer). */
  initialLon?: number
  /** Default 15. */
  initialLat?: number
  ariaLabel: string
  /** Optional href for the pulse links under the globe; default is "#<id>" (click is intercepted). */
  pulseHref?: (id: string) => string
}

const CAMERA_DISTANCE = 3.1
const CAMERA_FOV = 35
// With fov 35 at distance 3.1 the ball (and its glow) is wider than the frame; zoom out a little so
// the whole ball is visible and reads as a ball.
const CAMERA_ZOOM = 0.84
const AUTO_ROTATE_RAD_PER_S = 0.035
const RESUME_AFTER_MS = 4000
const DRAG_RAD_PER_PX = 0.0055
const HIT_RADIUS_PX = 16
const CLICK_SLOP_PX = 5

interface GlobeScene {
  canvas: HTMLCanvasElement
  setPulses(pulses: GlobePulse[]): void
  setActive(id: string | null): void
  setAriaLabel(label: string): void
  setReducedMotion(reduced: boolean): void
  dispose(): void
}

interface SceneOptions {
  stage: HTMLElement
  tip: HTMLElement
  texture: HTMLCanvasElement
  colours: GlobeColours
  lat: number
  lon: number
  reducedMotion: boolean
  ariaLabel: string
  onSelect(id: string): void
  onContextLost(): void
}

interface PulseObject {
  pulse: GlobePulse
  local: Vector3
  ring: Mesh
  ringMaterial: MeshBasicMaterial
  dot: Mesh
}

const ATMOSPHERE_VERTEX = `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const ATMOSPHERE_FRAGMENT = `
varying vec3 vNormal;
void main() {
  float f = pow(max(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
  gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * f;
}`

// A soft limb: black, alpha rising to 0.45 at the edge, same fresnel term.
const LIMB_FRAGMENT = `
varying vec3 vNormal;
void main() {
  float f = pow(1.0 - clamp(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, 0.45 * f);
}`

function createGlobeScene(options: SceneOptions): GlobeScene {
  const { stage, tip } = options
  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  const gl = renderer.getContext()
  if (!gl) {
    renderer.dispose()
    throw new Error('No WebGL context')
  }
  const canvas = renderer.domElement
  canvas.className = 'globe__canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', options.ariaLabel)
  stage.insertBefore(canvas, stage.firstChild)

  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
  camera.position.set(0, 0, CAMERA_DISTANCE)
  camera.zoom = CAMERA_ZOOM
  camera.updateProjectionMatrix()

  const disposables: Array<{ dispose(): void }> = [renderer]

  // Globe: no lighting on the data, so the colours equal the legend.
  const texture = new CanvasTexture(options.texture)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  disposables.push(texture)
  const globeGeometry = new SphereGeometry(1, 96, 64)
  const globeMaterial = new MeshBasicMaterial({ map: texture })
  disposables.push(globeGeometry, globeMaterial)
  const globe = new Group()
  globe.add(new Mesh(globeGeometry, globeMaterial))
  scene.add(globe)

  // Atmosphere glow, behind the ball.
  const atmosphereGeometry = new SphereGeometry(1.06, 64, 48)
  const atmosphereMaterial = new ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  disposables.push(atmosphereGeometry, atmosphereMaterial)
  scene.add(new Mesh(atmosphereGeometry, atmosphereMaterial))

  // Soft limb.
  const limbGeometry = new SphereGeometry(1.001, 64, 48)
  const limbMaterial = new ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: LIMB_FRAGMENT,
    transparent: true,
    depthWrite: false,
  })
  disposables.push(limbGeometry, limbMaterial)
  const limb = new Mesh(limbGeometry, limbMaterial)
  limb.renderOrder = 1
  scene.add(limb)

  // Stars: 1,200 fixed points, 600 at 1 px and 600 at 2 px.
  const stars = starPositions(1200, 40)
  const starObjects: Array<{ points: Points; material: PointsMaterial; base: number }> = []
  for (const [part, base] of [[0, 1], [1, 2]] as const) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(stars.slice(part * 1800, part * 1800 + 1800), 3))
    const material = new PointsMaterial({
      color: 0xeaf1fb,
      size: base,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    })
    disposables.push(geometry, material)
    const points = new Points(geometry, material)
    scene.add(points)
    starObjects.push({ points, material, base })
  }

  // Pulses live in the rotating group.
  const ringGeometry = new RingGeometry(0.8, 1, 48)
  const dotGeometry = new CircleGeometry(0.012, 16)
  disposables.push(ringGeometry, dotGeometry)
  const pulseRoot = new Object3D()
  globe.add(pulseRoot)
  const pulseColour = new Color().setStyle(rgbToHex(options.colours.onNight))
  let pulseObjects: PulseObject[] = []

  // State.
  const initial = orientationFor(options.lat, options.lon)
  let yaw = initial.yaw
  let pitch = initial.pitch
  let target: { yaw: number; pitch: number } | null = null
  let reduced = options.reducedMotion
  let visible = true
  let pageHidden = document.hidden
  let dragging = false
  let dragMoved = 0
  let lastX = 0
  let lastY = 0
  let lastInteraction = Number.NEGATIVE_INFINITY
  let clock = 0
  let lastFrame = performance.now()
  let raf = 0
  let timer = 0
  let disposed = false
  let activeId: string | null = null
  let hoverId: string | null = null
  let size = 0

  const worldPoint = new Vector3()
  const projected = new Vector3()

  const running = () => visible && !pageHidden && !disposed
  const canRotate = () => !dragging && !reduced && performance.now() - lastInteraction >= RESUME_AFTER_MS

  /** Screen position (stage pixels) of a pulse, or null when it is on the far side. */
  function screenPosition(item: PulseObject): { x: number; y: number } | null {
    worldPoint.copy(item.local).applyMatrix4(globe.matrixWorld)
    if (worldPoint.z * CAMERA_DISTANCE <= 1.05) return null
    projected.copy(worldPoint).project(camera)
    return { x: (projected.x * 0.5 + 0.5) * size, y: (-projected.y * 0.5 + 0.5) * size }
  }

  function updateTip(): void {
    const item = activeId ? pulseObjects.find((p) => p.pulse.id === activeId) : undefined
    const spot = item ? screenPosition(item) : null
    if (!item || !spot) {
      tip.hidden = true
      return
    }
    if (tip.textContent !== item.pulse.label) tip.textContent = item.pulse.label
    tip.hidden = false
    tip.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px) translate(-50%, calc(-100% - 12px))`
  }

  function hitTest(x: number, y: number): PulseObject | null {
    let best: PulseObject | null = null
    let bestDistance = HIT_RADIUS_PX
    for (const item of pulseObjects) {
      const spot = screenPosition(item)
      if (!spot) continue
      const distance = Math.hypot(spot.x - x, spot.y - y)
      if (distance <= bestDistance) {
        best = item
        bestDistance = distance
      }
    }
    return best
  }

  function renderOnce(): void {
    globe.rotation.set(pitch, yaw, 0)
    globe.updateMatrixWorld(true)
    pulseObjects.forEach((item, index) => {
      const state = reduced ? STATIC_PULSE : pulseState(clock, index)
      item.ring.scale.set(state.radius, state.radius, 1)
      item.ringMaterial.opacity = state.opacity
    })
    renderer.render(scene, camera)
    updateTip()
  }

  function frame(): void {
    raf = 0
    if (!running()) return
    const now = performance.now()
    const dt = Math.min((now - lastFrame) / 1000, 0.1)
    lastFrame = now
    if (!reduced) clock += dt
    if (target) {
      const k = 1 - Math.exp(-dt * 7)
      const dy = angleDiff(yaw, target.yaw)
      const dp = target.pitch - pitch
      yaw += dy * k
      pitch += dp * k
      if (Math.abs(dy) < 0.002 && Math.abs(dp) < 0.002) {
        yaw = target.yaw
        pitch = target.pitch
        target = null
      }
    } else if (canRotate()) {
      yaw += AUTO_ROTATE_RAD_PER_S * dt
    }
    renderOnce()
    if (target || (!reduced && (pulseObjects.length > 0 || canRotate()))) {
      schedule()
    } else if (!reduced && !dragging) {
      // Paused after an interaction with nothing animating: stop entirely until rotation resumes.
      window.clearTimeout(timer)
      timer = window.setTimeout(schedule, Math.max(0, RESUME_AFTER_MS - (now - lastInteraction)) + 20)
    }
  }

  function schedule(): void {
    if (raf || !running()) return
    lastFrame = performance.now()
    raf = requestAnimationFrame(frame)
  }

  function setActive(id: string | null): void {
    activeId = id
    schedule()
    if (!running()) updateTip()
  }

  // Pointer interaction: drag rotates, a click without movement selects a pulse.
  function localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    const scale = rect.width > 0 ? size / rect.width : 1
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale }
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragging = true
    dragMoved = 0
    lastX = event.clientX
    lastY = event.clientY
    lastInteraction = performance.now()
    target = null
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      /* capture is a nicety */
    }
    canvas.classList.add('globe__canvas--dragging')
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (dragging) {
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      dragMoved += Math.abs(dx) + Math.abs(dy)
      yaw += dx * DRAG_RAD_PER_PX
      pitch = clampPitch(pitch + dy * DRAG_RAD_PER_PX)
      lastInteraction = performance.now()
      schedule()
      return
    }
    const spot = localPoint(event)
    const hit = hitTest(spot.x, spot.y)
    canvas.style.cursor = hit ? 'pointer' : ''
    const id = hit ? hit.pulse.id : null
    if (id !== hoverId) {
      hoverId = id
      setActive(id)
    }
  }
  const endDrag = (event: PointerEvent, select: boolean): void => {
    if (!dragging) return
    dragging = false
    lastInteraction = performance.now()
    canvas.classList.remove('globe__canvas--dragging')
    try {
      canvas.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    if (select && dragMoved < CLICK_SLOP_PX) {
      const spot = localPoint(event)
      const hit = hitTest(spot.x, spot.y)
      if (hit) options.onSelect(hit.pulse.id)
    }
    schedule()
  }
  const onPointerUp = (event: PointerEvent): void => endDrag(event, true)
  const onPointerCancel = (event: PointerEvent): void => endDrag(event, false)
  const onPointerLeave = (): void => {
    if (dragging || hoverId === null) return
    hoverId = null
    canvas.style.cursor = ''
    setActive(null)
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('pointerleave', onPointerLeave)

  const onContextLost = (event: Event): void => {
    event.preventDefault()
    options.onContextLost()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)

  // Resize, visibility, page visibility.
  function resize(): void {
    const width = Math.round(stage.clientWidth)
    if (width <= 0) return
    size = width
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(ratio)
    renderer.setSize(width, width, false)
    for (const star of starObjects) star.material.size = star.base * ratio
    // setSize clears the drawing buffer: draw again now, whether or not the loop is running.
    renderOnce()
    schedule()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(stage)
  const intersection = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1]
    if (!entry) return
    visible = entry.isIntersecting
    if (visible) schedule()
  })
  intersection.observe(stage)
  const onVisibility = (): void => {
    pageHidden = document.hidden
    if (!pageHidden) schedule()
  }
  document.addEventListener('visibilitychange', onVisibility)

  resize()
  size = size || stage.clientWidth || 460
  renderOnce()
  schedule()

  return {
    canvas,
    setPulses(pulses) {
      for (const item of pulseObjects) {
        pulseRoot.remove(item.ring, item.dot)
        item.ringMaterial.dispose()
        ;(item.dot.material as Material).dispose()
      }
      pulseObjects = pulses.map((pulse) => {
        const [x, y, z] = latLonToVector(pulse.lat, pulse.lon)
        const local = new Vector3(x, y, z)
        const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), local)
        const ringMaterial = new MeshBasicMaterial({
          color: pulseColour,
          transparent: true,
          opacity: 0.9,
          side: DoubleSide,
          depthWrite: false,
        })
        const ring = new Mesh(ringGeometry, ringMaterial)
        ring.position.copy(local).multiplyScalar(1.003)
        ring.quaternion.copy(quaternion)
        const dot = new Mesh(dotGeometry, new MeshBasicMaterial({ color: pulseColour, side: DoubleSide }))
        dot.position.copy(local).multiplyScalar(1.004)
        dot.quaternion.copy(quaternion)
        pulseRoot.add(ring, dot)
        return { pulse, local, ring, ringMaterial, dot }
      })
      if (activeId && !pulses.some((p) => p.id === activeId)) activeId = null
      schedule()
      if (!running()) renderOnce()
    },
    setActive(id) {
      activeId = id
      if (id) {
        const item = pulseObjects.find((p) => p.pulse.id === id)
        if (item && !screenPosition(item)) {
          // On the far side: turn the globe to it so the label can be shown.
          const next = orientationFor(item.pulse.lat, item.pulse.lon)
          if (reduced) {
            yaw = next.yaw
            pitch = next.pitch
          } else {
            target = next
          }
          lastInteraction = performance.now()
        }
      }
      schedule()
      if (!running() || reduced) renderOnce()
    },
    setAriaLabel(label) {
      canvas.setAttribute('aria-label', label)
    },
    setReducedMotion(next) {
      reduced = next
      if (reduced) target = null
      schedule()
      renderOnce()
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      resizeObserver.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      for (const item of pulseObjects) {
        item.ringMaterial.dispose()
        ;(item.dot.material as Material).dispose()
      }
      pulseObjects = []
      for (const item of disposables) item.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      tip.hidden = true
    },
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function EarthGlobe({
  trendClass,
  qualityFlag = null,
  land,
  borders = null,
  countries = null,
  pulses,
  onPulseSelect,
  initialLon = 105,
  initialLat = 15,
  ariaLabel,
  pulseHref,
}: EarthGlobeProps) {
  const s = useStrings(STRINGS)
  const stageRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const flatRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<GlobeScene | null>(null)
  const selectRef = useRef(onPulseSelect)
  const [flat, setFlat] = useState(false)
  const pulseList = useMemo(() => pulses ?? [], [pulses])

  useEffect(() => {
    selectRef.current = onPulseSelect
  }, [onPulseSelect])

  // The equirectangular canvas; colours are read from CSS variables when it is built.
  const texture = useMemo<HTMLCanvasElement | null>(() => {
    try {
      return buildGlobeCanvas(
        trendClass,
        qualityFlag,
        land,
        readGlobeColours(),
        undefined,
        undefined,
        borders,
        countries,
      )
    } catch {
      return null
    }
  }, [trendClass, qualityFlag, land, borders, countries])

  // The WebGL scene. Falls back to the flat map when no context can be created or it is lost.
  useEffect(() => {
    const stage = stageRef.current
    const tip = tipRef.current
    if (flat || !stage || !tip || !texture) return
    let created: GlobeScene
    try {
      created = createGlobeScene({
        stage,
        tip,
        texture,
        colours: readGlobeColours(),
        lat: initialLat,
        lon: initialLon,
        reducedMotion: prefersReducedMotion(),
        ariaLabel,
        onSelect: (id) => selectRef.current?.(id),
        onContextLost: () => setFlat(true),
      })
    } catch {
      setFlat(true)
      return
    }
    sceneRef.current = created
    return () => {
      created.dispose()
      if (sceneRef.current === created) sceneRef.current = null
    }
    // ariaLabel and pulses are applied by the effects below; the initial orientation only at start.
  }, [texture, flat])

  useEffect(() => {
    sceneRef.current?.setPulses(pulseList)
  }, [pulseList, texture, flat])

  useEffect(() => {
    sceneRef.current?.setAriaLabel(ariaLabel)
  }, [ariaLabel, texture, flat])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => sceneRef.current?.setReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Flat fallback: show the same canvas inside a rounded card.
  useEffect(() => {
    const holder = flatRef.current
    if (!flat || !holder || !texture) return
    texture.classList.add('globe__flat-canvas')
    holder.appendChild(texture)
    return () => {
      texture.remove()
    }
  }, [flat, texture])

  return (
    <div className="globe">
      <div className={flat ? 'globe__stage globe__stage--flat' : 'globe__stage'} ref={stageRef}>
        {flat && (
          <div className="globe__flat" role="img" aria-label={ariaLabel} ref={flatRef} />
        )}
        <div className="globe__tip" role="tooltip" ref={tipRef} hidden />
      </div>
      <p className="globe__legend">
        <span className="globe__legend-item">
          <span className="globe__swatch globe__swatch--increase" aria-hidden="true" />
          {s.warm}
        </span>
        <span className="globe__legend-item">
          <span className="globe__swatch globe__swatch--decrease" aria-hidden="true" />
          {s.cool}
        </span>
        <span className="globe__legend-item">
          <span className="globe__swatch globe__swatch--flagged" aria-hidden="true" />
          {s.flagged}
        </span>
      </p>
      {pulseList.length > 0 && (
        <ul className="globe__links">
          {pulseList.map((pulse) => (
            <li key={pulse.id}>
              <a
                href={pulseHref ? pulseHref(pulse.id) : `#${pulse.id}`}
                onClick={(event) => {
                  if (!pulseHref || !(event.ctrlKey || event.metaKey || event.shiftKey)) event.preventDefault()
                  selectRef.current?.(pulse.id)
                }}
                onFocus={() => sceneRef.current?.setActive(pulse.id)}
                onBlur={() => sceneRef.current?.setActive(null)}
                onMouseEnter={() => sceneRef.current?.setActive(pulse.id)}
                onMouseLeave={() => sceneRef.current?.setActive(null)}
              >
                {pulse.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
