"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./GameShell.module.scss";

export interface GameShellProps {
  title: string;
  /** 数値を渡すとスコア表示が出る。スコアを使わないゲームは省略可。 */
  score?: number;
  scoreLabel?: string;
  isPaused?: boolean;
  onTogglePause?: () => void;
  /** 一時停止中に stage の上に重ねるオーバーレイの文言。省略時は既定文言。 */
  pauseHint?: string;
  children: ReactNode;
}

/**
 * 各ゲーム共通のヘッダー（一覧へ戻る導線 / タイトル / スコア / 一時停止）と
 * canvas を差し込むための stage 領域を提供するシェル。
 * ゲーム側は stage の中身（pixi/three のマウント先 div など）だけを気にすればよい。
 */
export function GameShell({
  title,
  score,
  scoreLabel = "SCORE",
  isPaused = false,
  onTogglePause,
  pauseHint = "タップ / Space キーで再開",
  children,
}: GameShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.back} data-testid="game-shell-back">
          ← 一覧へ
        </Link>
        <h1 className={styles.title} data-testid="game-shell-title">
          {title}
        </h1>
        {typeof score === "number" && (
          <div className={styles.score} data-testid="game-shell-score">
            {scoreLabel} {Math.floor(score).toLocaleString("ja-JP")}
          </div>
        )}
        {onTogglePause && (
          <button
            type="button"
            className={styles.pauseButton}
            onClick={onTogglePause}
            data-testid="game-shell-pause"
          >
            {isPaused ? "再開" : "一時停止"}
          </button>
        )}
      </header>
      <div className={styles.stage} data-testid="game-shell-stage">
        {children}
        {isPaused && (
          <div className={styles.pauseOverlay} data-testid="game-shell-pause-overlay">
            <div className={styles.pauseOverlayTitle}>一時停止中</div>
            <div className={styles.pauseOverlayHint}>{pauseHint}</div>
          </div>
        )}
      </div>
    </div>
  );
}
