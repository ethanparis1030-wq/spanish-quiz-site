(function () {
  const MARK = "SPANISH_RESCUE_PATCH_V1";
  if (window[MARK]) return;
  window[MARK] = true;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c];
    });
  }

  function normalizeText(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[¿¡]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function shouldTakeOver() {
    const moduleSelect = $("moduleSelect");
    const batchSelect = $("batchSelect");
    const prompt = $("prompt");

    if (!moduleSelect || !batchSelect || !prompt) return false;

    const promptText = (prompt.textContent || "").trim();
    const moduleEmpty = moduleSelect.options.length === 0;
    const batchEmpty = batchSelect.options.length === 0;
    const stillLoading = promptText === "载入中..." || promptText === "载入中…";

    return moduleEmpty || batchEmpty || stillLoading;
  }

  if (!shouldTakeOver()) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse($("quiz-data").textContent);
  } catch (e) {
    if ($("prompt")) $("prompt").textContent = "载入失败。内嵌 JSON 解析出错。";
    console.error(e);
    return;
  }

  const STORAGE_KEY = "spanish_merged_site_progress_v4";

  const state = {
    data: payload.questions || [],
    meta: payload.meta || {},
    filtered: [],
    queue: [],
    cursor: 0,
    current: null,
    progress: {
      stats: { answered: 0, correct: 0, wrong: 0 },
      perQuestion: {},
      missedIds: []
    }
  };

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          state.progress = parsed;
        }
      }
    } catch (e) {}

    if (!state.progress.stats) state.progress.stats = { answered: 0, correct: 0, wrong: 0 };
    if (!state.progress.perQuestion) state.progress.perQuestion = {};
    if (!Array.isArray(state.progress.missedIds)) state.progress.missedIds = [];
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress, null, 2));
    renderStats();
  }

  function isMissed(qid) {
    return (state.progress.missedIds || []).includes(qid);
  }

  function isMastered(qid) {
    const item = state.progress.perQuestion[qid];
    return !!(item && item.mastered);
  }

  function setSelectOptions(selectEl, items) {
    selectEl.innerHTML = "";
    items.forEach(function (item) {
      const option = document.createElement("option");
      option.value = item.key;
      option.textContent = item.label;
      selectEl.appendChild(option);
    });
  }

  function refreshModuleOptions() {
    const level = $("levelSelect").value;
    const moduleSelect = $("moduleSelect");

    if (level === "ALL") {
      setSelectOptions(moduleSelect, [{ key: "ALL", label: "全部" }]);
      moduleSelect.value = "ALL";
      return;
    }

    const items = state.meta.modules_by_level && state.meta.modules_by_level[level]
      ? state.meta.modules_by_level[level]
      : [{ key: "ALL", label: "全部" }];

    const oldValue = moduleSelect.value;
    setSelectOptions(moduleSelect, items);

    const allowed = new Set(items.map(function (x) { return x.key; }));
    moduleSelect.value = allowed.has(oldValue) ? oldValue : "ALL";
  }

  function refreshBatchOptions() {
    const level = $("levelSelect").value;
    const moduleKey = $("moduleSelect").value;
    const batchSelect = $("batchSelect");

    if (level === "ALL" || moduleKey === "ALL") {
      setSelectOptions(batchSelect, [{ key: "ALL", label: "全部" }]);
      batchSelect.value = "ALL";
      return;
    }

    const key = level + "::" + moduleKey;
    const items = state.meta.batches_by_level_module && state.meta.batches_by_level_module[key]
      ? state.meta.batches_by_level_module[key]
      : [{ key: "ALL", label: "全部" }];

    const oldValue = batchSelect.value;
    setSelectOptions(batchSelect, items);

    const allowed = new Set(items.map(function (x) { return x.key; }));
    batchSelect.value = allowed.has(oldValue) ? oldValue : "ALL";
  }

  function getScopePool() {
    const level = $("levelSelect").value;
    const moduleKey = $("moduleSelect").value;
    const batchKey = $("batchSelect").value;

    let arr = state.data.slice();

    if (level !== "ALL") {
      arr = arr.filter(function (q) { return q.level === level; });
    }

    if (moduleKey !== "ALL") {
      arr = arr.filter(function (q) { return q.module === moduleKey; });
    }

    if (batchKey !== "ALL") {
      arr = arr.filter(function (q) { return q.batch_key === batchKey; });
    }

    return arr;
  }

  function applyFilters() {
    let arr = getScopePool();
    const masteryMode = $("masteryModeSelect").value;

    if (masteryMode === "active") {
      arr = arr.filter(function (q) { return !isMastered(q.id); });
    } else if (masteryMode === "missed") {
      arr = arr.filter(function (q) { return isMissed(q.id); });
    }

    arr.sort(function (a, b) {
      if (a.level !== b.level) return a.level.localeCompare(b.level, "en");
      if (a.module_order !== b.module_order) return a.module_order - b.module_order;
      if (a.batch_order !== b.batch_order) return a.batch_order - b.batch_order;
      return a.id.localeCompare(b.id, "en");
    });

    state.filtered = arr;
    state.queue = arr.slice();
    state.cursor = 0;

    if ($("poolInfo")) {
      $("poolInfo").textContent =
        "当前筛选后共有 " + arr.length + " 题。默认模式下，答对的题会自动退出当前题池。";
    }

    renderStats();
    nextQuestion(true);
  }

  function renderStats() {
    if ($("poolCount")) $("poolCount").textContent = String(state.filtered.length || 0);
    if ($("answeredCount")) $("answeredCount").textContent = String(state.progress.stats.answered || 0);

    const answered = state.progress.stats.answered || 0;
    const correct = state.progress.stats.correct || 0;
    if ($("accuracy")) $("accuracy").textContent = answered ? Math.round((correct / answered) * 100) + "%" : "0%";

    if ($("missedCount")) $("missedCount").textContent = String((state.progress.missedIds || []).length);
  }

  function markMissed(questionId, isMissedFlag) {
    const set = new Set(state.progress.missedIds || []);
    if (isMissedFlag) set.add(questionId);
    else set.delete(questionId);
    state.progress.missedIds = Array.from(set);
  }

  function renderQuestion(q) {
    state.current = q;

    if ($("questionMeta")) {
      $("questionMeta").innerHTML =
        '<span class="tag">' + escapeHtml(q.level) + '</span>' +
        '<span class="tag">' + escapeHtml(q.module_label) + '</span>' +
        '<span class="tag">' + escapeHtml(q.batch_label) + '</span>' +
        '<span class="tag">' + escapeHtml(q.section_title) + '</span>' +
        '<span class="tag">ID: ' + escapeHtml(q.id) + '</span>';
    }

    if ($("prompt")) $("prompt").textContent = q.prompt;
    if ($("answerInput")) $("answerInput").value = "";
    if ($("feedback")) {
      $("feedback").className = "feedback";
      $("feedback").style.display = "none";
      $("feedback").textContent = "";
    }
    if ($("answerInput")) $("answerInput").focus();
  }

  function nextQuestion(forceFirst) {
    if (!state.queue.length) {
      if ($("questionMeta")) $("questionMeta").innerHTML = "";
      if ($("prompt")) $("prompt").textContent = "当前筛选下没有题。你可以切换板块、Batch，或者点“重新开始当前范围”。";
      if ($("feedback")) {
        $("feedback").className = "feedback";
        $("feedback").style.display = "none";
        $("feedback").textContent = "";
      }
      return;
    }

    if (forceFirst) state.cursor = 0;
    if (state.cursor >= state.queue.length) state.cursor = 0;

    renderQuestion(state.queue[state.cursor]);
    state.cursor += 1;
  }

  function showFeedback(kind, text) {
    const el = $("feedback");
    if (!el) return;
    el.className = "feedback " + kind;
    el.style.display = "block";
    el.textContent = text;
  }

  function removeCurrentFromPoolIfNeeded(qid) {
    const masteryMode = $("masteryModeSelect").value;
    if (masteryMode === "all") return;

    state.filtered = state.filtered.filter(function (q) { return q.id !== qid; });
    state.queue = state.queue.filter(function (q) { return q.id !== qid; });
    if (state.cursor > state.queue.length) state.cursor = state.queue.length;
    renderStats();
  }

  function submitAnswer() {
    const q = state.current;
    if (!q) return;

    const userRaw = $("answerInput").value;
    const user = normalizeText(userRaw);
    const answers = (q.answers || []).map(normalizeText).filter(Boolean);
    const ok = answers.includes(user);

    state.progress.stats.answered += 1;

    if (!state.progress.perQuestion[q.id]) {
      state.progress.perQuestion[q.id] = {
        attempts: 0,
        correct: 0,
        wrong: 0,
        lastUserAnswer: "",
        mastered: false
      };
    }

    const item = state.progress.perQuestion[q.id];
    item.attempts += 1;
    item.lastUserAnswer = userRaw;

    if (ok) {
      state.progress.stats.correct += 1;
      item.correct += 1;
      item.mastered = true;
      markMissed(q.id, false);

      const msg = ["答对了。", "", "标准答案："].concat(q.answers || []);
      if (q.explanation) msg.push("", "解释：", q.explanation);

      showFeedback("ok", msg.join("\n"));
      saveProgress();
      removeCurrentFromPoolIfNeeded(q.id);

      if ($("autoNext") && $("autoNext").checked) {
        setTimeout(function () { nextQuestion(false); }, 450);
      }
    } else {
      state.progress.stats.wrong += 1;
      item.wrong += 1;
      item.mastered = false;
      markMissed(q.id, true);

      const msg = [
        "这题错了。",
        "",
        "你的答案：" + (userRaw || "(空白)"),
        "",
        "标准答案："
      ].concat(q.answers || []);

      if (q.explanation) msg.push("", "解释：", q.explanation);

      showFeedback("bad", msg.join("\n"));
      saveProgress();
    }
  }

  function revealAnswer() {
    const q = state.current;
    if (!q) return;

    const msg = ["标准答案："].concat(q.answers || []);
    if (q.explanation) msg.push("", "解释：", q.explanation);

    showFeedback("info", msg.join("\n"));
  }

  function resetFilters() {
    $("levelSelect").value = "ALL";
    refreshModuleOptions();
    refreshBatchOptions();
    $("masteryModeSelect").value = "active";
    if ($("autoNext")) $("autoNext").checked = false;
    applyFilters();
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "spanish_merged_progress.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(reader.result);
        state.progress = parsed;
        saveProgress();
        applyFilters();
      } catch (e) {
        alert("导入失败：这不是有效的 JSON 进度文件。");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function resetCurrentScope() {
    const scope = getScopePool();
    if (!scope.length) {
      alert("当前范围里没有题可重置。");
      return;
    }

    const ok = confirm("确定要把“当前筛选范围”里的题重置成可重做吗？");
    if (!ok) return;

    const ids = new Set(scope.map(function (q) { return q.id; }));
    const nextPer = {};

    Object.keys(state.progress.perQuestion || {}).forEach(function (qid) {
      if (!ids.has(qid)) {
        nextPer[qid] = state.progress.perQuestion[qid];
      }
    });

    state.progress.perQuestion = nextPer;
    state.progress.missedIds = (state.progress.missedIds || []).filter(function (qid) { return !ids.has(qid); });
    saveProgress();
    applyFilters();
  }

  function resetAllProgress() {
    const ok = confirm("确定要清空全部进度和错题吗？");
    if (!ok) return;

    localStorage.removeItem(STORAGE_KEY);
    state.progress = {
      stats: { answered: 0, correct: 0, wrong: 0 },
      perQuestion: {},
      missedIds: []
    };
    saveProgress();
    applyFilters();
  }

  function bindOnce(elm, event, key, handler) {
    if (!elm) return;
    if (elm.dataset[key] === "1") return;
    elm.dataset[key] = "1";
    elm.addEventListener(event, handler);
  }

  function init() {
    loadProgress();

    refreshModuleOptions();
    refreshBatchOptions();

    if ($("poolInfo")) {
      $("poolInfo").textContent =
        "总题数 " + (payload.meta.total_questions || 0) +
        "。A1: " + (payload.meta.a1_questions || 0) +
        "，A2: " + (payload.meta.a2_questions || 0) + "。";
    }

    renderStats();
    applyFilters();

    bindOnce($("levelSelect"), "change", "rescueBoundLevel", function () {
      refreshModuleOptions();
      refreshBatchOptions();
      applyFilters();
    });

    bindOnce($("moduleSelect"), "change", "rescueBoundModule", function () {
      refreshBatchOptions();
      applyFilters();
    });

    bindOnce($("batchSelect"), "change", "rescueBoundBatch", applyFilters);
    bindOnce($("masteryModeSelect"), "change", "rescueBoundMastery", applyFilters);

    bindOnce($("applyBtn"), "click", "rescueBoundApply", applyFilters);
    bindOnce($("resetFilterBtn"), "click", "rescueBoundResetFilter", resetFilters);
    bindOnce($("resetCurrentScopeBtn"), "click", "rescueBoundResetScope", resetCurrentScope);

    bindOnce($("submitBtn"), "click", "rescueBoundSubmit", submitAnswer);
    bindOnce($("showBtn"), "click", "rescueBoundShow", revealAnswer);
    bindOnce($("nextBtn"), "click", "rescueBoundNext", function () { nextQuestion(false); });

    bindOnce($("exportBtn"), "click", "rescueBoundExport", exportProgress);
    bindOnce($("importBtn"), "click", "rescueBoundImport", function () {
      if ($("importFile")) $("importFile").click();
    });

    bindOnce($("importFile"), "change", "rescueBoundImportFile", function (e) {
      const file = e.target.files[0];
      if (file) importProgress(file);
      e.target.value = "";
    });

    bindOnce($("resetProgressBtn"), "click", "rescueBoundResetProgress", resetAllProgress);

    bindOnce($("answerInput"), "keydown", "rescueBoundAnswer", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        submitAnswer();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
