(function () {
  const campaign = window.YURUKAMI_CAMPAIGN;
  const eventKey = "yk_ningenkai_shingi_events";
  const leadKey = "yk_ningenkai_shingi_leads";
  const params = new URLSearchParams(window.location.search);
  const operatorMode = params.get("operator") === "1" ||
    window.location.protocol === "file:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const state = {
    questionIndex: 0,
    scores: {},
    answers: [],
    result: null,
  };

  const byId = (id) => document.getElementById(id);
  const questionText = byId("question-text");
  const questionCount = byId("question-count");
  const progressBar = byId("progress-bar");
  const choicesEl = byId("choices");
  const restartButton = byId("restart-button");
  const eventCountEl = byId("event-count");

  function safeRead(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // Local storage may be blocked in some preview environments.
    }
  }

  function getEvents() {
    return safeRead(eventKey, []);
  }

  function getLeads() {
    return safeRead(leadKey, []);
  }

  function sendEvent(event) {
    const endpoint = window.YURUKAMI_EVENT_ENDPOINT;
    if (!endpoint) return;
    const body = JSON.stringify(event);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(endpoint, blob);
        return;
      }
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch (_error) {
      // Keep local tracking functional even if the collector is unavailable.
    }
  }

  function track(eventName, payload = {}) {
    const event = {
      eventName,
      campaignId: campaign.meta.campaignId,
      occurredAt: new Date().toISOString(),
      path: window.location.pathname,
      source: params.get("utm_source") || "direct_local",
      medium: params.get("utm_medium") || "local",
      campaign: params.get("utm_campaign") || campaign.meta.campaignId,
      content: params.get("utm_content") || "",
      ...payload,
    };
    const events = getEvents();
    events.push(event);
    safeWrite(eventKey, events);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(event);
    sendEvent(event);
    updateEventCount();
  }

  function updateEventCount() {
    if (eventCountEl) {
      eventCountEl.textContent = `${getEvents().length}件`;
    }
  }

  function characterById(id) {
    return campaign.characters.find((character) => character.id === id);
  }

  function imagePath(character, variant = "chibi") {
    const base = variant === "normal" ? campaign.paths.normalBase : campaign.paths.chibiBase;
    return `${base}${character[variant]}`;
  }

  function setCharacterImages() {
    document.querySelectorAll("[data-character-image]").forEach((img) => {
      const character = characterById(img.dataset.characterImage);
      if (!character) return;
      img.src = imagePath(character);
      img.alt = character.name;
    });
  }

  function resetScores() {
    state.scores = {};
    campaign.characters.forEach((character) => {
      state.scores[character.id] = 0;
    });
  }

  function renderQuestion() {
    const questions = campaign.diagnosis.questions;
    const question = questions[state.questionIndex];
    const displayIndex = state.questionIndex + 1;
    questionText.textContent = question.text;
    questionCount.textContent = `${displayIndex} / ${questions.length}`;
    progressBar.style.width = `${(displayIndex / questions.length) * 100}%`;
    choicesEl.innerHTML = "";

    question.choices.forEach((choice, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.textContent = choice.label;
      button.addEventListener("click", () => answerQuestion(question, choice, index));
      choicesEl.appendChild(button);
    });
  }

  function answerQuestion(question, choice, choiceIndex) {
    Object.entries(choice.weights).forEach(([characterId, points]) => {
      state.scores[characterId] = (state.scores[characterId] || 0) + points;
    });
    state.answers.push({ questionId: question.id, choiceIndex, choice: choice.label });
    track("diagnosis_answer", {
      questionId: question.id,
      choice: choice.label,
      questionIndex: state.questionIndex + 1,
    });

    if (state.questionIndex >= campaign.diagnosis.questions.length - 1) {
      completeDiagnosis();
      return;
    }

    state.questionIndex += 1;
    renderQuestion();
  }

  function completeDiagnosis() {
    const ranked = Object.entries(state.scores)
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    state.result = characterById(ranked[0].id);
    renderResult(state.result, ranked);
    track("diagnosis_complete", {
      characterId: state.result.id,
      characterName: state.result.name,
      score: ranked[0].score,
      answers: state.answers,
    });
  }

  function renderResult(character, ranked) {
    byId("result").hidden = false;
    byId("result-name").textContent = `${character.name} が付きました`;
    byId("result-line").textContent = character.diagnosisLine;
    byId("result-chibi").src = imagePath(character);
    byId("result-chibi").alt = character.name;
    byId("result-fuda-title").textContent = character.fudaTitle;
    byId("result-fuda-text").textContent = character.fudaText;
    byId("result-fuda-god").textContent = `${character.name} / ${character.role}`;
    byId("lead-character").value = character.id;
    byId("result").scrollIntoView({ behavior: "smooth", block: "start" });
    const resultFuda = byId("result-fuda");
    resultFuda.style.setProperty("--card-color", character.color);
    resultFuda.dataset.resultScores = JSON.stringify(ranked);
  }

  function restartDiagnosis() {
    state.questionIndex = 0;
    state.answers = [];
    state.result = null;
    resetScores();
    byId("result").hidden = true;
    renderQuestion();
    track("diagnosis_restart");
  }

  function renderLeadCharacters() {
    const select = byId("lead-character");
    select.innerHTML = "";
    campaign.characters.forEach((character) => {
      const option = document.createElement("option");
      option.value = character.id;
      option.textContent = character.name;
      select.appendChild(option);
    });
  }

  function renderFudaGrid() {
    const grid = byId("fuda-grid");
    grid.innerHTML = "";
    campaign.characters.forEach((character) => {
      const tile = document.createElement("article");
      tile.className = "fuda-tile";
      tile.innerHTML = `
        <div class="fuda-person">
          <img src="${imagePath(character)}" alt="${character.name}">
          <div>
            <b>${character.name}</b>
            <span>${character.role}</span>
          </div>
        </div>
        <div class="fuda-card mini-fuda">
          <span class="fuda-seal">神託</span>
          <h3>${character.fudaTitle}</h3>
          <p>${character.fudaText}</p>
          <small>${character.promise}</small>
        </div>
        <div class="fuda-actions">
          <button type="button" data-fuda-select="${character.id}">この神で受け取る</button>
          <button type="button" data-fuda-interest="${character.id}">商品化希望</button>
        </div>
      `;
      tile.querySelector("[data-fuda-select]").addEventListener("click", () => {
        byId("lead-character").value = character.id;
        track("fuda_select", { characterId: character.id, characterName: character.name });
        byId("owned-fan-form").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      tile.querySelector("[data-fuda-interest]").addEventListener("click", () => {
        track("product_interest", {
          product: "free_fuda_to_paid_pack",
          characterId: character.id,
          characterName: character.name,
        });
        tile.querySelector("[data-fuda-interest]").textContent = "希望を記録";
      });
      grid.appendChild(tile);
    });
  }

  function renderProductLadder() {
    const ladder = byId("product-ladder");
    ladder.innerHTML = "";
    campaign.products.forEach((product) => {
      const item = document.createElement("article");
      item.className = "product-step";
      item.innerHTML = `
        <span class="tier">${product.tier}</span>
        <h3>${product.name}</h3>
        <p>${product.promise}</p>
        <strong>${product.price === 0 ? "無料" : `${product.price.toLocaleString("ja-JP")}円`}</strong>
      `;
      item.addEventListener("click", () => {
        track("product_interest", {
          productTier: product.tier,
          productName: product.name,
          price: product.price,
        });
      });
      ladder.appendChild(item);
    });
  }

  function renderShortsSummary() {
    const summary = byId("shorts-summary");
    const bySeries = new Map();
    campaign.shortSeries.forEach((short) => {
      bySeries.set(short.series, (bySeries.get(short.series) || 0) + 1);
    });
    summary.innerHTML = "";
    Array.from(bySeries.entries()).forEach(([series, count]) => {
      const item = document.createElement("article");
      item.className = "series-chip";
      item.innerHTML = `<b>${series}</b><span>${count}本</span>`;
      summary.appendChild(item);
    });
  }

  function setupLeadForm() {
    const form = byId("lead-form");
    const message = byId("lead-message");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const character = characterById(formData.get("character"));
      const lead = {
        createdAt: new Date().toISOString(),
        name: String(formData.get("name") || "").trim(),
        contact: String(formData.get("contact") || "").trim(),
        characterId: character.id,
        characterName: character.name,
        source: params.get("utm_source") || "direct_local",
        content: params.get("utm_content") || "",
      };
      const leads = getLeads();
      leads.push(lead);
      safeWrite(leadKey, leads);
      track("owned_fan_local_submit", {
        characterId: character.id,
        characterName: character.name,
        hasContact: lead.contact.length > 0,
      });
      message.textContent = `${character.shortName}の先行案内として記録しました。`;
    });
  }

  function csvEscape(value) {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv(filename, rows) {
    if (!rows.length) {
      return;
    }
    const headers = Array.from(rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set()));
    const csv = [
      headers.map(csvEscape).join(","),
      ...rows.map((row) => headers.map((header) => csvEscape(
        typeof row[header] === "object" ? JSON.stringify(row[header]) : row[header],
      )).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setupOperatorPanel() {
    if (operatorMode) {
      document.querySelectorAll("[data-operator-only]").forEach((element) => {
        element.hidden = false;
      });
    }
    const toggle = byId("operator-toggle");
    const body = byId("operator-body");
    toggle.addEventListener("click", () => {
      body.hidden = !body.hidden;
      track("operator_panel_toggle", { open: !body.hidden });
    });
    byId("export-events").addEventListener("click", () => {
      track("analytics_export", { type: "events" });
      exportCsv("yk_ningenkai_shingi_events.csv", getEvents());
    });
    byId("clear-events").addEventListener("click", () => {
      safeWrite(eventKey, []);
      updateEventCount();
    });
  }

  function setupCtaTracking() {
    document.querySelectorAll("[data-cta]").forEach((element) => {
      element.addEventListener("click", () => {
        track("cta_click", {
          cta: element.dataset.cta,
          resultCharacterId: state.result ? state.result.id : "",
        });
      });
    });
    document.querySelectorAll("[data-track-link]").forEach((element) => {
      element.addEventListener("click", () => {
        track("nav_click", { linkId: element.dataset.trackLink, href: element.getAttribute("href") });
      });
    });
  }

  function init() {
    resetScores();
    setCharacterImages();
    renderLeadCharacters();
    renderFudaGrid();
    renderProductLadder();
    renderShortsSummary();
    renderQuestion();
    setupLeadForm();
    setupOperatorPanel();
    setupCtaTracking();
    restartButton.addEventListener("click", restartDiagnosis);
    updateEventCount();
    track("page_view", {
      title: document.title,
      referrer: document.referrer,
    });
  }

  init();
}());
