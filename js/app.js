const EXPLORER_BENCHMARK_CACHE_KEY = 'proteomeui.explorerBenchmark.v1';
const EXPLORER_BENCHMARK_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
let EXPLORER_BENCHMARK_PROFILE = null;

function getExplorerBenchmarkSignature(){
  return JSON.stringify({
    userAgent: navigator.userAgent || '',
    platform: navigator.platform || '',
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    pixelRatio: window.devicePixelRatio || 1
  });
}

function getBrowserFamily(){
  const ua = navigator.userAgent || '';
  if(/firefox/i.test(ua)) return 'firefox';
  if(/edg/i.test(ua)) return 'edge';
  if(/chrome|chromium/i.test(ua) && !/edg|opr/i.test(ua)) return 'chrome';
  if(/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return 'safari';
  return 'other';
}

function getBrowserMultiplier(browserFamily = getBrowserFamily()){
  if(browserFamily === 'safari') return 1.2;
  if(browserFamily === 'firefox') return 1.08;
  return 1;
}

function readExplorerBenchmarkCache(){
  try {
    const raw = window.localStorage.getItem(EXPLORER_BENCHMARK_CACHE_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed || parsed.signature !== getExplorerBenchmarkSignature()) return null;
    if(!parsed.measuredAt || (Date.now() - parsed.measuredAt) > EXPLORER_BENCHMARK_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeExplorerBenchmarkCache(profile){
  try {
    window.localStorage.setItem(EXPLORER_BENCHMARK_CACHE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage unavailable or quota exceeded; ignore and keep in-memory profile only.
  }
}

function setExplorerBenchmarkProfile(profile){
  EXPLORER_BENCHMARK_PROFILE = profile;
  document.dispatchEvent(new CustomEvent('explorerBenchmarkReady', {detail: profile}));
}

function buildExplorerBenchmarkProfile(benchmarkMs){
  const browserFamily = getBrowserFamily();
  let tier = 'balanced';
  let multiplier = 1.12;

  if(benchmarkMs <= 180){
    tier = 'fast';
    multiplier = 0.92;
  } else if(benchmarkMs >= 420){
    tier = 'slow';
    multiplier = 1.35;
  }

  multiplier *= getBrowserMultiplier(browserFamily);

  return {
    signature: getExplorerBenchmarkSignature(),
    measuredAt: Date.now(),
    benchmarkMs,
    browserFamily,
    tier,
    loadMultiplier: Number(multiplier.toFixed(3))
  };
}

async function runExplorerBenchmark(){
  if(typeof Plotly === 'undefined' || !document.body){
    return buildExplorerBenchmarkProfile(260);
  }

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = '720px';
  host.style.height = '360px';
  host.style.pointerEvents = 'none';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);

  const matrix = Array.from({length: 50}, (_, rowIndex) =>
    Array.from({length: 12}, (_, colIndex) => Math.sin((rowIndex + 1) * (colIndex + 1) / 9))
  );
  const trace = (axisSuffix = '') => ({
    z: matrix,
    x: Array.from({length: 12}, (_, idx) => `T${idx + 1}`),
    y: Array.from({length: 50}, (_, idx) => `G${idx + 1}`),
    type: 'heatmap',
    colorscale: 'Viridis',
    showscale: false,
    xaxis: axisSuffix ? `x${axisSuffix}` : 'x',
    yaxis: axisSuffix ? `y${axisSuffix}` : 'y'
  });

  const data = [trace(''), trace('2'), trace('3'), trace('4')];
  const layout = {
    width: 720,
    height: 360,
    margin: {l: 40, r: 20, t: 20, b: 30},
    grid: {rows: 2, columns: 2, pattern: 'independent'}
  };

  const start = performance.now();
  try {
    await Plotly.newPlot(host, data, layout, {displayModeBar: false, staticPlot: true, responsive: false});
  } finally {
    try {
      Plotly.purge(host);
    } catch {
      // Ignore purge failures.
    }
    host.remove();
  }

  return buildExplorerBenchmarkProfile(Math.round(performance.now() - start));
}

async function initializeExplorerBenchmark(){
  const cachedProfile = readExplorerBenchmarkCache();
  if(cachedProfile){
    setExplorerBenchmarkProfile(cachedProfile);
    return cachedProfile;
  }

  const profile = await runExplorerBenchmark();
  writeExplorerBenchmarkCache(profile);
  setExplorerBenchmarkProfile(profile);
  return profile;
}

function getExplorerBenchmarkProfile(){
  return EXPLORER_BENCHMARK_PROFILE;
}

function getActiveMainTabId(){
  const activeMain = document.querySelector(".main-tab-content.active");
  return activeMain ? activeMain.id : null;
}

function getActiveSubTabId(mainTabId = getActiveMainTabId()){
  if(!mainTabId) return null;
  const mainTab = document.getElementById(mainTabId);
  const activeSub = mainTab ? mainTab.querySelector(".subtab-content.active") : null;
  return activeSub ? activeSub.id : null;
}

function getCurrentViewKey(){
  const mainTabId = getActiveMainTabId();
  const subTabId = getActiveSubTabId(mainTabId);
  return mainTabId && subTabId ? `${mainTabId}:${subTabId}` : null;
}

function restoreCurrentViewPlot(){
  if(typeof window.restorePlotStateForView !== 'function') return;
  window.restorePlotStateForView(getCurrentViewKey());
}

function openMainTab(id, button){

const previousViewKey = getCurrentViewKey();
if(previousViewKey && typeof window.savePlotStateForView === 'function'){
window.savePlotStateForView(previousViewKey)
}

document
.querySelectorAll(".main-tab-content")
.forEach(t=>t.classList.remove("active"))

document
.getElementById(id)
.classList.add("active")

document
.querySelectorAll(".tab-button")
.forEach(b=>b.classList.remove("active"))

button.classList.add("active")

restoreCurrentViewPlot()

if(typeof window.updateExplorerPreviews === 'function'){
window.updateExplorerPreviews();
}

}

function openSubTab(id, button){

const previousViewKey = getCurrentViewKey();
if(previousViewKey && typeof window.savePlotStateForView === 'function'){
window.savePlotStateForView(previousViewKey)
}

const currentMainTab = document.querySelector(".main-tab-content.active");
if(!currentMainTab) return;

currentMainTab
.querySelectorAll(".subtab-content")
.forEach(t=>t.classList.remove("active"))

document
.getElementById(id)
.classList.add("active")

currentMainTab
.querySelectorAll(".subtab-button")
.forEach(b=>b.classList.remove("active"))

button.classList.add("active")

restoreCurrentViewPlot()

if(typeof window.updateExplorerPreviews === 'function'){
window.updateExplorerPreviews();
}

}

// Keyboard shortcuts: Enter behaves like clicking the associated action button
function setupKeyboardShortcuts(){
  const addEnter = (el, handler) => {
    if(!el) return;
    el.addEventListener('keydown', e => {
      if(e.key === 'Enter'){
        e.preventDefault();
        handler();
      }
    });
  };

  const addCtrlEnter = (el, handler) => {
    if(!el) return;
    el.addEventListener('keydown', e => {
      if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)){
        e.preventDefault();
        handler();
      }
    });
  };

  addEnter(document.getElementById('spatialGene'), plotSpatial);
  addEnter(document.getElementById('temporalGene'), plotTemporal);
  addEnter(document.getElementById('goTermInput'), () => searchGoTerm(false));
  addEnter(document.getElementById('goTermInputTemporal'), () => searchGoTerm(true));

  // In multi-line text areas, use Ctrl+Enter to generate plots
  addCtrlEnter(document.getElementById('spatialGenes'), plotSpatialHeatmap);
  addCtrlEnter(document.getElementById('temporalGenes'), () => plotTemporalHeatmap());
}

function setupPValueFilterControls(){
  const bindPValueToggle = (checkboxSelector, wrapperId) => {
    const checkboxes = Array.from(document.querySelectorAll(checkboxSelector));
    const wrapper = document.getElementById(wrapperId);
    if(checkboxes.length === 0 || !wrapper) return;

    const update = () => {
      const hasPValueSelected = checkboxes.some(cb => cb.value === 'P_VALUE' && cb.checked);
      wrapper.style.display = hasPValueSelected ? 'block' : 'none';
    };

    checkboxes.forEach(cb => cb.addEventListener('change', update));
    update();
  };

  bindPValueToggle('.temporal-metric-checkbox', 'temporalPValueFilterWrap');
  bindPValueToggle('.go-temporal-metric-checkbox', 'goTemporalPValueFilterWrap');
}

function setupTemporalSineFitAutoReplot(){
  const checkbox = document.getElementById('temporalShowSineFit');
  if(!checkbox) return;

  checkbox.addEventListener('change', () => {
    const temporalGeneInput = document.getElementById('temporalGene');
    if(!temporalGeneInput || !temporalGeneInput.value.trim()) return;

    if(typeof getCurrentViewKey === 'function' && getCurrentViewKey() !== 'temporal:temporalSingle') return;

    if(typeof plotTemporal === 'function'){
      plotTemporal();
    }
  });
}

function setTemporalPlotControlsReady(ready){
  const temporalActionIds = [
    'temporalSinglePlotBtn',
    'temporalHeatmapPlotBtn',
    'goTemporalGenerateBtn',
    'explorerTemporalPlotBtn'
  ];

  temporalActionIds.forEach(id => {
    const button = document.getElementById(id);
    if(!button) return;
    button.disabled = !ready;
    button.title = ready ? '' : 'Data is still loading';
  });
}

function setupExplorerPreviewBindings(){
  const controls = [
    'explorerSpatialRhoBand',
    'explorerSpatialDeStatus',
    'explorerSpatialMembership',
    'explorerSpatialAggregation',
    'explorerSpatialClusterMode',
    'explorerTemporalRegion',
    'explorerTemporalMembership',
    'explorerTemporalAggregation',
    'explorerTemporalPValueMetric',
    'explorerTemporalPValueThreshold',
    'explorerTemporalSortDataset',
    'explorerTemporalSortMetric',
    'explorerTemporalSortOrder',
    'explorerSpatialTopNEnabled',
    'explorerSpatialTopN',
    'explorerSpatialTopNSort',
    'explorerTemporalTopNEnabled',
    'explorerTemporalTopN',
    'explorerTemporalTopNSort',
    'explorerTemporalSignificanceDataset'
  ];

  const triggerUpdate = () => {
    if(typeof window.updateExplorerPreviews === 'function'){
      window.updateExplorerPreviews();
    }
  };

  controls.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('change', triggerUpdate);
    if(el && el.tagName === 'INPUT') el.addEventListener('input', triggerUpdate);
  });

  document.querySelectorAll('.explorer-temporal-metric-checkbox').forEach(cb => {
    cb.addEventListener('change', triggerUpdate);
  });

  setTemporalPlotControlsReady(false);
  document.addEventListener('proteomeDataLoaded', () => {
    setTemporalPlotControlsReady(true);
    triggerUpdate();
  });
  document.addEventListener('explorerBenchmarkReady', triggerUpdate);
  triggerUpdate();
}

setupKeyboardShortcuts();
setupPValueFilterControls();
setupTemporalSineFitAutoReplot();
setupExplorerPreviewBindings();
initializeExplorerBenchmark();

window.getCurrentViewKey = getCurrentViewKey;
window.getExplorerBenchmarkProfile = getExplorerBenchmarkProfile;
