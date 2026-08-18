import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  ShuffleIcon,
  RepeatIcon,
  Repeat1Icon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ProgressSlider,
  VolumeControl,
  formatTime,
  repeatLabel,
  useITunesCover,
} from "@/components/layout/player-bar";
import {
  LyricsBody,
  LyricsSourceButton,
  useLyricsView,
} from "@/components/layout/lyrics-view";
import { Thumbnail, pickHighResThumbnail } from "@/components/shared/thumbnail";
import { ArtworkOutline } from "@/components/shared/artwork-outline";
import { ArtistLinks } from "@/components/shared/artist-links";
import { LikeDislikeButtons } from "@/components/shared/like-buttons";
import { PlayerMoreMenu } from "@/components/layout/player-more-menu";
import { usePlaybackStore, currentTrack } from "@/lib/store/playback";
import { useScrubStore } from "@/lib/store/scrub";
import { useNowPlayingStore } from "@/lib/store/now-playing";
import { cn } from "@/lib/utils";

/**
 * Immersive full-window "Now Playing" screen: full-size album cover on the
 * left, full-size synced karaoke lyrics on the right, over a blurred copy
 * of the cover.
 *
 * Reuses the whole existing player stack — the same playback/scrub stores,
 * the `ProgressSlider`/`VolumeControl` bits exported from the player bar,
 * and the `LyricsBody`/`useLyricsView` karaoke engine (which reads the
 * playback position + scrub internally, highlights the active line, and
 * seeks on line click). The only new logic here is layout.
 *
 * Notes on why it's built the way it is:
 *  - Portaled to `document.body` so `app-shell` can flip the app root
 *    `inert` while it's open (background removed from tab order + a11y
 *    tree) without any sibling gymnastics. React context still flows
 *    through the portal, so the reused QueryClient/Router/store consumers
 *    keep working.
 *  - Its own `TooltipProvider delayDuration={800}` because it mounts inside
 *    `SidebarProvider`'s `delay=0` provider (same reason both bars re-wrap).
 *  - The content is forced into a `dark` token context: the reused lyrics /
 *    volume / like / source-menu components paint with themed foreground
 *    colors, which would be dark-on-dark over this backdrop in the light
 *    theme. `dark` makes them light regardless of the app theme.
 *  - Positioned below the 36px custom title bar (`top-(--titlebar-h)`) so
 *    the OS window controls + drag region stay usable while it's open.
 */
export function NowPlayingOverlay() {
  const { playing, status, position, duration, shuffle, repeat } =
    usePlaybackStore(
      useShallow((s) => ({
        playing: s.playing,
        status: s.status,
        position: s.position,
        duration: s.duration,
        shuffle: s.shuffle,
        repeat: s.repeat,
      })),
    );
  const track = usePlaybackStore(currentTrack);
  const toggle = usePlaybackStore((s) => s.toggle);
  const next = usePlaybackStore((s) => s.next);
  const prev = usePlaybackStore((s) => s.prev);
  const seek = usePlaybackStore((s) => s.seek);
  const setShuffle = usePlaybackStore((s) => s.setShuffle);
  const cycleRepeat = usePlaybackStore((s) => s.cycleRepeat);

  const scrub = useScrubStore((s) => s.scrub);
  const setScrub = useScrubStore((s) => s.setScrub);
  const setOpen = useNowPlayingStore((s) => s.setOpen);

  const iTunesCover = useITunesCover(track);
  const lyricsState = useLyricsView(track);
  const reduce = useReducedMotion();

  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Esc-to-close + focus management (see doc comment). The
  // `defaultPrevented` guard mirrors app-shell's `useGlobalShortcuts` so a
  // press that Radix already consumed (closing an open lyrics-source menu
  // or a tooltip) doesn't also close the overlay. Focus moves into the
  // overlay on open and is restored to the expand trigger on close;
  // combined with `inert` on the app root (app-shell), that's a compliant
  // modal focus model without a focus-trap library.
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prevFocused?.focus?.();
    };
  }, [setOpen]);

  // Auto-close guarded upstream (hasTrack in app-shell); this null-guard
  // only covers the frame where the queue empties while we're still mounted.
  if (!track) return null;

  const loading = status === "loading" && playing;
  const coverUrl =
    track.thumbnails && track.thumbnails.length > 0
      ? pickHighResThumbnail(track.thumbnails)
      : null;

  const overlay = (
    <TooltipProvider delayDuration={800} skipDelayDuration={0}>
      <motion.div
        role="region"
        aria-label="Now playing"
        initial={{ opacity: 0, scale: reduce ? 1 : 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduce ? 0.12 : 0.2, ease: "easeOut" }}
        className="dark fixed inset-x-0 bottom-0 top-(--titlebar-h) z-40 flex flex-col overflow-hidden bg-background text-foreground"
      >
        {/* Blurred cover backdrop. A single static image (never animate the
            blur radius) — cheaper than a live `backdrop-filter` sampling
            the whole window, and this view only ever shows one track. */}
        {coverUrl ? (
          <img
            key={coverUrl}
            src={coverUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover blur-3xl saturate-150"
            style={{ opacity: 0.35 }}
          />
        ) : null}
        {/* Dark scrim: blur alone does not guarantee contrast over a bright
            cover, so a ~50% scrim keeps text readable over arbitrary art. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-black/55"
        />

        {/* Close */}
        <div className="relative flex shrink-0 justify-end p-3">
          <Button
            ref={closeBtnRef}
            variant="ghost"
            size="icon"
            aria-label="Close now playing"
            onClick={() => setOpen(false)}
            className="text-white hover:bg-white/10"
          >
            <XIcon />
          </Button>
        </div>

        {/* Two columns: cover+controls left, lyrics right. Stacks on narrow
            widths. Every ancestor of the lyrics body is a `min-h-0` flex
            column so its internal `h-full` scroller resolves. */}
        <div className="relative flex min-h-0 flex-1 flex-col gap-6 px-6 pb-8 lg:flex-row lg:gap-10 lg:px-10">
          {/* LEFT */}
          <div className="flex min-h-0 flex-col items-center justify-center gap-5 lg:w-1/2">
            <div className="relative isolate aspect-square w-full max-w-[min(70vw,38vh)] rounded-xl shadow-[0_8px_40px_rgb(0_0_0/0.45)] lg:max-w-[min(80vw,58vh)]">
              <Thumbnail
                thumbnails={track.thumbnails}
                alt={track.title}
                className="size-full rounded-xl pointer-events-none"
                targetSize={1024}
                highRes
                overrideHighRes={iTunesCover}
              />
              <ArtworkOutline className="rounded-xl" />
            </div>

            {/* Meta + like. `text-white` (not a token) guarantees contrast
                directly over the blurred cover; text-shadow is the safety
                net for the brightest covers. */}
            <div className="flex w-full max-w-xl items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-2xl font-semibold text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]">
                  {track.title}
                </span>
                <ArtistLinks
                  artists={track.artists}
                  fallback={track.subtitle ?? ""}
                  className="truncate text-base text-white/70 [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]"
                />
              </div>
              <LikeDislikeButtons
                videoId={track.videoId}
                track={track}
                className="shrink-0"
              />
            </div>

            {/* Progress */}
            <div className="flex w-full max-w-xl flex-col gap-2">
              <ProgressSlider
                position={position}
                duration={duration}
                scrub={scrub}
                setScrub={setScrub}
                seek={seek}
                disabled={duration <= 0}
              />
              <div className="flex justify-between text-xs tabular-nums text-white/70">
                <span>{formatTime(scrub ?? position)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Transport — same cluster the player bar renders, scaled up.
                Kept inline (not extracted) so the two working bars stay
                untouched. */}
            <div className="flex items-center justify-center gap-2 text-white">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Shuffle"
                aria-pressed={shuffle}
                onClick={() => setShuffle(!shuffle)}
                className={cn("hover:bg-white/10", shuffle && "text-brand")}
              >
                <ShuffleIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous"
                onClick={prev}
                className="hover:bg-white/10"
              >
                <SkipBackIcon className="fill-current" />
              </Button>
              <Button
                size="icon"
                aria-label={playing ? "Pause" : "Play"}
                onClick={toggle}
                className="size-14 rounded-full bg-brand text-white hover:bg-brand/90"
              >
                {loading ? (
                  <Loader2Icon className="animate-spin" />
                ) : playing ? (
                  <PauseIcon className="fill-current" />
                ) : (
                  <PlayIcon className="fill-current" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next"
                onClick={next}
                className="hover:bg-white/10"
              >
                <SkipForwardIcon className="fill-current" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={repeatLabel(repeat)}
                    aria-pressed={repeat !== "off"}
                    onClick={cycleRepeat}
                    className={cn(
                      "hover:bg-white/10",
                      repeat !== "off" && "text-brand",
                    )}
                  >
                    {repeat === "one" ? <Repeat1Icon /> : <RepeatIcon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{repeatLabel(repeat)}</TooltipContent>
              </Tooltip>
            </div>

            {/* Secondary: volume, lyrics source, more */}
            <div className="flex items-center justify-center gap-1">
              <VolumeControl />
              <LyricsSourceButton state={lyricsState} />
              <PlayerMoreMenu track={track} />
            </div>
          </div>

          {/* RIGHT: full-height synced lyrics. `text-shadow` on the wrapper
              is a contrast safety net over the scrim. */}
          <div className="flex min-h-0 flex-1 flex-col lg:w-1/2">
            <div className="min-h-0 flex-1 [text-shadow:0_1px_3px_rgb(0_0_0/0.55)]">
              <LyricsBody state={lyricsState} />
            </div>
          </div>
        </div>
      </motion.div>
    </TooltipProvider>
  );

  return createPortal(overlay, document.body);
}
