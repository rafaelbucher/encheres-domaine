// src/scrape.js
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");

const BASE = process.env.BASE || "https://encheres-domaine.gouv.fr";
const START_VENTES = new URL("/ventes", BASE).toString();
const KEYWORDS = new RegExp(process.env.KEYWORDS || "\\b(montre|montres|horlogerie)\\b", "i");
const DELAY_MS = Number(process.env.DELAY_MS || 800);
const MAX_PAGES = Number(process.env.MAX_PAGES || 400);
const TZ = "Europe/Paris";

// util
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const toAbs = (base, href) => { try { return new URL(href, base).toString(); } catch { return href; } };
const nextRun = () => {
  const now = DateTime.now().setZone(TZ);
  let next = now.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  if (next <= now) next = next.plus({ days: 1 });
  return next;
};

// parseurs (Cheerio)
function extractVenteLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const out = new Set();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href"); if (!href) return;
    const abs = toAbs(pageUrl, href).split("#")[0];
    if (/\/vente(\/|s\/|s\?|[?#]|$)/i.test(abs) && !/\/ventes(\/|$|\?)/i.test(abs)) out.add(abs);
  });
  return [...out];
}
function nextFromVentes(html, pageUrl) {
  const $ = cheerio.load(html);
  const sel = $("a[rel='next'], a.next, li.pagination-next a, a[aria-label*='Suivant'], a:contains('Suivant')");
  if (sel.length && sel.first().attr("href")) return toAbs(pageUrl, sel.first().attr("href"));
  const guess = $("a[href]").map((_, el) => $(el).attr("href")).get()
    .map(h => toAbs(pageUrl, h)).find(u => /[?&](page|p)=\d+/i.test(u) || /\/ventes\/page\/\d+/i.test(u));
  return guess || null;
}
function extractLotsFromVente(html, pageUrl) {
  const $ = cheerio.load(html);
  const out = new Set();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href"); if (!href) return;
    const abs = toAbs(pageUrl, href).split("#")[0];
    if (/\/lot(\/|s\/|[?#]|$)|\/detail\/lot/i.test(abs)) out.add(abs);
  });
  return [...out];
}
function parseLotDetail(html, lotUrl) {
  const $ = cheerio.load(html);
  let title = $("h1, h2, .product-title, .lot-title, .page-title").first().text().trim() || $("title").text().trim();
  const descSel = [".product.attribute.description",".lot-description",".product-description",".description","#description"];
  let desc = ""; for (const s of descSel) { const n = $(s).first(); if (n && n.text().trim()) { desc = n.text().trim(); break; } }
  if (!desc) { const p = $("p").filter((_, el) => $(el).text().trim().length > 60).first(); if (p) desc = p.text().trim(); }
  const img = $("img.product-image-photo, .gallery img, figure img, img[src*='/media/']").first();
  const image = img && img.attr("src") ? toAbs(lotUrl, img.attr("src")) : "";
  const keep = KEYWORDS.test(`${title}\n${desc}`);
  return { url: lotUrl, title: title || "(sans titre)", desc, image, keep };
}

// HTML avec décompte HH:MM:SS
function buildHtml(items, nextRunDt) {
  const esc = s => (s || "").toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cards = items.map(it => `
<article class="lot">
  <a class="thumb" href="${esc(it.url)}" target="_blank" rel="noopener">
    ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.title)}">` : `<div class="noimg">Pas d'image</div>`}
  </a>
  <div class="content">
    <h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
    ${it.desc ? `<p>${esc(it.desc.length>450?it.desc.slice(0,449)+'…':it.desc)}</p>` : ""}
  </div>
</article>`).join("\n");

  const nextIso = nextRunDt.toISO();
  const generatedAt = DateTime.now().setZone(TZ).toFormat("yyyy-LL-dd HH:mm:ss");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Montres — Enchères du Domaine</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;background:#f6f7f9}
header{display:flex;flex-direction:column;gap:.4rem}
.topline{display:flex;align-items:center;justify-content:space-between}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:1rem}
article.lot{background:#fff;border:1px solid #e7e9ee;border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.thumb{display:block;aspect-ratio:4/3;background:#eee;overflow:hidden}
img{width:100%;height:100%;object-fit:cover;display:block}
.noimg{display:flex;align-items:center;justify-content:center;height:160px;color:#777}
.content{padding:12px}
h1{font-size:1.4rem;margin:0}
h3{margin:.2rem 0;font-size:1rem}
p{margin:.3rem 0 .6rem 0;color:#333;line-height:1.35}
.badge{border:1px solid #e0e0e0;border-radius:999px;padding:.2rem .6rem;font-size:.85rem}
.countdown{font-variant-numeric:tabular-nums}
footer{margin:2rem 0;color:#666;font-size:.85rem}
</style></head>
<body>
<header>
  <div class="topline"><h1>Montres — Enchères du Domaine</h1><div class="badge">${items.length} lots</div></div>
  <small>Généré le ${generatedAt} (Europe/Paris). Prochaine exécution à <strong>${DateTime.fromISO(nextIso).setZone(TZ).toFormat("dd/LL/yyyy HH:mm")}</strong> — départ dans <strong id="countdown" class="countdown">--:--:--</strong>.</small>
</header>
<section class="grid">
${cards || "<p>Aucun lot correspondant trouvé.</p>"}
</section>
<footer>
  <p>Source : <a href="${BASE}" target="_blank" rel="noopener">${BASE}</a>. Page régénérée automatiquement chaque jour à 10:00 (Europe/Paris).</p>
</footer>
<script>
(function(){
  const target = new Date(${JSON.stringify(nextIso)});
  const el = document.getElementById('countdown');
  const pad = n=>String(n).padStart(2,'0');
  function tick(){
    const now = new Date();
    let diff = Math.max(0, Math.floor((target-now)/1000));
    const h = Math.floor(diff/3600), m = Math.floor((diff%3600)/60), s = diff%60;
    el.textContent = pad(h)+":"+pad(m)+":"+pad(s);
  }
  tick(); setInterval(tick,1000);
})();
</script>
</body></html>`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Helper pour charger une URL et récupérer le HTML final (rendu JS inclus)
  async function getHtml(url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // scroll léger pour déclencher lazy-load si besoin
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    return await page.content();
  }

  // 1) parcourir /ventes + pagination
  const ventes = new Set();
  let url = START_VENTES, guardPages = 0, seenPages = new Set();
  while (url && guardPages < MAX_PAGES && !seenPages.has(url)) {
    seenPages.add(url); guardPages++;
    const html = await getHtml(url);
    extractVenteLinks(html, url).forEach(v => ventes.add(v));
    url = nextFromVentes(html, url);
    await sleep(DELAY_MS);
  }

  // 2) pour chaque vente, collecter les lots (+ pagination interne simple)
  const lotUrls = new Set();
  for (const vente of ventes) {
    const html = await getHtml(vente);
    extractLotsFromVente(html, vente).forEach(u => lotUrls.add(u));
    await sleep(DELAY_MS);
  }

  // 3) parser chaque lot + filtre mots-clés
  const kept = [];
  for (const lot of lotUrls) {
    const html = await getHtml(lot);
    const data = parseLotDetail(html, lot);
    if (data.keep) kept.push(data);
    await sleep(DELAY_MS);
  }

  // 4) générer HTML
  fs.mkdirSync("public", { recursive: true });
  const out = buildHtml(kept, nextRun());
  fs.writeFileSync(path.join("public", "montres.html"), out, "utf8");

  await browser.close();
  console.log(`OK — ${kept.length} lots exportés dans public/montres.html`);
})();
