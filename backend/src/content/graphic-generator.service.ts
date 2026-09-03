import { Injectable, Logger } from '@nestjs/common';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import axios from 'axios';

/**
 * @napi-rs/canvas bundles a rendering engine but NO fonts — it relies on fonts
 * installed on the host. The production image is node:20-alpine, which ships
 * with none, so every ctx.fillText() drew nothing: generated banners came out
 * with the layout frame, an empty text panel, an unlabelled button and a blank
 * contact bar. Fonts are now installed in the Dockerfile and registered here.
 */
let RESOLVED_FONT_FAMILY = 'sans-serif';
let FONTS_READY = false;

function initFonts(logger: Logger): void {
  if (FONTS_READY) return;
  FONTS_READY = true;

  const dirs = ['/usr/share/fonts', '/usr/local/share/fonts', 'C:\\Windows\\Fonts'];
  let loaded = 0;
  for (const dir of dirs) {
    try {
      const n = GlobalFonts.loadFontsFromDir(dir);
      if (typeof n === 'number') loaded += n;
    } catch {
      // Directory absent on this platform — try the next one.
    }
  }

  let families: string[] = [];
  try {
    families = (GlobalFonts.families || []).map((f: any) => f.family).filter(Boolean);
  } catch {
    families = [];
  }

  // Prefer a known-good sans face; fall back to whatever actually loaded.
  const preferred = [
    'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'FreeSans',
    'Arial', 'Helvetica', 'Segoe UI',
  ];
  const match = preferred.find((p) => families.includes(p)) || families[0];
  if (match) RESOLVED_FONT_FAMILY = match;

  if (!families.length) {
    logger.error(
      '[GraphicGeneratorService] No fonts available to the canvas renderer. Text will NOT appear on generated images. Install a font package (Alpine: apk add font-dejavu fontconfig).',
    );
  } else {
    logger.log(
      `[GraphicGeneratorService] Registered ${loaded} font file(s); ${families.length} family/families available. Using "${RESOLVED_FONT_FAMILY}".`,
    );
  }
}

/** Builds a canvas font string using the family that is actually available. */
function font(weightAndSize: string): string {
  return `${weightAndSize} "${RESOLVED_FONT_FAMILY}", sans-serif`;
}

/**
 * DejaVu and the other bundled faces have no emoji glyphs, so emoji in canvas
 * text render as blank space or tofu boxes. Strip them from drawn strings.
 */
function stripEmoji(text: string): string {
  return String(text ?? '')
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface BrandedGraphicOptions {
  businessName: string;
  offerText: string;
  niche?: string;
  vibe?: string;
  headline?: string;
  description?: string;
  ctaType?: string;
  logoUrl?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  contactDetails?: {
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
  };
  brandColors?: string[];
  bgImageUrl?: string;
  /**
   * Distinguishes one post's artwork from another's. Without it every post in
   * a plan whose AI background failed rendered the exact same flat gradient,
   * so a week of posts looked like six copies of one image.
   */
  variantSeed?: string;
  bgImageBuffer?: Buffer;
  aspectRatio?: '1:1' | '4:5' | '9:16';
}

export interface VibePalette {
  bgStart: string;
  bgEnd: string;
  accent: string;
  badgeBg: string;
  badgeText: string;
  cardBg: string;
  cardBorder: string;
  textColor: string;
  subtextColor: string;
}

@Injectable()
export class GraphicGeneratorService {
  private readonly logger = new Logger(GraphicGeneratorService.name);

  constructor() {
    initFonts(this.logger);
  }

  /**
   * Returns tailored color palettes based on user brand colors or brand vibe.
   */
  private getPalette(brandColors?: string[], vibe?: string): VibePalette {
    if (Array.isArray(brandColors) && brandColors.length > 0) {
      const primary = brandColors[0] || '#4F46E5';
      const secondary = brandColors[1] || '#7C3AED';

      return {
        bgStart: primary,
        bgEnd: '#0f172a',
        accent: secondary,
        badgeBg: 'rgba(255, 255, 255, 0.15)',
        badgeText: '#ffffff',
        cardBg: 'rgba(15, 23, 42, 0.78)',
        cardBorder: secondary,
        textColor: '#ffffff',
        subtextColor: '#e2e8f0',
      };
    }

    const v = (vibe || '').toLowerCase();

    if (v.includes('luxurious') || v.includes('elite') || v.includes('premium')) {
      return {
        bgStart: '#2e1065',
        bgEnd: '#0f051d',
        accent: '#eab308',
        badgeBg: 'rgba(234, 179, 8, 0.2)',
        badgeText: '#fef08a',
        cardBg: 'rgba(15, 5, 29, 0.75)',
        cardBorder: 'rgba(234, 179, 8, 0.4)',
        textColor: '#ffffff',
        subtextColor: '#cbd5e1',
      };
    }

    if (v.includes('eco') || v.includes('sustainable') || v.includes('mindful') || v.includes('natural') || v.includes('organic')) {
      return {
        bgStart: '#064e3b',
        bgEnd: '#022c22',
        accent: '#10b981',
        badgeBg: 'rgba(16, 185, 129, 0.2)',
        badgeText: '#a7f3d0',
        cardBg: 'rgba(2, 44, 34, 0.75)',
        cardBorder: 'rgba(16, 185, 129, 0.4)',
        textColor: '#ffffff',
        subtextColor: '#cbd5e1',
      };
    }

    if (v.includes('festive') || v.includes('playful') || v.includes('joyful')) {
      return {
        bgStart: '#881337',
        bgEnd: '#4c0519',
        accent: '#f59e0b',
        badgeBg: 'rgba(245, 158, 11, 0.2)',
        badgeText: '#fde68a',
        cardBg: 'rgba(76, 5, 25, 0.75)',
        cardBorder: 'rgba(245, 158, 11, 0.4)',
        textColor: '#ffffff',
        subtextColor: '#cbd5e1',
      };
    }

    if (v.includes('bold') || v.includes('high-energy') || v.includes('casual') || v.includes('energetic')) {
      return {
        bgStart: '#1e1b4b',
        bgEnd: '#0f172a',
        accent: '#06b6d4',
        badgeBg: 'rgba(6, 182, 212, 0.2)',
        badgeText: '#67e8f9',
        cardBg: 'rgba(15, 23, 42, 0.75)',
        cardBorder: 'rgba(6, 182, 212, 0.4)',
        textColor: '#ffffff',
        subtextColor: '#cbd5e1',
      };
    }

    // Default: Professional Corporate Navy & Cyan
    return {
      bgStart: '#0b2240',
      bgEnd: '#07172c',
      accent: '#0076a3',
      badgeBg: 'rgba(0, 118, 163, 0.25)',
      badgeText: '#38bdf8',
      cardBg: 'rgba(7, 23, 44, 0.8)',
      cardBorder: 'rgba(0, 118, 163, 0.4)',
      textColor: '#ffffff',
      subtextColor: '#cbd5e1',
    };
  }

  /**
   * Safely loads an image buffer from URL or Buffer for Canvas rendering.
   */
  private async fetchImageCanvasBuffer(source?: string | Buffer): Promise<any | null> {
    if (!source) return null;
    try {
      if (Buffer.isBuffer(source)) {
        return await loadImage(source);
      }
      if (typeof source === 'string') {
        if (source.startsWith('data:image')) {
          const base64Data = source.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          return await loadImage(buffer);
        }
        // Fetch remote AI-generated image buffer with browser headers & fallback
        let imageBuffer: Buffer | null = null;
        let fetchUrl = source;

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await axios.get(fetchUrl, {
              // Pollinations renders the image on demand when the URL is first
              // requested, which regularly takes 10-30s for a long prompt. The
              // old 5s timeout aborted most of those, so the branded graphic
              // was composited over a bare gradient with no photo behind it.
              responseType: 'arraybuffer',
              timeout: 45_000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              },
            });
            imageBuffer = Buffer.from(response.data);
            break;
          } catch (fetchErr: any) {
            this.logger.warn(`[GraphicGeneratorService] Image fetch attempt ${attempt} failed: ${fetchErr.message}`);
            if (attempt === 2) break;
            if (fetchUrl.includes('model=flux')) {
              fetchUrl = fetchUrl.replace('model=flux', 'model=turbo');
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        if (imageBuffer) {
          return await loadImage(imageBuffer);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Failed to fetch/load image canvas buffer: ${err.message}`);
    }
    return null;
  }

  /**
   * Generates a platform-tailored, high-quality branded social graphic as a PNG Buffer.
   * Composites:
   * 1. AI-generated Visual Scene Background
   * 2. Real Uploaded User Logo (or brand mark)
   * 3. Glassmorphic Text Card with Headline, Offer, & Subheading
   * 4. 3D CTA Button
   * 5. Contact Details Footer Bar
   */
  /** Stable small integer from a string, so a given post always looks the same. */
  private seedFrom(value: string): number {
    let h = 0;
    for (let i = 0; i < value.length; i++) {
      h = (h * 31 + value.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  /**
   * Draws the background used when no AI visual is available.
   *
   * This used to be one fixed gradient plus one centred glow, identical for
   * every post, which is why a generated plan looked like the same picture
   * repeated. The seed picks a different composition, gradient direction and
   * accent geometry per post, so a week of posts reads as a set rather than a
   * duplicate.
   */
  private drawDesignedBackground(
    ctx: any,
    width: number,
    height: number,
    palette: VibePalette,
    seedText: string,
  ): void {
    // Unsigned shifts throughout: `>>` on a uint32 above 2^31 returns a
    // negative number, which then indexes out of these tables.
    const seed = this.seedFrom(seedText || 'visionpilot');
    const variant = seed % 5;
    const angle = (seed >>> 3) % 4;

    // Gradient direction varies so two posts never share the same wash.
    const coords: [number, number, number, number][] = [
      [0, 0, width, height],
      [width, 0, 0, height],
      [0, height, width, 0],
      [width / 2, 0, width / 2, height],
    ];
    const [x0, y0, x1, y1] = coords[angle];
    const bg = ctx.createLinearGradient(x0, y0, x1, y1);
    bg.addColorStop(0, palette.bgStart);
    bg.addColorStop(1, palette.bgEnd);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();

    if (variant === 0) {
      // Soft off-centre glow.
      const cx = width * (0.25 + ((seed >>> 5) % 50) / 100);
      const cy = height * 0.35;
      const aura = ctx.createRadialGradient(cx, cy, 40, cx, cy, width * 0.75);
      aura.addColorStop(0, palette.accent + '55');
      aura.addColorStop(1, 'transparent');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, width, height);
    } else if (variant === 1) {
      // Diagonal ribbons.
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = palette.accent;
      const band = width / 9;
      for (let i = -1; i < 12; i += 2) {
        ctx.save();
        ctx.translate(i * band, 0);
        ctx.rotate((22 * Math.PI) / 180);
        ctx.fillRect(0, -height, band, height * 3);
        ctx.restore();
      }
    } else if (variant === 2) {
      // Concentric arcs radiating from a corner.
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 14;
      const ox = seed % 2 === 0 ? 0 : width;
      for (let r = width * 0.25; r < width * 1.5; r += width * 0.14) {
        ctx.beginPath();
        ctx.arc(ox, height, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (variant === 3) {
      // Scattered dot field.
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = palette.accent;
      let n = seed;
      for (let i = 0; i < 90; i++) {
        n = (n * 1103515245 + 12345) >>> 0;
        const px = (n % width);
        const py = ((n >>> 8) % height);
        const pr = 4 + ((n >>> 16) % 14);
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Large translucent blobs.
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = palette.accent;
      let n = seed;
      for (let i = 0; i < 3; i++) {
        n = (n * 1103515245 + 12345) >>> 0;
        const cx = n % width;
        const cy = (n >>> 9) % height;
        const rr = width * (0.22 + ((n >>> 18) % 20) / 100);
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Keep the lower half dark enough for the copy to stay readable.
    const legibility = ctx.createLinearGradient(0, height * 0.4, 0, height);
    legibility.addColorStop(0, 'transparent');
    legibility.addColorStop(1, 'rgba(15, 23, 42, 0.85)');
    ctx.fillStyle = legibility;
    ctx.fillRect(0, height * 0.4, width, height * 0.6);
  }

  /**
   * Fills the area a product photograph would have occupied: an oversized
   * monogram watermark with the offer set large across it.
   */
  private drawHeroStatement(
    ctx: any,
    width: number,
    height: number,
    palette: VibePalette,
    data: BrandedGraphicOptions,
  ): void {
    const top = height * 0.17;
    const bottom = height * 0.47;
    const midY = (top + bottom) / 2;

    // Monogram watermark from the business initials.
    const initials = String(data.businessName || 'VP')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();

    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = palette.textColor;
    ctx.font = font(`bold ${Math.round(height * 0.3)}px`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, width / 2, midY);
    ctx.restore();

    const statement = String(data.offerText || data.headline || '').trim();
    if (!statement) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shrink until the line fits, then wrap to at most two lines.
    let size = Math.round(height * 0.075);
    let lines: string[] = [];
    const maxWidth = width * 0.78;
    while (size > 26) {
      ctx.font = font(`bold ${size}px`);
      lines = this.wrapToLines(ctx, statement, maxWidth, 2);
      if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= maxWidth)) break;
      size -= 4;
    }

    const lineHeight = size * 1.2;
    const startY = midY - ((lines.length - 1) * lineHeight) / 2;

    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = palette.textColor;
    lines.forEach((line, i) => ctx.fillText(line, width / 2, startY + i * lineHeight));

    // Accent rule under the statement.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    const ruleY = startY + (lines.length - 1) * lineHeight + size * 0.85;
    ctx.moveTo(width / 2 - 70, ruleY);
    ctx.lineTo(width / 2 + 70, ruleY);
    ctx.stroke();
    ctx.restore();
  }

  /** Greedy word wrap capped at `maxLines`, with an ellipsis if it overflows. */
  private wrapToLines(ctx: any, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
        if (lines.length === maxLines) break;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);

    if (lines.length === maxLines) {
      const consumed = lines.join(' ').split(/\s+/).length;
      if (consumed < words.length) {
        let last = lines[maxLines - 1];
        while (last.length > 4 && ctx.measureText(`${last}…`).width > maxWidth) {
          last = last.slice(0, -1);
        }
        lines[maxLines - 1] = `${last}…`;
      }
    }
    return lines.length ? lines : [text];
  }

  async generateBrandedGraphicBuffer(data: BrandedGraphicOptions): Promise<Buffer> {
    let width = 1080;
    let height = 1080;

    if (data.aspectRatio === '4:5') {
      height = 1350;
    } else if (data.aspectRatio === '9:16') {
      height = 1920;
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const palette = this.getPalette(data.brandColors, data.vibe);

    // 1. Render Background (AI Visual Scene or Gradient)
    let aiVisualLoaded = false;
    const bgImageSource = data.bgImageBuffer || data.bgImageUrl;
    if (bgImageSource) {
      const bgImg = await this.fetchImageCanvasBuffer(bgImageSource);
      if (bgImg) {
        // Draw AI visual background aspect-fill
        const imgRatio = bgImg.width / bgImg.height;
        const canvasRatio = width / height;
        let drawW = width;
        let drawH = height;
        let drawX = 0;
        let drawY = 0;

        if (imgRatio > canvasRatio) {
          drawW = height * imgRatio;
          drawX = (width - drawW) / 2;
        } else {
          drawH = width / imgRatio;
          drawY = (height - drawH) / 2;
        }

        ctx.drawImage(bgImg, drawX, drawY, drawW, drawH);
        aiVisualLoaded = true;

        // Apply dark vignette gradients at top (for logo/badge) and bottom (for text card & contact bar)
        const topVignette = ctx.createLinearGradient(0, 0, 0, height * 0.35);
        topVignette.addColorStop(0, 'rgba(15, 23, 42, 0.88)');
        topVignette.addColorStop(1, 'transparent');
        ctx.fillStyle = topVignette;
        ctx.fillRect(0, 0, width, height * 0.35);

        const bottomVignette = ctx.createLinearGradient(0, height * 0.45, 0, height);
        bottomVignette.addColorStop(0, 'transparent');
        bottomVignette.addColorStop(1, 'rgba(15, 23, 42, 0.92)');
        ctx.fillStyle = bottomVignette;
        ctx.fillRect(0, height * 0.45, width, height * 0.55);
      }
    }

    if (!aiVisualLoaded) {
      this.drawDesignedBackground(ctx, width, height, palette, data.variantSeed || data.headline || data.offerText || '');
      // With no product photograph the upper half is dead space. Fill it with
      // the offer as a display line over the business monogram so the post
      // still reads as a designed piece rather than an empty frame.
      this.drawHeroStatement(ctx, width, height, palette, data);
    }

    // 2. Frame Border Accent
    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 8;
    ctx.strokeRect(30, 30, width - 60, height - 60);

    // 3. Top Header Bar: Real Logo / Business Brand Pill
    const headerY = 55;
    let logoDrawn = false;

    if (data.logoUrl) {
      const logoImg = await this.fetchImageCanvasBuffer(data.logoUrl);
      if (logoImg) {
        const logoBoxW = 180;
        const logoBoxH = 60;
        const logoBoxX = 50;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.beginPath();
        ctx.roundRect(logoBoxX, headerY, logoBoxW, logoBoxH, 12);
        ctx.fill();

        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fit logo cleanly inside logoBox
        const padding = 8;
        const availW = logoBoxW - padding * 2;
        const availH = logoBoxH - padding * 2;
        const scale = Math.min(availW / logoImg.width, availH / logoImg.height);
        const lw = logoImg.width * scale;
        const lh = logoImg.height * scale;
        const lx = logoBoxX + (logoBoxW - lw) / 2;
        const ly = headerY + (logoBoxH - lh) / 2;

        ctx.drawImage(logoImg, lx, ly, lw, lh);
        logoDrawn = true;
      }
    }

    // Category / Niche Pill (Top Right)
    const categoryText = (data.niche || 'EXCLUSIVE PROMOTION').toUpperCase();
    ctx.font = font('bold 22px');
    const catW = ctx.measureText(categoryText).width + 36;
    const catX = width - 50 - catW;
    const catY = headerY + 8;

    ctx.fillStyle = palette.badgeBg;
    ctx.beginPath();
    ctx.roundRect(catX, catY, catW, 42, 21);
    ctx.fill();

    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(catX, catY, catW, 42, 21);
    ctx.stroke();

    ctx.fillStyle = palette.badgeText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(categoryText, catX + catW / 2, catY + 21);

    // If logo was not present, show Business Name in Top Left
    if (!logoDrawn) {
      const busNameStr = (data.businessName || 'BRAND').toUpperCase();
      ctx.fillStyle = palette.textColor;
      ctx.font = font('bold 30px');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(stripEmoji(busNameStr), 50, headerY + 28);
    }

    // 4. Central / Lower Glassmorphism Card Frame for Marketing Copy
    const cardX = 60;
    const cardW = width - 120;
    const cardH = height > 1400 ? 560 : 420;
    const cardY = height - cardH - 120;

    ctx.fillStyle = palette.cardBg;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 24);
    ctx.fill();

    ctx.strokeStyle = palette.cardBorder;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 24);
    ctx.stroke();

    // 5. Business Name / Headline in Card
    let currentY = cardY + 40;

    ctx.fillStyle = palette.accent;
    ctx.font = font('bold 22px');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText((data.businessName || 'PROMOTION').toUpperCase(), width / 2, currentY);
    currentY += 36;

    // Main Headline Text
    ctx.fillStyle = palette.textColor;
    ctx.font = font('bold 36px');
    const mainHeadline = data.headline || data.offerText || 'SPECIAL OFFER';
    currentY = this.drawWrappedText(ctx, mainHeadline, width / 2, currentY, cardW - 60, 44);
    currentY += 16;

    // Offer / Description Subheading
    if (data.description || data.offerText) {
      ctx.fillStyle = palette.subtextColor;
      ctx.font = font('bold 22px');
      const descText = data.description || `Special Offer: ${data.offerText}`;
      currentY = this.drawWrappedText(ctx, stripEmoji(descText), width / 2, currentY, cardW - 80, 30);
      currentY += 24;
    }

    // 6. 3D CTA Button inside Card
    const btnW = Math.min(420, cardW - 80);
    const btnH = 50;
    const btnX = width / 2 - btnW / 2;
    const btnY = cardY + cardH - 80;

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.roundRect(btnX + 3, btnY + 4, btnW, btnH, 25);
    ctx.fill();

    // Surface
    const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX, btnY + btnH);
    btnGrad.addColorStop(0, palette.accent);
    btnGrad.addColorStop(1, '#0284c7');
    ctx.fillStyle = btnGrad;
    ctx.beginPath();
    ctx.roundRect(btnX, btnY, btnW, btnH, 25);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const rawCta = (data.ctaType || 'CLAIM OFFER NOW').replace(/_/g, ' ');
    ctx.fillStyle = '#ffffff';
    ctx.font = font('bold 22px');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(stripEmoji(rawCta).toUpperCase(), width / 2, btnY + 25);

    // 7. Contact Details High-Contrast Footer Section
    const phone = data.phone || data.contactDetails?.phone;
    const website = data.website || data.contactDetails?.website;
    const email = data.email || data.contactDetails?.email;

    const contactParts: string[] = [];
    if (phone && phone !== '+1-800-555-0199') contactParts.push(stripEmoji(phone));
    if (website && website !== 'www.brand.com' && website !== 'Not Applicable') contactParts.push(stripEmoji(website));
    if (email) contactParts.push(stripEmoji(email));

    if (contactParts.length === 0) {
      contactParts.push(stripEmoji(data.businessName));
      if (data.niche) contactParts.push(stripEmoji(data.niche));
    }

    const contactText = contactParts.join('   |   ');

    const contactBarY = height - 90;
    const contactBarH = 50;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(40, contactBarY, width - 80, contactBarH);

    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(40, contactBarY, width - 80, contactBarH);

    ctx.fillStyle = '#ffffff';
    ctx.font = font('bold 18px');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(contactText, width / 2, contactBarY + contactBarH / 2);

    const buffer = canvas.toBuffer('image/png');
    this.logger.log(`[GraphicGeneratorService] Successfully rendered ${width}x${height} graphic buffer (${buffer.length} bytes) for business: ${data.businessName}`);
    return buffer;
  }

  /**
   * Utility to wrap and draw multiline centered text.
   * Returns ending Y coordinate.
   */
  private drawWrappedText(
    ctx: any,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ): number {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;

      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line.trim(), x, currentY);
        line = words[n] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line.trim(), x, currentY);
    return currentY + lineHeight;
  }
}
