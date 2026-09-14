import Link from "next/link";
import { getAllGames } from "@/games-registry";
import styles from "./page.module.scss";

const DIMENSION_LABEL: Record<string, string> = {
  "2d": "2D",
  "3d": "3D",
};

export default function Home() {
  const games = getAllGames();

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>ai-game</h1>
          <p className={styles.heroSubtitle}>
            プロトタイプ品質のWebゲームを少しずつ増やしていくアーカイブです。PC・スマホどちらでも遊べます。
          </p>
        </div>

        {games.length === 0 ? (
          <p className={styles.emptyState}>まだゲームがありません。</p>
        ) : (
          <div className={styles.grid}>
            {games.map((game) => (
              <Link
                key={game.slug}
                href={`/games/${game.slug}`}
                className={styles.card}
                data-testid={`game-card-${game.slug}`}
              >
                <div className={styles.cardTopRow}>
                  <span className={styles.dimensionBadge}>{DIMENSION_LABEL[game.dimension]}</span>
                  <span className={styles.cardDate}>{game.createdAt}</span>
                </div>
                <div className={styles.cardTitle}>{game.title}</div>
                <p className={styles.cardDescription}>{game.description}</p>
                <div className={styles.tagRow}>
                  {game.tags.map((tag) => (
                    <span key={tag} className={styles.tag}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
