<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createFrameAnimator, type FrameAnimator } from '../vendor/oil-motion/interactive-motion'

type AtlasManifest = {
  version: number
  type: string
  asset: string
  frameCount: number
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
}

const assetRoot = `${import.meta.env.BASE_URL}motion/map-basketball/`
const stillUrl = `${assetRoot}still.png`
const atlasUrl = `${assetRoot}character.webp`
const scrollDistance = 160
const travelDistance = 48

const host = ref<HTMLElement | null>(null)
const sprite = ref<HTMLElement | null>(null)
const ready = ref(false)
const posterFailed = ref(false)
let manifest: AtlasManifest | null = null
let animator: FrameAnimator | null = null
let wideScreen: MediaQueryList | null = null
let reducedMotion: MediaQueryList | null = null
let intersectionObserver: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let loadController: AbortController | null = null
let sampleFrame = 0
let loadSequence = 0
let startTop = 0
let currentProgress = 0
let visible = false
let scrollParents: EventTarget[] = []

function clamp(value: number) { return Math.min(1, Math.max(0, value)) }
function canAnimate() { return Boolean(wideScreen?.matches && !reducedMotion?.matches && !document.hidden) }

function renderFrame(frame: number) {
  if (!manifest || !sprite.value) return
  const { columns, rows, frameCount } = manifest
  const column = frame % columns
  const row = Math.floor(frame / columns)
  const x = columns === 1 ? 0 : column / (columns - 1) * 100
  const y = rows === 1 ? 0 : row / (rows - 1) * 100
  const progress = frameCount === 1 ? 0 : frame / (frameCount - 1)
  // One DOM write per animation frame updates both the atlas frame and the shared person/ball travel.
  sprite.value.style.cssText = `background-image:url("${atlasUrl}");background-size:${columns * 100}% ${rows * 100}%;background-position:${x}% ${y}%;transform:translate3d(${Math.round(progress * travelDistance)}px,0,0)`
}

function stopAnimator() {
  animator?.destroy()
  animator = null
}

function readScrollProgress() {
  if (!host.value) return 0
  return clamp((startTop - host.value.getBoundingClientRect().top) / scrollDistance)
}

function sampleScroll() {
  sampleFrame = 0
  if (!ready.value || !visible || !canAnimate() || !manifest) return
  currentProgress = readScrollProgress()
  if (!animator) {
    animator = createFrameAnimator({
      frameCount: manifest.frameCount,
      initialFrame: currentProgress * (manifest.frameCount - 1),
      render: renderFrame,
    })
  } else {
    animator.setProgress(currentProgress)
  }
}

function scheduleScroll() {
  if (!sampleFrame && ready.value && visible && canAnimate()) sampleFrame = requestAnimationFrame(sampleScroll)
}

function validManifest(value: unknown): value is AtlasManifest {
  if (!value || typeof value !== 'object') return false
  const atlas = value as Partial<AtlasManifest>
  return atlas.version === 1 && atlas.type === 'sprite-atlas' && atlas.asset === 'character.webp'
    && Number.isInteger(atlas.frameCount) && Number(atlas.frameCount) > 0
    && Number.isInteger(atlas.columns) && Number(atlas.columns) > 0
    && Number.isInteger(atlas.rows) && Number(atlas.rows) > 0
    && Number.isInteger(atlas.cellWidth) && Number(atlas.cellWidth) > 0
    && Number.isInteger(atlas.cellHeight) && Number(atlas.cellHeight) > 0
    && Number(atlas.frameCount) <= Number(atlas.columns) * Number(atlas.rows)
}

async function loadAtlas() {
  if (!canAnimate() || ready.value || loadController) return
  const sequence = ++loadSequence
  const controller = new AbortController()
  loadController = controller
  try {
    const response = await fetch(`${assetRoot}character.json`, { signal: controller.signal })
    if (!response.ok) throw new Error('动画帧清单不可用')
    const decoded: unknown = await response.json()
    if (!validManifest(decoded)) throw new Error('动画帧清单无效')
    const image = new Image()
    image.src = atlasUrl
    await image.decode()
    if (sequence !== loadSequence || !canAnimate()) return
    manifest = decoded
    renderFrame(0)
    ready.value = true
    scheduleScroll()
  } catch {
    // A decorative asset must never block the map; the still image remains visible.
    if (sequence === loadSequence) ready.value = false
  } finally {
    if (loadController === controller) loadController = null
  }
}

function updateMotionPreference() {
  if (!canAnimate()) {
    ++loadSequence
    loadController?.abort()
    loadController = null
    stopAnimator()
    ready.value = false
    return
  }
  if (manifest) {
    renderFrame(0)
    ready.value = true
    scheduleScroll()
  } else {
    void loadAtlas()
  }
}

function onIntersection(entries: IntersectionObserverEntry[]) {
  visible = Boolean(entries[0]?.isIntersecting)
  if (visible) scheduleScroll()
  else stopAnimator()
}

function onResize() {
  if (!host.value) return
  startTop = host.value.getBoundingClientRect().top + currentProgress * scrollDistance
  scheduleScroll()
}

onMounted(() => {
  if (!host.value) return
  startTop = host.value.getBoundingClientRect().top
  wideScreen = window.matchMedia('(min-width: 1101px)')
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  wideScreen.addEventListener('change', updateMotionPreference)
  reducedMotion.addEventListener('change', updateMotionPreference)
  document.addEventListener('visibilitychange', updateMotionPreference)
  scrollParents = [window]
  const mapPage = host.value.closest('.map-page')
  const mapCanvas = host.value.closest('.map-canvas')
  if (mapPage) scrollParents.push(mapPage)
  if (mapCanvas) scrollParents.push(mapCanvas)
  for (const parent of scrollParents) parent.addEventListener('scroll', scheduleScroll, { passive: true })
  intersectionObserver = new IntersectionObserver(onIntersection)
  intersectionObserver.observe(host.value)
  resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(host.value)
  updateMotionPreference()
})

onBeforeUnmount(() => {
  ++loadSequence
  loadController?.abort()
  stopAnimator()
  if (sampleFrame) cancelAnimationFrame(sampleFrame)
  for (const parent of scrollParents) parent.removeEventListener('scroll', scheduleScroll)
  wideScreen?.removeEventListener('change', updateMotionPreference)
  reducedMotion?.removeEventListener('change', updateMotionPreference)
  document.removeEventListener('visibilitychange', updateMotionPreference)
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
})
</script>

<template>
  <div ref="host" class="map-basketball-motion" aria-hidden="true" data-testid="map-basketball-motion">
    <div ref="sprite" class="map-basketball-motion__sprite" :class="{ 'is-ready': ready }"></div>
    <img v-if="!ready && !posterFailed" class="map-basketball-motion__still" :src="stillUrl" alt="" draggable="false" @error="posterFailed = true" />
  </div>
</template>

<style scoped>
.map-basketball-motion{position:relative;width:240px;height:140px;overflow:hidden;pointer-events:none;user-select:none;align-self:end}
.map-basketball-motion__sprite,.map-basketball-motion__still{position:absolute;bottom:0;left:24px;width:140px;height:140px;object-fit:contain}
.map-basketball-motion__sprite{visibility:hidden;background-repeat:no-repeat}
.map-basketball-motion__sprite.is-ready{visibility:visible}
@media(max-width:1100px){.map-basketball-motion{display:none}}
</style>
