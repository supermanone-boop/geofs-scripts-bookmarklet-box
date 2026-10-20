(() => {
"use strict";

if (window.__MORECRAFTS_SLIDER_UI_V3__ || window.__MORECRAFTS_SLIDER_UI_V3_WAITING__) {
    console.log("[MoreCrafts] Slider UI is already running or starting");
    return;
}
window.__MORECRAFTS_SLIDER_UI_V3_WAITING__ = true;
// Keep this legacy marker only so an earlier version can detect the addon family.
window.__MORECRAFTS_UI_V2__ = true;

console.log("[MoreCrafts] Independent Slider UI");

const MORECRAFTS_CREDITS = [
    {model:"C-17",author:"manilov.ap",source:"https://skfb.ly/YQsV",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"DC-10",author:"manilov.ap",source:"https://skfb.ly/YRnB",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"F-4 Phantom II",author:"manilov.ap",source:"https://skfb.ly/YRWL",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"C-130J Super Hercules",author:"b4_cobra",source:"https://skfb.ly/pIRSw",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"F-104 Starfighter",author:"Mikhail_Zelenov",source:"https://skfb.ly/ovIRP",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"Tu-154",author:"Shawn 684 M",source:"https://skfb.ly/ooJYC",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"SH-60B Seahawk Helicopter",author:"Muhamad Mirza Arrafi",source:"https://skfb.ly/p96qS",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"Boeing 727",author:"Marine",source:"https://skfb.ly/ppFKo",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"Airbus ZeroE",author:"dannzjs",source:"https://skfb.ly/oLorX",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"Su-57",author:"Collaro_Show",source:"https://skfb.ly/prsPF",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"SR-72 Darkstar",author:"Cem Gürbüz",source:"https://skfb.ly/oJUTR",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"B-52 Stratofortress",author:"bohmerang",source:"https://skfb.ly/oLo8p",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"An-124",author:"manilov.ap",source:"https://skfb.ly/YJOW",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"},
    {model:"U-2 Dragonlady - Free",author:"bohmerang",source:"https://skfb.ly/pysq6",license:"CC BY-NC-SA 4.0",licenseUrl:"https://creativecommons.org/licenses/by-nc-sa/4.0/"},
    {model:"B-1 Lancer",author:"manilov.ap",source:"https://skfb.ly/YMyE",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/"}
];

const MORECRAFTS = [
    {name:"C17 globe master",base:3179,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/c17.glb",rotation:[0,0,210],position:[5,5,0],scale:[1,1,1]},
    {name:"F104 star fighter",base:5229,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/f104.glb",rotation:[0,0,270],position:[0,2.5,0],scale:[4.5,4.5,4.5]},
    {name:"U2",base:2556,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/u-2_dragonlady_-_free.glb",rotation:[0,0,270],position:[0,0,0],scale:[1.5,1.5,1.5]},
    {name:"SH60B",base:9,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/sh-60b_seahawk_helicopter.glb",rotation:[0,0,270],position:[0,0,-1.5],scale:[0.01,0.01,0.01]},
    {name:"Antonov an-124",base:5527,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/an124.glb",rotation:[0,0,270],position:[0,0,0.8],scale:[0.75,0.75,0.75]},
    {name:"McDonnell Douglas F-4 Phantom II",base:3617,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/F4.glb",rotation:[7,0,210],position:[-1,-0.67,-1.51],scale:[0.85,0.85,0.85]},
    {name:"Sukhoi Su-57",base:18,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/su57.glb",rotation:[0,0,270],position:[0,0,-0.8],scale:[0.5,0.5,0.5]},
    {name:"McDonnell Douglas DC-10",base:3292,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/dc10.glb",rotation:[0,0,215],position:[0,0,0],scale:[0.85,0.85,0.85]},
    {name:"Tupolev Tu-154",base:3011,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/tu154.glb",rotation:[0,0,180],position:[0,0,-5],scale:[0.86,0.86,0.86]},
    {name:"Boeing 727",base:2843,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/boeing727.glb",rotation:[0,0,180],position:[0,0,-3.5],scale:[0.45,0.45,0.45]},
    {name:"B-52 Stratofortress",base:4745,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/boeing_b-52_stratofortress.glb",rotation:[0,0,90],position:[0,0,0],scale:[1,1,1]},
    {name:"B-1 Lancer",base:20,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/b-1_lancer_final_version.glb",rotation:[0,0,90],position:[0,0,-2],scale:[1,1,1]},
    {name:"SR-72 Darkstar",base:2364,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/lockheed_martin_sr72_darkstar__topgun_maverick.glb",rotation:[0,0,270],position:[0,0,0],scale:[4,4,4]},
    {name:"Airbus ZERO-E",base:10,glb:"https://raw.githubusercontent.com/supermanone-boop/models/main/Airbus_ZeroE.glb",rotation:[0,0,270],position:[0,0,-100],scale:[0.1,0.1,0.1]}
];

const CREDIT_ALIASES = {
    "C17 globe master":"C-17",
    "F104 star fighter":"F-104 Starfighter",
    "U2":"U-2 Dragonlady - Free",
    "SH60B":"SH-60B Seahawk Helicopter",
    "Antonov an-124":"An-124",
    "McDonnell Douglas F-4 Phantom II":"F-4 Phantom II",
    "Sukhoi Su-57":"Su-57",
    "McDonnell Douglas DC-10":"DC-10",
    "Tupolev Tu-154":"Tu-154",
    "Boeing 727":"Boeing 727",
    "B-52 Stratofortress":"B-52 Stratofortress",
    "B-1 Lancer":"B-1 Lancer",
    "SR-72 Darkstar":"SR-72 Darkstar",
    "Airbus ZERO-E":"Airbus ZeroE"
};

function getCredit(name) {
    const title = CREDIT_ALIASES[name];
    return MORECRAFTS_CREDITS.find(c => c.model === title) || null;
}

const STORAGE_KEY = "morecrafts_position_scale_v2";

function defaultSettings(item) {
    return { position: item.position.slice(), size: 1, rotation: [0, 0, 0] };
}

function validSettings(value, item) {
    if (!value || !Array.isArray(value.position) || value.position.length !== 3 ||
        !value.position.every(n => typeof n === "number" && Number.isFinite(n)) ||
        typeof value.size !== "number" || !Number.isFinite(value.size) || value.size <= 0) {
        return defaultSettings(item);
    }
    const rotation = Array.isArray(value.rotation) && value.rotation.length === 3 &&
        value.rotation.every(n => typeof n === "number" && Number.isFinite(n))
        ? value.rotation.slice() : [0, 0, 0];
    return { position: value.position.slice(), size: Math.min(value.size, 10000), rotation };
}

function readSettings() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch (err) {
        console.warn("[MoreCrafts] Settings read failed:", err);
    }
    const result = {};
    MORECRAFTS.forEach(item => { result[item.base] = validSettings(saved[item.base], item); });
    return result;
}

const SETTINGS = readSettings();
let selectedAircraft = MORECRAFTS[0];
let loadGeneration = 0;
let applyTimeout = null;
let hideInterval = null;
let morecraftsRoot = null;
let editorPanel = null;
let statusNode = null;
let titleNode = null;
let selectNode = null;
let launcherButton = null;
const sliderControls = { position: [], rotation: [], size: null };

window.morecraftsEnabled = false;

function notify(message) {
    console.log("[MoreCrafts] " + message);
    if (!document.body) return;
    let toast = document.getElementById("mc-slider-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "mc-slider-toast";
        Object.assign(toast.style, {
            position: "fixed", left: "50%", bottom: "22px", transform: "translateX(-50%)",
            zIndex: "2147483647", maxWidth: "calc(100vw - 28px)", padding: "10px 14px",
            borderRadius: "8px", background: "rgba(20,24,32,.96)", color: "#fff",
            border: "1px solid rgba(255,255,255,.2)", boxShadow: "0 4px 18px rgba(0,0,0,.35)",
            font: "13px/1.4 system-ui,sans-serif", pointerEvents: "none", display: "none"
        });
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.display = "block";
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.display = "none"; }, 2200);
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(SETTINGS));
        return true;
    } catch (err) {
        console.error("[MoreCrafts] Settings save failed:", err);
        notify("設定を保存できませんでした");
        return false;
    }
}

function stopHideInterval() {
    if (hideInterval) clearInterval(hideInterval);
    hideInterval = null;
    if (window.morecraftsHideInterval) {
        clearInterval(window.morecraftsHideInterval);
        window.morecraftsHideInterval = null;
    }
}

function hideNativeAircraft() {
    if (!window.morecraftsEnabled || !window.geofs || !geofs.aircraft || !geofs.aircraft.instance) return;
    try {
        const ac = geofs.aircraft.instance;
        const root = ac.parts && ac.parts.root;
        if (!root) return;
        if (root.object3d) root.object3d.visible = false;
        if (root.object3d && root.object3d._model) root.object3d._model.show = false;
    } catch (err) {
        console.warn("[MoreCrafts] Hide error:", err);
    }
}

function el(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
}

function styleButton(button, primary) {
    Object.assign(button.style, {
        border: "1px solid " + (primary ? "rgba(99,179,237,.9)" : "rgba(255,255,255,.2)"),
        borderRadius: "7px", padding: "9px 10px", minHeight: "36px",
        background: primary ? "#2169a6" : "rgba(255,255,255,.08)", color: "#fff",
        font: "600 12px system-ui,sans-serif", cursor: "pointer", minWidth: "0"
    });
}

function formatValue(value, digits) {
    return Number(value).toFixed(digits).replace(/\.?0+$/, "") || "0";
}

function addSlider(parent, label, group, index, config) {
    const row = el("div", undefined, parent);
    Object.assign(row.style, { margin: "7px 0 10px", minWidth: "0" });
    const labelRow = el("div", undefined, row);
    Object.assign(labelRow.style, {
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "8px", fontSize: "12px", marginBottom: "3px"
    });
    const caption = el("label", label, labelRow);
    caption.style.fontWeight = "600";
    const valueNode = el("span", "0", labelRow);
    Object.assign(valueNode.style, { fontVariantNumeric: "tabular-nums", opacity: ".95", whiteSpace: "nowrap" });
    const input = el("input", undefined, row);
    input.type = "range";
    input.min = String(config.min);
    input.max = String(config.max);
    input.step = String(config.step);
    input.value = String(config.value);
    input.setAttribute("aria-label", label);
    Object.assign(input.style, {
        display: "block", width: "100%", margin: "0", padding: "0",
        accentColor: "#69b7ff", cursor: "ew-resize", touchAction: "pan-y"
    });
    caption.htmlFor = input.id = "mc-slider-" + group + "-" + index;
    const record = { input, valueNode, min: config.min, max: config.max, step: config.step, digits: config.digits };
    if (group === "position") sliderControls.position[index] = record;
    else if (group === "rotation") sliderControls.rotation[index] = record;
    else sliderControls.size = record;
    input.addEventListener("input", () => {
        if (!selectedAircraft) return;
        syncSettingsFromSliders();
        updateStatus();
    });
    return row;
}

function addSection(parent, text) {
    const section = el("div", text, parent);
    Object.assign(section.style, {
        font: "700 12px system-ui,sans-serif", color: "#9fd3ff",
        margin: "14px 0 3px", paddingBottom: "4px",
        borderBottom: "1px solid rgba(255,255,255,.16)"
    });
    return section;
}

function syncSettingsFromSliders() {
    if (!selectedAircraft) return;
    const settings = SETTINGS[selectedAircraft.base];
    settings.position = sliderControls.position.map(control => Number(control.input.value));
    settings.rotation = sliderControls.rotation.map(control => Number(control.input.value));
    settings.size = Number(sliderControls.size.input.value);
    updateSliderReadouts();
}

function updateSliderReadouts() {
    sliderControls.position.forEach((control, i) => {
        control.valueNode.textContent = formatValue(control.input.value, 1) + " units";
    });
    sliderControls.rotation.forEach((control, i) => {
        control.valueNode.textContent = formatValue(control.input.value, 0) + "°";
    });
    if (sliderControls.size) sliderControls.size.valueNode.textContent = "×" + formatValue(sliderControls.size.input.value, 2);
}

function updateStatus() {
    if (!selectedAircraft || !statusNode) return;
    const settings = SETTINGS[selectedAircraft.base];
    statusNode.textContent = "X " + formatValue(settings.position[0], 2) +
        " / Y " + formatValue(settings.position[1], 2) +
        " / Z " + formatValue(settings.position[2], 2) +
        "  ·  Scale ×" + formatValue(settings.size, 2) +
        "  ·  Rot " + settings.rotation.map(v => formatValue(v, 0) + "°").join(" / ");
}

function refreshSliders() {
    if (!selectedAircraft) return;
    const settings = SETTINGS[selectedAircraft.base];
    titleNode.textContent = selectedAircraft.name;
    sliderControls.position.forEach((control, i) => {
        const value = settings.position[i];
        control.input.min = String(Math.min(-150, Math.floor(value - 25)));
        control.input.max = String(Math.max(150, Math.ceil(value + 25)));
        control.input.value = String(value);
    });
    sliderControls.rotation.forEach((control, i) => {
        const value = settings.rotation[i];
        control.input.min = String(Math.min(-180, Math.floor(value - 30)));
        control.input.max = String(Math.max(180, Math.ceil(value + 30)));
        control.input.value = String(value);
    });
    sliderControls.size.input.max = String(Math.max(10, Math.ceil(settings.size + 1)));
    sliderControls.size.input.value = String(settings.size);
    updateSliderReadouts();
    updateStatus();
}

function loadCustomAircraft(item) {
    if (!item) return;
    selectedAircraft = item;
    if (selectNode) selectNode.value = String(item.base);
    refreshSliders();
    window.morecraftsEnabled = true;
    const generation = ++loadGeneration;
    if (applyTimeout) clearTimeout(applyTimeout);
    applyTimeout = null;
    stopHideInterval();
    statusNode.textContent = "Loading " + item.name + "…";
    notify("読み込み中: " + item.name);

    try {
        geofs.aircraft.instance.load(item.base);
    } catch (err) {
        console.error("[MoreCrafts] Native load failed:", err);
        window.morecraftsEnabled = false;
        notify("標準機体の読み込みに失敗しました");
        return;
    }

    applyTimeout = setTimeout(() => {
        applyTimeout = null;
        if (generation !== loadGeneration || !window.morecraftsEnabled) return;
        if (!selectedAircraft || selectedAircraft.base !== item.base) return;
        try {
            const ac = geofs.aircraft.instance;
            const settings = SETTINGS[item.base];
            if (!settings) throw new Error("Aircraft settings not found");
            hideNativeAircraft();
            hideInterval = setInterval(() => {
                if (generation !== loadGeneration || !window.morecraftsEnabled) {
                    stopHideInterval();
                    return;
                }
                hideNativeAircraft();
            }, 300);
            window.morecraftsHideInterval = hideInterval;

            const actualScale = item.scale.map(value => value * settings.size);
            const partName = "morecrafts_" + item.base + "_" + generation;
            window.morecraftsPart = partName;
            ac.addParts([{
                name: partName,
                model: item.glb,
                rotation: item.rotation.map((value, i) => value + settings.rotation[i]),
                position: settings.position.slice(),
                scale: actualScale
            }]);
            const credit = getCredit(item.name);
            console.log("[MoreCrafts] Loaded:", item.name, "position:", settings.position,
                "scale:", actualScale, "rotation offset:", settings.rotation, "credit:", credit || "Not matched");
            statusNode.textContent = "Loaded: " + item.name;
            notify("読み込み完了: " + item.name);
        } catch (err) {
            console.error("[MoreCrafts] Load error:", err);
            statusNode.textContent = "Load error — see console";
            notify("MoreCraftsの読み込みエラー");
        }
    }, 2500);
}

function mountUI() {
    if (document.getElementById("mc-slider-launcher")) return;
    const style = el("style", undefined, document.head || document.body);
    style.id = "mc-slider-style-v3";
    style.textContent = `
#mc-slider-panel, #mc-slider-launcher, #mc-slider-panel * { box-sizing:border-box; }
#mc-slider-panel button, #mc-slider-launcher { -webkit-tap-highlight-color:transparent; }
#mc-slider-panel input[type=range] { height:26px; }
#mc-slider-panel select { color:#fff; background:#202a37; }
#mc-slider-panel summary { cursor:pointer; }
@media(max-width:480px) { #mc-slider-panel { right:6px !important; width:calc(100vw - 12px) !important; max-height:76vh !important; } }
`;

    launcherButton = el("button", "MoreCrafts", document.body);
    launcherButton.id = "mc-slider-launcher";
    launcherButton.type = "button";
    Object.assign(launcherButton.style, {
        position: "fixed", right: "10px", top: "82px", zIndex: "2147483000",
        padding: "10px 12px", borderRadius: "8px", border: "1px solid #74bfff",
        background: "rgba(20,83,130,.97)", color: "#fff", font: "700 13px system-ui,sans-serif",
        boxShadow: "0 3px 12px rgba(0,0,0,.4)", cursor: "pointer", touchAction: "manipulation"
    });

    editorPanel = el("section", undefined, document.body);
    editorPanel.id = "mc-slider-panel";
    Object.assign(editorPanel.style, {
        display: "block", position: "fixed", right: "8px", top: "126px",
        width: "min(360px, calc(100vw - 16px))", maxHeight: "76vh", overflowY: "auto",
        overscrollBehavior: "contain", zIndex: "2147482999", padding: "12px",
        border: "1px solid rgba(150,200,235,.65)", borderRadius: "10px",
        background: "rgba(16,22,30,.97)", color: "#f4f7fb",
        boxShadow: "0 8px 28px rgba(0,0,0,.48)",
        font: "13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif",
        WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)"
    });

    const header = el("div", undefined, editorPanel);
    Object.assign(header.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "10px" });
    titleNode = el("strong", "MoreCrafts Slider Editor", header);
    Object.assign(titleNode.style, { fontSize: "15px", overflowWrap: "anywhere" });
    const closeButton = el("button", "Hide", header);
    styleButton(closeButton, false);
    closeButton.style.padding = "6px 9px";
    closeButton.addEventListener("click", () => { editorPanel.style.display = "none"; });

    el("label", "Aircraft", editorPanel).style.cssText = "display:block;font-size:12px;font-weight:700;margin-bottom:4px;";
    selectNode = el("select", undefined, editorPanel);
    selectNode.id = "mc-slider-aircraft-select";
    Object.assign(selectNode.style, {
        width: "100%", minHeight: "38px", padding: "8px", borderRadius: "6px",
        border: "1px solid rgba(255,255,255,.24)", font: "13px system-ui,sans-serif", marginBottom: "8px"
    });
    MORECRAFTS.forEach(item => {
        const option = el("option", item.name, selectNode);
        option.value = String(item.base);
    });
    selectNode.value = String(selectedAircraft.base);
    selectNode.addEventListener("change", () => {
        const next = MORECRAFTS.find(item => String(item.base) === selectNode.value);
        if (!next) return;
        selectedAircraft = next;
        refreshSliders();
        statusNode.textContent = "選択中: " + next.name + "（適用するには Load / Apply を押してください）";
    });

    addSection(editorPanel, "POSITION · 模型内の位置");
    ["X", "Y", "Z"].forEach((axis, i) => addSlider(editorPanel, "Position " + axis, "position", i,
        { min: -150, max: 150, step: 0.1, value: 0, digits: 1 }));

    addSection(editorPanel, "ROTATION · 回転と向き");
    ["Rotation X", "Rotation Y", "Heading Z · 向き"].forEach((label, i) => addSlider(editorPanel, label, "rotation", i,
        { min: -180, max: 180, step: 1, value: 0, digits: 0 }));

    addSection(editorPanel, "SCALE · 大きさ");
    addSlider(editorPanel, "Scale multiplier", "size", 0,
        { min: 0.01, max: 10, step: 0.01, value: 1, digits: 2 });

    const actionRow = el("div", undefined, editorPanel);
    Object.assign(actionRow.style, { display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "7px", marginTop: "12px" });
    const applyButton = el("button", "Load / Apply", actionRow);
    styleButton(applyButton, true);
    applyButton.addEventListener("click", () => {
        syncSettingsFromSliders();
        saveSettings();
        loadCustomAircraft(selectedAircraft);
    });
    const saveButton = el("button", "Save", actionRow);
    styleButton(saveButton, false);
    saveButton.addEventListener("click", () => {
        syncSettingsFromSliders();
        if (saveSettings()) notify("設定を保存しました: " + selectedAircraft.name);
    });

    const resetButton = el("button", "Reset selected aircraft", editorPanel);
    styleButton(resetButton, false);
    Object.assign(resetButton.style, { width: "100%", marginTop: "7px" });
    resetButton.addEventListener("click", () => {
        if (!selectedAircraft) return;
        SETTINGS[selectedAircraft.base] = defaultSettings(selectedAircraft);
        refreshSliders();
        saveSettings();
        loadCustomAircraft(selectedAircraft);
    });

    statusNode = el("div", "Select an aircraft and press Load / Apply.", editorPanel);
    Object.assign(statusNode.style, { fontSize: "11px", opacity: ".9", lineHeight: "1.5", marginTop: "10px", overflowWrap: "anywhere" });
    el("p", "Sliders change the stored values. Load / Apply reloads the selected aircraft. X/Y/Z rotation values are added to the model's original rotation.", editorPanel).style.cssText = "font-size:11px;line-height:1.5;opacity:.75;margin:9px 0 0;";

    const creditDetails = el("details", undefined, editorPanel);
    Object.assign(creditDetails.style, { marginTop: "12px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,.14)" });
    el("summary", "Model credits & licenses", creditDetails).style.fontWeight = "700";
    const creditList = el("div", undefined, creditDetails);
    Object.assign(creditList.style, { marginTop: "9px", fontSize: "11px", lineHeight: "1.6" });
    MORECRAFTS_CREDITS.forEach(credit => {
        const entry = el("div", undefined, creditList);
        Object.assign(entry.style, { marginBottom: "10px", overflowWrap: "anywhere" });
        el("strong", credit.model, entry);
        el("br", undefined, entry);
        el("span", "Author: " + credit.author + " · ", entry);
        const sourceLink = el("a", "Source", entry);
        sourceLink.href = credit.source;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        el("br", undefined, entry);
        el("span", "License: ", entry);
        const licenseLink = el("a", credit.license, entry);
        licenseLink.href = credit.licenseUrl;
        licenseLink.target = "_blank";
        licenseLink.rel = "noopener noreferrer";
    });
    el("p", "Model-to-file correspondence has not been independently verified. Consult original model pages for attribution and license terms.", creditList).style.opacity = ".75";

    launcherButton.addEventListener("click", () => {
        editorPanel.style.display = editorPanel.style.display === "none" ? "block" : "none";
    });
    refreshSliders();
    notify("独立スライダーUIを起動しました");
}

function startMoreCrafts() {
    if (window.__MORECRAFTS_SLIDER_UI_V3__) return;
    if (!window.geofs || !geofs.aircraft || !geofs.aircraft.instance || typeof geofs.aircraft.instance.load !== "function" || !document.body) return false;
    window.__MORECRAFTS_SLIDER_UI_V3__ = true;

    // Remove the previous version's attached GeoFS UI. The editor below is fully independent.
    document.querySelectorAll(".geofs-morecrafts-list").forEach(node => node.remove());
    document.querySelectorAll('button[data-toggle-panel=".geofs-morecrafts-list"]').forEach(node => node.remove());
    if (window.morecraftsHideInterval) clearInterval(window.morecraftsHideInterval);
    if (window.__MORECRAFTS_UI_V2__) window.morecraftsEnabled = false;

    const instance = geofs.aircraft.instance;
    const previousLoad = instance.load;
    instance.load = function(id, t, a, o) {
        const isMoreCrafts = MORECRAFTS.some(item => Number(item.base) === Number(id));
        if (!isMoreCrafts) {
            window.morecraftsEnabled = false;
            loadGeneration++;
            if (applyTimeout) clearTimeout(applyTimeout);
            applyTimeout = null;
            stopHideInterval();
        }
        return previousLoad.call(this, id, t, a, o);
    };

    mountUI();
    delete window.__MORECRAFTS_SLIDER_UI_V3_WAITING__;
    console.log("[MoreCrafts] Independent slider UI ready. Aircraft:", MORECRAFTS.length);
    return true;
}

let startupAttempts = 0;
const startupTimer = setInterval(() => {
    startupAttempts++;
    if (startMoreCrafts()) {
        clearInterval(startupTimer);
    } else if (startupAttempts > 240) {
        clearInterval(startupTimer);
        delete window.__MORECRAFTS_SLIDER_UI_V3__;
        delete window.__MORECRAFTS_SLIDER_UI_V3_WAITING__;
        console.error("[MoreCrafts] GeoFS aircraft system was not found. Run this script after GeoFS finishes loading.");
    }
}, 250);

})();
