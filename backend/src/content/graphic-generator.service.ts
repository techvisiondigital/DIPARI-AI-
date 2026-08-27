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
      // Fallback base gradient
      const bgGradient = ctx.createLinearGradient(0, 0, width, height);
      bgGradient.addColorStop(0, palette.bgStart);
      bgGradient.addColorStop(1, palette.bgEnd);
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, width, height);

      // Radial glowing aura
      const aura = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, 480);
      aura.addColorStop(0, palette.accent + '44');
      aura.addColorStop(1, 'transparent');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, width, height);
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
