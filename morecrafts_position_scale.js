(() => {
"use strict";

if (window.__MORECRAFTS_UI_V2__) {
    ui.notification.show("MoreCrafts is already running");
    return;
}
window.__MORECRAFTS_UI_V2__ = true;

console.log("[MoreCrafts] Position & Scale Editor");

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
    return {position:item.position.slice(), size:1};
}

function validSettings(value, item) {
    if (!value || !Array.isArray(value.position) ||
        value.position.length !== 3 ||
        !value.position.every(n => typeof n === "number" && Number.isFinite(n)) ||
        typeof value.size !== "number" || !Number.isFinite(value.size) ||
        value.size <= 0) return defaultSettings(item);

    return {position:value.position.slice(), size:Math.min(value.size,10000)};
}

function readSettings() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
    } catch (err) {
        console.warn("[MoreCrafts] Settings read failed:", err);
    }
    const result = {};
    MORECRAFTS.forEach(item => {
        result[item.base] = validSettings(saved[item.base], item);
    });
    return result;
}

const SETTINGS = readSettings();

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(SETTINGS));
        return true;
    } catch (err) {
        console.error("[MoreCrafts] Settings save failed:", err);
        ui.notification.show("Settings could not be saved");
        return false;
    }
}

window.morecraftsEnabled = false;
let selectedAircraft = null;
let loadGeneration = 0;
let applyTimeout = null;
let editorPanel = null;
let hideInterval = null;
let positionInputs = [];
let sizeInput = null;
let editorTitle = null;
let editorStatus = null;

function stopHideInterval() {
    if (hideInterval) {
        clearInterval(hideInterval);
        hideInterval = null;
    }
    if (window.morecraftsHideInterval) {
        clearInterval(window.morecraftsHideInterval);
        window.morecraftsHideInterval = null;
    }
}

function hideNativeAircraft() {
    if (!window.morecraftsEnabled) return;
    try {
        const ac = geofs.aircraft.instance;
        const root = ac.parts && ac.parts.root;
        if (!root) return;
        if (root.object3d) root.object3d.visible = false;
        if (root.object3d && root.object3d._model) {
            root.object3d._model.show = false;
        }
    } catch (err) {
        console.warn("[MoreCrafts] Hide error:", err);
    }
}

const originalLoad = geofs.aircraft.instance.load;

geofs.aircraft.instance.load = function(id, t, a, o) {
    const isMoreCrafts = MORECRAFTS.some(item => item.base == id);
    if (!isMoreCrafts) {
        window.morecraftsEnabled = false;
        selectedAircraft = null;
        loadGeneration++;
        if (applyTimeout) {
            clearTimeout(applyTimeout);
            applyTimeout = null;
        }
        stopHideInterval();
        if (editorPanel) editorPanel.style.display = "none";
    }
    return originalLoad.call(this, id, t, a, o);
};

function makeElement(tag, textContent, parent) {
    const el = document.createElement(tag);
    if (textContent !== undefined) el.textContent = textContent;
    if (parent) parent.appendChild(el);
    return el;
}

function styleButton(button) {
    Object.assign(button.style, {
        padding:"9px 8px",
        border:"1px solid rgba(128,128,128,.5)",
        borderRadius:"4px",
        background:"rgba(128,128,128,.14)",
        color:"inherit",
        fontSize:"12px",
        cursor:"pointer",
        minWidth:"0"
    });
}

function numberInput(parent, labelText, value, step) {
    const wrap = makeElement("label", undefined, parent);
    Object.assign(wrap.style, {
        display:"flex", flexDirection:"column", gap:"4px",
        minWidth:"0", fontSize:"12px"
    });
    makeElement("span", labelText, wrap);
    const input = makeElement("input", undefined, wrap);
    input.type = "number";
    input.step = step;
    input.value = String(value);
    input.inputMode = "decimal";
    Object.assign(input.style, {
        boxSizing:"border-box", width:"100%", minWidth:"0",
        padding:"8px 4px",
        border:"1px solid rgba(128,128,128,.5)",
        borderRadius:"4px",
        background:"rgba(128,128,128,.12)",
        color:"inherit", fontSize:"14px"
    });
    return input;
}

function refreshEditor() {
    if (!editorPanel || !selectedAircraft) return;
    const item = selectedAircraft;
    const settings = SETTINGS[item.base];
    editorTitle.textContent = item.name;
    positionInputs.forEach((input, i) => {
        input.value = String(settings.position[i]);
    });
    sizeInput.value = String(settings.size);
    editorStatus.textContent =
        "Position: X " + settings.position[0] +
        " / Y " + settings.position[1] +
        " / Z " + settings.position[2] +
        " | Scale ×" + settings.size;
}

function readEditor() {
    if (!selectedAircraft) return false;
    const position = positionInputs.map(input => Number(input.value));
    const size = Number(sizeInput.value);

    if (positionInputs.some(input => input.value.trim() === "") ||
        sizeInput.value.trim() === "" ||
        !position.every(Number.isFinite) ||
        !Number.isFinite(size) || size <= 0 || size > 10000) {
        ui.notification.show("Enter valid numbers. Scale must be above 0.");
        return false;
    }

    SETTINGS[selectedAircraft.base] = {position, size};
    return true;
}

function createEditor(parent) {
    editorPanel = makeElement("div", undefined, parent);
    editorPanel.className = "morecrafts-editor";
    Object.assign(editorPanel.style, {
        display:"none", padding:"12px",
        borderBottom:"1px solid rgba(128,128,128,.35)",
        boxSizing:"border-box"
    });

    editorTitle = makeElement("h4", "Aircraft settings", editorPanel);
    Object.assign(editorTitle.style, {margin:"0 0 8px 0",fontSize:"15px"});

    makeElement("div", "Position (X / Y / Z)", editorPanel).style.cssText =
        "font-size:12px;margin-bottom:6px;";

    const positionRow = makeElement("div", undefined, editorPanel);
    Object.assign(positionRow.style, {
        display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:"6px"
    });

    positionInputs = [
        numberInput(positionRow, "X", 0, "0.1"),
        numberInput(positionRow, "Y", 0, "0.1"),
        numberInput(positionRow, "Z", 0, "0.1")
    ];

    const sizeRow = makeElement("div", undefined, editorPanel);
    Object.assign(sizeRow.style, {
        display:"grid", gridTemplateColumns:"minmax(0,1fr)",
        gap:"6px", marginTop:"10px"
    });

    sizeInput = numberInput(sizeRow, "Scale multiplier (1 = original size)", 1, "0.01");

    const buttonRow = makeElement("div", undefined, editorPanel);
    Object.assign(buttonRow.style, {
        display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))",
        gap:"6px", marginTop:"10px"
    });

    const applyButton = makeElement("button", "Apply / Reload", buttonRow);
    applyButton.type = "button";
    styleButton(applyButton);
    applyButton.addEventListener("click", () => {
        if (!readEditor()) return;
        saveSettings();
        loadCustomAircraft(selectedAircraft, true);
    });

    const saveButton = makeElement("button", "Save", buttonRow);
    saveButton.type = "button";
    styleButton(saveButton);
    saveButton.addEventListener("click", () => {
        if (!readEditor()) return;
        if (saveSettings()) {
            refreshEditor();
            ui.notification.show("Saved: " + selectedAircraft.name);
        }
    });

    const resetButton = makeElement("button", "Reset to Default", editorPanel);
    resetButton.type = "button";
    styleButton(resetButton);
    Object.assign(resetButton.style, {width:"100%",marginTop:"6px"});
    resetButton.addEventListener("click", () => {
        if (!selectedAircraft) return;
        SETTINGS[selectedAircraft.base] = defaultSettings(selectedAircraft);
        refreshEditor();
        saveSettings();
        ui.notification.show("Reset: " + selectedAircraft.name);
        loadCustomAircraft(selectedAircraft, true);
    });

    editorStatus = makeElement("div", "", editorPanel);
    Object.assign(editorStatus.style, {
        fontSize:"11px", opacity:".8", marginTop:"8px",
        lineHeight:"1.5", overflowWrap:"anywhere"
    });

    makeElement(
        "p",
        "Position values use the same units as the original part position. Scale multiplies all three original scale values.",
        editorPanel
    ).style.cssText = "font-size:11px;line-height:1.5;opacity:.8;margin:8px 0 0;";
}

function loadCustomAircraft(item, reload) {
    if (!item) return;

    selectedAircraft = item;
    window.morecraftsEnabled = true;
    const generation = ++loadGeneration;

    if (applyTimeout) {
        clearTimeout(applyTimeout);
        applyTimeout = null;
    }
    stopHideInterval();

    if (editorPanel) {
        editorPanel.style.display = "block";
        refreshEditor();
    }

    ui.notification.show("Loading " + item.name);

    try {
        geofs.aircraft.instance.load(item.base);
    } catch (err) {
        console.error("[MoreCrafts] Native load failed:", err);
        ui.notification.show("Native aircraft load failed");
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
                if (generation !== loadGeneration) {
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
                name:partName,
                model:item.glb,
                rotation:item.rotation.slice(),
                position:settings.position.slice(),
                scale:actualScale
            }]);

            const credit = getCredit(item.name);
            console.log("[MoreCrafts] Loaded:", item.name);
            console.log("[MoreCrafts] GLB:", item.glb);
            console.log("[MoreCrafts] Position:", settings.position);
            console.log("[MoreCrafts] Scale:", actualScale);
            console.log("[MoreCrafts] Credit:", credit || "Not matched");
            ui.notification.show(item.name + " loaded");
        } catch (err) {
            console.error("[MoreCrafts] Load error:", err);
            ui.notification.show("MoreCrafts Error");
        }
    }, 2500);
}

const wait = setInterval(() => {
    const aircraftButton = document.querySelector(
        'button[data-toggle-panel=".geofs-aircraft-list"]'
    );
    if (!aircraftButton) return;
    clearInterval(wait);

    const btn = aircraftButton.cloneNode(true);
    btn.textContent = "MoreCrafts";
    btn.setAttribute("data-toggle-panel", ".geofs-morecrafts-list");
    aircraftButton.parentNode.insertBefore(btn, aircraftButton);

    const panel = document.createElement("ul");
    panel.className = "geofs-list geofs-morecrafts-list geofs-toggle-panel";
    Object.assign(panel.style, {
        overflowY:"auto", maxHeight:"75vh", boxSizing:"border-box"
    });

    const header = makeElement("div", undefined, panel);
    Object.assign(header.style, {
        padding:"12px 20px",
        borderBottom:"1px solid rgba(128,128,128,.35)"
    });

    makeElement("h4", "MoreCrafts", header).style.margin = "0 0 10px 0";

    const details = makeElement("details", undefined, header);
    const summary = makeElement("summary", "Model Credits & Licenses", details);
    summary.style.cursor = "pointer";
    const creditList = makeElement("div", undefined, details);
    Object.assign(creditList.style, {
        marginTop:"10px", fontSize:"12px", lineHeight:"1.65", whiteSpace:"normal"
    });

    MORECRAFTS_CREDITS.forEach(credit => {
        const entry = makeElement("div", undefined, creditList);
        Object.assign(entry.style, {marginBottom:"12px",overflowWrap:"anywhere"});
        makeElement("strong", credit.model, entry);
        makeElement("br", undefined, entry);
        makeElement("span", "Author: " + credit.author, entry);
        makeElement("br", undefined, entry);
        makeElement("span", "Source: ", entry);
        const sourceLink = makeElement("a", "Sketchfab model", entry);
        sourceLink.href = credit.source;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        makeElement("br", undefined, entry);
        makeElement("span", "License: ", entry);
        const licenseLink = makeElement("a", credit.license, entry);
        licenseLink.href = credit.licenseUrl;
        licenseLink.target = "_blank";
        licenseLink.rel = "noopener noreferrer";
    });

    makeElement(
        "p",
        "Model-to-file correspondence has not been independently verified. Consult the original model pages for attribution and license terms.",
        creditList
    ).style.fontSize = "11px";

    const aircraftPanel = document.querySelector(".geofs-aircraft-list");
    if (!aircraftPanel || !aircraftPanel.parentNode) {
        console.error("[MoreCrafts] Aircraft panel not found");
        btn.remove();
        panel.remove();
        return;
    }

    aircraftPanel.parentNode.insertBefore(panel, aircraftPanel.nextSibling);
    createEditor(panel);

    MORECRAFTS.forEach(item => {
        const li = makeElement("li", item.name, panel);
        li.dataset.base = String(item.base);
        Object.assign(li.style, {
            cursor:"pointer", padding:"9px 20px", overflowWrap:"anywhere"
        });

        const credit = getCredit(item.name);
        li.title = credit ? "Model by " + credit.author : "Credit not matched";

        li.addEventListener("click", () => {
            selectedAircraft = item;
            if (editorPanel) {
                editorPanel.style.display = "block";
                refreshEditor();
            }
            loadCustomAircraft(item, false);
        });
    });

    if (window.componentHandler) window.componentHandler.upgradeDom();
    console.log("[MoreCrafts] UI ready");
    console.log("[MoreCrafts] Aircraft:", MORECRAFTS.length);
    console.log("[MoreCrafts] Per-aircraft settings enabled");
}, 500);

})();
