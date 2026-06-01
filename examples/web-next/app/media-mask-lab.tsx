'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Rejourney } from '@rejourneyco/browser';

export function MediaMaskLab() {
  const nestedVideoRef = useRef<HTMLVideoElement>(null);
  const ambientVideoRef = useRef<HTMLVideoElement>(null);
  const [nestedVideoPlaying, setNestedVideoPlaying] = useState(false);
  const [posterVisible, setPosterVisible] = useState(true);

  useEffect(() => {
    const video = ambientVideoRef.current;
    if (!video) return;
    video.play().catch(() => {
      // Muted autoplay is best-effort; the nested player remains interactive.
    });
  }, []);

  function setNestedPlayback(nextPlaying: boolean) {
    const video = nestedVideoRef.current;
    setPosterVisible(false);
    setNestedVideoPlaying(nextPlaying);

    if (nextPlaying) {
      video?.play().catch(() => setNestedVideoPlaying(false));
    } else {
      video?.pause();
    }

    Rejourney.logEvent('web_fixture_nested_video_toggled', {
      playing: nextPlaying,
      source: 'web-next',
    });
  }

  function toggleNestedVideo() {
    setNestedPlayback(!nestedVideoPlaying);
  }

  function resetNestedVideo() {
    const video = nestedVideoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setNestedVideoPlaying(false);
    setPosterVisible(true);
    Rejourney.logEvent('web_fixture_nested_video_reset', {
      source: 'web-next',
    });
  }

  function handleNestedKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleNestedVideo();
    }
  }

  return (
    <section className="panel media-panel">
      <p className="eyebrow">Media privacy</p>
      <h2>Brew media replay lab</h2>
      <div className="media-grid">
        <article className="media-card">
          <img
            className="media-image"
            src="/media/brew-home.jpg"
            alt="Brew Coffee Labs recipe feed"
          />
          <div className="media-card-body">
            <span>Recipe hero</span>
            <strong>Image node</strong>
          </div>
        </article>

        <article className="media-card">
          <img
            className="media-image"
            src="/media/brew-index.jpg"
            alt="Brew Coffee Labs sign in screen"
            data-rj-mask-media
          />
          <div className="media-card-body">
            <span>Explicit mask</span>
            <strong>data-rj-mask-media</strong>
          </div>
        </article>

        <article className="media-card media-card-wide">
          <video
            ref={ambientVideoRef}
            className="ambient-video"
            src="/media/brew-nested-video-demo.mp4"
            poster="/media/brew-video-poster.png"
            muted
            loop
            playsInline
            controls
            preload="metadata"
          />
          <div className="media-card-body">
            <span>Browser video</span>
            <strong>Native controls</strong>
          </div>
        </article>

        <article className="media-card media-card-wide">
          <div
            className="nested-video-shell"
            role="button"
            tabIndex={0}
            onClick={toggleNestedVideo}
            onKeyDown={handleNestedKeyDown}
            onDoubleClick={resetNestedVideo}
          >
            <video
              ref={nestedVideoRef}
              className="nested-video"
              src="/media/brew-nested-video-demo.mp4"
              poster="/media/brew-video-poster.png"
              muted
              loop
              playsInline
              preload="metadata"
            />
            {posterVisible ? (
              <img
                className="nested-video-poster"
                src="/media/brew-video-poster.png"
                alt=""
                aria-hidden="true"
              />
            ) : null}
            <div className="nested-video-scrim" aria-hidden="true" />
            <div className="nested-video-control">
              <span className={nestedVideoPlaying ? 'pause-glyph' : 'play-glyph'} aria-hidden="true" />
              <strong>{nestedVideoPlaying ? 'Pause Video' : 'Play Video'}</strong>
            </div>
          </div>
          <div className="media-card-body">
            <span>Nested button</span>
            <strong>Video with poster overlay</strong>
          </div>
        </article>
      </div>
    </section>
  );
}
