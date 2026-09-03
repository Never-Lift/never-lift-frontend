import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  raceApi,
  type TrackCatalog,
  type TrackCatalogEntry,
  type TrackDefinition,
} from '@/lib/api'
import { getErrorMessage } from '@/lib/error-messages'

type TrackCarouselProps = {
  catalog: TrackCatalog | null
  selectedId: string | null
  disabled?: boolean
  getTrack?: typeof raceApi.getTrack
  onSelect: (trackId: string) => void
  onLoadError: (message: string) => void
}

type DragState = {
  pointerId: number
  originX: number
  originScrollLeft: number
  moved: boolean
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function trackMatches(track: TrackCatalogEntry, search: string) {
  if (!search) return true
  return normalizeSearch(
    `${track.name} ${track.countryName} ${track.countryCode} ${track.locality}`,
  ).includes(search)
}

function TrackSilhouette({
  track,
  name,
}: {
  track?: TrackDefinition
  name: string
}) {
  if (!track) {
    return (
      <div
        aria-label={`Carregando traçado ${name}`}
        className="h-24 animate-pulse rounded-lg bg-muted/60"
      />
    )
  }

  const width = Math.max(1, track.bounds.maxX - track.bounds.minX)
  const height = Math.max(1, track.bounds.maxY - track.bounds.minY)
  const points = track.centerline
    .map((point) => `${point.x},${-point.y}`)
    .join(' ')

  return (
    <svg
      aria-label={`Traçado ${name}`}
      className="h-24 w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={`${track.bounds.minX - width * 0.08} ${-track.bounds.maxY - height * 0.08} ${width * 1.16} ${height * 1.16}`}
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={Math.max(width, height) * 0.014}
      />
    </svg>
  )
}

function TrackCard({
  track,
  definition,
  selected,
  disabled,
  eager,
  onVisible,
  onSelect,
}: {
  track: TrackCatalogEntry
  definition?: TrackDefinition
  selected: boolean
  disabled: boolean
  eager: boolean
  onVisible: () => void
  onSelect: () => void
}) {
  const cardRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (definition) return
    const card = cardRef.current
    if (!card || typeof IntersectionObserver === 'undefined') {
      if (eager) onVisible()
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onVisible()
          observer.disconnect()
        }
      },
      { rootMargin: '180px' },
    )
    observer.observe(card)
    return () => observer.disconnect()
  }, [definition, eager, onVisible])

  return (
    <button
      aria-label={`Selecionar ${track.name}`}
      aria-selected={selected}
      className={`w-44 shrink-0 snap-start rounded-xl border p-2.5 text-left transition sm:w-48 ${
        selected
          ? 'border-info bg-info/10 text-info shadow-[0_0_0_1px_rgb(49_199_255/0.25)]'
          : 'border-border/70 bg-background/35 text-muted-foreground hover:border-info/45 hover:text-foreground'
      } disabled:cursor-not-allowed disabled:opacity-55`}
      disabled={disabled}
      onClick={onSelect}
      ref={cardRef}
      role="option"
      type="button"
    >
      <TrackSilhouette name={track.name} track={definition} />
      <span className="mt-2 block truncate text-center text-xs font-extrabold text-foreground">
        {track.name}
      </span>
      <span className="mt-0.5 block truncate text-center text-[10px] font-semibold text-muted-foreground">
        {track.countryName} · {track.locality}
      </span>
    </button>
  )
}

export function TrackCarousel({
  catalog,
  selectedId,
  disabled = false,
  getTrack = raceApi.getTrack,
  onSelect,
  onLoadError,
}: TrackCarouselProps) {
  const tracks = useMemo(() => catalog?.tracks ?? [], [catalog])
  const selectedTrack = tracks.find((track) => track.id === selectedId)
  const [search, setSearch] = useState('')
  const [definitions, setDefinitions] = useState<Record<string, TrackDefinition>>({})
  const loadingIds = useRef(new Set<string>())
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const normalizedSearch = normalizeSearch(search)
  const filteredTracks = useMemo(
    () => tracks.filter((track) => trackMatches(track, normalizedSearch)),
    [normalizedSearch, tracks],
  )

  const loadDefinition = useCallback(
    (trackId: string) => {
      if (definitions[trackId] || loadingIds.current.has(trackId)) return
      loadingIds.current.add(trackId)
      getTrack(trackId)
        .then((definition) => {
          setDefinitions((current) => ({ ...current, [trackId]: definition }))
        })
        .catch((loadError: unknown) => onLoadError(getErrorMessage(loadError)))
        .finally(() => loadingIds.current.delete(trackId))
    },
    [definitions, getTrack, onLoadError],
  )

  useEffect(() => {
    if (selectedId) loadDefinition(selectedId)
  }, [loadDefinition, selectedId])

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollLeft = 0
  }, [normalizedSearch])

  function scrollByPage(direction: -1 | 1) {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollBy({
      behavior: 'smooth',
      left: direction * Math.max(180, scroller.clientWidth * 0.78),
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return
    const scroller = scrollerRef.current
    if (!scroller) return
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originScrollLeft: scroller.scrollLeft,
      moved: false,
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || !scroller || drag.pointerId !== event.pointerId) return
    const distance = event.clientX - drag.originX
    if (Math.abs(distance) > 5 && !drag.moved) {
      drag.moved = true
      scroller.setPointerCapture?.(event.pointerId)
    }
    if (drag.moved) scroller.scrollLeft = drag.originScrollLeft - distance
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    suppressClickRef.current = drag.moved
    dragRef.current = null
    if (scroller?.hasPointerCapture?.(event.pointerId)) {
      scroller.releasePointerCapture(event.pointerId)
    }
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
  }

  return (
    <section aria-label="Escolha de circuito">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Pista
          {selectedTrack && (
            <span className="ml-2 text-info">{selectedTrack.name}</span>
          )}
        </p>
        <div className="flex gap-1">
          <Button
            aria-label="Circuitos anteriores"
            disabled={disabled || filteredTracks.length === 0}
            onClick={() => scrollByPage(-1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button
            aria-label="Próximos circuitos"
            disabled={disabled || filteredTracks.length === 0}
            onClick={() => scrollByPage(1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>

      <label className="relative mb-3 block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Pesquisar circuitos"
          className="pl-9"
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Pesquisar por circuito, país ou cidade"
          type="search"
          value={search}
        />
      </label>

      <div
        aria-label="Selecionar pista"
        className="flex touch-pan-y snap-x snap-mandatory gap-2 overflow-x-auto pb-3 pr-8 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden cursor-grab active:cursor-grabbing"
        onClickCapture={(event) => {
          if (suppressClickRef.current) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onPointerCancel={finishDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        ref={scrollerRef}
        role="listbox"
      >
        {filteredTracks.map((track, index) => (
          <TrackCard
            definition={definitions[track.id]}
            disabled={disabled}
            eager={track.id === selectedId || index === 0}
            key={track.id}
            onSelect={() => onSelect(track.id)}
            onVisible={() => loadDefinition(track.id)}
            selected={track.id === selectedId}
            track={track}
          />
        ))}
      </div>
      {filteredTracks.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          Nenhum circuito corresponde à pesquisa.
        </p>
      )}
    </section>
  )
}
