import { Container, Graphics, Text } from "pixi.js";
import {
  BELT_Y,
  CUP_GRADE,
  type CupGrade,
  type KyusuPourWorld,
  SPOUT_X,
  SPOUT_Y,
} from "./engine/world";

const POPUP_LIFETIME = 1;
const SPLASH_LIFETIME = 0.45;
const MAX_SPLASHES = 48;
const BELT_STRIPE_SPACING = 36;
const POT_REST_ROTATION = 0.3;
const POT_POUR_ROTATION = 0.95;
const TEA_COLOR = 0x9fbf3b;
const CUP_BODY_COLOR = 0x23262f;
const CUP_RIM_COLOR = 0xe8e1d1;
const CLAY_COLOR = 0xb4532a;
const CLAY_DARK_COLOR = 0x8a3a1c;

export const GRADE_COLORS: Readonly<Record<CupGrade, number>> = {
  [CUP_GRADE.perfect]: 0x7cf5c4,
  [CUP_GRADE.good]: 0x6ee7ff,
  [CUP_GRADE.short]: 0xff6b6b,
  [CUP_GRADE.over]: 0xff6b6b,
};

interface Popup {
  readonly text: Text;
  age: number;
}

interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/**
 * Kyusu Pour の pixi.js 描画。ワールドは画面比の座標で状態を持つため、
 * 毎フレーム現在の画面サイズを掛けて px に変換して描き直す。
 */
export class SceneRenderer {
  readonly root = new Container();
  private readonly beltGraphics = new Graphics();
  private readonly cupGraphics = new Graphics();
  private readonly streamGraphics = new Graphics();
  private readonly splashGraphics = new Graphics();
  private readonly pot = new Container();
  private readonly potGraphics = new Graphics();
  private readonly popupContainer = new Container();
  private readonly popups: Popup[] = [];
  private readonly splashes: Splash[] = [];
  private potRadius = 0;

  constructor() {
    this.pot.addChild(this.potGraphics);
    this.root.addChild(
      this.beltGraphics,
      this.cupGraphics,
      this.streamGraphics,
      this.splashGraphics,
      this.pot,
      this.popupContainer,
    );
  }

  showPopup(label: string, color: number, x: number, y: number): void {
    const text = new Text({
      text: label,
      style: { fill: color, fontSize: 20, fontWeight: "800" },
    });
    text.anchor.set(0.5, 1);
    text.position.set(x, y);
    this.popupContainer.addChild(text);
    this.popups.push({ text, age: 0 });
  }

  addSplash(x: number, y: number): void {
    if (this.splashes.length >= MAX_SPLASHES) return;
    const direction = Math.random() < 0.5 ? -1 : 1;
    this.splashes.push({
      x,
      y,
      vx: direction * (30 + Math.random() * 70),
      vy: -(60 + Math.random() * 90),
      age: 0,
    });
  }

  render(world: KyusuPourWorld, width: number, height: number, deltaSeconds: number): void {
    this.drawBelt(world, width, height);
    this.drawCups(world, width, height);
    this.drawStream(world, width, height);
    this.drawPot(world, width, height);
    this.updateSplashes(deltaSeconds);
    this.updatePopups(deltaSeconds);
  }

  private drawBelt(world: KyusuPourWorld, width: number, height: number): void {
    const beltTop = BELT_Y * height;
    const g = this.beltGraphics;
    g.clear();
    g.rect(0, beltTop, width, height - beltTop).fill({ color: 0x1b1e27 });
    g.rect(0, beltTop, width, 3).fill({ color: 0x3a3f4d });
    const offset = (world.beltTravel * width) % BELT_STRIPE_SPACING;
    for (let x = -offset; x < width; x += BELT_STRIPE_SPACING) {
      g.rect(x, beltTop + 10, 3, height - beltTop - 20).fill({ color: 0x2b2f3a });
    }
    g.rect(SPOUT_X * width - 1, SPOUT_Y * height, 2, beltTop - SPOUT_Y * height).fill({
      color: 0xffffff,
      alpha: 0.06,
    });
  }

  private drawCups(world: KyusuPourWorld, width: number, height: number): void {
    const g = this.cupGraphics;
    g.clear();
    const bottom = BELT_Y * height;
    for (const cup of world.cups) {
      const cx = cup.x * width;
      const topWidth = cup.width * width;
      const bottomWidth = topWidth * 0.8;
      const cupHeight = world.cupHeight(cup) * height;
      const top = bottom - cupHeight;
      const outline = [
        cx - topWidth / 2,
        top,
        cx + topWidth / 2,
        top,
        cx + bottomWidth / 2,
        bottom,
        cx - bottomWidth / 2,
        bottom,
      ];
      g.poly(outline).fill({ color: CUP_BODY_COLOR });

      const fillRatio = cup.filled / cup.capacity;
      if (fillRatio > 0) {
        const fillTop = bottom - cupHeight * fillRatio;
        const fillTopWidth = bottomWidth + (topWidth - bottomWidth) * fillRatio;
        g.poly([
          cx - fillTopWidth / 2,
          fillTop,
          cx + fillTopWidth / 2,
          fillTop,
          cx + bottomWidth / 2,
          bottom,
          cx - bottomWidth / 2,
          bottom,
        ]).fill({ color: TEA_COLOR, alpha: 0.85 });
      }

      const targetY = bottom - cupHeight * cup.targetRatio;
      const targetHalfWidth = (bottomWidth + (topWidth - bottomWidth) * cup.targetRatio) / 2;
      g.moveTo(cx - targetHalfWidth, targetY)
        .lineTo(cx + targetHalfWidth, targetY)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.75 });

      const rimColor = cup.grade ? GRADE_COLORS[cup.grade] : CUP_RIM_COLOR;
      g.poly(outline).stroke({ width: 3, color: rimColor, alpha: cup.grade ? 1 : 0.9 });
    }
  }

  private drawStream(world: KyusuPourWorld, width: number, height: number): void {
    const g = this.streamGraphics;
    g.clear();
    const x = SPOUT_X * width;
    const drops = world.drops;
    drops.forEach((drop, index) => {
      const thickness = Math.min(8, 2 + drop.volume * 0.9);
      const newer = drops[index + 1];
      if (newer && drop.y - newer.y < 0.15) {
        g.moveTo(x, drop.y * height)
          .lineTo(x, newer.y * height)
          .stroke({ width: thickness, color: TEA_COLOR, alpha: 0.9 });
      }
      g.circle(x, drop.y * height, thickness / 2).fill({ color: TEA_COLOR });
    });
  }

  private drawPot(world: KyusuPourWorld, width: number, height: number): void {
    const radius = Math.min(width, height) * 0.075;
    if (radius !== this.potRadius) {
      this.potRadius = radius;
      this.redrawPot(radius);
    }
    // 注ぎ口の先端を回転中心にしているので、どれだけ傾けてもお茶の出る位置は動かない。
    this.pot.position.set(SPOUT_X * width, SPOUT_Y * height);
    this.pot.rotation = POT_REST_ROTATION - world.tilt * POT_POUR_ROTATION;
  }

  private redrawPot(r: number): void {
    const g = this.potGraphics;
    g.clear();
    g.moveTo(0, 0)
      .lineTo(r * 1.25, r * 0.65)
      .stroke({ width: r * 0.32, color: CLAY_COLOR, cap: "round" });
    g.rect(r * 2.7, r * 0.35, r * 1.5, r * 0.3).fill({ color: CLAY_DARK_COLOR });
    g.circle(r * 2, r * 0.85, r).fill({ color: CLAY_COLOR });
    g.ellipse(r * 2, -r * 0.05, r * 0.55, r * 0.16).fill({ color: CLAY_DARK_COLOR });
    g.circle(r * 2, -r * 0.25, r * 0.14).fill({ color: CLAY_DARK_COLOR });
  }

  private updateSplashes(deltaSeconds: number): void {
    const g = this.splashGraphics;
    g.clear();
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const splash = this.splashes[i];
      splash.age += deltaSeconds;
      splash.vy += 420 * deltaSeconds;
      splash.x += splash.vx * deltaSeconds;
      splash.y += splash.vy * deltaSeconds;
      if (splash.age >= SPLASH_LIFETIME) {
        this.splashes.splice(i, 1);
        continue;
      }
      g.circle(splash.x, splash.y, 2.5).fill({
        color: TEA_COLOR,
        alpha: 1 - splash.age / SPLASH_LIFETIME,
      });
    }
  }

  private updatePopups(deltaSeconds: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const popup = this.popups[i];
      popup.age += deltaSeconds;
      popup.text.position.y -= deltaSeconds * 28;
      popup.text.alpha = Math.max(0, 1 - popup.age / POPUP_LIFETIME);
      if (popup.age >= POPUP_LIFETIME) {
        this.popupContainer.removeChild(popup.text);
        popup.text.destroy();
        this.popups.splice(i, 1);
      }
    }
  }
}
