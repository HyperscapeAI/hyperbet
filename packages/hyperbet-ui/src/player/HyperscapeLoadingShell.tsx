import type { CSSProperties } from "react";

import logoUrl from "../assets/hyperscape-loader/logo.png";
import type { ViewerBootPhase } from "./viewerBootPhases";

import "./hlsPlayer.css";

export interface HyperscapeLoadingShellProps {
  visible: boolean;
  phase: ViewerBootPhase;
  progress: number;
  stageLabel: string;
  overlayMessage?: string | null;
}

export function HyperscapeLoadingShell({
  visible,
  phase,
  progress,
  stageLabel,
  overlayMessage = null,
}: HyperscapeLoadingShellProps) {
  const progressValue = Math.max(0, Math.min(100, progress));
  const isFinishing = progressValue >= 99.5;
  const rootStyle = {
    "--hb-loader-progress": `${progressValue}%`,
  } as CSSProperties;

  return (
    <div
      className={`hb-hls-player-loader${visible ? "" : " is-hidden"}`}
      data-phase={phase}
      style={rootStyle}
    >
      <div className="hb-hls-player-loader__image" />
      <div className="hb-hls-player-loader__shade" />

      <div className="hb-hls-player-loader__logo-container">
        <img
          src={logoUrl}
          alt="Hyperscape"
          className="hb-hls-player-loader__logo"
        />

        <div className="hb-hls-player-loader__center-progress">
          <div className="hb-hls-player-loader__stage">{stageLabel}</div>
          <div className="hb-hls-player-loader__progress">
            <div className="hb-hls-player-loader__track">
              <div className="hb-hls-player-loader__bar-container">
                <div
                  className={`hb-hls-player-loader__bar${
                    isFinishing ? " is-finishing" : ""
                  }`}
                />
              </div>
              <div className="hb-hls-player-loader__bar-frame" />
            </div>
            <div className="hb-hls-player-loader__percentage">
              {Math.floor(progressValue)}%
            </div>
          </div>
        </div>
      </div>

      {overlayMessage ? (
        <div className="hb-hls-player-loader__overlay">
          <div className="hb-hls-player-loader__overlay-card">
            {overlayMessage}
          </div>
        </div>
      ) : null}
    </div>
  );
}
