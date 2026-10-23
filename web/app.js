const COLORS = ["#6d8aff", "#43d7a0", "#f5aa59", "#a77bf3"];
const svgNs = "http://www.w3.org/2000/svg";

const state = {
  data: null,
  selected: [],
  range: "all",
  chartSeries: [],
};

const elements = {
  search: document.querySelector("#school-search"),
  results: document.querySelector("#school-results"),
  selected: document.querySelector("#selected-schools"),
  metrics: document.querySelector("#metrics"),
  chart: document.querySelector("#rating-chart"),
  chartWrap: document.querySelector("#chart-wrap"),
  tooltip: document.querySelector("#chart-tooltip"),
  empty: document.querySelector("#chart-empty"),
  legend: document.querySelector("#chart-legend"),
  historyName: document.querySelector("#history-name"),
  historyBody: document.querySelector("#history-body"),
  leaderboard: document.querySelector("#leaderboard-list"),
  download: document.querySelector("#download-button"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatRating(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
}

function formatDate(value, options = { month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", options).format(new Date(`${value}T00:00:00`));
}

function compactName(school) {
  return `${school.name} (${school.state})`;
}

function historyFor(id) {
  return (state.data.history[id] ?? []).map((point) => ({
    dateString: point[0],
    date: new Date(`${point[0]}T00:00:00`),
    rating: point[1],
    uncertainty: point[2],
    tournament: point[3],
    place: point[4],
    fieldSize: point[5],
    change: point[6],
    level: point[7],
  }));
}

function filteredHistory(id) {
  const history = historyFor(id);
  if (state.range === "all" || history.length === 0) return history;
  const latest = history.at(-1).date;
  const cutoff = new Date(latest);
  cutoff.setFullYear(cutoff.getFullYear() - Number(state.range));
  return history.filter((point) => point.date >= cutoff);
}

function updateUrl() {
  const url = new URL(window.location.href);
  if (state.selected.length) url.searchParams.set("schools", state.selected.join(","));
  else url.searchParams.delete("schools");
  if (state.range === "all") url.searchParams.delete("range");
  else url.searchParams.set("range", state.range);
  window.history.replaceState(null, "", url);
}

function selectSchool(id) {
  if (state.selected.includes(id)) return;
  if (state.selected.length >= 4) state.selected.shift();
  state.selected.push(id);
  elements.search.value = "";
  elements.results.hidden = true;
  render();
}

function removeSchool(id) {
  state.selected = state.selected.filter((selectedId) => selectedId !== id);
  if (state.selected.length === 0) {
    const fallback = state.data.schools.find((school) => school.active);
    if (fallback) state.selected.push(fallback.id);
  }
  render();
}

function renderSelected() {
  elements.selected.innerHTML = state.selected.map((id, index) => {
    const school = state.data.schoolById.get(id);
    if (!school) return "";
    return `
      <span class="school-chip" style="--series-color:${COLORS[index]}">
        <i></i>${escapeHtml(compactName(school))}
        <button type="button" data-remove="${school.id}" aria-label="Remove ${escapeHtml(school.name)}">×</button>
      </span>`;
  }).join("");
}

function renderMetrics() {
  const school = state.data.schoolById.get(state.selected[0]);
  const history = school ? historyFor(school.id) : [];
  const peak = history.length ? Math.max(...history.map((point) => point.rating)) : null;
  const latest = history.at(-1);
  const oneYearBefore = latest
    ? history.findLast((point) => point.date <= new Date(new Date(latest.date).setFullYear(latest.date.getFullYear() - 1)))
    : null;
  const delta = latest && oneYearBefore ? latest.rating - oneYearBefore.rating : null;
  const rank = school?.nationalRank ? `#${school.nationalRank}` : "—";
  const stateRank = school?.stateRank ? `#${school.stateRank} · ${school.state}` : "—";

  elements.metrics.innerHTML = `
    <div class="metric"><span>Current rating</span><strong>${formatRating(school?.rating)}</strong>${delta === null ? "" : `<small class="${delta < 0 ? "negative" : ""}">${delta >= 0 ? "+" : ""}${Math.round(delta)} / yr</small>`}</div>
    <div class="metric"><span>National rank</span><strong>${rank}</strong></div>
    <div class="metric"><span>State rank</span><strong>${stateRank}</strong></div>
    <div class="metric"><span>All-time peak</span><strong>${formatRating(peak)}</strong></div>`;
}

function createSvg(tag, attributes = {}) {
  const node = document.createElementNS(svgNs, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function niceStep(span, targetTicks = 5) {
  const rough = span / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = residual >= 5 ? 5 : residual >= 2 ? 2 : 1;
  return step * magnitude;
}

function linePath(points, xScale, yScale) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${xScale(point.date).toFixed(2)},${yScale(point.rating).toFixed(2)}`).join(" ");
}

function renderChart() {
  const width = elements.chartWrap.clientWidth;
  const height = elements.chartWrap.clientHeight;
  const margin = { top: 18, right: 18, bottom: 36, left: width < 520 ? 46 : 58 };
  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const series = state.selected
    .map((id, index) => ({ school: state.data.schoolById.get(id), points: filteredHistory(id), color: COLORS[index] }))
    .filter((item) => item.school && item.points.length);

  state.chartSeries = series;
  elements.chart.innerHTML = `
    <title id="chart-title">School rating history</title>
    <desc id="chart-desc">A line chart comparing ${series.map((item) => escapeHtml(item.school.name)).join(", ")}.</desc>`;
  elements.chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  elements.empty.hidden = series.length > 0;
  elements.empty.style.display = series.length > 0 ? "none" : "grid";

  if (!series.length) {
    elements.legend.innerHTML = "";
    return;
  }

  const allPoints = series.flatMap((item) => item.points);
  let minDate = Math.min(...allPoints.map((point) => point.date.getTime()));
  let maxDate = Math.max(...allPoints.map((point) => point.date.getTime()));
  if (minDate === maxDate) { minDate -= 86_400_000; maxDate += 86_400_000; }
  const rawMin = Math.min(...allPoints.map((point) => point.rating));
  const rawMax = Math.max(...allPoints.map((point) => point.rating));
  const padding = Math.max(70, (rawMax - rawMin) * 0.12);
  const yMin = Math.max(0, Math.floor((rawMin - padding) / 100) * 100);
  const yMax = Math.ceil((rawMax + padding) / 100) * 100;
  const xScale = (date) => margin.left + ((date.getTime() - minDate) / (maxDate - minDate)) * innerWidth;
  const yScale = (rating) => margin.top + (1 - (rating - yMin) / (yMax - yMin)) * innerHeight;

  const defs = createSvg("defs");
  const gradient = createSvg("linearGradient", { id: "area-gradient", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.append(createSvg("stop", { offset: "0", "stop-color": COLORS[0], "stop-opacity": "0.22" }));
  gradient.append(createSvg("stop", { offset: "1", "stop-color": COLORS[0], "stop-opacity": "0" }));
  defs.append(gradient);
  elements.chart.append(defs);

  const step = niceStep(yMax - yMin);
  for (let value = Math.ceil(yMin / step) * step; value <= yMax; value += step) {
    const y = yScale(value);
    elements.chart.append(createSvg("line", { class: "grid-line", x1: margin.left, y1: y, x2: width - margin.right, y2: y }));
    const label = createSvg("text", { class: "axis-label", x: margin.left - 10, y: y + 3, "text-anchor": "end" });
    label.textContent = Math.round(value).toLocaleString();
    elements.chart.append(label);
  }

  const xTicks = width < 520 ? 4 : 6;
  for (let index = 0; index < xTicks; index += 1) {
    const timestamp = minDate + (index / (xTicks - 1)) * (maxDate - minDate);
    const x = margin.left + (index / (xTicks - 1)) * innerWidth;
    const label = createSvg("text", { class: "axis-label", x, y: height - 10, "text-anchor": index === 0 ? "start" : index === xTicks - 1 ? "end" : "middle" });
    label.textContent = formatDate(new Date(timestamp).toISOString().slice(0, 10));
    elements.chart.append(label);
  }
  elements.chart.append(createSvg("line", { class: "axis-baseline", x1: margin.left, y1: margin.top + innerHeight, x2: width - margin.right, y2: margin.top + innerHeight }));

  series.forEach((item, seriesIndex) => {
    const path = linePath(item.points, xScale, yScale);
    if (series.length === 1 && item.points.length > 1) {
      const areaPath = `${path} L${xScale(item.points.at(-1).date)},${margin.top + innerHeight} L${xScale(item.points[0].date)},${margin.top + innerHeight} Z`;
      elements.chart.append(createSvg("path", { class: "rating-area", d: areaPath }));
    }
    const line = createSvg("path", { class: "rating-line", d: path, style: `--series-color:${item.color}` });
    elements.chart.append(line);
    const lastPoint = item.points.at(-1);
    elements.chart.append(createSvg("circle", {
      class: "rating-point",
      cx: xScale(lastPoint.date),
      cy: yScale(lastPoint.rating),
      r: 4,
      style: `--series-color:${item.color}`,
    }));
  });

  const hoverLine = createSvg("line", { class: "hover-line", y1: margin.top, y2: margin.top + innerHeight, visibility: "hidden" });
  const hit = createSvg("rect", { class: "chart-hit", x: margin.left, y: margin.top, width: innerWidth, height: innerHeight });
  elements.chart.append(hoverLine, hit);

  const hideTooltip = () => {
    hoverLine.setAttribute("visibility", "hidden");
    elements.tooltip.hidden = true;
  };

  hit.addEventListener("pointermove", (event) => {
    const bounds = elements.chart.getBoundingClientRect();
    const viewX = ((event.clientX - bounds.left) / bounds.width) * width;
    const clampedX = Math.max(margin.left, Math.min(width - margin.right, viewX));
    const time = minDate + ((clampedX - margin.left) / innerWidth) * (maxDate - minDate);
    const matches = series.map((item) => {
      let nearest = item.points[0];
      for (const point of item.points) {
        if (Math.abs(point.date.getTime() - time) < Math.abs(nearest.date.getTime() - time)) nearest = point;
      }
      return { ...item, point: nearest };
    });
    const anchor = matches[0].point;
    const actualX = xScale(anchor.date);
    hoverLine.setAttribute("x1", actualX);
    hoverLine.setAttribute("x2", actualX);
    hoverLine.setAttribute("visibility", "visible");
    elements.tooltip.innerHTML = `<time>${formatDate(anchor.dateString, { month: "long", day: "numeric", year: "numeric" })}</time>${matches.map((match) => `<div class="tooltip-row"><span><i style="--series-color:${match.color}"></i>${escapeHtml(match.school.name)}</span><strong>${formatRating(match.point.rating)}</strong></div>`).join("")}`;
    elements.tooltip.hidden = false;
    const relativeX = (actualX / width) * elements.chartWrap.clientWidth;
    const relativeY = (yScale(anchor.rating) / height) * elements.chartWrap.clientHeight;
    elements.tooltip.style.left = `${Math.max(115, Math.min(elements.chartWrap.clientWidth - 115, relativeX))}px`;
    elements.tooltip.style.top = `${Math.max(105, relativeY)}px`;
  });
  hit.addEventListener("pointerleave", hideTooltip);

  elements.legend.innerHTML = series.map((item) => `<span class="legend-item" style="--series-color:${item.color}"><i></i>${escapeHtml(compactName(item.school))}</span>`).join("");
}

function renderHistory() {
  const school = state.data.schoolById.get(state.selected[0]);
  elements.historyName.textContent = school ? compactName(school) : "";
  const rows = school ? historyFor(school.id).slice(-7).reverse() : [];
  elements.historyBody.innerHTML = rows.length ? rows.map((row) => {
    const change = row.change ?? 0;
    return `<tr>
      <td><strong>${escapeHtml(row.tournament)}</strong><small>${formatDate(row.dateString, { month: "short", day: "numeric", year: "numeric" })} · ${escapeHtml(row.level)}</small></td>
      <td>${row.place ?? "—"}<small> / ${row.fieldSize ?? "—"}</small></td>
      <td>${formatRating(row.rating)}</td>
      <td class="${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${Math.round(change)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="4">No tournament history available.</td></tr>`;
}

function renderLeaderboard() {
  elements.leaderboard.innerHTML = state.data.schools
    .filter((school) => school.active)
    .slice(0, 7)
    .map((school) => `<li><button type="button" data-school="${school.id}" aria-label="Add ${escapeHtml(school.name)} to chart"><b>${school.nationalRank}</b><span><strong>${escapeHtml(school.name)}</strong><small>${escapeHtml(school.city)}, ${school.state}</small></span><em>${formatRating(school.rating)}</em></button></li>`)
    .join("");
}

function renderSearchResults(query = "") {
  const normalized = query.trim().toLocaleLowerCase();
  let matches = state.data.schools.filter((school) => !state.selected.includes(school.id));
  if (normalized) {
    const terms = normalized.split(/\s+/);
    matches = matches.filter((school) => {
      const haystack = `${school.name} ${school.city} ${school.state}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  } else {
    matches = matches.filter((school) => school.active);
  }
  matches = matches.slice(0, 9);
  elements.results.innerHTML = matches.length
    ? matches.map((school) => `<button class="search-result" type="button" role="option" data-school="${school.id}"><span><strong>${escapeHtml(school.name)}</strong><small>${escapeHtml(school.city)}, ${school.state}${school.active ? " · Current season" : ` · Last active ${school.lastSeason}`}</small></span><span>${school.nationalRank ? `#${school.nationalRank} · ` : ""}${formatRating(school.rating)}</span></button>`).join("")
    : `<div class="search-result"><span><strong>No schools found</strong><small>Try a shorter name or state abbreviation.</small></span></div>`;
  elements.results.hidden = false;
}

function render() {
  renderSelected();
  renderMetrics();
  renderChart();
  renderHistory();
  renderLeaderboard();
  updateUrl();
}

function downloadCsv() {
  const rows = [["school", "state", "date", "rating", "uncertainty", "tournament", "place", "field_size", "rating_change"]];
  state.selected.forEach((id) => {
    const school = state.data.schoolById.get(id);
    filteredHistory(id).forEach((point) => rows.push([
      school.name, school.state, point.dateString, point.rating, point.uncertainty,
      point.tournament, point.place, point.fieldSize, point.change,
    ]));
  });
  const csv = rows.map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "scioly-rating-history.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindEvents() {
  elements.search.addEventListener("input", () => renderSearchResults(elements.search.value));
  elements.search.addEventListener("focus", () => renderSearchResults(elements.search.value));
  elements.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") elements.results.hidden = true;
    if (event.key === "Enter") {
      const first = elements.results.querySelector("[data-school]");
      if (first) selectSchool(first.dataset.school);
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      elements.search.focus();
    }
  });
  document.addEventListener("click", (event) => {
    const schoolButton = event.target.closest("[data-school]");
    const removeButton = event.target.closest("[data-remove]");
    if (schoolButton) selectSchool(schoolButton.dataset.school);
    if (removeButton) removeSchool(removeButton.dataset.remove);
    if (!event.target.closest(".school-picker")) elements.results.hidden = true;
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.range = button.dataset.range;
      document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("active", item === button));
      renderChart();
      updateUrl();
    });
  });
  elements.download.addEventListener("click", downloadCsv);
  new ResizeObserver(() => renderChart()).observe(elements.chartWrap);
}

async function initialize() {
  document.body.classList.add("loading");
  try {
    const response = await fetch("./data/ratings.json");
    if (!response.ok) throw new Error(`Ratings data returned ${response.status}`);
    state.data = await response.json();
    state.data.schoolById = new Map(state.data.schools.map((school) => [school.id, school]));

    const params = new URLSearchParams(window.location.search);
    const requested = (params.get("schools") ?? "").split(",").filter((id) => state.data.schoolById.has(id)).slice(0, 4);
    state.selected = requested.length ? requested : [state.data.schools.find((school) => school.active).id];
    state.range = ["1", "3", "5"].includes(params.get("range")) ? params.get("range") : "all";
    document.querySelectorAll("[data-range]").forEach((button) => button.classList.toggle("active", button.dataset.range === state.range));

    const snapshotCount = Object.values(state.data.history).reduce((sum, rows) => sum + rows.length, 0);
    document.querySelector("#school-count").textContent = state.data.schools.length.toLocaleString();
    document.querySelector("#snapshot-count").textContent = snapshotCount.toLocaleString();
    document.querySelector("#season-label").textContent = state.data.latestSeason;
    document.querySelector("#model-version").textContent = `Model ${state.data.modelVersion}`;
    bindEvents();
    render();
  } catch (error) {
    console.error(error);
    const banner = document.createElement("div");
    banner.className = "error-banner";
    banner.textContent = "The ratings data could not be loaded. Run “pnpm web:data”, then start the site with “pnpm web”.";
    document.querySelector("main").prepend(banner);
  } finally {
    document.body.classList.remove("loading");
  }
}

initialize();
