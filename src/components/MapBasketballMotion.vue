<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { gazeDirection, type Point } from '../utils/mascot-gaze'

const assetUrl = import.meta.env.BASE_URL + 'motion/map-basketball/mascot.webp'
const svgId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const host = ref<HTMLElement | null>(null)
const figure = ref<HTMLElement | null>(null)
const leftPupil = ref<SVGGElement | null>(null)
const rightPupil = ref<SVGGElement | null>(null)
const ready = ref(false)
const failed = ref(false)
const state = ref<'resting' | 'tracking' | 'static'>('resting')

// Coordinates are measured against the original 1024 × 1536 illustration.
const eyeCenters: Point[] = [{ x: 424, y: 363 }, { x: 588, y: 349 }]
const current = [{ x: 0, y: 0 }, { x: 0, y: 0 }]
const target = [{ x: 0, y: 0 }, { x: 0, y: 0 }]
let bounds: DOMRect | null = null
let frame = 0
let lastTime = 0
let visible = false
let wideScreen: MediaQueryList | null = null
let reducedMotion: MediaQueryList | null = null
let finePointer: MediaQueryList | null = null
let intersectionObserver: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null

function canTrack() {
  return ready.value && !failed.value && visible && wideScreen?.matches
    && finePointer?.matches && !reducedMotion?.matches && !document.hidden
}

function draw() {
  const pupils = [leftPupil.value, rightPupil.value]
  current.forEach((point, index) => {
    pupils[index]?.setAttribute('transform', 'translate(' + (point.x * 12).toFixed(2) + ' ' + (point.y * 18).toFixed(2) + ')')
  })
}

function stop() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  lastTime = 0
}

function animate(time: number) {
  frame = 0
  if (!canTrack()) return
  const elapsed = lastTime ? Math.min(time - lastTime, 50) : 16
  const follow = 1 - Math.exp(-elapsed / 65)
  lastTime = time
  let moving = false
  current.forEach((point, index) => {
    const destination = target[index]!
    point.x += (destination.x - point.x) * follow
    point.y += (destination.y - point.y) * follow
    if (Math.hypot(destination.x - point.x, destination.y - point.y) > 0.001) moving = true
    else Object.assign(point, destination)
  })
  draw()
  if (moving) frame = requestAnimationFrame(animate)
  else lastTime = 0
}

function schedule() {
  if (!frame && canTrack()) frame = requestAnimationFrame(animate)
}

function reset(immediate = false) {
  target.forEach(point => Object.assign(point, { x: 0, y: 0 }))
  state.value = reducedMotion?.matches ? 'static' : 'resting'
  if (immediate || !canTrack()) {
    stop()
    current.forEach(point => Object.assign(point, { x: 0, y: 0 }))
    draw()
  } else schedule()
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch' || !canTrack() || !figure.value) return
  bounds ??= figure.value.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  eyeCenters.forEach((center, index) => {
    Object.assign(target[index]!, gazeDirection(
      { x: event.clientX, y: event.clientY },
      { x: bounds!.left + center.x / 1024 * bounds!.width, y: bounds!.top + center.y / 1536 * bounds!.height },
    ))
  })
  state.value = 'tracking'
  schedule()
}

function onPointerOut(event: PointerEvent) { if (!event.relatedTarget) reset() }
function onBlur() { reset(true) }
function invalidateBounds() { bounds = null }
function updatePreference() { invalidateBounds(); reset(true) }
function onAssetLoad() { ready.value = true; updatePreference() }
function onAssetError() { failed.value = true; ready.value = false; reset(true) }

onMounted(() => {
  wideScreen = window.matchMedia('(min-width: 1101px)')
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  finePointer = window.matchMedia('(any-pointer: fine)')
  for (const preference of [wideScreen, reducedMotion, finePointer]) preference.addEventListener('change', updatePreference)
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerout', onPointerOut)
  document.addEventListener('visibilitychange', updatePreference)
  window.addEventListener('blur', onBlur)
  window.addEventListener('scroll', invalidateBounds, { passive: true, capture: true })
  window.addEventListener('resize', invalidateBounds, { passive: true })
  intersectionObserver = new IntersectionObserver(entries => {
    visible = Boolean(entries[0]?.isIntersecting)
    invalidateBounds()
    if (!visible) reset(true)
  })
  if (host.value) intersectionObserver.observe(host.value)
  resizeObserver = new ResizeObserver(invalidateBounds)
  if (figure.value) resizeObserver.observe(figure.value)
  updatePreference()
})

onBeforeUnmount(() => {
  stop()
  for (const preference of [wideScreen, reducedMotion, finePointer]) preference?.removeEventListener('change', updatePreference)
  document.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerout', onPointerOut)
  document.removeEventListener('visibilitychange', updatePreference)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('scroll', invalidateBounds, true)
  window.removeEventListener('resize', invalidateBounds)
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
})
</script>

<template>
  <div ref="host" class="map-basketball-motion" :class="{ 'is-ready': ready }" :data-gaze-state="state" aria-hidden="true" data-testid="map-basketball-motion">
    <div v-if="!failed" ref="figure" class="map-basketball-motion__figure" @transitionend="invalidateBounds">
      <img class="map-basketball-motion__art" :src="assetUrl" alt="" width="1024" height="1536" draggable="false" decoding="async" @load="onAssetLoad" @error="onAssetError" />
      <svg class="map-basketball-motion__eyes" viewBox="0 0 1024 1536" focusable="false">
        <defs>
          <clipPath :id="svgId + '-left-eye'"><ellipse cx="424" cy="363" rx="36" ry="44" transform="rotate(-9 424 363)" /></clipPath>
          <clipPath :id="svgId + '-right-eye'"><ellipse cx="588" cy="349" rx="35" ry="45" transform="rotate(9 588 349)" /></clipPath>
        </defs>
        <g :clip-path="'url(#' + svgId + '-left-eye)'">
          <g ref="leftPupil" class="map-basketball-motion__pupil" transform="translate(0 0)">
            <ellipse cx="424" cy="363" rx="22" ry="25" fill="#32271f" />
            <ellipse cx="424" cy="365" rx="13" ry="17" fill="#191c17" />
            <circle cx="417" cy="354" r="5.5" fill="#fffdf7" />
          </g>
        </g>
        <g :clip-path="'url(#' + svgId + '-right-eye)'">
          <g ref="rightPupil" class="map-basketball-motion__pupil" transform="translate(0 0)">
            <ellipse cx="588" cy="349" rx="22" ry="25" fill="#32271f" />
            <ellipse cx="588" cy="351" rx="13" ry="17" fill="#191c17" />
            <circle cx="581" cy="340" r="5.5" fill="#fffdf7" />
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.map-basketball-motion{position:relative;width:220px;height:232px;align-self:center;pointer-events:none;user-select:none;contain:layout paint}
.map-basketball-motion__figure{position:absolute;left:34px;bottom:0;width:152px;height:228px;opacity:0;transform:translateY(6px);transition:opacity .3s ease,transform .4s cubic-bezier(.22,.68,.26,1)}
.map-basketball-motion.is-ready .map-basketball-motion__figure{opacity:1;transform:translateY(0)}
.map-basketball-motion__art,.map-basketball-motion__eyes{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.map-basketball-motion__eyes{overflow:visible}
@media(prefers-reduced-motion:reduce){.map-basketball-motion__figure{transition:none;transform:none}}
@media(max-width:1100px){.map-basketball-motion{display:none}}
</style>
