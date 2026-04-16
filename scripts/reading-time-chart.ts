/**
 * Generate a reading time distribution chart (HTML) from card output.
 *
 * Usage:
 *   npx tsx scripts/reading-time-chart.ts
 *   # → writes /tmp/reading-time-histograms.html
 *   # → open in browser or screenshot with:
 *   #   npx playwright screenshot --viewport-size="1400,7200" file:///tmp/reading-time-histograms.html /tmp/histograms.png
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.resolve("content/output");
const OUT_FILE = "/tmp/reading-time-histograms.html";

const BOOK_DISPLAY: Record<string, { title: string; color: string }> = {
  enchiridion: { title: "The Enchiridion", color: "#B5704F" },
  discourses: { title: "Discourses", color: "#B5704F" },
  meditations: { title: "Meditations", color: "#5B6E8A" },
  "shortness-of-life": { title: "On the Shortness of Life", color: "#6B7F5E" },
  "happy-life": { title: "On the Happy Life", color: "#6B7F5E" },
  "peace-of-mind": { title: "On Peace of Mind", color: "#6B7F5E" },
  "on-anger": { title: "On Anger", color: "#6B7F5E" },
};

// Collect reading times per book
const data: Record<string, number[]> = {};
const bookSlugs = readdirSync(OUTPUT_DIR).filter((b) => {
  try {
    return b !== "authors.json" && statSync(path.join(OUTPUT_DIR, b)).isDirectory();
  } catch {
    return false;
  }
});

for (const slug of bookSlugs) {
  data[slug] = [];
  const bookDir = path.join(OUTPUT_DIR, slug);
  const files = readdirSync(bookDir).filter((f) => !f.startsWith("_"));
  for (const f of files) {
    const cards = JSON.parse(readFileSync(path.join(bookDir, f), "utf8"));
    for (const c of cards) {
      data[slug].push(c.reading_time_seconds);
    }
  }
}

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Reading Time Distribution</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { background: #FAF7F2; font-family: Georgia, serif; margin: 0; padding: 40px; }
  h1 { color: #2C2520; font-size: 28px; margin-bottom: 40px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 32px; margin-bottom: 48px; }
  .chart-box { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .chart-box h2 { color: #2C2520; font-size: 16px; margin: 0 0 16px; }
</style>
</head>
<body>
<h1>Card Reading Time Distribution</h1>
<div class="grid" id="charts"></div>
<script>
const BOOK_DISPLAY = ${JSON.stringify(BOOK_DISPLAY)};
const DATA = ${JSON.stringify(data)};

const labels = ["0-4","5-9","10-14","15-19","20-24","25-29","30-34","35-39","40-44","45-49","50-54","55-59","60-64"];

function bucket(times) {
  const counts = new Array(13).fill(0);
  for (const t of times) counts[Math.min(Math.floor(t / 5), 12)]++;
  return counts;
}

const grid = document.getElementById("charts");

function makeChart(container, times, color, height) {
  const canvas = container.querySelector("canvas");
  canvas.style.height = height + "px";
  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ data: bucket(times), backgroundColor: color + "CC", borderRadius: 3 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: "seconds", font: { size: 11 } }, grid: { display: false } },
        y: { title: { display: true, text: "cards", font: { size: 11 } }, beginAtZero: true, grid: { color: "#f0ece6" }, ticks: { precision: 0 } }
      }
    }
  });
}

const order = ["enchiridion","discourses","meditations","shortness-of-life","happy-life","peace-of-mind","on-anger"];
for (const slug of order) {
  const info = BOOK_DISPLAY[slug];
  const times = DATA[slug];
  if (!info || !times) continue;
  const box = document.createElement("div");
  box.className = "chart-box";
  box.innerHTML = '<h2>' + info.title + ' (' + times.length + ' cards)</h2><canvas></canvas>';
  grid.appendChild(box);
  makeChart(box, times, info.color, 240);
}

const allTimes = Object.values(DATA).flat();
const box = document.createElement("div");
box.className = "chart-box";
box.innerHTML = '<h2>All Cards (' + allTimes.length + ' cards)</h2><canvas></canvas>';
grid.appendChild(box);
makeChart(box, allTimes, "#2C2520", 320);
</script>
</body>
</html>`;

writeFileSync(OUT_FILE, html);
console.log(`Wrote ${OUT_FILE}`);
console.log(`Screenshot with:`);
console.log(`  npx playwright screenshot --viewport-size="1400,7200" "file://${OUT_FILE}" /tmp/histograms.png`);
